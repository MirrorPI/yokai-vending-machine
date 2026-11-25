import { emptyItem, recentDropHistory, RECENT_DROP_LIMIT } from './state.ts';
import type { GameState, ObservationOwner, PhotoMetadata, Visit } from './state.ts';
import type { Command } from './repository.ts';
import { count, family, id, object, owner, season, text, timestamp, validState, visit } from './validation.ts';
import { placePhotoSlot, sharedPhotoKey } from '../photos/shared.ts';
import { seasonProgress } from './season-control.ts';

type Transition = { status: 'changed' | 'unchanged'; state: GameState } | { status: 'invalid'; reason: string };
const invalid = (reason: string): Transition => ({ status: 'invalid', reason });
const owns = (s: GameState, o: ObservationOwner) => owner(o)
  && s.observationOwner?.sessionId === o.sessionId && s.observationOwner.epoch === o.epoch;
const own = <T>(records: Record<string, T>, key: string): T | undefined => Object.hasOwn(records, key) ? records[key] : undefined;

/** Persistence-level transitions only. Event timing, visibility and static eligibility belong to A04/A05. */
export function applyCommand(current: GameState, c: Command): Transition {
  if (!object(c)) return invalid('Command must be an object');
  const s = structuredClone(current);
  switch (c.type) {
    case 'claimObservation': {
      if (!id(c.sessionId) || !count(c.expectedEpoch)
        || c.expectedEpoch !== (s.observationOwner?.epoch ?? 0)) return invalid('Stale observation epoch');
      const epoch = c.expectedEpoch + 1;
      if (!count(epoch)) return invalid('Observation epoch exhausted');
      s.observationOwner = { ...s.observationOwner, sessionId: c.sessionId, epoch };
      if (s.activeVisit) s.activeVisit.ownerEpoch = epoch;
      break;
    }
    case 'startVisit': {
      if (!owns(s, c.owner) || s.activeVisit !== null || !object(c.visit)) return invalid('Owner or active visit mismatch');
      const v: Visit = { ...c.visit, ownerEpoch: c.owner.epoch, state: 'VISITING', itemGranted: false, grantSource: null, settledAt: null };
      if (!visit(v) || !timestamp(v.captureDeadlineAt) || !season(v.season) || !family(v.backgroundFamily)
        || s.lastSettlement?.visitId === v.visitId) return invalid('Invalid or reused visit');
      s.activeVisit = v;
      break;
    }
    case 'settleVisit': {
      const v = s.activeVisit;
      if (!owns(s, c.owner) || !v || v.visitId !== c.visitId || v.ownerEpoch !== c.owner.epoch) return invalid('Visit or owner mismatch');
      if (!timestamp(c.at) || !['manual', 'left'].includes(c.source)) return invalid('Invalid settlement');
      const timing = c.timing;
      if (timing !== undefined && (!object(timing) || timing.appearedAt !== v.appearedAt
        || timing.captureDeadlineAt !== v.captureDeadlineAt || !Number.isFinite(timing.elapsedMs)
        || timing.elapsedMs < 0)) return invalid('Invalid monotonic evidence');
      if (v.itemGranted) return { status: 'unchanged', state: s };
      const row = own(s.items, v.itemId) ?? emptyItem();
      row.totalCount += 1;
      row.unreadCount += 1;
      row.firstObtainedAt ??= c.at;
      row.lastObtainedAt = c.at;
      if (c.source === 'manual') {
        if (!timestamp(v.captureDeadlineAt) || (timing === undefined
          ? Date.parse(c.at) < Date.parse(v.appearedAt) || Date.parse(c.at) >= Date.parse(v.captureDeadlineAt)
          : timing.elapsedMs >= (v.dwellMs ?? Date.parse(v.captureDeadlineAt) - Date.parse(v.appearedAt)))
          || !season(v.season) || !family(v.backgroundFamily) || !object(c.photo) || !text(c.photo.photoKey)
          || (c.photo.shared !== undefined && typeof c.photo.shared !== 'boolean')
          || (c.photo.shared && c.photo.sceneSeason !== undefined && c.photo.sceneSeason !== v.season)
          || (c.photo.slotSeason !== undefined && !season(c.photo.slotSeason))
          || (c.photo.sceneSeason !== undefined && !season(c.photo.sceneSeason))
          || (c.photo.capturedGameSeason !== undefined && !season(c.photo.capturedGameSeason))) return invalid('Manual capture metadata or deadline invalid');
        row.manualCount += 1;
        const slot = c.photo.slotSeason ?? v.season!;
        if (c.photo.slotSeason !== undefined) v.photoSlotSeason = slot;
        const record: import('./state.ts').CaptureRecord = own(s.discovered, v.yokaiId) ?? {
          firstCapturedAt: c.at, captureCount: 0, photos: {}, coverSeason: null,
        };
        record.captureCount += 1;
        const old = own(record.photos, slot);
        if (c.photo.shared) {
          const place = placePhotoSlot(v.season!, v.backgroundFamily!);
          record.placePhotos ??= {};
          const previous = own(record.placePhotos, place) ?? Object.entries(record.photos).find(([s, p]) => !p.shared && (p.status === 'saved' || p.status === undefined) && p.backgroundFamily === v.backgroundFamily && (p.sceneSeason ?? s) === v.season)?.[1];
          const p: PhotoMetadata = { photoKey: sharedPhotoKey(v.yokaiId, v.season!, v.backgroundFamily!),
            at: previous?.at ?? c.at, lastCapturedAt: c.at, captureCount: (previous?.captureCount ?? (previous ? 1 : 0)) + 1,
            shared: true, status: 'saved', backgroundFamily: v.backgroundFamily, sceneSeason: v.season,
            capturedGameSeason: c.photo.capturedGameSeason ?? slot };
          record.placePhotos[place] = p;
          // Retain the legacy seasonal reference for older clients and visit invariants.
          if (!old) { record.photos[slot] = { ...p }; record.coverSeason ??= slot; }
        } else if (!old || old.status === 'failed') {
          if (old && old.photoKey !== c.photo.photoKey) return invalid('Retry must keep the original photoKey');
          const p: PhotoMetadata = {
            ...old, photoKey: c.photo.photoKey, at: c.at, status: 'pending', attemptId: v.visitId,
            backgroundFamily: v.backgroundFamily,
            ...(c.photo.sceneSeason !== undefined ? { sceneSeason: c.photo.sceneSeason } : {}),
            ...(c.photo.capturedGameSeason !== undefined ? { capturedGameSeason: c.photo.capturedGameSeason } : {}),
          };
          record.photos[slot] = p;
          record.coverSeason ??= slot;
        }
        s.discovered[v.yokaiId] = record;
      } else {
        if (c.photo !== undefined) return invalid('Automatic settlement cannot reserve a photo');
        row.leftCount += 1;
        row.unreadLeftCount += 1;
      }
      s.items[v.itemId] = row;
      const previousDrops = recentDropHistory(s);
      if (c.source === 'left') {
        s.recentDrops = [...previousDrops, { visitId: v.visitId, itemId: v.itemId, settledAt: c.at }].slice(-RECENT_DROP_LIMIT);
      } else if (!s.recentDrops && previousDrops.length) {
        s.recentDrops = [...previousDrops];
      }
      Object.assign(v, { itemGranted: true, grantSource: c.source, settledAt: c.at, state: c.source === 'manual' ? 'CAPTURED' : 'SETTLED' });
      s.lastSettlement = { visitId: v.visitId, itemId: v.itemId, source: c.source, settledAt: c.at };
      break;
    }
    case 'finishVisit':
      if (!owns(s, c.owner) || s.activeVisit?.visitId !== c.visitId || !s.activeVisit.itemGranted) return invalid('Only a settled active visit can finish');
      s.activeVisit = null;
      break;
    case 'markYokaiViewed': {
      if (!id(c.yokaiId) || !timestamp(c.viewedAt)) return invalid('Invalid viewed capture');
      const record = own(s.discovered, c.yokaiId);
      if (!record) return invalid('Capture not found');
      record.firstViewedAt ??= c.viewedAt;
      break;
    }
    case 'markItemViewed': {
      if (!id(c.itemId) || !timestamp(c.viewedAt) || !count(c.manualCount) || !count(c.leftCount)) return invalid('Invalid viewed range');
      const row = own(s.items, c.itemId);
      if (!row || row.totalCount === 0 || c.manualCount > row.manualCount || c.leftCount > row.leftCount) return invalid('Viewed counts exceed current counts');
      const checkedManual = row.manualCount - (row.unreadCount - row.unreadLeftCount);
      const checkedLeft = row.leftCount - row.unreadLeftCount;
      row.unreadLeftCount = row.leftCount - Math.max(checkedLeft, c.leftCount);
      row.unreadCount = row.unreadLeftCount + row.manualCount - Math.max(checkedManual, c.manualCount);
      row.firstViewedAt ??= c.viewedAt;
      break;
    }
    case 'updatePhotoStatus': {
      if (!id(c.yokaiId) || !season(c.season) || !text(c.photoKey) || !['saved', 'failed'].includes(c.status)) return invalid('Invalid photo completion');
      const record = own(s.discovered, c.yokaiId);
      const p = record && own(record.photos, c.season);
      if (!p || p.photoKey !== c.photoKey || p.attemptId !== c.attemptId) return invalid('Stale photo completion');
      if (p.status === c.status) return { status: 'unchanged', state: s };
      if (p.status !== 'pending') return invalid('Photo is not pending');
      p.status = c.status;
      break;
    }
    case 'changeSettings': {
      if (!object(c.patch) || Object.keys(c.patch).some(k => !['sound', 'arrivalChime', 'backgroundFamily', 'seasonMode', 'fixedSeason'].includes(k))
        || (c.patch.sound !== undefined && typeof c.patch.sound !== 'boolean')
        || (c.patch.arrivalChime !== undefined && typeof c.patch.arrivalChime !== 'boolean')
        || (c.patch.backgroundFamily !== undefined && !family(c.patch.backgroundFamily))
        || (c.patch.seasonMode !== undefined && !['auto', 'fixed'].includes(c.patch.seasonMode))
        || (c.patch.fixedSeason !== undefined && !season(c.patch.fixedSeason))
        || (c.viewedCutscenes !== undefined && (!Array.isArray(c.viewedCutscenes) || c.viewedCutscenes.length > 100 || !c.viewedCutscenes.every(key => id(key) && key.length <= 100)))
        || (c.firstRunDone !== undefined && typeof c.firstRunDone !== 'boolean')) return invalid('Invalid settings patch');
      if ((c.patch.seasonMode === 'fixed' || c.patch.fixedSeason !== undefined) && !seasonProgress(s).unlocked) return invalid('Season selection is locked');
      if ((c.patch.seasonMode ?? s.settings.seasonMode) === 'fixed' && !season(c.patch.fixedSeason ?? s.settings.fixedSeason)) return invalid('Fixed season required');
      for (const [key, value] of Object.entries(c.patch)) if (value !== undefined) s.settings[key] = value;
      if (c.firstRunDone !== undefined) s.firstRunDone = c.firstRunDone;
      if (c.viewedCutscenes?.length) {
        s.viewedCutscenes ??= {};
        for (const key of c.viewedCutscenes) s.viewedCutscenes[key] = true;
      }
      break;
    }
    default: return invalid('Unknown command');
  }
  if (!validState(s)) return invalid('State invariants or safe integer bounds violated');
  return { status: JSON.stringify(s) === JSON.stringify(current) ? 'unchanged' : 'changed', state: s };
}
