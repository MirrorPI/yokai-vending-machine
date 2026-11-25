import type { GameRepository } from '../domain/repository.ts';
import type { CaptureContext, SettlementReceipt, VisitExecution } from '../runtime/execution.ts';
import type { PhotoBytes, PhotoReservation, PhotoStore } from '../storage/photos.ts';
import type { AssetFile } from '../data/catalog.ts';
import { freezeCapture, hitCapture } from './scene.ts';
import type { CaptureDefinition, ClickGeometry, FrozenCapture, Raster } from './scene.ts';

export interface PhotoJobStatus {
  readonly state: 'idle' | 'pending' | 'saved' | 'failed' | 'metadata-pending' | 'unavailable' | 'stale';
  readonly photoKey?: string;
  readonly reason?: string;
}
export class PhotoJobs {
  private readonly ports: { repository: GameRepository; files: PhotoStore; encode(sample: FrozenCapture): Promise<PhotoBytes>; reconcilePhoto?(reservation: PhotoReservation): boolean };
  #active = new Map<string, Promise<void>>();
  #disposed = false;
  #status: PhotoJobStatus = Object.freeze({ state: 'idle' });
  constructor(ports: PhotoJobs['ports']) { this.ports = ports; }
  get status() { return this.#status; }
  #set(state: PhotoJobStatus['state'], photoKey?: string, reason?: string) { this.#status = Object.freeze({ state, photoKey, reason }); }
  async #complete(r: PhotoReservation, status: 'saved' | 'failed') {
    try {
      const result = await this.ports.repository.commit({ type: 'updatePhotoStatus', ...r, status });
      if (result.status === 'applied' || result.status === 'unchanged') this.#set(status, r.photoKey);
      else this.#set(result.status === 'invalid' ? 'stale' : 'metadata-pending', r.photoKey);
    } catch { this.#set('metadata-pending', r.photoKey); }
  }
  async #fail(r: PhotoReservation, reason?: string) {
    // A duplicate encoder can fail after another worker has already committed
    // the file. Inspect/close under the file + metadata locks before failure.
    try {
      const file = await this.ports.files.closePending(r);
      if (file.status === 'found' && file.attemptId === r.attemptId) await this.#complete(r, 'saved');
      else if (file.status === 'missing' || file.status === 'preserved') await this.#complete(r, 'failed');
      else this.#set(file.status === 'stale' ? 'stale' : 'metadata-pending', r.photoKey, reason);
    } catch { this.#set('metadata-pending', r.photoKey, reason); }
  }
  /** Receipt and immutable click sample must be the same manual visit/reservation. */
  schedule(receipt: SettlementReceipt, sample: FrozenCapture): boolean {
    const photo = receipt.photo, c = sample.context;
    if (this.#disposed || receipt.source !== 'manual' || receipt.visitId !== c.visitId || receipt.yokaiId !== c.bundle.plan.input.yokaiId
      || !photo || photo.attemptId !== c.visitId || photo.slotSeason !== c.slotSeason || photo.status !== 'pending') return false;
    const r: PhotoReservation = { yokaiId: receipt.yokaiId, season: photo.slotSeason, photoKey: photo.photoKey, attemptId: photo.attemptId };
    const key = JSON.stringify([r.photoKey, r.attemptId]);
    if (this.#active.has(key)) return false;
    const work = this.#run(r, sample).finally(() => this.#active.delete(key));
    this.#active.set(key, work); return true;
  }
  async #run(r: PhotoReservation, sample: FrozenCapture) {
    this.#set('pending', r.photoKey);
    try {
      const reserved = await this.ports.files.reserve(r);
      if (this.#disposed) return;
      if (reserved.status !== 'ready') {
        if (reserved.status === 'stale') { this.#set('stale', r.photoKey); return; }
        // Never replace an incompatible or legacy file. The capture record remains.
        await this.#fail(r, reserved.status === 'unavailable' ? reserved.reason : undefined); return;
      }
      const bytes = await this.ports.encode(sample);
      if (this.#disposed) return;
      const written = await this.ports.files.write(r, bytes);
      if (this.#disposed) return;
      if (written.status === 'stale') { this.#set('stale', r.photoKey); return; }
      if (written.status === 'stored') await this.#complete(r, 'saved');
      else await this.#fail(r, written.status === 'unavailable' ? written.reason : undefined);
    } catch (e) {
      if (!this.#disposed) await this.#fail(r, e instanceof Error ? e.message : String(e));
    }
  }
  async drain(): Promise<void> { await Promise.all([...this.#active.values()]); }
  /** Retire future callbacks; an in-flight IDB transaction can still commit. It is
   * reconciled by its exact attempt on restart, never rolled back/deleted blindly. */
  dispose() { this.#disposed = true; }
  /** Only the application startup/recovery coordinator calls this after verified
   * ownership/recovery. It never encodes or awards; live local jobs are skipped. */
  async reconcilePending(): Promise<void> {
    let read;
    try { read = await this.ports.repository.read(); } catch { this.#set('unavailable'); return; }
    if (read.status !== 'ok') { this.#set('unavailable'); return; }
    for (const [yokaiId, record] of Object.entries(read.state.discovered)) {
      for (const [season, p] of Object.entries(record.photos)) {
        if (p.status !== 'pending' || !p.attemptId || !['spring', 'summer', 'autumn', 'winter'].includes(season)) continue;
        const key = JSON.stringify([p.photoKey, p.attemptId]);
        if (!this.#disposed && this.#active.has(key)) continue;
        const r: PhotoReservation = { yokaiId, season: season as PhotoReservation['season'], photoKey: p.photoKey, attemptId: p.attemptId };
        if (this.ports.reconcilePhoto?.(r) === false) continue;
        try {
          const file = await this.ports.files.closePending(r);
          if (file.status === 'found' && file.attemptId === p.attemptId) await this.#complete(r, 'saved');
          else if (file.status === 'missing' || file.status === 'preserved') await this.#complete(r, 'failed');
          else this.#set(file.status === 'stale' ? 'stale' : 'metadata-pending', p.photoKey);
        } catch { this.#set('metadata-pending', p.photoKey); }
      }
    }
  }
}
export interface CaptureInput extends ClickGeometry {
  readonly sampledAtMono?: number;
  readonly bundle: CaptureContext['bundle'] | null | undefined;
  readonly displayToken: number | undefined;
  readonly overlayOpacity: number;
  readonly proof: unknown;
}
export interface CapturePorts {
  execution: VisitExecution;
  jobs: PhotoJobs;
  definition(yokaiId: string): CaptureDefinition;
  readRaster(context: CaptureContext, file: AssetFile): Raster;
  /** Trusted host verifies event, actual displayed frame/time/opacity and surface.
   * A10 validates the current surface, DOM frame and actual event; no generic rAF/render fallback. */
  confirmInput(context: CaptureContext, sample: FrozenCapture, input: CaptureInput): boolean;
}
export class CaptureService {
  private readonly ports: CapturePorts;
  #sample: FrozenCapture | null = null;
  #evidence: object | null = null;
  #busy = false;
  #disposed = false;
  constructor(ports: CapturePorts) { this.ports = ports; }
  get disposed() { return this.#disposed; }
  confirms(context: CaptureContext, evidence: unknown): boolean {
    return !this.#disposed && !!this.#evidence && evidence === this.#evidence && this.#sample?.context === context;
  }
  async click(input: CaptureInput): Promise<{ status: 'accepted' | 'ignored' | 'blocked' }> {
    if (this.#disposed || this.#busy) return { status: 'ignored' };
    const context = this.ports.execution.captureContext(input.sampledAtMono);
    // A blocked settlement may outlive its visit (for example after sleep and
    // recovery). Keep its pixels while that visit is pending, but never let an
    // abandoned sample prevent a later visitor from being captured.
    if (context && this.#sample && context.visitId !== this.#sample.context.visitId) this.#sample = null;
    if (this.#sample || !context || context.bundle !== input.bundle || context.displayToken !== input.displayToken) return { status: 'ignored' };
    let sample: FrozenCapture;
    try {
      sample = freezeCapture(context, this.ports.definition(context.bundle.plan.input.yokaiId!),
        file => this.ports.readRaster(context, file), input.overlayOpacity);
      if (!hitCapture(sample, input) || this.ports.confirmInput(context, sample, input) !== true) return { status: 'ignored' };
    } catch { return { status: 'ignored' }; }
    this.#sample = sample; this.#evidence = Object.freeze({}); this.#busy = true;
    try {
      await this.ports.execution.requestManual(context, this.#evidence);
      const receipt = this.ports.execution.receipt;
      const accepted = receipt?.visitId === context.visitId && receipt.source === 'manual';
      await this.consumeReceipt();
      if (accepted) return { status: 'accepted' };
      const blocked = this.ports.execution.status.state === 'blocked';
      // If nothing remains uncertain, allow another click on the same visit.
      if (!blocked) this.#sample = null;
      return { status: blocked ? 'blocked' : 'ignored' };
    } finally { this.#evidence = null; this.#busy = false; }
  }
  /** Also call after A05 explicit retry: retain the original sample while its
   * settlement is uncertain. An old receipt never consumes a different visit. */
  async consumeReceipt(): Promise<void> {
    const receipt = this.ports.execution.receipt, sample = this.#sample;
    if (!sample || !receipt || receipt.visitId !== sample.context.visitId) return;
    this.ports.jobs.schedule(receipt, sample);
    this.#sample = null;
  }
  retireTransfer() { this.#sample = null; this.#evidence = null; }
  dispose() { this.#disposed = true; this.#sample = null; this.#evidence = null; this.ports.jobs.dispose(); }
}
