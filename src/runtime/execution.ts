import type { LiveTransfer } from '../observation/transfer.ts';
import type { Command, CommitResult, GameRepository, Persistence, ReadResult } from '../domain/repository.ts';
import type { GameState, ObservationOwner, Season, Settlement, Visit } from '../domain/state.ts';
import { owner as validOwner } from '../domain/validation.ts';
import type { PreparedScene } from '../scene/bundle.ts';
import type { Clock, RuntimeVisit, VisitScheduler } from './scheduler.ts';

export interface ExecutionAuthority {
  /** Verified by the host; this service never claims or invents observation ownership. */
  readonly owner: ObservationOwner | null;
  readonly authorized: boolean;
  readonly observable: boolean;
}
export interface PresentationTicket {
  readonly token: number;
  readonly owner: ObservationOwner;
  readonly bundle: PreparedScene;
  readonly yokaiId: string;
  readonly monotonicMs: number;
  readonly wallMs: number;
}
/** A06 must bind its hit test and immutable scene sample to this exact context.
 * No DOM click, rasterization, PNG or file storage is performed here. */
export interface CaptureContext {
  readonly token: number;
  readonly visitId: string;
  readonly generation: number;
  readonly owner: ObservationOwner;
  readonly displayToken: number;
  readonly bundle: PreparedScene;
  readonly sampledAtMono: number;
  readonly gameSeason: Season;
  readonly sceneSeason: Season;
  readonly family: 'forest' | 'hill';
  readonly slotSeason: Season;
}
export interface ExecutionPorts {
  sharedPhotos?: boolean;
  scheduler: VisitScheduler;
  repository: GameRepository;
  clock: Clock;
  authority(): ExecutionAuthority;
  /** Short host DOM migration barrier. It never supplies visible evidence. */
  surfaceStable?(): boolean;
  waitForSurface?(): Promise<void>;
  /** Trusted display integration, not React render/effect/DOM presence or rAF alone.
   * A10 supplies browser surface/layer/frame evidence. Missing proof fails closed. */
  confirmDisplay(ticket: PresentationTicket, evidence: unknown): boolean;
  confirmCapture?(context: CaptureContext, evidence: unknown): boolean;
  /** Static definitions only: exactly all four seasons (common) or one dedicated season. */
  photoSeasons(yokaiId: string): readonly string[];
}
export interface ExecutionStatus {
  readonly state: 'ready' | 'blocked';
  readonly reason: ReadResult['status'] | CommitResult['status'] | 'authority' | 'displaced' | 'stale-callback' | null;
  readonly operation?: 'lock' | 'read' | 'write' | 'backup';
  readonly persistence?: Persistence;
}
export interface SettlementReceipt {
  readonly visitId: string;
  readonly yokaiId: string;
  readonly itemId: string;
  readonly source: 'manual' | 'left';
  readonly settledAt: string;
  /** Only a newly confirmed reservation for this visit. Null preserves an existing photo.
   * Pending is not PNG/file success; A06 must retain its earlier immutable scene sample. */
  readonly photo: Readonly<{ slotSeason: Season; photoKey: string; attemptId: string; status: 'pending' }> | null;
}
type Built = { command: Command; guard(latest: Readonly<GameState>): boolean };
type Live = { visit: RuntimeVisit; owner: ObservationOwner; ticket: PresentationTicket; interrupted: boolean };
const sameOwner = (a: ObservationOwner | null | undefined, b: ObservationOwner | null | undefined) =>
  !!a && !!b && a.sessionId === b.sessionId && a.epoch === b.epoch;
const owns = (s: Readonly<GameState>, o: ObservationOwner) => sameOwner(s.observationOwner, o);
const settlementMatches = (s: Readonly<GameState>, v: Visit) => v.itemGranted && s.lastSettlement?.visitId === v.visitId
  && s.lastSettlement.itemId === v.itemId && s.lastSettlement.source === v.grantSource && s.lastSettlement.settledAt === v.settledAt;
const sameSettlement = (a: Settlement | null, b: Settlement) => a?.visitId === b.visitId && a.itemId === b.itemId
  && a.source === b.source && a.settledAt === b.settledAt;
const own = <T>(records: Record<string, T>, key: string): T | undefined => Object.hasOwn(records, key) ? records[key] : undefined;

/** A04 ↔ A02 coordinator. One bounded queue for start, manual/deadline/interruption,
 * recovery and finish. The repository snapshot is the only award authority. */
export class VisitExecution {
  private readonly ports: ExecutionPorts;
  #tail: Promise<void> = Promise.resolve();
  #ticket: PresentationTicket | null = null;
  #live: Live | null = null;
  #capture: CaptureContext | null = null;
  #manual: CaptureContext | null = null;
  #serial = 0;
  #previous: ExecutionAuthority | null = null;
  #status: ExecutionStatus = Object.freeze({ state: 'blocked', reason: 'authority' });
  #receipt: SettlementReceipt | null = null;
  constructor(ports: ExecutionPorts) { this.ports = ports; }
  async quiesce() { await this.#tail; }
  retireTransfer() {
    this.#live = null; this.#ticket = null; this.#capture = null; this.#manual = null; this.#previous = null;
    this.#receipt = null; this.ports.scheduler.retireTransfer();
  }
  /** Broadcast data is a continuation hint, never award authority. Only adopt
   * after the new lifetime lock/epoch and an exact latest persisted comparison. */
  async adoptTransfer(t: LiveTransfer, bundle: PreparedScene): Promise<boolean> {
    const a = this.#authority();
    if (!a.authorized || !a.observable || !a.owner) return false;
    const state = await this.#read(), v = state?.activeVisit, r = t.visit;
    if (!state || !v || !owns(state, a.owner) || !this.#canWrite(a.owner) || v.ownerEpoch !== a.owner.epoch
      || v.visitId !== r.visitId || v.yokaiId !== r.yokaiId || v.itemId !== r.itemId || v.appearedAt !== r.appearedAt
      || v.captureDeadlineAt !== r.captureDeadlineAt || v.backgroundFamily !== r.family || v.season !== r.season
      || bundle.plan.input.yokaiId !== r.yokaiId || bundle.plan.input.family !== r.family || bundle.plan.input.season !== r.season
      || t.display.presentation?.monotonicMs !== r.shownMono || Math.abs((t.display.presentation?.wallMs ?? 0) - Date.parse(r.appearedAt)) >= 1
      || bundle.plan.input.playback.originMs !== r.playbackOriginMs || r.shownMono !== r.playbackOriginMs
      || Math.abs((v.dwellMs ?? r.deadlineMono-r.shownMono) - (r.deadlineMono-r.shownMono)) > 0.01
      || !Number.isFinite(r.shownMono) || !Number.isFinite(r.deadlineMono) || r.deadlineMono <= r.shownMono
      || v.itemGranted !== (t.settlementSource !== null) || v.grantSource !== t.settlementSource) return false;
    this.ports.scheduler.acceptTransfer(t, bundle);
    const visit = this.ports.scheduler.state.visit!;
    const ticket: PresentationTicket = Object.freeze({ token: t.display.token, owner: a.owner, bundle, yokaiId: r.yokaiId,
      monotonicMs: r.shownMono, wallMs: Date.parse(r.appearedAt) });
    this.#live = { visit, owner: a.owner, ticket, interrupted: false }; this.#previous = a;
    this.#ticket = null; this.#manual = null; this.#capture = null; this.#receipt = null;
    return true;
  }
  get status(): ExecutionStatus { return this.#status; }
  get receipt(): SettlementReceipt | null { return this.#receipt; }
  #block(reason: ExecutionStatus['reason'], operation?: ExecutionStatus['operation']) {
    this.#status = Object.freeze({ state: 'blocked', reason, ...(operation ? { operation } : {}) });
  }
  #failure(result: ReadResult | CommitResult) {
    this.#block(result.status, result.status === 'unavailable' ? result.operation : undefined);
  }
  #authority(): ExecutionAuthority {
    try {
      const a = this.ports.authority();
      return { owner: validOwner(a.owner) ? Object.freeze({ ...a.owner }) : null,
        authorized: a.authorized === true, observable: a.observable === true };
    } catch { return { owner: null, authorized: false, observable: false }; }
  }
  #canWrite(owner: ObservationOwner) {
    const a = this.#authority();
    return a.authorized && sameOwner(a.owner, owner);
  }
  /** Called synchronously at ingress too: a hidden/freeze signal cannot get stuck
   * behind an async write and then disappear when visible returns. No blur input. */
  #observe() {
    if (this.ports.surfaceStable?.() === false) return;
    const a = this.#authority();
    const eligible = a.authorized && !!a.owner;
    const changed = this.#previous && !sameOwner(a.owner, this.#previous.owner);
    if (this.#live && (!eligible || !a.observable || changed)) this.#live.interrupted = true;
    this.ports.scheduler.setObservation({ observable: a.observable, authorized: eligible });
    if (changed) this.ports.scheduler.suspend();
    this.#previous = a;
  }
  #enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.#tail.then(work).catch(() => { this.#block('unavailable'); });
    this.#tail = result;
    return result;
  }
  synchronize(): Promise<void> { this.#observe(); return this.#enqueue(() => this.#run()); }
  interrupt(): Promise<void> {
    this.#observe();
    if (this.#live) this.#live.interrupted = true;
    this.#ticket = null;
    this.ports.scheduler.suspend();
    return this.#enqueue(() => this.#run());
  }
  retry(): Promise<void> {
    this.#observe();
    return this.#enqueue(async () => {
      const s = this.ports.scheduler;
      s.retryStart(); s.retryEnd(); s.retryFinish();
      await this.#run();
    });
  }
  beginPresentation(token: number): PresentationTicket | null {
    this.#observe();
    const a = this.#authority();
    if (!a.authorized || !a.observable || !a.owner) return null;
    const s = this.ports.scheduler;
    s.beginPresentation(token, { monotonicMs: this.ports.clock.monotonic(), wallMs: this.ports.clock.wall() });
    const d = s.state.display;
    if (s.state.phase !== 'presenting' || d?.token !== token || !d.presentation) return null;
    this.#ticket = Object.freeze({ token, owner: a.owner, bundle: d.bundle, yokaiId: s.state.candidate!.id,
      monotonicMs: d.presentation.monotonicMs, wallMs: d.presentation.wallMs });
    return this.#ticket;
  }
  confirmDisplay(ticket: PresentationTicket | null, evidence: unknown): Promise<void> {
    this.#observe();
    const a = this.#authority(), s = this.ports.scheduler, d = s.state.display;
    if (!ticket || ticket !== this.#ticket || !a.observable || !a.authorized || !sameOwner(ticket.owner, a.owner)
      || s.state.phase !== 'presenting' || d?.token !== ticket.token || d.bundle !== ticket.bundle
      || s.state.candidate?.id !== ticket.yokaiId) return Promise.resolve();
    let confirmed = false;
    try { confirmed = this.ports.confirmDisplay(ticket, evidence) === true; } catch { /* Fail closed. */ }
    if (!confirmed) return Promise.resolve();
    // A panel or slow rendering can defer display proof past this proposal's
    // entire lifetime. No visit was sent yet; discard it instead of submitting
    // an expired start or inventing a new timestamp for an old animation.
    if (this.ports.clock.monotonic() >= ticket.monotonicMs + d.presentation!.dwellMs) {
      this.#ticket = null;
      s.retireTransfer();
      return this.#enqueue(() => this.#run());
    }
    s.confirmDisplay(ticket.token, ticket);
    if (!s.state.visit || s.state.visit.bundle !== ticket.bundle) return Promise.resolve();
    this.#live = { visit: s.state.visit, owner: ticket.owner, ticket, interrupted: false };
    // Invocation enqueues start immediately, but Web Locks and physical display
    // cannot be made one atomic operation. Manual input stays disabled until proof.
    this.#ticket = null;
    return this.#enqueue(() => this.#run());
  }
  captureContext(sampledAtMono = this.ports.clock.monotonic()): CaptureContext | null {
    this.#observe();
    const s = this.ports.scheduler.state, live = this.#live, a = this.#authority();
    if (!Number.isFinite(sampledAtMono) || sampledAtMono > this.ports.clock.monotonic() || this.ports.clock.monotonic() - sampledAtMono > 1000
      || !live || !this.#sameLive(live) || !a.observable || !this.#canWrite(live.owner) || live.interrupted
      || s.startStatus !== 'approved' || !['appearing', 'visiting'].includes(s.phase)) return null;
    const seasons = this.ports.photoSeasons(live.visit.yokaiId);
    const all = ['spring', 'summer', 'autumn', 'winter'];
    const common = seasons.length === 4 && all.every(x => seasons.includes(x));
    if (!common && (seasons.length !== 1 || seasons[0] !== live.visit.season)) return null;
    this.#capture = Object.freeze({ token: ++this.#serial, visitId: live.visit.visitId, generation: live.visit.generation,
      owner: live.owner, displayToken: live.ticket.token, bundle: live.visit.bundle,
      sampledAtMono, gameSeason: s.season, sceneSeason: live.visit.season,
      family: live.visit.family, slotSeason: common ? s.season : live.visit.season });
    return this.#capture;
  }
  requestManual(context: CaptureContext | null, evidence: unknown): Promise<void> {
    this.#observe();
    if (!context || context !== this.#capture || !this.#live || context.visitId !== this.#live.visit.visitId) return Promise.resolve();
    let confirmed = false;
    try { confirmed = this.ports.confirmCapture?.(context, evidence) === true; } catch { /* Fail closed. */ }
    if (!confirmed) return Promise.resolve();
    return this.#enqueue(async () => {
      const live = this.#live;
      if (!live || context !== this.#capture || !this.#sameLive(live) || !sameOwner(context.owner, live.owner)
        || !this.#canWrite(live.owner) || context.sampledAtMono < live.visit.shownMono
        || context.sampledAtMono > this.ports.clock.monotonic()) return;
      this.#manual ??= context;
      this.ports.scheduler.requestManualReview(context.visitId, context.generation);
      await this.#run();
    });
  }
  #sameLive(live: Live) { return this.#live === live && this.ports.scheduler.state.visit === live.visit; }
  #sameVisit(v: Visit | null, live: Live) {
    const r = live.visit;
    return !!v && v.visitId === r.visitId && v.ownerEpoch === live.owner.epoch && v.yokaiId === r.yokaiId
      && v.itemId === r.itemId && v.appearedAt === r.appearedAt && v.captureDeadlineAt === r.captureDeadlineAt
      && v.season === r.season && v.backgroundFamily === r.family;
  }
  async #read(): Promise<GameState | null> {
    let result: ReadResult;
    try { result = await this.ports.repository.read(); }
    catch { this.#block('unavailable', 'read'); return null; }
    if (result.status !== 'ok') { this.#failure(result); return null; }
    this.#status = Object.freeze({ state: 'ready', reason: null, persistence: result.persistence });
    return result.state;
  }
  /** Conflict/guard invalidation gets a fresh evaluation. Any other failed reply
   * is reconciled once by reading; absence of proof remains blocked until retry. */
  async #transaction(owner: ObservationOwner, build: (s: GameState) => Built | null,
    proof: (s: GameState) => boolean): Promise<GameState | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.ports.waitForSurface?.();
      const state = await this.#read();
      if (!state) return null;
      await this.ports.waitForSurface?.();
      if (!this.#canWrite(owner)) { this.#block('authority'); return null; }
      if (!owns(state, owner)) { this.#block('displaced'); return null; }
      if (proof(state)) return state;
      const built = build(state);
      if (!built) { this.#block('invalid'); return null; }
      let result: CommitResult;
      try {
        result = await this.ports.repository.commit(built.command, { expectedRevision: state.revision,
          guard: latest => this.ports.surfaceStable?.() !== false && this.#canWrite(owner) && owns(latest, owner) && built.guard(latest) });
      } catch { result = { status: 'unavailable', operation: 'write', reason: 'Commit response unavailable' }; }
      if (!this.#canWrite(owner)) { this.#block('authority'); return null; }
      if (result.status === 'applied' || result.status === 'unchanged') {
        if (owns(result.state, owner) && proof(result.state)) {
          this.#status = Object.freeze({ state: 'ready', reason: null, persistence: result.persistence });
          return result.state;
        }
        this.#block('invalid'); return null;
      }
      // Even invalid may mean another writer already finished the same intent.
      const latest = await this.#read();
      if (!latest) return null;
      if (!this.#canWrite(owner)) { this.#block('authority'); return null; }
      if (!owns(latest, owner)) { this.#block('displaced'); return null; }
      if (proof(latest)) return latest;
      if (result.status === 'conflict' || (result.status === 'invalid' && result.reason === 'Execution guard rejected')) continue;
      this.#failure(result); return null;
    }
    this.#block('conflict'); return null;
  }
  #at() { return new Date(this.ports.clock.wall()).toISOString(); }
  #manualNow(live: Live) {
    const now = this.ports.clock.monotonic();
    return !!this.#manual && this.#manual.visitId === live.visit.visitId && !live.interrupted
      && this.#authority().observable && this.#canWrite(live.owner) && Number.isFinite(now)
      && now >= live.visit.shownMono && now < live.visit.deadlineMono;
  }
  async #start(live: Live): Promise<boolean> {
    const s = this.ports.scheduler, request = s.state.startRequest;
    if (!request) return false;
    const valid = () => this.#sameLive(live) && s.state.startRequest?.token === request.token && s.state.startStatus === 'pending';
    const r = live.visit;
    const state = await this.#transaction(live.owner, saved => {
      if (!valid() || saved.activeVisit || saved.lastSettlement?.visitId === r.visitId) return null;
      return { command: { type: 'startVisit', owner: live.owner, visit: { visitId: r.visitId, yokaiId: r.yokaiId,
        itemId: r.itemId, appearedAt: r.appearedAt, captureDeadlineAt: r.captureDeadlineAt,
        dwellMs: r.deadlineMono - r.shownMono,
        season: r.season, backgroundFamily: r.family } }, guard: latest => valid() && latest.activeVisit === null };
    }, saved => valid() && this.#sameVisit(saved.activeVisit, live));
    s.resolveStart(request.token, state ? 'approved' : 'failed');
    return !!state;
  }
  /** Used by both runtime and restart recovery. Only the live path can supply manual evidence. */
  async #settle(owner: ObservationOwner, expected: Visit, live: Live | null, token?: number): Promise<GameState | null> {
    const s = this.ports.scheduler;
    const valid = () => !live || (this.#sameLive(live) && s.state.endRequest?.token === token && s.state.endStatus === 'pending');
    const matches = (v: Visit | null) => v?.visitId === expected.visitId && v.itemId === expected.itemId
      && v.yokaiId === expected.yokaiId && v.appearedAt === expected.appearedAt && v.ownerEpoch === owner.epoch
      && (!live || this.#sameVisit(v, live));
    return this.#transaction(owner, saved => {
      const v = saved.activeVisit;
      if (!valid() || !v || !matches(v) || v.itemGranted) return null;
      const manual = !!live && this.#manualNow(live);
      if (live && !manual && !live.interrupted && this.#authority().observable
        && this.ports.clock.monotonic() < live.visit.deadlineMono) return null;
      const source = manual ? 'manual' : 'left';
      const context = this.#manual;
      const previousPhoto = context ? own(own(saved.discovered, v.yokaiId)?.photos ?? {}, context.slotSeason) : undefined;
      const command: Command = { type: 'settleVisit', owner, visitId: v.visitId, source, at: this.#at(),
        ...(live ? { timing: { appearedAt: v.appearedAt, captureDeadlineAt: v.captureDeadlineAt!,
          elapsedMs: this.ports.clock.monotonic() - live.visit.shownMono } } : {}),
        ...(manual && context ? { photo: { photoKey: previousPhoto?.photoKey ?? `${v.yokaiId}_${context.slotSeason}`,
          slotSeason: context.slotSeason, sceneSeason: context.sceneSeason, capturedGameSeason: context.gameSeason,
          ...(this.ports.sharedPhotos ? { shared: true } : {}) } } : {}) };
      return { command, guard: latest => valid() && matches(latest.activeVisit) && !latest.activeVisit!.itemGranted
        && (!live || this.#manualNow(live) === manual) };
    }, saved => valid() && !!saved.activeVisit && matches(saved.activeVisit) && settlementMatches(saved, saved.activeVisit));
  }
  async #finish(owner: ObservationOwner, settlement: Settlement, valid: () => boolean): Promise<boolean> {
    return !!await this.#transaction(owner, saved => {
      const v = saved.activeVisit;
      if (!valid() || !v || !settlementMatches(saved, v) || !sameSettlement(saved.lastSettlement, settlement)) return null;
      return { command: { type: 'finishVisit', owner, visitId: settlement.visitId },
        guard: latest => valid() && !!latest.activeVisit && settlementMatches(latest, latest.activeVisit)
          && sameSettlement(latest.lastSettlement, settlement) };
    }, saved => valid() && saved.activeVisit === null && sameSettlement(saved.lastSettlement, settlement));
  }
  async #run() {
    this.#observe();
    const live = this.#live, s = this.ports.scheduler;
    if (live) {
      if (!this.#sameLive(live) || !this.#canWrite(live.owner)) { this.#block('authority'); return; }
      if (s.state.startStatus === 'failed' || s.state.endStatus === 'failed' || s.state.finishStatus === 'failed') return;
      if (s.state.startStatus === 'pending' && !await this.#start(live)) return;
      this.#observe();
      s.tick();
      const end = s.state.endRequest;
      if (end && s.state.endStatus === 'pending') {
        const state = await this.#settle(live.owner, { ...live.visit, ownerEpoch: live.owner.epoch,
          state: 'VISITING', itemGranted: false, grantSource: null, settledAt: null }, live, end.token);
        this.#observe();
        s.resolveEnd(end.token, state ? 'settled' : 'failed', state?.activeVisit?.grantSource ?? 'left');
        if (!state) return;
        const v = state.activeVisit!;
        const slot = v.photoSlotSeason ?? v.season;
        const photo = slot ? own(own(state.discovered, v.yokaiId)?.photos ?? {}, slot) : undefined;
        this.#receipt = Object.freeze({ visitId: v.visitId, yokaiId: v.yokaiId, itemId: v.itemId,
          source: v.grantSource!, settledAt: v.settledAt!,
          photo: v.grantSource === 'manual' && slot && photo?.attemptId === v.visitId && photo.status === 'pending'
            ? Object.freeze({ slotSeason: slot, photoKey: photo.photoKey, attemptId: v.visitId, status: 'pending' }) : null });
      }
      const finish = s.state.finishRequest;
      if (finish && s.state.finishStatus === 'pending') {
        const state = await this.#read();
        if (!state) { s.resolveFinish(finish.token, 'failed'); return; }
        const last = state.lastSettlement;
        const valid = () => this.#sameLive(live) && s.state.finishRequest?.token === finish.token && s.state.finishStatus === 'pending';
        const complete = !!last && last.visitId === live.visit.visitId && await this.#finish(live.owner, last, valid);
        this.#observe();
        if (!complete && this.#status.state === 'ready') this.#block('invalid');
        s.resolveFinish(finish.token, complete ? 'complete' : 'failed');
        if (!complete) return;
        this.#live = null; this.#manual = null; this.#capture = null;
      }
      if (this.#live) return;
    }
    if (!s.state.recoveryPending) return;
    const a = this.#authority(), token = s.state.recoveryToken;
    if (!a.authorized || !a.owner) { this.#block('authority'); return; }
    let state = await this.#read();
    if (!state) return;
    if (!owns(state, a.owner)) { this.#block('displaced'); return; }
    const persisted = state.activeVisit;
    if (persisted) {
      if (!persisted.itemGranted) {
        state = await this.#settle(a.owner, persisted, null);
        if (!state) return;
      }
      const settlement = state.lastSettlement;
      if (!settlement || settlement.visitId !== persisted.visitId || !await this.#finish(a.owner, settlement, () => s.state.recoveryToken === token)) return;
    }
    if (!this.#canWrite(a.owner)) { this.#block('authority'); return; }
    this.#observe();
    s.confirmRecovery(token, true);
  }
}
