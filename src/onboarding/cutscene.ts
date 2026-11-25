import type { GameState } from '../domain/state.ts';
export const introCuts = [
  { id: 'lost', title: '길을 잃다', line: '요괴의 흔적을 쫓다가…\n내가 길을 잃어 버렸다.', durationMs: 2200 },
  { id: 'light', title: '낯선 불빛', line: '잠깐. 이 숲 한가운데…\n자판기가 왜 있지?', durationMs: 2200 },
  { id: 'drink', title: '작은 휴식', line: '조사는 잠시 미뤄 두고.\n시원한 것부터 한 모금.', durationMs: 2200 },
  { id: 'rest', title: '고요한 숲', line: '후우… 살 것 같다.\n그런데, 누가 관리하는 걸까?', durationMs: 2200 },
  { id: 'rustle', title: '첫 번째 기척', line: '…부스럭.\n방금, 저 풀숲에서?', durationMs: 2200 },
] as const;
export type IntroCutId = typeof introCuts[number]['id'];
// Change this ID only when a new story should be shown to all accounts.
export const introCutsceneId = 'forest-intro-v2';
export function hasSeenIntro(state: GameState | null): boolean {
  return state?.viewedCutscenes?.[introCutsceneId] === true;
}
