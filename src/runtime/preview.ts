import type { Family, Season } from '../scene/types.ts';
import { seasons } from './rules.ts';
export interface RuntimePreview { season?: Season; family: Family; seed: number }
/** Separate from A03 scenePreview. These values are never settings or records. */
export function resolveRuntimePreview(search: string): RuntimePreview | null {
  const p = new URLSearchParams(search);
  if (p.get('schedulerPreview') !== '1') return null;
  const season = p.get('season');
  const family = p.get('family') ?? 'forest';
  const seed = Number(p.get('seed') ?? '1');
  if ((season !== null && !seasons.includes(season as Season)) || !['forest', 'hill'].includes(family) ||
    !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid scheduler preview input');
  return { ...(season ? { season: season as Season } : {}), family: family as Family, seed };
}
export function seededRandom(seed: number): () => number {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 0x100000000; };
}
