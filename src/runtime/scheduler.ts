import { withFlightDirection } from '../scene/composition.ts';
import { transferState } from '../observation/transfer.ts';
import type { LiveTransfer } from '../observation/transfer.ts';
import { drawCandidate, dwellDuration, fades, unit, waitDuration } from './rules.ts';
import type { Candidate, Random } from './rules.ts';
import type { PreparedScene } from '../scene/bundle.ts';
import type { Family, ScenePlan, Season } from '../scene/types.ts';

export interface Clock { wall(): number; monotonic(): number }
export interface Observation { observable: boolean; authorized: boolean }
export interface PresentationStamp { readonly monotonicMs: number; readonly wallMs: number; readonly dwellMs: number }
export interface DisplayProposal {
  readonly token: number; readonly bundle: PreparedScene; readonly readyMono: number;
  readonly presentation: PresentationStamp | null;
}
export interface RuntimeVisit {
  readonly visitId: string; readonly generation: number; readonly yokaiId: string; readonly itemId: string;
  readonly shownMono: number; readonly deadlineMono: number; readonly appearedAt: string; readonly captureDeadlineAt: string;
  readonly family: Family; readonly season: Season; readonly placement: 'verified-default';
  readonly playbackOriginMs: number; readonly bundle: PreparedScene;
}
export type Phase = 'suspended' | 'waiting' | 'no-candidates' | 'preparing' | 'awaiting-display' |
  'presenting' | 'awaiting-start' | 'appearing' | 'visiting' | 'end-requested' | 'settled-hold' | 'leaving' | 'followup-blocked';
export interface SchedulerState {
  readonly phase: Phase; readonly season: Season; readonly family: Family; readonly pendingFamily: Family | null;
  readonly candidate: Candidate | null; readonly display: DisplayProposal | null; readonly visit: RuntimeVisit | null;
  readonly lastYokaiId: string | null; readonly waitUntil: number | null;
  readonly loadStatus: 'idle' | 'loading' | 'ready' | 'failed'; readonly error: string | null;
  readonly startRequest: Readonly<{ token: number; visit: RuntimeVisit }> | null;
  readonly startStatus: 'idle' | 'pending' | 'failed' | 'approved';
  readonly endRequest: Readonly<{ token: number; visit: RuntimeVisit; reason: 'deadline' | 'interrupted' | 'manual-review' }> | null;
  readonly endStatus: 'idle' | 'pending' | 'failed' | 'settled';
  readonly finishRequest: Readonly<{ token: number; visitId: string }> | null;
  readonly finishStatus: 'idle' | 'pending' | 'failed';
  readonly settledAtMono: number | null; readonly settlementSource: 'manual' | 'left' | null;
  readonly leavingAt: number | null; readonly recoveryToken: number; readonly recoveryPending: boolean;
}
export interface SchedulerPorts {
  clock: Clock; random: Random; createVisitId(): string;
  candidates(season: Season, family: Family): readonly Candidate[];
  prepare(plan: ScenePlan): Promise<PreparedScene>;
}
/** Reuse decoded files; only the monotonic animation origin is bound at first display. */
function withOrigin(bundle: PreparedScene, originMs: number): PreparedScene {
  if (bundle.plan.input.playback.originMs === originMs) return bundle;
  return Object.freeze({ ...bundle, plan: Object.freeze({ ...bundle.plan, input: Object.freeze({ ...bundle.plan.input,
    playback: Object.freeze({ originMs }) }) }) });
}
/** Pull-based requests are intentionally inert until A05 explicitly resolves them.
 * No repository, browser storage, visibility listener or collection mutation lives here. */
export class VisitScheduler {
  private readonly ports: SchedulerPorts;
  #state: SchedulerState;
  #observation: Observation = { observable: false, authorized: false };
  #serial = 0;
  #timerToken = 0;
  #loadToken = 0;
  #interrupted = false;
  #firstArrival: { maxDelayMs: number } | null;
  #manualSelection: boolean;
  #requestedId: string | null = null;
  constructor(ports: SchedulerPorts, options: { season: Season; family: Family;
    /** A09 alone decides if the tutorial is eligible. No default shortcut or saved flag. */
    firstArrival?: { maxDelayMs: number }; manualSelection?: boolean }) {
    this.ports = ports;
    this.#manualSelection = options.manualSelection === true;
    if (options.firstArrival && (options.firstArrival.maxDelayMs < 0 || options.firstArrival.maxDelayMs > 5000 || !Number.isFinite(options.firstArrival.maxDelayMs))) throw new Error('Invalid first arrival input');
    this.#firstArrival = options.firstArrival ?? null;
    this.#state = Object.freeze({ phase: 'suspended', season: options.season, family: options.family, pendingFamily: null,
      candidate: null, display: null, visit: null, lastYokaiId: null, waitUntil: null, loadStatus: 'idle', error: null,
      startRequest: null, startStatus: 'idle', endRequest: null, endStatus: 'idle', finishRequest: null, finishStatus: 'idle',
      leavingAt: null, settledAtMono: null, settlementSource: null, recoveryToken: ++this.#serial, recoveryPending: true });
  }
  /** In-memory handoff only, after A05 compares the same persisted visit/epoch. */
  acceptTransfer(t: LiveTransfer, bundle: PreparedScene) {
    ++this.#loadToken; this.#firstArrival = null; this.#interrupted = false;
    this.#serial = Math.max(this.#serial, t.visit.generation, t.display.token) + 1;
    this.#observation = { observable: true, authorized: true };
    const restored = transferState(t, bundle);
    this.#patch({ ...restored, candidate: t.candidate, phase: t.phase, family: t.visit.family, season: t.visit.season,
      pendingFamily: t.pendingFamily, lastYokaiId: t.lastYokaiId, waitUntil: null, recoveryPending: false,
      loadStatus: 'ready', error: null, startStatus: 'approved', startRequest: null,
      endStatus: t.settlementSource ? 'settled' : 'idle', endRequest: null, finishRequest: null, finishStatus: 'idle',
      leavingAt: t.leavingAt, settledAtMono: t.settledAtMono, settlementSource: t.settlementSource });
  }
  retireTransfer() {
    this.suspend();
    this.#patch({ visit: null, candidate: null, display: null, startRequest: null, startStatus: 'idle',
      endRequest: null, endStatus: 'idle', finishRequest: null, finishStatus: 'idle', phase: 'suspended',
      recoveryPending: true, waitUntil: null, leavingAt: null, settledAtMono: null, settlementSource: null });
  }
  get state(): SchedulerState { return this.#state; }
  get timerToken(): number { return this.#timerToken; }
  get sceneLocked(): boolean { return this.#state.candidate !== null || this.#state.visit !== null; }
  #patch(patch: Partial<SchedulerState>) { this.#state = Object.freeze({ ...this.#state, ...patch }); ++this.#timerToken; }
  #eligible() { return this.#observation.observable && this.#observation.authorized && !this.#state.recoveryPending; }
  #wait(preservedDeadline: number | null = null) {
    if (!this.#eligible()) { this.#patch({ phase: 'suspended', waitUntil: null }); return; }
    if (this.#manualSelection) { this.#patch({ phase: 'waiting', waitUntil: Infinity }); return; }
    if (preservedDeadline !== null) { this.#patch({ phase: 'waiting', waitUntil: preservedDeadline }); return; }
    const duration = this.#firstArrival ? this.#firstArrival.maxDelayMs * unit(this.ports.random) : waitDuration(this.ports.random);
    this.#patch({ phase: 'waiting', waitUntil: this.ports.clock.monotonic() + duration });
  }
  setObservation(observation: Observation) {
    const wasVisible = this.#observation.observable && this.#observation.authorized;
    this.#observation = { ...observation };
    const visible = observation.observable && observation.authorized;
    if (wasVisible && !visible) this.suspend();
    else if (!wasVisible && visible) this.resume();
  }
  /** Host supplies actual hidden/freeze/sleep evidence, never plain window blur. */
  suspend() {
    this.#requestedId = null;
    ++this.#loadToken;
    this.#interrupted = true;
    this.#patch({ recoveryPending: true, recoveryToken: ++this.#serial });
    if (this.#state.visit) {
      if (this.#state.endStatus === 'settled' && this.#state.phase !== 'followup-blocked') this.#finishExit(null);
      else if (this.#state.startStatus === 'approved') this.#end('interrupted');
    } else {
      this.#patch({ phase: 'suspended', candidate: null, display: null, waitUntil: null, loadStatus: 'idle', error: null });
      this.#applyPendingFamily();
    }
  }
  resume() {
    // Resume/freeze notifications are not guaranteed to arrive as a pair.
    this.suspend();
  }
  /** A05 confirms unresolved persisted work/authority before a fresh wait. */
  confirmRecovery(token: number, clear: boolean) {
    if (!this.#state.recoveryPending || token !== this.#state.recoveryToken || !clear || !this.#observation.observable || !this.#observation.authorized) return;
    this.#patch({ recoveryPending: false });
    if (!this.#state.visit && !this.#state.candidate) { this.#interrupted = false; this.#wait(); }
  }
  requestSeason(season: Season) {
    if (season === this.#state.season) return;
    this.#patch({ season });
    if (this.#state.phase === 'no-candidates') this.#patch({ phase: 'waiting' });
  }
  requestFamily(family: Family) {
    if (this.sceneLocked) this.#patch({ pendingFamily: family });
    else { this.#patch({ family, pendingFamily: null }); if (this.#state.phase === 'no-candidates') this.#patch({ phase: 'waiting' }); }
  }
  #applyPendingFamily() {
    if (this.#state.pendingFamily) this.#patch({ family: this.#state.pendingFamily, pendingFamily: null });
  }
  /** Only an explicitly configured local host enables this selection policy.
   * Preparation, paint evidence, server start/settle/finish and recovery still apply. */
  requestImmediateVisit(id: string): boolean {
    if (!this.#manualSelection || this.#requestedId !== null || !this.#eligible() || this.sceneLocked ||
        !['waiting', 'no-candidates'].includes(this.#state.phase) ||
        !this.ports.candidates(this.#state.season, this.#state.family).some(c => c.id === id)) return false;
    this.#requestedId = id;
    this.#patch({ phase: 'waiting', waitUntil: this.ports.clock.monotonic() });
    return true;
  }
  tick(token = this.#timerToken) {
    if (token !== this.#timerToken) return;
    const now = this.ports.clock.monotonic();
    const s = this.#state;
    if (s.phase === 'waiting' && this.#eligible() && now >= s.waitUntil!) {
      let candidates = this.ports.candidates(s.season, s.family);
      if (this.#firstArrival && !this.#manualSelection) candidates = candidates.filter(c => c.rarity === 'common');
      const candidate = this.#manualSelection ? candidates.find(c => c.id === this.#requestedId) : drawCandidate(candidates, s.lastYokaiId, this.ports.random);
      this.#requestedId = null;
      if (!candidate) { this.#patch({ phase: 'no-candidates' }); return; }
      const oriented = candidate.plan.layers.some(l => l.flight) ? Object.freeze({ ...candidate,
        plan: withFlightDirection(candidate.plan, unit(this.ports.random) < .5 ? 'left-to-right' : 'right-to-left') }) : candidate;
      this.#patch({ candidate: oriented, phase: 'preparing' });
      this.#prepare();
    } else if ((s.phase === 'appearing' || s.phase === 'visiting') && s.visit) {
      if (now >= s.visit.deadlineMono) this.#end('deadline');
      else if (now >= s.visit.shownMono + fades[s.candidate!.rarity].enter && s.phase === 'appearing') this.#patch({ phase: 'visiting' });
    } else if (s.phase === 'settled-hold' && now >= s.settledAtMono! + 800) {
      this.#patch({ phase: 'leaving', leavingAt: now });
    } else if (s.phase === 'leaving' && now >= s.leavingAt! + fades[s.candidate!.rarity].exit) {
      this.#finishExit(now + waitDuration(this.ports.random));
    }
  }
  async #prepare() {
    const candidate = this.#state.candidate;
    if (!candidate || !this.#eligible()) return;
    const token = ++this.#loadToken;
    this.#patch({ phase: 'preparing', loadStatus: 'loading', error: null });
    try {
      const bundle = await this.ports.prepare(candidate.plan);
      if (token !== this.#loadToken || !this.#eligible()) return;
      // Verify the loader returned the requested identity, never silently swap a candidate.
      if (bundle.plan.input.yokaiId !== candidate.id || bundle.plan.mapId !== candidate.plan.mapId || bundle.plan.input.flightDirection !== candidate.plan.input.flightDirection) throw new Error('Prepared candidate mismatch');
      const readyMono = this.ports.clock.monotonic();
      this.#patch({ phase: 'awaiting-display', loadStatus: 'ready', display: Object.freeze({ token: ++this.#serial,
        bundle, readyMono, presentation: null }) });
    } catch (error) {
      if (token !== this.#loadToken) return;
      this.#patch({ loadStatus: 'failed', error: String(error) });
    }
  }
  retryPreparation() { if (this.#state.phase === 'preparing' && this.#state.loadStatus === 'failed') this.#prepare(); }
  /** A05 binds this in the frame where it begins projecting the prepared body.
   * Still not an actual-display acknowledgement or a persisted visit. */
  beginPresentation(token: number, shown: { monotonicMs: number; wallMs: number }) {
    const s = this.#state;
    if (s.phase !== 'awaiting-display' || !s.display || token !== s.display.token || !this.#eligible()) return;
    if (!Number.isFinite(shown.monotonicMs) || !Number.isFinite(shown.wallMs) || Math.abs(shown.wallMs) > 8.64e15 - 22000 ||
      shown.monotonicMs < s.display.readyMono || shown.monotonicMs > this.ports.clock.monotonic()) return;
    const presentation = Object.freeze({ ...shown, dwellMs: dwellDuration(s.candidate!.rarity, this.ports.random) });
    this.#patch({ phase: 'presenting', display: Object.freeze({ ...s.display, presentation,
      bundle: withOrigin(s.display.bundle, shown.monotonicMs) }) });
  }
  confirmDisplay(token: number, shown: { monotonicMs: number; wallMs: number }) {
    const s = this.#state;
    const stamp = s.display?.presentation;
    if (s.phase !== 'presenting' || !s.display || !stamp || token !== s.display.token || !this.#eligible() ||
      shown.monotonicMs !== stamp.monotonicMs || shown.wallMs !== stamp.wallMs) return;
    const duration = stamp.dwellMs;
    const bundle = s.display.bundle;
    const visit: RuntimeVisit = Object.freeze({ visitId: this.ports.createVisitId(), generation: ++this.#serial, yokaiId: s.candidate!.id, itemId: s.candidate!.itemId,
      shownMono: shown.monotonicMs, deadlineMono: shown.monotonicMs + duration,
      appearedAt: new Date(shown.wallMs).toISOString(), captureDeadlineAt: new Date(shown.wallMs + duration).toISOString(),
      family: bundle.plan.input.family, season: bundle.plan.input.season, placement: 'verified-default',
      playbackOriginMs: shown.monotonicMs, bundle });
    this.#firstArrival = null;
    this.#patch({ phase: 'awaiting-start', visit, lastYokaiId: visit.yokaiId,
      display: Object.freeze({ ...s.display, bundle }), startRequest: Object.freeze({ token: ++this.#serial, visit }), startStatus: 'pending' });
  }
  resolveStart(token: number, result: 'approved' | 'failed') {
    const s = this.#state;
    if (!s.startRequest || token !== s.startRequest.token || s.startStatus !== 'pending') return;
    this.#patch({ startStatus: result, phase: result === 'approved' ? 'appearing' : 'awaiting-start' });
    if (result === 'approved' && this.#interrupted) this.#end('interrupted');
  }
  retryStart() {
    if (this.#state.startStatus !== 'failed') return;
    this.#patch({ startStatus: 'pending', startRequest: Object.freeze({ token: ++this.#serial, visit: this.#state.visit! }) });
  }
  /** Inert A05 input after external click/owner validation. The serialized A05
   * commit must revalidate time/authority; this does not capture or grant items. */
  requestManualReview(visitId: string, generation: number) {
    const s = this.#state;
    if (!s.visit || s.visit.visitId !== visitId || s.visit.generation !== generation ||
      (s.phase !== 'appearing' && s.phase !== 'visiting') || s.startStatus !== 'approved') return;
    if (!this.#eligible()) this.#end('interrupted');
    else if (this.ports.clock.monotonic() >= s.visit.deadlineMono) this.#end('deadline');
    else this.#end('manual-review');
  }
  #end(reason: 'deadline' | 'interrupted' | 'manual-review') {
    if (this.#state.endRequest || !this.#state.visit) return;
    this.#patch({ phase: 'end-requested', endStatus: 'pending',
      endRequest: Object.freeze({ token: ++this.#serial, visit: this.#state.visit, reason }) });
  }
  resolveEnd(token: number, result: 'settled' | 'failed', source: 'manual' | 'left' = 'left') {
    const s = this.#state;
    if (!s.endRequest || token !== s.endRequest.token || s.endStatus !== 'pending') return;
    if (result === 'settled' && source === 'manual' && s.endRequest.reason !== 'manual-review') return;
    this.#patch({ endStatus: result });
    if (result === 'settled') {
      const now = this.ports.clock.monotonic();
      this.#patch({ settlementSource: source, settledAtMono: now });
      if (this.#interrupted || s.endRequest.reason === 'interrupted') this.#finishExit(null);
      else if (source === 'manual') this.#patch({ phase: 'settled-hold' });
      else this.#patch({ phase: 'leaving', leavingAt: now });
    }
  }
  #finishExit(waitUntil: number | null) {
    this.#patch({ phase: 'followup-blocked', display: null, waitUntil,
      finishRequest: Object.freeze({ token: ++this.#serial, visitId: this.#state.visit!.visitId }), finishStatus: 'pending' });
  }
  retryEnd() {
    if (this.#state.endStatus !== 'failed' || !this.#state.endRequest) return;
    this.#patch({ endStatus: 'pending', endRequest: Object.freeze({ ...this.#state.endRequest, token: ++this.#serial }) });
  }
  resolveFinish(token: number, result: 'complete' | 'failed') {
    const s = this.#state;
    if (!s.finishRequest || token !== s.finishRequest.token || s.finishStatus !== 'pending') return;
    if (result === 'failed') { this.#patch({ finishStatus: 'failed' }); return; }
    this.#patch({ candidate: null, display: null, visit: null, loadStatus: 'idle', error: null,
      startRequest: null, startStatus: 'idle', endRequest: null, endStatus: 'idle', finishRequest: null, finishStatus: 'idle', leavingAt: null, settledAtMono: null, settlementSource: null });
    this.#applyPendingFamily();
    const waitUntil = this.#interrupted ? null : s.waitUntil;
    this.#interrupted = false;
    this.#wait(waitUntil);
  }
  retryFinish() {
    if (this.#state.finishStatus !== 'failed' || !this.#state.finishRequest) return;
    this.#patch({ finishStatus: 'pending', finishRequest: Object.freeze({ ...this.#state.finishRequest, token: ++this.#serial }) });
  }
}
