import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../src/domain/state.ts';
import {applyCommand} from '../src/domain/commands.ts';
import {validState} from '../src/domain/validation.ts';
const at='2026-11-16T00:00:00Z', owner={sessionId:'shared-test',epoch:1};
function capture(state,family,visitId,sceneSeason='spring'){
 state={...structuredClone(state),observationOwner:owner,activeVisit:null};
 const started=applyCommand(state,{type:'startVisit',owner,visit:{visitId,yokaiId:'yokai_001',itemId:'item_001',appearedAt:at,captureDeadlineAt:'2026-11-16T00:00:20Z',dwellMs:20000,season:sceneSeason,backgroundFamily:family}});
 assert.equal(started.status,'changed');
 const command={type:'settleVisit',owner,visitId,source:'manual',at:'2026-11-16T00:00:01Z',photo:{photoKey:'legacy-compatible-key',slotSeason:'spring',sceneSeason,capturedGameSeason:'spring',shared:true}};
 const result=applyCommand(started.state,command);assert.equal(result.status,'changed');return {state:result.state,command};
}
test('shared captures unlock only the photographed place, repeat without a file reservation and preserve old files',()=>{
 const old={photoKey:'old-png',at,status:'saved',backgroundFamily:'forest',sceneSeason:'spring'};
 const start=initialState();start.discovered.yokai_001={firstCapturedAt:at,captureCount:1,photos:{spring:old},coverSeason:'spring'};
 let {state,command}=capture(start,'hill','v1');const r=state.discovered.yokai_001;
 assert.deepEqual(r.photos.spring,old);
 assert.equal(r.placePhotos['spring:hill'].status,'saved');assert.equal(r.placePhotos['spring:hill'].shared,true);
 assert.equal(r.placePhotos['spring:hill'].captureCount,1);assert.equal(r.placePhotos['spring:forest'],undefined);
 assert.equal(applyCommand(state,command).status,'unchanged');
 state=capture(state,'hill','v2').state;
 assert.equal(state.discovered.yokai_001.placePhotos['spring:hill'].captureCount,2);
 state=capture(state,'forest','v3').state;
 assert.equal(Object.keys(state.discovered.yokai_001.placePhotos).length,2);
 assert.equal(validState(state),true);
});
test('representative identity follows actual scene season across a game-season boundary and is shared across accounts',()=>{
 const a=capture(initialState(),'forest','alice','winter').state.discovered.yokai_001;
 const b=capture(initialState(),'forest','bob','winter').state.discovered.yokai_001;
 assert.equal(a.placePhotos['winter:forest'].photoKey,b.placePhotos['winter:forest'].photoKey);
 assert.equal(a.placePhotos['spring:forest'],undefined);
 assert.equal(a.placePhotos['winter:forest'].capturedGameSeason,'spring');
 const corrupt=capture(initialState(),'forest','invalid').state;
 corrupt.discovered.yokai_001.placePhotos['spring:forest'].backgroundFamily='hill';
 assert.equal(validState(corrupt),false);
});

import {buildEncyclopedia} from '../src/encyclopedia/model.ts';
import {EncyclopediaController} from '../src/encyclopedia/controller.ts';
import {readFile} from 'node:fs/promises';
import {decodeRgbaPng} from '../src/capture/png.ts';
const catalog=JSON.parse(await readFile(new URL('../src/data/generated/asset-catalog.json',import.meta.url)));
test('place projection preserves unknown old photographs and never unlocks the other environment',()=>{
 const state=capture(initialState(),'forest','projection').state;
 const r=state.discovered.yokai_001;
 r.photos.summer={photoKey:'old-unknown',at,status:'saved'};
 const model=buildEncyclopedia(catalog,state,{places:true});
 const entry=model.entries.find(e=>e.id==='yokai_001');
 assert.equal(model.progress.totalPhotos,384);
 assert.equal(entry.slots.find(s=>s.season==='spring:forest').state,'saved');
 assert.equal(entry.slots.find(s=>s.season==='spring:hill').state,'empty');
 assert.equal(entry.slots.find(s=>s.season==='summer:forest').state,'empty');
 assert.equal(entry.slots.find(s=>s.season==='summer:hill').state,'empty');
 assert.equal(entry.slots.find(s=>s.season==='legacy:summer').metadata.photoKey,'old-unknown');
});
test('shared image switches clear the previous URL and do not request a private PNG',async()=>{
 const state=capture(initialState(),'forest','controller').state;let reads=0;
 const c=new EncyclopediaController({catalog,repository:{read:async()=>({status:'ok',state})},files:{get:async()=>{reads++;throw Error('private PNG requested');}},sharedPhotoHref:(id,s,f,full)=>`${id}/${s}/${f}/${full}`});
 await c.open();await c.select('yokai_001');
 assert.equal(c.snapshot.photo.url,'yokai_001/spring/forest/false');
 await c.selectPhoto('spring:hill');assert.equal(c.snapshot.photo.state,'empty');assert.equal(c.snapshot.photo.url,undefined);
 await c.selectPhoto('spring:forest');await c.showFull(true);assert.equal(c.snapshot.photo.url,'yokai_001/spring/forest/true');assert.equal(reads,0);c.close();
});
test('opening an unknown-place old cover selects a visible place without inventing a capture',async()=>{
 const state=initialState();state.discovered.yokai_001={firstCapturedAt:at,captureCount:1,coverSeason:'spring',photos:{spring:{photoKey:'unknown-place',at,status:'saved'}}};
 const before=JSON.stringify(state);let reads=0;
 const c=new EncyclopediaController({catalog,repository:{read:async()=>({status:'ok',state})},files:{get:async()=>{reads++;return{status:'missing'};}},sharedPhotoHref:()=>'/shared.png'});
 await c.open();await c.select('yokai_001');
 assert.equal(c.snapshot.season,'spring:forest');assert.equal(c.snapshot.photo.state,'empty');assert.equal(reads,0);
 assert.equal(JSON.stringify(state),before);c.close();
});
test('every catalog environment has distinct valid portrait and full-scene files',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../src/data/generated/shared-photos.json',import.meta.url)));
 let total=0;
 for(const y of catalog.yokai)for(const s of y.seasons){
  const paths=[];
  for(const f of ['forest','hill']){
   const pair=manifest[`shared-v1:${y.id}:${s}:${f}`];assert.ok(pair);total++;paths.push(pair.full);
   for(const [key,size]of [['portrait',[96,128]],['full',[192,256]]]){
    const raster=await decodeRgbaPng(await readFile(new URL('../public/'+pair[key],import.meta.url)),size);assert.equal(raster.width,size[0]);
   }
  }
  assert.notEqual(paths[0],paths[1]);
 }
 assert.equal(total,384);assert.equal(Object.keys(manifest).length,total);
});

test('known-place legacy originals stay accessible alongside the shared representative',async()=>{
 const state=initialState();state.discovered.yokai_001={firstCapturedAt:at,captureCount:1,coverSeason:'spring',photos:{spring:{photoKey:'private-original',at,status:'saved',sceneSeason:'spring',backgroundFamily:'forest'}}};
 const entry=buildEncyclopedia(catalog,state,{places:true}).entries.find(e=>e.id==='yokai_001');
 assert.equal(entry.slots.find(s=>s.season==='spring:forest').state,'saved');
 assert.equal(entry.slots.find(s=>s.season==='legacy:spring').metadata.photoKey,'private-original');
 let read;const c=new EncyclopediaController({catalog,repository:{read:async()=>({status:'ok',state})},files:{get:async key=>{read=key;return{status:'missing'};}},sharedPhotoHref:()=>'/shared.png'});
 await c.open();await c.select('yokai_001');await c.selectPhoto('legacy:spring');assert.equal(read,'private-original');c.close();
 const next=capture(state,'forest','new-known').state.discovered.yokai_001;
 assert.equal(next.placePhotos['spring:forest'].captureCount,2);assert.equal(next.placePhotos['spring:forest'].at,at);
 assert.equal(next.photos.spring.photoKey,'private-original');
});
