import type { Family, SceneInput, Season } from './types.ts';

export interface ScenePreview {
  preview: boolean;
  input: SceneInput;
  fixedTimeMs: number | null;
}
/** Explicit, read-only review inputs. Never persisted as settings or visits. */
export function resolveScenePreview(search: string): ScenePreview {
  const params = new URLSearchParams(search);
  const preview = params.get('scenePreview') === '1';
  const input: SceneInput = { family: 'forest', season: 'spring', yokaiId: null,
    placement: 'verified-default', playback: { originMs: 0 } };
  if (!preview) return { preview, input, fixedTimeMs: null };
  const family = params.get('family') ?? 'forest';
  const season = params.get('season') ?? 'spring';
  const yokai = params.get('yokai');
  const time = params.get('elapsedMs');
  if (!['forest', 'hill'].includes(family) || !['spring', 'summer', 'autumn', 'winter'].includes(season) ||
      (yokai !== null && !/^yokai_\d{3}$/.test(yokai)) ||
      (time !== null && (time.trim() === '' || !Number.isFinite(Number(time)) || Number(time) < 0)) ||
      (params.has('placement') && params.get('placement') !== 'verified-default')) throw new Error('Invalid scene preview input');
  return { preview, input: { ...input, family: family as Family, season: season as Season, yokaiId: yokai },
    fixedTimeMs: time === null ? null : Number(time) };
}
