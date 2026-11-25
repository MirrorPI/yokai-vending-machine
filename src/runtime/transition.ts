import type { PreparedScene } from '../scene/bundle.ts';
import type { SceneInput, ScenePlan } from '../scene/types.ts';

export interface TransitionSample {
  readonly current: PreparedScene | null;
  readonly from: PreparedScene | null;
  readonly to: PreparedScene | null;
  readonly originMs: number | null;
  readonly durationMs: 3000;
  readonly sampledAt: number;
  readonly progress: number;
}
export interface TransitionState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly requested: Readonly<SceneInput> | null;
  readonly error: string | null;
}
/** Only empty complete map scenes may crossfade. A visiting body is never copied
 * into two maps. A06 can freeze sample() and its two immutable decoded bundles. */
export class SceneTransition {
  private readonly ports: { monotonic(): number; prepare(plan: ScenePlan): Promise<PreparedScene> };
  #version = 0;
  #locked = false;
  #current: PreparedScene | null = null;
  #fade: { from: PreparedScene; to: PreparedScene; originMs: number } | null = null;
  #pending: PreparedScene | null = null;
  #plan: ScenePlan | null = null;
  #state: TransitionState = Object.freeze({ status: 'idle', requested: null, error: null });
  constructor(ports: { monotonic(): number; prepare(plan: ScenePlan): Promise<PreparedScene> }) { this.ports = ports; }
  get state(): TransitionState { return this.#state; }
  get transitioning(): boolean { return this.#fade !== null; }
  #publish(patch: Partial<TransitionState>) { this.#state = Object.freeze({ ...this.#state, ...patch }); }
  request(plan: ScenePlan) {
    if (plan.input.yokaiId !== null || plan.layers.some(l => l.id !== 'background')) throw new Error('Crossfade accepts background-only plans');
    this.#plan = plan;
    this.#pending = null;
    const version = ++this.#version;
    this.#publish({ status: 'loading', requested: plan.input, error: null });
    void this.#prepare(plan, version);
  }
  async #prepare(plan: ScenePlan, version: number) {
    try {
      const bundle = await this.ports.prepare(plan);
      if (version !== this.#version) return;
      if (bundle.plan.mapId !== plan.mapId || bundle.plan.input.yokaiId !== null || bundle.plan.layers.some(l => l.id !== 'background')) throw new Error('Prepared background mismatch');
      this.#pending = bundle;
      this.#publish({ status: 'ready', error: null });
      this.#adopt();
    } catch (error) {
      if (version !== this.#version) return;
      this.#publish({ status: 'failed', error: String(error) });
    }
  }
  retry() { if (this.#state.status === 'failed' && this.#plan) this.request(this.#plan); }
  setLocked(locked: boolean) { this.#locked = locked; this.#adopt(); }
  #adopt() {
    if (this.#locked || this.#fade || !this.#pending) return;
    const next = this.#pending;
    this.#pending = null;
    if (!this.#current) this.#current = next;
    else if (this.#current.plan.mapId !== next.plan.mapId) this.#fade = { from: this.#current, to: next, originMs: this.ports.monotonic() };
  }
  tick() {
    if (this.#fade && this.ports.monotonic() >= this.#fade.originMs + 3000) {
      this.#current = this.#fade.to;
      this.#fade = null;
    }
    this.#adopt();
  }
  sample(nowMs = this.ports.monotonic()): TransitionSample {
    return Object.freeze({ current: this.#current, from: this.#fade?.from ?? null, to: this.#fade?.to ?? null,
      originMs: this.#fade?.originMs ?? null, durationMs: 3000, sampledAt: nowMs,
      progress: this.#fade ? Math.min(1, Math.max(0, (nowMs - this.#fade.originMs) / 3000)) : 1 });
  }
  cancel() {
    ++this.#version;
    this.#pending = null;
    this.#publish({ status: this.#current ? 'ready' : 'idle', error: null });
  }
}
