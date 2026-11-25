import type { AssetFile } from '../data/catalog.ts';
import type { GameState, Season } from '../domain/state.ts';
import { recentDropHistory } from '../domain/state.ts';
import type { Rarity, RarityFilter } from '../encyclopedia/model.ts';
export type InventoryFilter = 'all' | 'common' | Season;
export interface InventoryCatalog {
  items: readonly { id: string; ownerYokaiId: string; name: string; description: string; icon: AssetFile }[];
  yokai: readonly { id: string; no: number; name: string; seasons: readonly string[]; mainItemId: string; rarity?: string }[];
}
interface Base { rarity: Rarity; id: string; no: number; category: Exclude<InventoryFilter, 'all'>; name: string }
export type InventoryEntry = Base & ({ status: 'locked' } | {
  status: 'acquired'; icon: AssetFile; description: string; ownerName: string;
  totalCount: number; manualCount: number; leftCount: number; unreadCount: number; unreadLeftCount: number;
  firstObtainedAt: string | null; lastObtainedAt: string | null; firstViewedAt: string | null; isNew: boolean;
});
export type AcquiredItem = Extract<InventoryEntry, { status: 'acquired' }>;
export interface Inventory {
  entries: InventoryEntry[];
  recentDrops: { visitId: string; entry: AcquiredItem }[];
  progress: { kinds: number; totalKinds: number; quantity: number; unread: number; unreadLeft: number };
  preserved: number;
}
/** Validated repository input. Locked projection contains no private definition fields.
 * Current catalog IDs alone contribute to counters. Unknowns stay in storage. */
export function buildInventory(catalog: InventoryCatalog, state: GameState): Inventory {
  const progress = { kinds: 0, totalKinds: catalog.items.length, quantity: 0, unread: 0, unreadLeft: 0 };
  const definitions = [...catalog.items].sort((a,b) =>
    catalog.yokai.find(y=>y.id===a.ownerYokaiId)!.no - catalog.yokai.find(y=>y.id===b.ownerYokaiId)!.no);
  const entries: InventoryEntry[] = definitions.map(i => {
    const y = catalog.yokai.find(y=>y.id===i.ownerYokaiId)!;
    const category = (y.seasons.length === 4 ? 'common' : y.seasons[0]) as Base['category'];
    const base = { rarity: (y.rarity ?? 'common') as Rarity, id:i.id, no:y.no, category, name:'???' };
    const r = Object.hasOwn(state.items,i.id) ? state.items[i.id] : undefined;
    if (!r || r.totalCount === 0) return { ...base, status:'locked' };
    progress.kinds++; progress.quantity+=r.totalCount; progress.unread+=r.unreadCount; progress.unreadLeft+=r.unreadLeftCount;
    return { ...base, status:'acquired', name:i.name, description:i.description, ownerName:y.name, icon:i.icon,
      totalCount:r.totalCount, manualCount:r.manualCount, leftCount:r.leftCount, unreadCount:r.unreadCount,
      unreadLeftCount:r.unreadLeftCount, firstObtainedAt:r.firstObtainedAt, lastObtainedAt:r.lastObtainedAt,
      firstViewedAt:r.firstViewedAt, isNew:r.firstViewedAt===null };
  });
  const ids = new Set(definitions.map(i=>i.id));
  const acquired = new Map(entries.filter(e => e.status === 'acquired').map(e => [e.id, e]));
  const recentDrops = recentDropHistory(state).flatMap(d => {
    const entry = acquired.get(d.itemId);
    return entry ? [{ visitId: d.visitId, entry }] : [];
  });
  return { entries, recentDrops, progress, preserved:Object.keys(state.items).filter(id=>!ids.has(id)).length };
}
export function filterInventory(model: Inventory, filter: InventoryFilter, rarity: RarityFilter = 'all'): InventoryEntry[] {
  const priority = (e: InventoryEntry) => e.status === 'acquired' ? e.isNew ? 2 : e.unreadCount > 0 ? 1 : 0 : 0;
  return model.entries.filter(e => (filter === 'all' || e.category === filter) && (rarity === 'all' || e.rarity === rarity))
    .sort((a,b) => priority(b) - priority(a)
      || (priority(a) > 0 && a.status === 'acquired' && b.status === 'acquired'
        ? Date.parse(b.lastObtainedAt ?? '') - Date.parse(a.lastObtainedAt ?? '') : 0) || a.no - b.no);
}
export function formatItemTime(iso: string | null, options: { locale?: string; timeZone?: string } = {}): string {
  if (iso===null) return '기록 없음';
  return new Intl.DateTimeFormat(options.locale ?? 'ko-KR', { dateStyle:'medium',timeStyle:'short',
    ...(options.timeZone ? { timeZone:options.timeZone } : {}) }).format(new Date(iso));
}
