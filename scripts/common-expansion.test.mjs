import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {inspectProject} from './asset-catalog.mjs';
import {candidatesFor} from '../src/runtime/rules.ts';
import {buildEncyclopedia} from '../src/encyclopedia/model.ts';
import {buildInventory} from '../src/inventory/model.ts';
import {initialState} from '../src/domain/state.ts';
const {catalog,report}=inspectProject(fileURLToPath(new URL('..',import.meta.url)));
test('approved expansion adds 8 all-season species and preserves 60 old IDs',()=>{
 assert.equal(report.summary.errors,0);assert.equal(catalog.yokai.length,102);assert.equal(catalog.items.length,102);
 assert.equal(catalog.yokai.filter(y=>y.seasons.length===4).length,30);
 for(const season of ['spring','summer','autumn','winter'])for(const family of ['forest','hill']){
  const p=candidatesFor(catalog,season,family);assert.equal(p.available.length,48);assert.deepEqual(p.excluded,[]);
  assert.deepEqual(Object.fromEntries(['common','rare','legendary','special'].map(r=>[r,p.available.filter(y=>y.rarity===r).length])),{common:22,rare:16,legendary:6,special:4});
 }
 assert.equal(buildEncyclopedia(catalog,initialState()).progress.totalPhotos,192);
 assert.equal(buildInventory(catalog,initialState()).progress.totalKinds,102);
});
test('existing 60 records, photos and read markers survive expansion unchanged',()=>{
 const state=initialState(),at='2026-11-15T08:00:00Z';
 for(const y of catalog.yokai.filter(y=>y.no<=60)){
  state.discovered[y.id]={firstCapturedAt:at,captureCount:2,firstViewedAt:at,coverSeason:y.seasons[0],photos:Object.fromEntries(y.seasons.map(s=>[s,{at,status:'saved',photoKey:`old:${y.id}:${s}`}]))};
  state.items[y.mainItemId]={totalCount:7,manualCount:3,leftCount:4,unreadCount:2,unreadLeftCount:1,firstObtainedAt:at,lastObtainedAt:at,firstViewedAt:at};
 }
 const before=JSON.stringify(state),old={...catalog,yokai:catalog.yokai.filter(y=>y.no<=60),items:catalog.items.filter(i=>Number(i.id.slice(-3))<=60)};
 assert.deepEqual(buildEncyclopedia(catalog,state).entries.slice(0,60),buildEncyclopedia(old,state).entries);
 assert.deepEqual(buildInventory(catalog,state).entries.slice(0,60),buildInventory(old,state).entries);
 assert.ok(buildInventory(catalog,state).entries.slice(60).every(e=>e.status==='locked'));
 assert.equal(JSON.stringify(state),before);
});
test('new item starts NEW and repeat acquisition carries count without reviving NEW',()=>{
 const s=initialState(),at='2026-11-16T00:00:00Z';s.items.item_061={totalCount:1,manualCount:1,leftCount:0,unreadCount:1,unreadLeftCount:0,firstObtainedAt:at,lastObtainedAt:at,firstViewedAt:null};
 const entry=()=>buildInventory(catalog,s).entries.find(e=>e.id==='item_061');assert.equal(entry()?.isNew,true);
 s.items.item_061.firstViewedAt=at;s.items.item_061.totalCount=2;s.items.item_061.manualCount=2;
 assert.equal(entry().isNew,false);assert.equal(entry().totalCount,2);assert.equal(entry().unreadCount,1);
});
