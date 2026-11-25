import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initialState} from '../src/domain/state.ts';
import {applyCommand} from '../src/domain/commands.ts';
import {buildInventory} from '../src/inventory/model.ts';
import {validState} from '../src/domain/validation.ts';

const catalog = JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
const at = '2026-11-16T09:00:00Z';
const owner = {sessionId:'fixture', epoch:1};
function run(s, command) {
  const result = applyCommand(s, command);
  assert.ok(result.status === 'changed' || result.status === 'unchanged', result.reason);
  return result.state;
}
function started(s, n, i) {
  if (!s.observationOwner) s = run(s,{type:'claimObservation', sessionId:owner.sessionId, expectedEpoch:0});
  return run(s,{type:'startVisit',owner,visit:{visitId:'visit-'+n,yokaiId:'yokai_'+i,itemId:'item_'+i,
    appearedAt:at,captureDeadlineAt:'2026-11-16T09:00:30Z',season:'spring',backgroundFamily:'forest'}});
}
function drop(s,n,i,source='left') {
  s = started(s,n,i);
  const cmd = {type:'settleVisit',owner,visitId:'visit-'+n,source,at,
    ...(source === 'manual' ? {photo:{photoKey:'key-'+n}} : {})};
  s = run(s,cmd);
  assert.equal(applyCommand(s,cmd).status,'unchanged','retries do not add receipts');
  return run(s,{type:'finishVisit',owner,visitId:'visit-'+n});
}
test('keeps five latest left grants in insertion order, skips manual, and shows repeated items',()=>{
 let s = initialState();
 for (const [n,i] of ['001','002','003','003','004','005'].entries()) s=drop(s,n,i);
 s=drop(s,6,'006','manual');
 const model = buildInventory(catalog,s);
 assert.deepEqual(model.recentDrops.map(d=>d.entry.id),['item_002','item_003','item_003','item_004','item_005']);
 assert.deepEqual(model.recentDrops.map(d=>d.visitId),['visit-1','visit-2','visit-3','visit-4','visit-5']);
 assert.equal(s.items.item_001.totalCount,1,'older grants stay in inventory');
 const read = run(s,{type:'markItemViewed',itemId:'item_003',viewedAt:at,manualCount:0,leftCount:2});
 assert.deepEqual(read.recentDrops,s.recentDrops);
 assert.ok(validState(JSON.parse(JSON.stringify(read))));
});
test('legacy saves recover only a confirmed last left grant; a manual grant cannot displace it',()=>{
 let s = drop(initialState(),1,'001');
 delete s.recentDrops;
 assert.ok(validState(s));
 assert.deepEqual(buildInventory(catalog,s).recentDrops.map(d=>d.entry.id),['item_001']);
 s = drop(s,2,'002','manual');
 assert.deepEqual(buildInventory(catalog,s).recentDrops.map(d=>d.entry.id),['item_001']);
});
