import test from 'node:test';
import assert from 'node:assert/strict';
import { minigameProgress, minigameItemId } from '../src/app/minigame-progress.ts';
import { readFileSync } from 'node:fs';
test('minigame unlock uses only the dokkaebi fire item without consuming it',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../src/data/generated/asset-catalog.json',import.meta.url)));
 assert.equal(catalog.yokai.find(y=>y.name==='도깨비불').mainItemId,minigameItemId);
 for(const count of [0,99,100,101]){
  const model={entries:[{id:minigameItemId,status:'acquired',totalCount:count},{id:'other',status:'acquired',totalCount:999}]};
  assert.deepEqual(minigameProgress(model),{count,unlocked:count>=100});
  assert.equal(model.entries[0].totalCount,count);
 }
 assert.deepEqual(minigameProgress({entries:[]}),{count:0,unlocked:false});
});
