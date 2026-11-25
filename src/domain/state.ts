/** User records only: no React, asset definitions, clocks or storage APIs. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type BackgroundFamily = 'forest' | 'hill';
export type GrantSource = 'manual' | 'left';
export interface Extensible { [key: string]: unknown }
export interface PhotoMetadata extends Extensible {
  shared?: boolean;
  captureCount?: number;
  lastCapturedAt?: string;
  photoKey: string;
  at: string;
  /** Missing status is a preserved legacy file reference, never a pending write. */
  status?: 'pending' | 'saved' | 'failed';
  attemptId?: string;
  backgroundFamily?: BackgroundFamily;
  capturedGameSeason?: Season;
  sceneSeason?: Season;
}
export interface CaptureRecord extends Extensible {
  placePhotos?: Record<string, PhotoMetadata>;
  firstViewedAt?: string;
  firstCapturedAt: string;
  captureCount: number;
  photos: Record<string, PhotoMetadata>;
  coverSeason: string | null;
}
export interface ItemRecord extends Extensible {
  totalCount: number;
  manualCount: number;
  leftCount: number;
  unreadCount: number;
  unreadLeftCount: number;
  firstObtainedAt: string | null;
  lastObtainedAt: string | null;
  firstViewedAt: string | null;
}
export interface ObservationOwner extends Extensible { sessionId: string; epoch: number }
export interface Visit extends Extensible {
  visitId: string;
  yokaiId: string;
  itemId: string;
  appearedAt: string;
  ownerEpoch: number;
  state: 'VISITING' | 'CAPTURED' | 'SETTLED';
  itemGranted: boolean;
  grantSource: GrantSource | null;
  settledAt: string | null;
  /** Additional fields required for a new manual settlement, optional in old v3. */
  captureDeadlineAt?: string;
  dwellMs?: number;
  season?: Season;
  backgroundFamily?: BackgroundFamily;
  /** Chosen at manual settlement; common visitors use capture-time game season. */
  photoSlotSeason?: Season;
}
export interface Settlement extends Extensible {
  visitId: string;
  itemId: string;
  source: GrantSource;
  settledAt: string;
}
export const RECENT_DROP_LIMIT = 5;
export type DropReceipt = Pick<Settlement, 'visitId' | 'itemId' | 'settledAt'>;
export interface Settings extends Extensible {
  seasonMode?: 'auto' | 'fixed';
  fixedSeason?: Season;
  sound: boolean;
  arrivalChime: boolean;
  backgroundFamily: BackgroundFamily;
}
export interface GameState extends Extensible {
  version: 3;
  revision: number;
  firstRunDone: boolean;
  viewedCutscenes?: Record<string, true>;
  discovered: Record<string, CaptureRecord>;
  items: Record<string, ItemRecord>;
  activeVisit: Visit | null;
  lastSettlement: Settlement | null;
  /** Confirmed left gifts in settlement order. Older v3 saves may omit it. */
  recentDrops?: DropReceipt[];
  observationOwner: ObservationOwner | null;
  settings: Settings;
}
export function recentDropHistory(state: GameState): readonly DropReceipt[] {
  if (state.recentDrops) return state.recentDrops;
  const last = state.lastSettlement;
  return last?.source === 'left' ? [{ visitId: last.visitId, itemId: last.itemId, settledAt: last.settledAt }] : [];
}
export function initialState(): GameState {
  return {
    version: 3, revision: 0, firstRunDone: false, discovered: {}, items: {},
    activeVisit: null, lastSettlement: null, observationOwner: null,
    settings: { sound: false, arrivalChime: false, backgroundFamily: 'forest' },
  };
}
export function emptyItem(): ItemRecord {
  return {
    totalCount: 0, manualCount: 0, leftCount: 0, unreadCount: 0, unreadLeftCount: 0,
    firstObtainedAt: null, lastObtainedAt: null, firstViewedAt: null,
  };
}
