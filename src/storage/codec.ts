import { initialState } from '../domain/state.ts';
import type { CaptureRecord, GameState } from '../domain/state.ts';
import { capture, count, family, item, object, photo, validState } from '../domain/validation.ts';

export type Decoded =
  | { status: 'ready'; state: GameState; origin: 'empty' | 'stored' | 'migrated'; oldVersion?: 1 | 2 }
  | { status: 'unsupported-version'; version: unknown }
  | { status: 'corrupt'; recovered: GameState; reason: string };

/** Only a preview. Never used as an implicit replacement for damaged authoritative data. */
function recover(v: unknown): GameState {
  const s = initialState();
  if (!object(v)) return s;
  const recovered = { ...v, ...s };
  if (typeof v.firstRunDone === 'boolean') recovered.firstRunDone = v.firstRunDone;
  if (object(v.settings)) recovered.settings = {
    ...v.settings,
    sound: typeof v.settings.sound === 'boolean' ? v.settings.sound : false,
    arrivalChime: typeof v.settings.arrivalChime === 'boolean' ? v.settings.arrivalChime : false,
    backgroundFamily: family(v.settings.backgroundFamily) ? v.settings.backgroundFamily as 'forest' | 'hill' : 'forest',
  };
  if (count(v.revision)) recovered.revision = v.revision;
  if (object(v.discovered)) {
    recovered.discovered = Object.fromEntries(Object.entries(v.discovered).flatMap(([key, value]) => {
      if (!object(value)) return [];
      const photos = object(value.photos) ? Object.fromEntries(Object.entries(value.photos).filter(([, p]) => photo(p))) : {};
      const candidate = { ...value, photos, coverSeason: typeof value.coverSeason === 'string' && Object.hasOwn(photos, value.coverSeason) ? value.coverSeason : null };
      return capture(candidate) ? [[key, candidate]] : [];
    }));
  }
  if (object(v.items)) recovered.items = Object.fromEntries(Object.entries(v.items).filter(([, r]) => item(r))) as GameState['items'];
  // Never infer payout or observation ownership from partially valid visit records.
  return recovered;
}

export function decode(raw: string | null): Decoded {
  if (raw === null) return { status: 'ready', state: initialState(), origin: 'empty' };
  let v: unknown;
  try { v = JSON.parse(raw); }
  catch { return { status: 'corrupt', recovered: initialState(), reason: 'Invalid JSON' }; }
  if (object(v) && count(v.version) && v.version > 3) return { status: 'unsupported-version', version: v.version };
  if (validState(v)) return { status: 'ready', state: v, origin: 'stored' };
  if (object(v) && (v.version === 1 || v.version === 2)) {
    const s = initialState();
    const records = object(v.discovered) ? Object.fromEntries(Object.entries(v.discovered).map(([key, value]) => {
      if (!object(value)) return [key, value];
      // v1 -> v2: add photos only when absent; never replace existing references.
      return [key, { ...value, ...(v.version === 1 && value.photos === undefined ? { photos: {} } : {}), coverSeason: value.coverSeason ?? null }];
    })) : v.discovered;
    const settings = object(v.settings) ? {
      ...v.settings,
      sound: v.settings.sound ?? false,
      arrivalChime: v.settings.arrivalChime ?? false,
      backgroundFamily: family(v.settings.backgroundFamily) ? v.settings.backgroundFamily : 'forest',
    } : v.settings;
    const migrated = {
      ...v, version: 3, revision: 1, firstRunDone: v.firstRunDone ?? false,
      discovered: records as Record<string, CaptureRecord>, settings,
      items: s.items, activeVisit: null, lastSettlement: null, observationOwner: null,
    };
    if (validState(migrated)) return { status: 'ready', state: migrated, origin: 'migrated', oldVersion: v.version };
  }
  return { status: 'corrupt', recovered: recover(v), reason: 'Unsupported schema or invalid state invariants' };
}
