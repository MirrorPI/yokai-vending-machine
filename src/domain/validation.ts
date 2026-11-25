import type { CaptureRecord, GameState, ItemRecord, ObservationOwner, PhotoMetadata, Settings, Visit } from './state.ts';
import { RECENT_DROP_LIMIT } from './state.ts';

export const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
export const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const id = (v: unknown): v is string => text(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
export const timestamp = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const nullableTime = (v: unknown) => v === null || timestamp(v);
export const season = (v: unknown) => ['spring', 'summer', 'autumn', 'winter'].includes(v as string);
export const family = (v: unknown) => v === 'forest' || v === 'hill';
const source = (v: unknown) => v === 'manual' || v === 'left';
export function photo(v: unknown): v is PhotoMetadata {
  return object(v) && text(v.photoKey) && timestamp(v.at)
    && (v.shared === undefined || typeof v.shared === 'boolean')
    && (v.captureCount === undefined || count(v.captureCount) && v.captureCount > 0)
    && (v.lastCapturedAt === undefined || timestamp(v.lastCapturedAt))
    && (v.status === undefined || ['pending', 'saved', 'failed'].includes(v.status as string))
    && (v.attemptId === undefined || text(v.attemptId))
    && (v.backgroundFamily === undefined || family(v.backgroundFamily))
    && (v.capturedGameSeason === undefined || season(v.capturedGameSeason))
    && (v.sceneSeason === undefined || season(v.sceneSeason));
}
export function capture(v: unknown): v is CaptureRecord {
  return object(v) && timestamp(v.firstCapturedAt) && count(v.captureCount) && v.captureCount > 0
    && (v.firstViewedAt === undefined || timestamp(v.firstViewedAt))
    && object(v.photos) && Object.values(v.photos).every(photo)
    && (v.placePhotos === undefined || object(v.placePhotos) && Object.entries(v.placePhotos).every(([key, p]) =>
      photo(p) && p.shared === true && p.status === 'saved' && family(p.backgroundFamily) && season(p.sceneSeason)
      && key === `${p.sceneSeason}:${p.backgroundFamily}` && count(p.captureCount) && p.captureCount > 0))
    && (v.coverSeason === null || (text(v.coverSeason) && Object.hasOwn(v.photos, v.coverSeason)));
}
export function item(v: unknown): v is ItemRecord {
  if (!object(v)) return false;
  const { totalCount: t, manualCount: m, leftCount: l, unreadCount: u, unreadLeftCount: ul } = v;
  return count(t) && count(m) && count(l) && count(u) && count(ul)
    && t === m + l && ul <= u && u <= t && ul <= l && u - ul <= m
    && nullableTime(v.firstObtainedAt) && nullableTime(v.lastObtainedAt) && nullableTime(v.firstViewedAt)
    && (t === 0 || (timestamp(v.firstObtainedAt) && timestamp(v.lastObtainedAt)));
}
export function owner(v: unknown): v is ObservationOwner {
  return object(v) && id(v.sessionId) && count(v.epoch) && v.epoch > 0;
}
export function settings(v: unknown): v is Settings {
  return object(v) && typeof v.sound === 'boolean' && typeof v.arrivalChime === 'boolean' && family(v.backgroundFamily)
    && (v.seasonMode === undefined || v.seasonMode === 'auto' || v.seasonMode === 'fixed')
    && (v.fixedSeason === undefined || season(v.fixedSeason)) && (v.seasonMode !== 'fixed' || season(v.fixedSeason));
}
export function visit(v: unknown): v is Visit {
  if (!object(v) || !id(v.visitId) || !id(v.yokaiId) || !id(v.itemId)
    || !timestamp(v.appearedAt) || !count(v.ownerEpoch) || v.ownerEpoch === 0
    || (v.captureDeadlineAt !== undefined && (!timestamp(v.captureDeadlineAt) || Date.parse(v.captureDeadlineAt) <= Date.parse(v.appearedAt)))
    || (v.dwellMs !== undefined && (typeof v.dwellMs !== 'number' || !Number.isFinite(v.dwellMs) || v.dwellMs <= 0
      || !timestamp(v.captureDeadlineAt) || Math.abs(v.dwellMs - (Date.parse(v.captureDeadlineAt) - Date.parse(v.appearedAt))) >= 1))
    || (v.season !== undefined && !season(v.season))
    || (v.backgroundFamily !== undefined && !family(v.backgroundFamily))
    || (v.photoSlotSeason !== undefined && !season(v.photoSlotSeason))) return false;
  if (v.itemGranted === false) return v.state === 'VISITING' && v.grantSource === null && v.settledAt === null;
  return v.itemGranted === true && source(v.grantSource) && timestamp(v.settledAt)
    && v.state === (v.grantSource === 'manual' ? 'CAPTURED' : 'SETTLED');
}
export function validState(v: unknown): v is GameState {
  if (!object(v) || v.version !== 3 || !count(v.revision) || typeof v.firstRunDone !== 'boolean'
    || (v.viewedCutscenes !== undefined && (!object(v.viewedCutscenes) || !Object.entries(v.viewedCutscenes).every(([key, value]) => id(key) && key.length <= 100 && value === true)))
    || !object(v.discovered) || !Object.values(v.discovered).every(capture)
    || !object(v.items) || !Object.values(v.items).every(item) || !settings(v.settings)
    || !(v.observationOwner === null || owner(v.observationOwner))
    || !(v.activeVisit === null || visit(v.activeVisit))) return false;
  const a = v.activeVisit;
  const o = v.observationOwner;
  if (a && (!o || a.ownerEpoch !== o.epoch)) return false;
  const last = v.lastSettlement;
  if (!(last === null || (object(last) && id(last.visitId) && id(last.itemId) && source(last.source) && timestamp(last.settledAt)))) return false;
  if (last) {
    const row = Object.hasOwn(v.items, last.itemId as string) ? v.items[last.itemId as string] as ItemRecord : undefined;
    if (!row || (last.source === 'manual' ? row.manualCount : row.leftCount) === 0) return false;
  }
  if (v.recentDrops !== undefined) {
    if (!Array.isArray(v.recentDrops) || v.recentDrops.length > RECENT_DROP_LIMIT) return false;
    const visits = new Set<string>();
    const counts = new Map<string, number>();
    for (const receipt of v.recentDrops) {
      if (!object(receipt) || !id(receipt.visitId) || !id(receipt.itemId) || !timestamp(receipt.settledAt) || visits.has(receipt.visitId)) return false;
      const row = Object.hasOwn(v.items, receipt.itemId) ? v.items[receipt.itemId] as ItemRecord : undefined;
      const visible = (counts.get(receipt.itemId) ?? 0) + 1;
      if (!row || visible > row.leftCount) return false;
      visits.add(receipt.visitId);
      counts.set(receipt.itemId, visible);
    }
  }
  if (a?.itemGranted && (!last || last.visitId !== a.visitId || last.itemId !== a.itemId
    || last.source !== a.grantSource || last.settledAt !== a.settledAt)) return false;
  if (a && !a.itemGranted && last?.visitId === a.visitId) return false;
  if (a?.itemGranted) {
    const row = Object.hasOwn(v.items, a.itemId) ? v.items[a.itemId] as ItemRecord : undefined;
    if (!row || (a.grantSource === 'manual' ? row.manualCount : row.leftCount) === 0) return false;
    if (a.grantSource === 'manual') {
      if (!Object.hasOwn(v.discovered, a.yokaiId)) return false;
      const record = v.discovered[a.yokaiId] as CaptureRecord;
      const slot = a.photoSlotSeason ?? a.season;
      if (slot !== undefined && !Object.hasOwn(record.photos, slot)) return false;
    }
  }
  return true;
}
