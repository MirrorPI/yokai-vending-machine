import type { GameRepository } from '../domain/repository.ts';
import type { ExecutionAuthority } from '../runtime/execution.ts';
import type { GameState, ObservationOwner } from '../domain/state.ts';
import { SAVE_KEY } from '../storage/driver.ts';
export const OBSERVATION_LOCK = `${SAVE_KEY}:observation`;
export interface SessionPorts {
  repository: GameRepository; lockName?: string; locks?: Pick<LockManager, 'request'>; sessionId: string; observable(): boolean;
}
export type ObservationPhase = 'preparing' | 'observing' | 'waiting' | 'unavailable';
/** A lifetime Web Lock selects the observer. Every persisted mutation still uses
 * the repository's DIFFERENT short writer lock. No lease or forced lock stealing. */
export class ObservationSession {
  readonly ports: SessionPorts;
  #owner: ObservationOwner | null = null;
  #generation = 0;
  #alive = false;
  #release: (() => void) | null = null;
  #pending: Promise<void> | null = null;
  #listeners = new Set<() => void>();
  status = '관찰권을 준비하고 있어요.';
  phase: ObservationPhase = 'preparing';
  constructor(ports: SessionPorts) { this.ports = ports; }
  subscribe = (fn: () => void) => { this.#listeners.add(fn); return () => { this.#listeners.delete(fn); }; };
  #publish(status: string, phase: ObservationPhase) { this.status = status; this.phase = phase; this.#listeners.forEach(fn => fn()); }
  authority = (): ExecutionAuthority => ({ owner: this.#owner, authorized: this.#alive && this.#release !== null && this.#owner !== null,
    observable: this.ports.observable() });
  start() { this.#alive = true; return this.acquire(); }
  acquire(): Promise<void> {
    if (!this.#alive || this.#owner || this.#pending || !this.ports.observable()) return this.#pending ?? Promise.resolve();
    if (!this.ports.locks) { this.#publish('이 브라우저에서는 안전한 관찰 잠금을 사용할 수 없어요. 수집을 시작하지 않아요.', 'unavailable'); return Promise.resolve(); }
    const gen = this.#generation;
    let done!: () => void;
    const ready = new Promise<void>(r => done = r);
    this.#pending = ready;
    void Promise.resolve().then(() => this.ports.locks!.request(this.ports.lockName ?? OBSERVATION_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock || !this.#alive || gen !== this.#generation) { this.#publish('다른 탭에서 관찰 중이에요.', 'waiting'); done(); return; }
      const hold = new Promise<void>(r => this.#release = r);
      try {
        this.#publish('관찰권을 준비하고 있어요.', 'preparing');
        const read = await this.ports.repository.read({fresh:true});
        if (!this.#alive || gen !== this.#generation) return;
        if (read.status !== 'ok') { this.#publish('관찰권 저장을 확인하지 못했어요. 다시 시도해 주세요.', 'unavailable'); return; }
        const epoch = read.state.observationOwner?.epoch ?? 0;
        let result;
        try { result = await this.ports.repository.commit({ type: 'claimObservation', sessionId: this.ports.sessionId, expectedEpoch: epoch },
          { expectedRevision: read.state.revision, guard: () => this.#alive && gen === this.#generation && this.ports.observable() }); }
        catch { result = null; }
        // A lost response never invents ownership. Read exactly our expected epoch.
        let state: GameState | null = null;
        if (result?.status === 'applied' || result?.status === 'unchanged') state = result.state;
        else { const latest = await this.ports.repository.read({fresh:true}); if (latest.status === 'ok') state = latest.state; }
        if (!this.#alive || gen !== this.#generation || !state || state.observationOwner?.sessionId !== this.ports.sessionId || state.observationOwner.epoch !== epoch + 1) {
          this.#publish('관찰권 저장을 확인하지 못했어요. 다시 시도해 주세요.', 'unavailable'); return;
        }
        this.#owner = Object.freeze({ ...state.observationOwner });
        this.#publish('이 화면에서 관찰 중이에요.', 'observing'); done();
        await hold;
      } finally { this.#owner = null; this.#release = null; done(); }
    })).catch(() => { this.#publish('관찰 잠금을 확인하지 못했어요. 다시 시도해 주세요.', 'unavailable'); done(); }).finally(() => { this.#pending = null; });
    // acquire resolves after claim, while #held remains pending for the lifetime.
    void ready.then(() => { this.#pending = null; });
    return ready;
  }
  async release() {
    ++this.#generation; this.#owner = null;
    const release = this.#release; this.#release = null; release?.();
    this.#publish('다른 탭에서 관찰 중이에요.', 'waiting');
    // No wait for a stalled repository response. Generation fences that callback.
  }
  async stop() { this.#alive = false; await this.release(); }
}
