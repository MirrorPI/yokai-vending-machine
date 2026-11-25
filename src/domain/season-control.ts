import type { GameState, Season } from './state.ts';

/** Active release IDs, shared by local and server command validation. */
export const ACTIVE_YOKAI_COUNT = 102;
const activeIds = new Set(Array.from({ length: ACTIVE_YOKAI_COUNT }, (_, i) => `yokai_${String(i + 1).padStart(3, '0')}`));
export function seasonProgress(state: Pick<GameState, 'discovered'> | null) {
  const captured = Object.entries(state?.discovered ?? {}).filter(([id, record]) => activeIds.has(id) && record.captureCount > 0).length;
  const required = 50;
  return { captured, total: ACTIVE_YOKAI_COUNT, required, unlocked: captured >= required };
}
export function chosenSeason(state: GameState | null): Season | null {
  return state && seasonProgress(state).unlocked && state.settings.seasonMode === 'fixed' ? state.settings.fixedSeason ?? null : null;
}
