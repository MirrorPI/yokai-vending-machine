import { SAVE_KEY } from './driver.ts';
import type { AtomicDriver } from './driver.ts';
import { createRepository } from './repository.ts';

/** A shareable volatile session. A fresh driver has no records from a previous process. */
export function createMemoryDriver(seed?: string): AtomicDriver {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(SAVE_KEY, seed);
  let tail: Promise<unknown> = Promise.resolve();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  return {
    persistence: 'volatile', key: SAVE_KEY,
    exclusive<T>(work: (value: typeof storage) => T | Promise<T>): Promise<T> {
      const result = tail.then(() => work(storage));
      tail = result.catch(() => {});
      return result;
    },
  };
}
export function createMemoryRepository(driver = createMemoryDriver()) { return createRepository(driver); }
