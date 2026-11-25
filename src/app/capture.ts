import type { GamePorts } from '../account/remote.ts';
import { VisitExecution } from '../runtime/execution.ts';
import type { ExecutionPorts } from '../runtime/execution.ts';
import { CaptureService, PhotoJobs } from '../capture/execution.ts';
import type { CapturePorts } from '../capture/execution.ts';
import type { PhotoBytes, PhotoStore } from '../storage/photos.ts';
import type { FrozenCapture } from '../capture/scene.ts';
import { createBrowserEncoder, createBrowserRasterReader } from '../capture/browser.ts';
import { createBrowserRepository } from '../storage/browser.ts';
import { createPhotoStore } from '../storage/photos.ts';

/** Trusted host composition, injectable for deterministic verification. None of
 * these constructors starts I/O, claims ownership or confirms actual paint. */
export function createCaptureExecution(ports: {
  execution: Omit<ExecutionPorts, 'confirmCapture'>;
  files: PhotoStore;
  encode(sample: FrozenCapture): Promise<PhotoBytes>;
  definition: CapturePorts['definition'];
  readRaster: CapturePorts['readRaster'];
  confirmInput: CapturePorts['confirmInput'];
}) {
  let capture: CaptureService;
  const execution = new VisitExecution({ ...ports.execution, confirmCapture: (c, e) => capture.confirms(c, e) });
  const jobs = new PhotoJobs({ repository: ports.execution.repository, files: ports.files, encode: ports.encode,
    reconcilePhoto: r => ports.execution.repository.guardSemantics !== 'remote-preflight-cas' || !r.attemptId.startsWith('migration:') });
  capture = new CaptureService({ execution, jobs, definition: ports.definition, readRaster: ports.readRaster, confirmInput: ports.confirmInput });
  let startup: Promise<void> | null = null;
  const afterExecution = async () => {
    if (capture.disposed) return;
    await capture.consumeReceipt();
    if (capture.disposed) return;
    if (execution.status.state === 'ready' && !ports.execution.scheduler.state.recoveryPending) {
      // One startup pass, not an rAF retry loop. Failures remain visible until an
      // explicit reconciliation/restart. Constructors and blocked previews do no I/O.
      startup ??= jobs.reconcilePending();
      await startup;
    }
  };
  return { repository: ports.execution.repository, execution, capture, jobs, files: ports.files,
    synchronize: async () => { await execution.synchronize(); await afterExecution(); },
    retry: async () => { await execution.retry(); await afterExecution(); },
    interrupt: async () => { await execution.interrupt(); await capture.consumeReceipt(); },
  };
}
export function createOrdinaryCapture(ports: Pick<ExecutionPorts, 'scheduler' | 'clock' | 'photoSeasons'> & {
  surfaceStable?: ExecutionPorts['surfaceStable']; waitForSurface?: ExecutionPorts['waitForSurface'];
  authority: ExecutionPorts['authority']; confirmDisplay: ExecutionPorts['confirmDisplay']; confirmInput: CapturePorts['confirmInput']; definition: CapturePorts['definition'];
}, storage?: Pick<GamePorts, 'repository' | 'files'>) {
  const repository = storage?.repository ?? createBrowserRepository();
  return createCaptureExecution({ execution: { ...ports, repository, sharedPhotos: true },
    files: storage?.files ?? createPhotoStore({ repository }), encode: createBrowserEncoder(), definition: ports.definition,
    readRaster: createBrowserRasterReader(), confirmInput: ports.confirmInput });
}
