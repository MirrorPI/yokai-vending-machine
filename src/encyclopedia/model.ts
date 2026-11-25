import type { AssetFile } from '../data/catalog.ts';
import type { GameState, PhotoMetadata, Season, CaptureRecord, BackgroundFamily } from '../domain/state.ts';

export type Rarity = 'common' | 'rare' | 'legendary' | 'special';
export type RarityFilter = 'all' | Rarity;
export const rarityNames = { common: '일반', rare: '희귀', legendary: '전설', special: '특수' } as const;
export type Filter = 'all' | 'common' | Season;
export const seasons: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
export interface EncyclopediaCatalog {
  yokai: readonly { id: string; no: number; name: string; seasons: readonly string[]; rarity: string;
    origin: string; description: string; lore: string; favoriteDrink: string; mainItemId: string;
    art: { still: AssetFile } | null }[];
  items: readonly { id: string; name: string; description: string }[];
}
export type SlotState = 'empty' | 'pending' | 'failed' | 'saved' | 'legacy';
export interface PhotoSlot { sceneSeason?: Season; family?: BackgroundFamily; season: string; state: SlotState; metadata?: PhotoMetadata }
export interface PublicItem { id: string; name: string; description: string }
interface BaseEntry { isNew: boolean; id: string; no: number; name: string; rarity: Rarity; seasons: Season[]; illustration: AssetFile | null }
export type Entry =
  | BaseEntry & { status: 'unseen'; illustration: null }
  | BaseEntry & { status: 'trace'; illustration: null; item: PublicItem | null }
  | BaseEntry & { status: 'captured'; origin: string; description: string; lore: string; favoriteDrink: string;
      item: PublicItem | null; capture: { firstCapturedAt: string; captureCount: number };
      coverSeason: string | null; cover: PhotoSlot | null; slots: PhotoSlot[] };
export interface Encyclopedia {
  entries: Entry[];
  progress: { captured: number; totalYokai: number; photos: number; totalPhotos: number;
    byRarity: Record<Rarity, number>; photoStates: Record<SlotState, number>; itemKinds: number; itemQuantity: number };
  preserved: { yokai: number; items: number; photoSlots: number };
}
const own = <T>(map: Record<string, T>, key: string): T | undefined => Object.hasOwn(map, key) ? map[key] : undefined;
const slot = (season: string, metadata?: PhotoMetadata): PhotoSlot => ({ season,
  state: metadata ? metadata.status ?? 'legacy' : 'empty', ...(metadata ? { metadata: structuredClone(metadata) } : {}) });

/** Old records unlock only their explicitly recorded environment. */
function placeSlots(record: CaptureRecord, available: Season[]): PhotoSlot[] {
  const result: PhotoSlot[] = available.flatMap(sceneSeason => (['forest', 'hill'] as const).map(family => {
    const key = `${sceneSeason}:${family}`;
    const legacy = Object.entries(record.photos).filter(([s, p]) => p.backgroundFamily === family && (p.sceneSeason ?? s) === sceneSeason);
    const metadata = own(record.placePhotos ?? {}, key) ?? legacy.find(([, p]) => p.status === 'saved' || p.status === undefined)?.[1] ?? legacy[0]?.[1];
    return { ...slot(key, metadata), sceneSeason, family };
  }));
  for (const [s, p] of Object.entries(record.photos)) if (!p.shared) result.push(slot(`legacy:${s}`, p));
  return result;
}

/** Input is a successfully validated repository snapshot. This projection carries
 * no locked content, and never repairs, writes or infers a historical environment. */
export function buildEncyclopedia(catalog: EncyclopediaCatalog, state: GameState, options: { places?: boolean } = {}): Encyclopedia {
  const definitions = [...catalog.yokai].sort((a, b) => a.no - b.no);
  const progress: Encyclopedia['progress'] = { captured: 0, totalYokai: definitions.length, photos: 0,
    totalPhotos: definitions.reduce((sum, y) => sum + seasons.filter(s => y.seasons.includes(s)).length * (options.places ? 2 : 1), 0),
    byRarity: { common: 0, rare: 0, legendary: 0, special: 0 },
    photoStates: { empty: 0, pending: 0, failed: 0, saved: 0, legacy: 0 }, itemKinds: 0, itemQuantity: 0 };
  const yokaiIds = new Set(definitions.map(y => y.id)), itemIds = new Set(catalog.items.map(i => i.id));
  const preserved = { yokai: Object.keys(state.discovered).filter(id => !yokaiIds.has(id)).length,
    items: Object.keys(state.items).filter(id => !itemIds.has(id)).length, photoSlots: 0 };
  for (const id of itemIds) {
    const quantity = own(state.items, id)?.totalCount ?? 0;
    if (quantity > 0) { progress.itemKinds++; progress.itemQuantity += quantity; }
  }
  const entries: Entry[] = definitions.map(y => {
    const availableSeasons = seasons.filter(s => y.seasons.includes(s));
    const base = { isNew: false, id: y.id, no: y.no, name: '???', seasons: availableSeasons, rarity: y.rarity as Rarity, illustration: null };
    const record = own(state.discovered, y.id);
    const acquired = (own(state.items, y.mainItemId)?.totalCount ?? 0) > 0;
    const definition = catalog.items.find(i => i.id === y.mainItemId);
    const item = definition ? { id: definition.id, name: definition.name, description: definition.description } : null;
    if (!record) {
      progress.photoStates.empty += availableSeasons.length * (options.places ? 2 : 1);
      return acquired ? { ...base, status: 'trace', name: y.name, item } : { ...base, status: 'unseen' };
    }
    progress.captured++; progress.byRarity[base.rarity]++;
    const slots = options.places ? placeSlots(record, availableSeasons) : availableSeasons.map(s => slot(s, own(record.photos, s)));
    const oldCover = record.coverSeason === null ? undefined : own(record.photos, record.coverSeason);
    const cover = options.places ? slots.find(s => s.metadata?.photoKey === oldCover?.photoKey && !!oldCover) ?? slots.find(s => s.metadata) ?? null
      : record.coverSeason === null ? null : slot(record.coverSeason, oldCover);
    for (const s of slots) { progress.photoStates[s.state]++; if (s.metadata && !s.season.startsWith('legacy:')) progress.photos++; }
    preserved.photoSlots += Object.keys(record.photos).filter(s => !availableSeasons.includes(s as Season)).length;
    return { ...base, isNew: !record.firstViewedAt, status: 'captured', name: y.name, illustration: y.art?.still ?? null,
      origin: y.origin, description: y.description, lore: y.lore, favoriteDrink: y.favoriteDrink, item,
      capture: { firstCapturedAt: record.firstCapturedAt, captureCount: record.captureCount },
      coverSeason: cover?.season ?? null, cover, slots };
  });
  return { entries, progress, preserved };
}
export function filterEntries(model: Encyclopedia, filter: Filter, rarity: RarityFilter = 'all'): Entry[] {
  return model.entries.filter(y => (rarity === 'all' || y.rarity === rarity) && (filter === 'all' || (filter === 'common'
    ? seasons.every(season => y.seasons.includes(season)) : y.seasons.length === 1 && y.seasons.includes(filter))))
    .sort((a, b) => Number(b.isNew) - Number(a.isNew)
      || (a.isNew && b.isNew && a.status === 'captured' && b.status === 'captured'
        ? Date.parse(b.capture.firstCapturedAt) - Date.parse(a.capture.firstCapturedAt) : 0) || a.no - b.no);
}
