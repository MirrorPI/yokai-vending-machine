import type { BackgroundFamily, Season } from '../domain/state.ts';
import type { GameRepository } from '../domain/repository.ts';
import type { PhotoStore } from '../storage/photos.ts';
import { createPhotoUrlLease } from '../capture/browser.ts';
import { buildEncyclopedia, filterEntries } from './model.ts';
import type { Encyclopedia, EncyclopediaCatalog, Entry, Filter, PhotoSlot, RarityFilter } from './model.ts';

function openingPhoto(entry: Entry | undefined): string | null {
  if (entry?.status !== 'captured') return null;
  const places = entry.slots.filter(slot => slot.family);
  if (places.length) return (entry.cover?.family ? entry.cover.season : null)
    ?? places.find(slot => slot.metadata)?.season ?? places[0].season;
  return entry.coverSeason ?? entry.slots[0]?.season ?? null;
}

export type PhotoView = { state: 'empty' | 'pending' | 'failed' | 'loading' | 'ready' | 'missing' | 'unavailable'
  | 'mismatch' | 'full-missing' | 'decode-error'; token: number; url?: string };
export interface EncyclopediaSnapshot {
  open: boolean; phase: 'idle' | 'loading' | 'ready' | 'error';
  error: 'corrupt' | 'unsupported-version' | 'unavailable' | null;
  viewed?: 'saving' | 'error' | null;
  rarity?: RarityFilter;
  detailOrder?: readonly string[];
  model: Encyclopedia | null; filter: Filter; selectedId: string | null;
  season: string | null; full: boolean; photo: PhotoView;
}
export interface EncyclopediaPorts {
  catalog: EncyclopediaCatalog;
  repository: Pick<GameRepository, 'read'>;
  sharedPhotoHref?(yokaiId: string, season: Season, family: BackgroundFamily, full: boolean): string | undefined;
  markViewed?(id: string): Promise<boolean>;
  files: Pick<PhotoStore, 'get'>;
  urls?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  subscribeChanges?(changed: () => void): () => void;
}
/** Read capabilities only. No ownership, writes, pending recovery or item reads.
 * Repository/read generations and photo identity generations are independent. */
export class EncyclopediaController {
  private ports: EncyclopediaPorts;
  private value: EncyclopediaSnapshot = { open: false, phase: 'idle', error: null, model: null,
    filter: 'all', selectedId: null, season: null, full: false, photo: { state: 'empty', token: 0 } };
  private listeners = new Set<() => void>();
  private readGeneration = 0;
  private photoGeneration = 0;
  private photoIdentity = '';
  private lease: ReturnType<typeof createPhotoUrlLease> | null = null;
  private unsubscribe: (() => void) | null = null;
  constructor(ports: EncyclopediaPorts) { this.ports = ports; }
  get snapshot(): EncyclopediaSnapshot { return this.value; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<EncyclopediaSnapshot>) {
    this.value = { ...this.value, ...patch }; this.listeners.forEach(f => f());
  }
  async open() {
    if (this.value.open) return;
    this.publish({ open: true, phase: 'loading', error: null });
    this.unsubscribe = this.ports.subscribeChanges?.(() => { void this.refresh(); }) ?? null;
    await this.refresh();
  }
  close() {
    this.readGeneration++; this.release(); this.unsubscribe?.(); this.unsubscribe = null;
    this.publish({ viewed: null, open: false, phase: 'idle', error: null, model: null, selectedId: null, detailOrder: undefined, season: null, full: false,
      photo: { state: 'empty', token: this.photoGeneration } });
  }
  surfaceChanged() {
    this.release();
    if (this.value.open) { this.publish({ photo: { state: 'empty', token: this.photoGeneration } }); void this.loadPhoto(); }
  }
  async refresh() {
    if (!this.value.open) return;
    const generation = ++this.readGeneration;
    let result;
    try { result = await this.ports.repository.read(); }
    catch { result = { status: 'unavailable' as const }; }
    if (!this.value.open || generation !== this.readGeneration) return;
    if (result.status !== 'ok') {
      this.release();
      this.publish({ phase: 'error', error: result.status, model: null, photo: { state: 'empty', token: this.photoGeneration } });
      return;
    }
    const model = buildEncyclopedia(this.ports.catalog, result.state, { places: !!this.ports.sharedPhotoHref });
    const selected = model.entries.find(y => y.id === this.value.selectedId);
    const season = this.value.season ?? openingPhoto(selected);
    // Compute file identity before publishing new metadata so no render can pair
    // a new attempt with an old URL, even briefly.
    this.value = { ...this.value, model, season, phase: 'ready', error: null };
    await this.loadPhoto();
  }
  setRarity(rarity: RarityFilter) { this.publish({ rarity, detailOrder: undefined }); }
  async presented(id: string) {
    if (!this.value.open || this.value.selectedId !== id || !this.value.model?.entries.find(e => e.id === id)?.isNew) return;
    if (!this.ports.markViewed || this.value.viewed === 'saving') return;
    this.publish({ viewed: 'saving' });
    let saved = false;
    try { saved = await this.ports.markViewed(id); } catch { /* Retry remains available. */ }
    if (!this.value.open || this.value.selectedId !== id) return;
    this.publish({ viewed: saved ? null : 'error' });
    if (saved) await this.refresh();
  }
  setFilter(filter: Filter) { this.publish({ filter, detailOrder: undefined }); }
  async select(id: string | null) {
    const entry = this.value.model?.entries.find(y => y.id === id);
    let detailOrder: readonly string[] | undefined;
    if (entry && this.value.model) {
      // Keep the opened list's order even after a NEW badge is acknowledged.
      if (this.value.selectedId && this.value.detailOrder?.includes(entry.id)) detailOrder = this.value.detailOrder;
      else {
        const ids = filterEntries(this.value.model, this.value.filter, this.value.rarity).map(e => e.id);
        detailOrder = ids.includes(entry.id) ? ids : [entry.id];
      }
    }
    this.value = { ...this.value, viewed: null, selectedId: entry?.id ?? null,
      detailOrder,
      season: openingPhoto(entry), full: false };
    await this.loadPhoto();
  }
  async selectPhoto(season: string) {
    const entry = this.value.model?.entries.find(y => y.id === this.value.selectedId);
    if (entry?.status !== 'captured' || ![...entry.slots, ...(entry.cover ? [entry.cover] : [])].some(s => s.season === season)) return;
    this.value = { ...this.value, season, full: false }; await this.loadPhoto();
  }
  async showFull(full: boolean) { this.value = { ...this.value, full }; await this.loadPhoto(); }
  async retryPhoto() { this.photoIdentity = ''; await this.loadPhoto(); }
  imageFailed(token: number) {
    if (this.value.photo.token !== token || this.value.photo.state !== 'ready') return;
    this.lease?.dispose(); this.lease = null;
    this.publish({ photo: { state: 'decode-error', token } });
  }
  get selectedSlot(): PhotoSlot | null {
    const e = this.value.model?.entries.find(y => y.id === this.value.selectedId);
    if (e?.status !== 'captured') return null;
    return e.slots.find(s => s.season === this.value.season) ?? (e.cover?.season === this.value.season ? e.cover : null);
  }
  private release() {
    this.photoGeneration++; this.lease?.dispose(); this.lease = null; this.photoIdentity = '';
  }
  private async loadPhoto() {
    if (!this.value.open || this.value.phase !== 'ready') return;
    const slot = this.selectedSlot, metadata = slot?.metadata;
    const identity = JSON.stringify([this.value.selectedId, this.value.season, this.value.full, metadata ?? null]);
    if (identity === this.photoIdentity) { this.publish({}); return; }
    this.release(); this.photoIdentity = identity;
    const token = this.photoGeneration;
    if (!metadata || slot?.state === 'empty' || slot?.state === 'pending' || slot?.state === 'failed') {
      this.publish({ photo: { state: slot?.state === 'pending' ? 'pending' : slot?.state === 'failed' ? 'failed' : 'empty', token } }); return;
    }
    if (slot?.family && slot.sceneSeason && this.ports.sharedPhotoHref && this.value.selectedId) {
      const url = this.ports.sharedPhotoHref(this.value.selectedId, slot.sceneSeason, slot.family, this.value.full);
      this.publish({ photo: url ? { state: 'ready', url, token } : { state: 'missing', token } }); return;
    }
    const lease = createPhotoUrlLease(this.ports.files, this.ports.urls);
    this.lease = lease; this.publish({ photo: { state: 'loading', token } });
    const result = await lease.load(metadata.photoKey, this.value.full);
    if (!this.value.open || this.lease !== lease || token !== this.photoGeneration) { lease.dispose(); return; }
    if (result.status === 'superseded') return;
    if (result.status === 'ready') {
      if (metadata.attemptId !== undefined && metadata.attemptId !== result.attemptId) {
        lease.dispose(); this.lease = null;
        this.publish({ photo: { state: 'mismatch', token } }); return;
      }
      this.publish({ photo: { state: 'ready', url: result.url, token } }); return;
    }
    this.publish({ photo: { state: result.status === 'missing' && this.value.full ? 'full-missing' : result.status, token } });
  }
}
