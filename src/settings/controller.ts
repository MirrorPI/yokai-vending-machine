import type { Command, GameRepository, ReadResult } from '../domain/repository.ts';
import type { GameState, Settings } from '../domain/state.ts';
type Patch = Extract<Command, { type: 'changeSettings' }>['patch'];
export interface SettingsSnapshot {
  phase: 'loading' | 'ready' | 'saving' | 'error'; settings: Settings | null;
  state: GameState | null; origin: 'empty' | 'stored' | 'migrated' | null; error: string | null;
}
/** One serial writer; only unsaved field intents are merged, never a full snapshot. */
export class SettingsController {
  readonly ports: { repository: GameRepository; subscribeChanges?(changed: () => void): () => void };
  #snapshot: SettingsSnapshot = { phase: 'loading', settings: null, state: null, origin: null, error: null };
  #listeners = new Set<() => void>();
  #viewed = new Set<string>();
  #pending: Patch = {}; #complete = false; #dirty = false;
  #work: Promise<void> | null = null; #read = 0; #unsubscribe: (() => void) | null = null;
  constructor(ports: SettingsController['ports']) { this.ports = ports; }
  get snapshot() { return this.#snapshot; }
  subscribe = (fn: () => void) => { this.#listeners.add(fn); return () => { this.#listeners.delete(fn); }; };
  #publish(patch: Partial<SettingsSnapshot>) { this.#snapshot = { ...this.#snapshot, ...patch }; this.#listeners.forEach(fn => fn()); }
  start() { this.#unsubscribe ??= this.ports.subscribeChanges?.(() => { void this.refresh(); }) ?? null; return this.refresh(); }
  stop() { this.#unsubscribe?.(); this.#unsubscribe = null; ++this.#read; }
  async refresh(): Promise<ReadResult> {
    const token = ++this.#read;
    const result = await this.ports.repository.read();
    if (token !== this.#read) return result;
    if (result.status !== 'ok') { this.#publish({ phase: 'error', error: `설정을 읽지 못했어요 (${result.status}).` }); return result; }
    if ((this.#snapshot.state?.revision ?? -1) > result.state.revision) return result;
    this.#publish({ state: result.state, origin: result.origin,
      settings: this.#dirty || this.#work ? this.#snapshot.settings : result.state.settings,
      ...(!this.#dirty && !this.#work ? { phase: 'ready' as const, error: null } : {}) });
    return result;
  }
  change(patch: Patch) {
    if (!this.#snapshot.settings) return;
    ++this.#read; this.#pending = { ...this.#pending, ...patch }; this.#dirty = true;
    this.#publish({ settings: { ...this.#snapshot.settings, ...patch } });
    if (this.#snapshot.phase !== 'error') this.#run();
  }
  completeTutorial() { ++this.#read; this.#complete = true; this.#dirty = true; if (this.#snapshot.phase !== 'error') this.#run(); }
  markCutsceneViewed(id: string) {
    if (this.#snapshot.state?.viewedCutscenes?.[id]) return;
    ++this.#read; this.#viewed.add(id); this.#dirty = true;
    if (this.#snapshot.phase !== 'error') this.#run();
  }
  #run() {
    if (this.#work) return;
    this.#publish({ phase: 'saving', error: null });
    this.#work = this.#drain().finally(() => {
      this.#work = null;
      if (this.#dirty && this.#snapshot.phase !== 'error') this.#run();
    });
  }
  async #drain() {
    while (this.#dirty) {
      const patch = this.#pending, complete = this.#complete, viewed = [...this.#viewed];
      this.#viewed.clear();
      this.#pending = {}; this.#complete = false; this.#dirty = false;
      let result;
      try {
        // Photo completion and tutorial completion can race at the remote CAS.
        // Retry only this idempotent partial intent; each commit reads fresh state.
        for (let attempt = 0; attempt < 3; attempt++) {
          result = await this.ports.repository.commit({ type: 'changeSettings', patch, ...(viewed.length ? { viewedCutscenes: viewed } : {}), ...(complete ? { firstRunDone: true } : {}) });
          if (result.status !== 'conflict') break;
        }
      }
      catch { result = { status: 'unavailable' as const }; }
      ++this.#read;
      if (!result || (result.status !== 'applied' && result.status !== 'unchanged')) {
        for (const id of viewed) this.#viewed.add(id);
        this.#pending = { ...patch, ...this.#pending }; this.#complete ||= complete; this.#dirty = true;
        this.#publish({ phase: 'error', error: `설정을 저장하지 못했어요 (${result?.status ?? 'unavailable'}). 선택을 유지했어요.` });
        return;
      }
      const state = (this.#snapshot.state?.revision ?? -1) > result.state.revision ? this.#snapshot.state! : result.state;
      this.#publish({ state, settings: { ...state.settings, ...this.#pending },
        phase: this.#dirty ? 'saving' : 'ready', error: null });
    }
  }
  async idle() { while (this.#work) await this.#work; }
  async retry() {
    await this.idle();
    if (this.#dirty) { this.#run(); await this.idle(); }
    else await this.refresh();
  }
}
