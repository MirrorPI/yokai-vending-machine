import type { GameRepository } from '../domain/repository.ts';
import type { GameState, Season } from '../domain/state.ts';
import { SAVE_KEY } from './driver.ts';

export interface PhotoReservation { yokaiId: string; season: Season; photoKey: string; attemptId: string }
export interface PhotoBytes { png: Blob; fullScene: Blob }
export type PhotoResult =
  | { status: 'ready' | 'stored' | 'missing' | 'stale' | 'preserved' }
  | { status: 'found'; png: Blob; fullScene?: Blob; attemptId?: string }
  | { status: 'unavailable'; reason: string };
export interface PhotoStore {
  reserve(r: PhotoReservation): Promise<PhotoResult>;
  write(r: PhotoReservation, bytes: PhotoBytes): Promise<PhotoResult>;
  /** Close missing attempts before marking metadata failed. Never regenerate old pixels. */
  closePending(r: PhotoReservation): Promise<PhotoResult>;
  get(photoKey: string): Promise<PhotoResult>;
}
interface Fence { attemptId: string; state: 'reserved' | 'saved' | 'closed'; fullScene?: Blob }
export interface PhotoStoreOptions {
  repository: GameRepository;
  indexedDB?(): IDBFactory | undefined;
  locks?(): Pick<LockManager, 'request'> | undefined;
}
const failure = (e: unknown): PhotoResult => ({ status: 'unavailable', reason: e instanceof Error ? e.message : String(e) });
/** Same DB/store/key and Blob values as legacy. One additive companion store fences
 * delayed writes and keeps the full composition without changing legacy photo keys. */
export function createPhotoStore(options: PhotoStoreOptions): PhotoStore {
  async function open(): Promise<IDBDatabase> {
    const factory = options.indexedDB ? options.indexedDB() : globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB unavailable');
    const attempt = (version?: number): Promise<IDBDatabase> => new Promise((resolve, reject) => {
      const request = factory.open('yokai-vending', version);
      let finished = false;
      const fail = (e: unknown) => { if (!finished) { finished = true; reject(e); } };
      request.onblocked = () => fail(new Error('IndexedDB upgrade blocked'));
      request.onerror = () => fail(request.error ?? new Error('IndexedDB open failed'));
      request.onupgradeneeded = () => {
        if (finished) { request.transaction?.abort(); return; }
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
          if (!db.objectStoreNames.contains('photoAttempts')) db.createObjectStore('photoAttempts');
        } catch (e) { request.transaction?.abort(); fail(e); }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (finished) { db.close(); return; }
        finished = true; db.onversionchange = () => db.close(); resolve(db);
      };
    });
    let db = await attempt();
    if (!db.objectStoreNames.contains('photos') || !db.objectStoreNames.contains('photoAttempts')) {
      const next = db.version + 1; db.close(); db = await attempt(next);
    }
    return db;
  }
  async function transaction(mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (r: PhotoResult) => void) => void): Promise<PhotoResult> {
    let db: IDBDatabase | undefined;
    try {
      db = await open();
      return await new Promise<PhotoResult>(resolve => {
        let tx: IDBTransaction;
        let value: PhotoResult = failure('No transaction result');
        try { tx = db!.transaction(['photos', 'photoAttempts'], mode); }
        catch (e) { resolve(failure(e)); return; }
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => resolve(failure(tx.error ?? 'Photo transaction aborted'));
        // Request errors abort the transaction by default; never preventDefault.
        tx.onerror = () => { /* Completion/abort is the terminal authority. */ };
        try { work(tx, r => { value = r; }); }
        catch (e) { value = failure(e); try { tx.abort(); } catch { resolve(value); } }
      });
    } catch (e) { return failure(e); }
    finally { db?.close(); }
  }
  function current(state: Readonly<GameState>, r: PhotoReservation): boolean {
    const records = state.discovered;
    const record = Object.hasOwn(records, r.yokaiId) ? records[r.yokaiId] : undefined;
    const p = record && Object.hasOwn(record.photos, r.season) ? record.photos[r.season] : undefined;
    return p?.status === 'pending' && p.photoKey === r.photoKey && p.attemptId === r.attemptId;
  }
  async function mutate(r: PhotoReservation, action: 'reserve' | 'write' | 'close', bytes?: PhotoBytes): Promise<PhotoResult> {
    try {
      const locks = options.locks ? options.locks() : globalThis.navigator?.locks;
      if (!locks) return failure('Web Locks unavailable; photo writes disabled');
      // Every A06 writer/reconciler, including previous executors/tabs, uses this lock.
      // Encoding never holds it. Short file transactions additionally lease the
      // metadata writer lock so failure/rebooking cannot pass a latest-read.
      return await locks.request(`${SAVE_KEY}:photo-writer`, { mode: 'exclusive' }, async () => {
        if (!options.repository.withSnapshot) return failure('Atomic photo snapshot inspection unavailable');
        const inspected = await options.repository.withSnapshot(async latest => {
          if (!current(latest, r)) return { status: 'stale' } as PhotoResult;
          return transaction('readwrite', (tx, result) => {
            const photos = tx.objectStore('photos'), attempts = tx.objectStore('photoAttempts');
            if (photos.keyPath !== null || attempts.keyPath !== null) throw new Error('Unsupported existing photo schema; preserved');
            const request = attempts.get(r.photoKey);
            request.onsuccess = () => {
              try {
                const fence = request.result as Fence | undefined;
                const read = photos.get(r.photoKey);
                read.onsuccess = () => {
                  try {
                    const raw: unknown = read.result;
                    const found = fence?.attemptId === r.attemptId && fence.state === 'saved' && raw instanceof Blob;
                    if (action === 'close') {
                      if (found) { result({ status: 'found', png: raw, fullScene: fence.fullScene, attemptId: fence.attemptId }); return; }
                      // A legacy/unknown file is preserved but is no proof for this attempt.
                      if (raw !== undefined && (!fence || fence.state === 'saved')) { result({ status: 'preserved' }); return; }
                      attempts.put({ attemptId: r.attemptId, state: 'closed' } satisfies Fence, r.photoKey);
                      result({ status: 'missing' }); return;
                    }
                    if (action === 'reserve') {
                      if (fence?.attemptId === r.attemptId) {
                        result({ status: fence.state === 'closed' ? 'stale' : 'ready' }); return;
                      }
                      if (raw !== undefined) { result({ status: 'preserved' }); return; }
                      attempts.put({ attemptId: r.attemptId, state: 'reserved' } satisfies Fence, r.photoKey);
                      result({ status: 'ready' }); return;
                    }
                    if (found) { result({ status: 'stored' }); return; }
                    if (!fence || fence.attemptId !== r.attemptId || fence.state !== 'reserved') { result({ status: 'stale' }); return; }
                    if (raw !== undefined) { result({ status: 'preserved' }); return; }
                    if (!(bytes?.png instanceof Blob) || bytes.png.type !== 'image/png' || !bytes.png.size
                      || !(bytes.fullScene instanceof Blob) || bytes.fullScene.type !== 'image/png' || !bytes.fullScene.size) throw new Error('Invalid PNG bytes');
                    photos.put(bytes.png, r.photoKey);
                    attempts.put({ attemptId: r.attemptId, state: 'saved', fullScene: bytes.fullScene } satisfies Fence, r.photoKey);
                    result({ status: 'stored' });
                  } catch { tx.abort(); }
                };
              } catch { tx.abort(); }
            };
          });
        });
        return inspected.status === 'inspected' ? inspected.value : failure('Photo metadata unavailable');
      });
    } catch (e) { return failure(e); }
  }
  return {
    reserve: r => mutate(r, 'reserve'), write: (r, bytes) => mutate(r, 'write', bytes),
    closePending: r => mutate(r, 'close'),
    get: photoKey => transaction('readonly', (tx, result) => {
      const request = tx.objectStore('photos').get(photoKey);
      request.onsuccess = () => {
        const png: unknown = request.result;
        if (png === undefined) { result({ status: 'missing' }); return; }
        if (!(png instanceof Blob)) { result(failure('Unsupported existing photo value; preserved')); return; }
        const fence = tx.objectStore('photoAttempts').get(photoKey);
        fence.onsuccess = () => {
          const record = fence.result as Fence | undefined;
          result({ status: 'found', png, ...(record?.state === 'saved' ? { attemptId: record.attemptId, fullScene: record.fullScene } : {}) });
        };
      };
    }),
  };
}
