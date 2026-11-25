import { applyCommand } from '../domain/commands.ts';
import { count } from '../domain/validation.ts';
import type { CommitResult, GameRepository, LoadFailure, ReadResult } from '../domain/repository.ts';
import { decode } from './codec.ts';
import { preserveRaw, readString, StorageAccessError, writeString } from './driver.ts';
import type { AtomicDriver, StringStorage } from './driver.ts';

export function createRepository(driver: AtomicDriver): GameRepository {
  function load(storage: StringStorage): ReadResult {
    const raw = readString(storage, driver.key);
    const result = decode(raw);
    if (result.status === 'unsupported-version') return result;
    if (result.status === 'corrupt') {
      let backup: 'saved' | 'failed' = 'saved';
      try { preserveRaw(storage, `${driver.key}.corrupt`, raw!); }
      catch { backup = 'failed'; }
      return { ...result, raw: raw!, backup };
    }
    if (result.origin === 'migrated') {
      preserveRaw(storage, `${driver.key}.v${result.oldVersion}`, raw!);
      writeString(storage, driver.key, JSON.stringify(result.state));
    }
    return { status: 'ok', state: result.state, origin: result.origin, persistence: driver.persistence };
  }
  async function locked<T>(work: (storage: StringStorage) => T | Promise<T>): Promise<T | LoadFailure> {
    try { return await driver.exclusive(work); }
    catch (e) {
      return { status: 'unavailable', operation: e instanceof StorageAccessError ? e.operation : 'lock', reason: e instanceof Error ? e.message : String(e) };
    }
  }
  return {
    read: () => locked(load),
    withSnapshot: work => locked(async storage => {
      const loaded = load(storage);
      if (loaded.status !== 'ok') return loaded;
      return { status: 'inspected' as const, value: await work(structuredClone(loaded.state)) };
    }),
    commit: (command, options = {}) => {
      // Detach the request before waiting for the lock. Callers cannot mutate queued work.
      let request: typeof command;
      let expectedRevision: number | undefined;
      let guard: typeof options.guard;
      try { request = structuredClone(command); expectedRevision = options.expectedRevision; guard = options.guard; }
      catch { return Promise.resolve({ status: 'invalid', reason: 'Request cannot be cloned' }); }
      return locked<CommitResult>(storage => {
        const loaded = load(storage);
        if (loaded.status !== 'ok') return loaded;
        if (expectedRevision !== undefined && !count(expectedRevision)) return { status: 'invalid', reason: 'Invalid expected revision' };
        if (expectedRevision !== undefined && expectedRevision !== loaded.state.revision) return { status: 'conflict', actualRevision: loaded.state.revision };
        if (guard !== undefined) {
          try {
            if (guard(structuredClone(loaded.state)) !== true) return { status: 'invalid', reason: 'Execution guard rejected' };
          } catch { return { status: 'invalid', reason: 'Execution guard rejected' }; }
        }
        const transition = applyCommand(loaded.state, request);
        if (transition.status === 'invalid') return transition;
        if (transition.status === 'unchanged') return { status: 'unchanged', state: transition.state, persistence: driver.persistence };
        const next = transition.state;
        if (!count(next.revision + 1)) return { status: 'invalid', reason: 'Revision exhausted' };
        next.revision += 1;
        writeString(storage, driver.key, JSON.stringify(next));
        return { status: 'applied', state: next, persistence: driver.persistence };
      });
    },
  };
}
