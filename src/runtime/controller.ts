import { compileScene } from '../scene/composition.ts';
import type { PreparedScene } from '../scene/bundle.ts';
import type { Family, ScenePlan, Season } from '../scene/types.ts';
import { candidatesFor, seasonAt } from './rules.ts';
import type { LocalOffset, Random, RuntimeCatalog } from './rules.ts';
import { VisitScheduler } from './scheduler.ts';
import type { Clock } from './scheduler.ts';
import { SceneTransition } from './transition.ts';

export interface RuntimePorts {
  catalog: RuntimeCatalog; clock: Clock; offset: LocalOffset; random: Random;
  createVisitId(): string; prepare(plan: ScenePlan): Promise<PreparedScene>;
}
/** Coordinates policies without supplying observation authority or pretending A05
 * has persisted/settled anything. The A10 host supplies the actual observation gate. */
export class RuntimeController {
  readonly scheduler: VisitScheduler;
  readonly transition: SceneTransition;
  private readonly ports: RuntimePorts;
  #disposed = false;
  #fixedSeason: Season | null;
  #seasonModePending = false;
  constructor(ports: RuntimePorts, options: { family?: Family; fixedSeason?: Season | null; verificationSeason?: Season; firstArrival?: { maxDelayMs: number }; manualSelection?: boolean } = {}) {
    this.ports = ports;
    this.#fixedSeason = options.verificationSeason ?? options.fixedSeason ?? null;
    const season = this.#fixedSeason ?? seasonAt(ports.clock.wall(), ports.offset).season;
    this.scheduler = new VisitScheduler({ ...ports,
      candidates: (season, family) => candidatesFor(ports.catalog, season, family).available },
    { season, family: options.family ?? 'forest', firstArrival: options.firstArrival, manualSelection: options.manualSelection });
    this.transition = new SceneTransition({ monotonic: ports.clock.monotonic, prepare: ports.prepare });
  }
  #syncScene() {
    const s = this.scheduler.state;
    const family = s.pendingFamily ?? s.family;
    const requested = this.transition.state.requested;
    if (requested?.family !== family || requested.season !== s.season) {
      this.transition.request(compileScene(this.ports.catalog, { family, season: s.season, yokaiId: null,
        playback: { originMs: 0 } }));
    }
    // Invalidate an obsolete prepared target before releasing the visit lock.
    this.transition.setLocked(this.scheduler.sceneLocked);
  }
  pulse() {
    if (this.#disposed) return;
    const season = this.#fixedSeason ?? seasonAt(this.ports.clock.wall(), this.ports.offset).season;
    // A manual preference change must not relabel a live capture's season.
    if (!this.#seasonModePending || !this.scheduler.sceneLocked) {
      this.scheduler.requestSeason(season);
      this.#seasonModePending = false;
    }
    this.#syncScene();
    this.transition.tick();
    const s = this.scheduler.state;
    const background = this.transition.sample();
    // Wait time is preserved while a target map decodes/fades. No selection is
    // allowed against an old map, nor can a body enter a two-background fade.
    const mapReady = background.current?.plan.input.family === s.family && background.current.plan.input.season === s.season &&
      !this.transition.transitioning && this.transition.state.status === 'ready';
    if (s.phase !== 'waiting' || mapReady) this.scheduler.tick();
    this.#syncScene();
  }
  requestFamily(family: Family) { if (!this.#disposed) { this.scheduler.requestFamily(family); this.#syncScene(); } }
  requestSeasonMode(fixed: Season | null) {
    if (this.#disposed || this.#fixedSeason === fixed) return;
    this.#fixedSeason = fixed;
    this.#seasonModePending = true;
    this.pulse();
  }
  snapshot() {
    const s = this.scheduler.state;
    return Object.freeze({ gameSeason: s.season, requestedSeason: this.transition.state.requested?.season ?? null,
      displayedSeason: this.transition.sample().current?.plan.input.season ?? null,
      nextSeasonAt: this.#fixedSeason ? null : seasonAt(this.ports.clock.wall(), this.ports.offset).nextAt,
      background: this.transition.sample(), scheduler: s,
      blockedBy: s.recoveryPending ? 'a05-observation-and-recovery' : s.startStatus === 'pending' || s.startStatus === 'failed' ? 'a05-start' :
        s.phase === 'end-requested' ? 'a05-settlement' : s.phase === 'followup-blocked' ? 'a05-finish' : null });
  }
  dispose() { this.#disposed = true; this.scheduler.suspend(); this.transition.cancel(); }
}
