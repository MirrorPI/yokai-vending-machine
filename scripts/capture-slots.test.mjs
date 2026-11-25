// Memory-only photo-slot regression; never accesses a browser profile or user DB.
import test from 'node:test';import assert from 'node:assert/strict';
import {catalog} from './helpers/capture-harness.mjs';
import {createMemoryRepository} from '../src/storage/memory.ts';
const at='2026-10-27T00:00:00Z',owner={sessionId:'fixture-only',epoch:1};
test('common four/dedicated one contract totals 192 slots across both environments, keeps cover and keys',async()=>{
 const repo=createMemoryRepository();await repo.commit({type:'claimObservation',sessionId:owner.sessionId,expectedEpoch:0});let i=0;
 for(const y of catalog.yokai){assert.equal(y.seasons.length,y.no<=20||(y.no>=61&&y.no<=68)||(y.no>=93&&y.no<=94)?4:1);
  for(const season of y.seasons){
   const visitId=`contract-${++i}`,photoKey=`original-${y.id}-${season}`;
   const result=await repo.commit({type:'startVisit',owner,visit:{visitId,yokaiId:y.id,itemId:y.mainItemId,appearedAt:at,captureDeadlineAt:'2026-10-27T00:00:20Z',season,backgroundFamily:i%2?'forest':'hill'}});assert.equal(result.status,'applied');
   assert.equal((await repo.commit({type:'settleVisit',owner,visitId,source:'manual',at,photo:{photoKey,slotSeason:season,sceneSeason:season,capturedGameSeason:season}})).status,'applied');
   await repo.commit({type:'updatePhotoStatus',yokaiId:y.id,season,photoKey,attemptId:visitId,status:'failed'});await repo.commit({type:'finishVisit',owner,visitId});
  }
 }
 const state=(await repo.read()).state;assert.equal(i,192);assert.equal(Object.values(state.discovered).reduce((n,r)=>n+Object.keys(r.photos).length,0),192);
 for(const y of catalog.yokai){const record=state.discovered[y.id];assert.equal(record.coverSeason,y.seasons[0]);assert.equal(record.captureCount,y.seasons.length);assert.equal(record.firstCapturedAt,at);assert.deepEqual(Object.keys(record.photos),y.seasons);for(const s of y.seasons)assert.equal(record.photos[s].photoKey,`original-${y.id}-${s}`);
  // Four common season/environment visits merge into the one canonical item.
  const expected=y.no<=20||(y.no>=61&&y.no<=68)||(y.no>=93&&y.no<=94)?4:1,item=state.items[y.mainItemId];assert.equal(item.totalCount,expected);assert.equal(item.manualCount,expected);assert.equal(item.leftCount,0);assert.equal(item.unreadCount,expected);
 }
 assert.equal(Object.keys(state.items).length,102,'environment/season never creates another item key');
});
