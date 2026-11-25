import type { VisitExecution } from '../runtime/execution.ts';
import type { CaptureService } from '../capture/execution.ts';
import type { ObservationSession } from './session.ts';
import type { GameRepository } from '../domain/repository.ts';

/** Explicit user recovery only. A displaced observer must not keep retrying its
 * old epoch/visit, or automatically fight another window for ownership. */
export async function retryObservation(
  host:{repository?:GameRepository;execution:VisitExecution;capture:CaptureService;retry():Promise<void>},
  session:Pick<ObservationSession,'release'|'acquire'>,
) {
  await host.execution.quiesce();
  const initialStatus=host.execution.status;
  if(host.repository?.guardSemantics==='remote-preflight-cas'
    && initialStatus.state==='blocked'
    && initialStatus.reason!=='authority' && initialStatus.reason!=='displaced') {
    // The previous write may have committed despite a lost reply. Keep the
    // immutable photo sample while reconciling that visit before any retirement.
    const read = await host.repository.read({fresh:true});
    if(read.status!=='ok')return;
    await host.retry();
    if(host.execution.status.state==='ready')return;
    if(!['invalid','authority','displaced'].includes(host.execution.status.reason ?? ''))return;
  }
  // A remote rejection can be permanent (expired start, changed scene). Reclaim
  // an epoch before discarding memory: this fences late writes and lets recovery
  // settle only the visit actually stored by the server, exactly once.
  if(host.execution.status.reason==='authority'||host.execution.status.reason==='displaced'
    || (host.repository?.guardSemantics==='remote-preflight-cas' && host.execution.status.reason==='invalid')) {
    host.capture.retireTransfer();
    host.execution.retireTransfer();
    await session.release();
    await session.acquire();
  } else await session.acquire();
  await host.retry();
}
