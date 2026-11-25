import { compileScene, sceneFiles } from '../scene/composition.ts';
import type { SceneCatalog, Season, Family, ScenePlan } from '../scene/types.ts';

export const seasons: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
export type LocalOffset = (wallMs: number) => number; // Date#getTimezoneOffset sign, minutes
export const browserOffset: LocalOffset = wallMs => new Date(wallMs).getTimezoneOffset();
/** Wall time only. Inject the offset interpreter for deterministic local calendar rules. */
export function seasonAt(wallMs: number, offset: LocalOffset): { season: Season; nextAt: number } {
  if (!Number.isFinite(wallMs)) throw new Error('Invalid wall clock');
  const local = wallMs - offset(wallMs) * 60_000;
  const interval = 45 * 60_000;
  const slot = Math.floor(local / interval);
  const season = seasons[((slot % 4) + 4) % 4];
  // Local quarter-hour boundaries also respect skipped/repeated DST wall time.
  let nextAt = Math.floor(wallMs / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 26 * 60; i++, nextAt += 60_000) {
    const nextSlot = Math.floor((nextAt - offset(nextAt) * 60_000) / interval);
    if (nextSlot !== slot) return { season, nextAt };
  }
  throw new Error('No local season boundary: unsupported timezone interpreter');
}
export type Rarity = 'common' | 'rare' | 'legendary' | 'special';
export const rarityWeights: Readonly<Record<Rarity, number>> = { common: 66, rare: 27, legendary: 5, special: 2 };
export const fades: Readonly<Record<Rarity, { enter: number; exit: number }>> = {
  common: { enter: 600, exit: 800 }, rare: { enter: 600, exit: 800 },
  legendary: { enter: 400, exit: 400 }, special: { enter: 200, exit: 400 },
};
export type Random = () => number;
export function unit(random: Random): number {
  const n = random();
  if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error('Random must be in [0,1)');
  return n;
}
export const waitDuration = (random: Random) => 28_000 + 67_000 * unit(random);
export function dwellDuration(rarity: Rarity, random: Random): number {
  const [min, span] = { common: [18_000, 4_000], rare: [13_000, 4_000], legendary: [7_000, 2_000], special: [4_000, 2_000] }[rarity];
  return min + span * unit(random);
}
export interface Candidate { id: string; itemId: string; rarity: Rarity; weight: number; plan: ScenePlan }
export type RuntimeCatalog = Omit<SceneCatalog, 'yokai'> & {
  yokai: readonly (SceneCatalog['yokai'][number] & {
    seasons: readonly string[]; rarity: string; weight?: number; mainItemId: string; definitionStatus: string;
    image?: string; origin?: string; lore?: string; description?: string; spots?: readonly string[]; size?: string; presentation?: string;
    giant?: { type: string; from: string; faceAnchor: readonly number[] } | null;
  })[];
  items: readonly { id: string; ownerYokaiId: string }[];
  files: readonly { publicPath: string; sha256: string }[];
};
export function candidatesFor(catalog: RuntimeCatalog, season: Season, family: Family) {
  const rule = catalog.yokai.filter(y => y.seasons.includes(season));
  const available: Candidate[] = [];
  const excluded: { id: string; reasons: string[] }[] = [];
  for (const y of rule) {
    const reasons: string[] = [];
    if (!['season-json', 'common-json'].includes(y.definitionStatus) || !y.image || !y.origin || !y.lore || !y.description ||
      !Array.isArray(y.spots) || (y.presentation === 'sprite' && !y.spots.length) || !y.size || !['sprite', 'giant'].includes(y.presentation ?? '')) reasons.push('missing-definition');
    if (y.presentation === 'giant' && (!y.giant || !['peek', 'coil', 'loom', 'spread', 'shadow'].includes(y.giant.type) ||
      !['left', 'right', 'top'].includes(y.giant.from) || y.giant.faceAnchor?.length !== 2 ||
      y.giant.faceAnchor.some(n => !Number.isFinite(n)))) reasons.push('missing-giant-definition');
    if (!y.art) reasons.push('missing-art');
    if (!Number.isFinite(y.weight) || (y.weight ?? 0) <= 0) reasons.push('invalid-weight');
    if (!(y.rarity in rarityWeights)) reasons.push('invalid-rarity');
    if (!catalog.items.some(i => i.id === y.mainItemId && i.ownerYokaiId === y.id)) reasons.push('missing-item-link');
    let plan: ScenePlan | undefined;
    try {
      plan = compileScene(catalog, { family, season, yokaiId: y.id, placement: 'verified-default', playback: { originMs: 0 } });
      const animation = y.art?.animation;
      const timing = animation?.metadata;
      if (!animation || !timing || animation.frames.length < 2 || animation.frames.length > 32 || !timing.sequence.length ||
        timing.sequence.length !== timing.durationsMs.length || timing.durationsMs.some(n => !Number.isFinite(n) || n <= 0) ||
        timing.sequence.some(n => !Number.isInteger(n) || n < 0 || n >= animation.frames.length) || sceneFiles(plan).some(f => !catalog.files.some(known => known.publicPath === f.publicPath && known.sha256 === f.sha256))) reasons.push('missing-files');
    } catch { reasons.push('unverified-scene'); }
    if (reasons.length || !plan) excluded.push({ id: y.id, reasons });
    else available.push(Object.freeze({ id: y.id, itemId: y.mainItemId, rarity: y.rarity as Rarity, weight: y.weight!, plan }));
  }
  return { rule, available, excluded };
}
function weighted<T>(values: readonly T[], weight: (value: T) => number, random: Random): T {
  let n = unit(random) * values.reduce((sum, v) => sum + weight(v), 0);
  for (const value of values) { n -= weight(value); if (n < 0) return value; }
  return values[values.length - 1]; // floating point accumulation at the upper boundary
}
export function drawCandidate<T extends { id: string; rarity: Rarity; weight: number }>(candidates: readonly T[], lastId: string | null, random: Random): T | null {
  const eligible = candidates.filter(c => c.id !== lastId);
  const ranks = (Object.keys(rarityWeights) as Rarity[]).filter(r => eligible.some(c => c.rarity === r));
  if (!ranks.length) return null;
  const rank = weighted(ranks, r => rarityWeights[r], random);
  return weighted(eligible.filter(c => c.rarity === rank), c => c.weight, random);
}
