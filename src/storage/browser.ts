import { SAVE_KEY, StorageAccessError } from './driver.ts';
import type { AtomicDriver, StringStorage } from './driver.ts';
import { createRepository } from './repository.ts';

export { SAVE_KEY } from './driver.ts';
export interface BrowserOptions {
  storage?: () => StringStorage;
  locks?: () => Pick<LockManager, 'request'> | undefined;
}
/** No IndexedDB open/upgrade/delete: legacy photo bytes remain entirely untouched. */
export function createBrowserRepository(options: BrowserOptions = {}) {
  const driver: AtomicDriver = {
    persistence: 'local', key: SAVE_KEY,
    async exclusive<T>(work: (storage: StringStorage) => T | Promise<T>): Promise<T> {
      let locks: Pick<LockManager, 'request'> | undefined;
      try { locks = options.locks ? options.locks() : globalThis.navigator?.locks; }
      catch (e) { throw new StorageAccessError('lock', e); }
      if (!locks) throw new StorageAccessError('lock', 'Web Locks unavailable; collection writes disabled');
      return locks.request(`${SAVE_KEY}:writer`, { mode: 'exclusive' }, () => {
        let storage: StringStorage;
        try { storage = options.storage ? options.storage() : globalThis.localStorage; }
        catch (e) { throw new StorageAccessError('read', e); }
        if (!storage) throw new StorageAccessError('read', 'Storage unavailable');
        return work(storage);
      });
    },
  };
  return createRepository(driver);
}
