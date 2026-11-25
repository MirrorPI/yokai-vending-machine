import { createBrowserRepository } from '../storage/browser.ts';
import { VisitExecution } from '../runtime/execution.ts';
import type { Clock, VisitScheduler } from '../runtime/scheduler.ts';

/** Ordinary composition root. A10 must supply verified ownership; A05/A11 must
 * validate the browser display integration before enabling presentation.
 * Construction alone performs no storage I/O or ownership claim. */
export function createOrdinaryExecution(ports: {
  scheduler: VisitScheduler;
  clock: Clock;
  observable(): boolean;
  photoSeasons(yokaiId: string): readonly string[];
}): VisitExecution {
  return new VisitExecution({ ...ports, repository: createBrowserRepository(),
    authority: () => ({ owner: null, authorized: false, observable: ports.observable() }),
    confirmDisplay: () => false,
  });
}
