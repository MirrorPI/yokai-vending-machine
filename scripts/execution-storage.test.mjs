import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryDriver,createMemoryRepository} from '../src/storage/memory.ts';
const owner={sessionId:'verified',epoch:1};
const visit={visitId:'real-1',yokaiId:'yokai_001',itemId:'item_001',appearedAt:'2026-10-27T00:00:00.000Z',captureDeadlineAt:'2026-10-27T00:00:20.000Z',season:'spring',backgroundFamily:'forest'};
async function setup(){const d=createMemoryDriver();const r=createMemoryRepository(d);await r.commit({type:'claimObservation',sessionId:'verified',expectedEpoch:0});await r.commit({type:'startVisit',owner,visit});return {r,d};}
const settle=(extra={})=>({type:'settleVisit',owner,visitId:'real-1',source:'manual',at:'2026-10-27T00:00:01.000Z',photo:{photoKey:'yokai_001_spring'},...extra});
const timing=elapsedMs=>({appearedAt:visit.appearedAt,captureDeadlineAt:visit.captureDeadlineAt,elapsedMs});
test('locked guard rejects a click that expired while waiting for storage, without any partial award',async()=>{
 const {r,d}=await setup();let eligible=true;
 const held=d.exclusive(()=>{eligible=false;});
 const result=await r.commit(settle(),{guard:()=>eligible});await held;
 assert.equal(result.status,'invalid');const s=(await r.read()).state;assert.deepEqual(s.items,{});assert.equal(s.activeVisit.itemGranted,false);
});
test('guard sees detached latest state; exceptions cannot mutate or commit it',async()=>{
 const {r}=await setup();const result=await r.commit(settle(),{guard:s=>{s.items.injected={};throw Error('no');}});
 assert.equal(result.status,'invalid');assert.deepEqual((await r.read()).state.items,{});
});
for(const at of ['2020-01-01T00:00:00.000Z','2030-01-01T00:00:00.000Z'])test(`monotonic evidence permits valid manual with real wall timestamp ${at}`,async()=>{
 const {r}=await setup();const result=await r.commit(settle({at,timing:timing(19999)}));assert.equal(result.status,'applied');assert.equal(result.state.activeVisit.settledAt,at);assert.equal(result.state.items.item_001.manualCount,1);
});
for(const elapsedMs of [-1,20000,20001,NaN])test(`elapsed evidence cannot approve manual at ${elapsedMs}`,async()=>{
 const {r}=await setup();assert.equal((await r.commit(settle({timing:timing(elapsedMs)}))).status,'invalid');assert.deepEqual((await r.read()).state.items,{});
});
test('timing proof must match persisted anchors and legacy ISO deadline remains strict',async()=>{
 const {r}=await setup();assert.equal((await r.commit(settle({timing:{...timing(1),appearedAt:'2025-01-01T00:00:00Z'}}))).status,'invalid');
 assert.equal((await r.commit(settle({at:visit.captureDeadlineAt}))).status,'invalid');
});
test('recovery uses actual backward wall timestamp for left without inventing elapsed time',async()=>{
 const {r}=await setup();const at='2020-01-01T00:00:00.000Z';const result=await r.commit(settle({source:'left',photo:undefined,at}));assert.equal(result.status,'applied');assert.equal(result.state.lastSettlement.settledAt,at);assert.deepEqual(result.state.discovered,{});
});
test('explicit common capture slot records game season and preserves original scene season',async()=>{
 const {r}=await setup();const result=await r.commit(settle({photo:{photoKey:'yokai_001_winter',slotSeason:'winter',sceneSeason:'spring',capturedGameSeason:'winter'}}));assert.equal(result.status,'applied');
 const record=result.state.discovered.yokai_001;assert.deepEqual(Object.keys(record.photos),['winter']);assert.equal(record.coverSeason,'winter');assert.equal(record.photos.winter.sceneSeason,'spring');assert.equal(result.state.activeVisit.photoSlotSeason,'winter');
});
test('fractional monotonic dwell is preserved despite ISO millisecond truncation',async()=>{
 const {r}=await setup();await r.commit({type:'settleVisit',owner,visitId:'real-1',source:'left',at:visit.appearedAt});await r.commit({type:'finishVisit',owner,visitId:'real-1'});
 await r.commit({type:'startVisit',owner,visit:{...visit,visitId:'fractional',dwellMs:20000.5}});
 const result=await r.commit({...settle({timing:timing(20000.25)}),visitId:'fractional'});assert.equal(result.status,'applied');assert.equal(result.state.items.item_001.manualCount,1);
});
