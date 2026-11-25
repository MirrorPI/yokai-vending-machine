import type { Persistence, StorageFailure } from '../domain/repository.ts';

export const SAVE_KEY = 'yokai-vending:save';
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface AtomicDriver {
  readonly persistence: Persistence;
  readonly key: string;
  /** Metadata read/validate/write remains synchronous. A06's read-only snapshot
   * lease may await a short IDB transaction under this same lock, never encoding. */
  exclusive<T>(work: (storage: StringStorage) => T | Promise<T>): Promise<T>;
}
export class StorageAccessError extends Error {
  readonly operation: StorageFailure['operation'];
  constructor(operation: StorageFailure['operation'], error: unknown) {
    super(error instanceof Error ? error.name + ': ' + error.message : String(error));
    this.operation = operation;
  }
}
export function readString(storage: StringStorage, key: string): string | null {
  try { return storage.getItem(key); }
  catch (e) { throw new StorageAccessError('read', e); }
}
export function writeString(storage: StringStorage, key: string, value: string, operation: 'write' | 'backup' = 'write'): void {
  try { storage.setItem(key, value); }
  catch (e) { throw new StorageAccessError(operation, e); }
}
/** Keep earlier originals intact. Repeated inspection of the same raw data writes nothing. */
export function preserveRaw(storage: StringStorage, key: string, raw: string): void {
  for (let n = 0; n < 100; n++) {
    const candidate = n === 0 ? key : `${key}.${n}`;
    const previous = readString(storage, candidate);
    if (previous === raw) return;
    if (previous === null) { writeString(storage, candidate, raw, 'backup'); return; }
  }
  throw new StorageAccessError('backup', 'Original backup slots exhausted; no original overwritten');
}
