import { createHash } from 'node:crypto';
import { validState } from '../src/domain/validation.ts';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`; return JSON.stringify(value); }
export const key = (kind, value) => `${kind}#${hash(value)}`;
export const goodId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !['__proto__', 'constructor', 'prototype'].includes(value) && !/[\u0000-\u001f]/.test(value);
// Resource caps, not current collection totals. Leave room for preserved/retired
// records: each of the 120 supported records can carry four legacy photographs and eight place/season records.
const MAX_DISCOVERED = 120;
const MAX_PHOTOS = MAX_DISCOVERED * 4;
const MAX_PLACE_PHOTOS = MAX_DISCOVERED * 8;
export function boundedState(state) { return validState(state) && Buffer.byteLength(JSON.stringify(state)) <= 262144 && Object.keys(state.discovered).length <= MAX_DISCOVERED && Object.values(state.discovered).reduce((n,r)=>n+Object.keys(r.photos).length,0)<=MAX_PHOTOS && Object.values(state.discovered).reduce((n,r)=>n+Object.keys(r.placePhotos??{}).length,0)<=MAX_PLACE_PHOTOS; }
export function objectKey(subject, reservation) { return `${hash(subject)}/${hash(reservation.photoKey)}/${hash(reservation.attemptId)}.json`; }
