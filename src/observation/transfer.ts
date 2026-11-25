import { compileScene, withFlightDirection } from '../scene/composition.ts';
import { candidatesFor, type RuntimeCatalog } from '../runtime/rules.ts';
import type { SchedulerState, RuntimeVisit, DisplayProposal } from '../runtime/scheduler.ts';
import type { Candidate } from '../runtime/rules.ts';
import type { PreparedScene } from '../scene/bundle.ts';
import type { ScenePlan } from '../scene/types.ts';
export interface LiveTransfer {
  plan: ScenePlan;
  visit: Omit<RuntimeVisit, 'bundle'>;
  display: Omit<DisplayProposal, 'bundle'>;
  candidate: Candidate;
  phase: 'appearing' | 'visiting' | 'settled-hold' | 'leaving';
  lastYokaiId: string | null;
  pendingFamily: SchedulerState['pendingFamily'];
  settledAtMono: number | null;
  settlementSource: SchedulerState['settlementSource'];
  leavingAt: number | null;
}
/** Only stable, persisted live work is transferable. Uncertain transactions stay
 * with their writer; a crash instead uses A05's single persisted recovery. */
export function liveTransfer(s: SchedulerState): LiveTransfer | null {
  if (!s.visit || !s.display || !s.candidate || s.startStatus !== 'approved'
    || !['appearing','visiting','settled-hold','leaving'].includes(s.phase) || s.endStatus === 'pending' || s.endStatus === 'failed') return null;
  const { bundle: _, ...visit } = s.visit, { bundle: __, ...display } = s.display;
  return structuredClone({ plan: s.visit.bundle.plan, visit, display, candidate: s.candidate, phase: s.phase as LiveTransfer['phase'],
    lastYokaiId: s.lastYokaiId, pendingFamily: s.pendingFamily, settledAtMono: s.settledAtMono, settlementSource: s.settlementSource, leavingAt: s.leavingAt });
}
export function transferState(t: LiveTransfer, bundle: PreparedScene) {
  const visit: RuntimeVisit = Object.freeze({ ...t.visit, bundle });
  return { visit, display: Object.freeze({ ...t.display, bundle }) };
}

/** Rebuild and compare received plans against approved catalog geometry before adoption. */
export function verifiedTransferScene(catalog: RuntimeCatalog, transfer: LiveTransfer) {
  const r = transfer.visit;
  const direction = transfer.plan.input.flightDirection;
  const plan = compileScene(catalog, { family: r.family, season: r.season, yokaiId: r.yokaiId,
    placement: 'verified-default', playback: { originMs: r.playbackOriginMs },
    ...(direction === undefined ? {} : { flightDirection: direction }) });
  const candidate = candidatesFor(catalog, r.season, r.family).available.find(c => c.id === r.yokaiId);
  if (!candidate || JSON.stringify(plan) !== JSON.stringify(transfer.plan)) throw new Error('Unverified transfer');
  return { plan, candidate: direction === undefined ? candidate : { ...candidate, plan: withFlightDirection(candidate.plan, direction) } };
}
