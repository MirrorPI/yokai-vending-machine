import type { BackgroundFamily, Season } from '../domain/state.ts';
export const photoFamilies = ['forest', 'hill'] as const;
export const photoFamilyNames = { forest: '숲', hill: '밤하늘' } as const;
export function placePhotoSlot(season: Season, family: BackgroundFamily): string { return `${season}:${family}`; }
export function sharedPhotoKey(yokaiId: string, season: Season, family: BackgroundFamily): string {
  return `shared-v1:${yokaiId}:${season}:${family}`;
}
