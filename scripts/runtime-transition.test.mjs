import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileScene } from '../src/scene/composition.ts';
const mod=await import('../src/runtime/transition.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync(new URL('../src/data/generated/asset-catalog.json',import.meta.url)));
const plan=(season,family='forest',yokaiId=null)=>compileScene(catalog,{season,family,yokaiId,playback:{originMs:99}});
const bundle=(season,id=1)=>({plan:plan(season),images:{},requestId:id});
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function setup(){assert.equal(typeof mod.SceneTransition,'function');let now=0;const requests=[];const t=new mod.SceneTransition({monotonic:()=>now,prepare:plan=>new Promise((resolve,reject)=>requests.push({plan,resolve:()=>resolve({plan,images:{},requestId:requests.length}),reject}))});return {t,requests,at:n=>{now=n;}};}
test('three-second transition only starts after complete load, sample is fixed and original backgrounds stay singular',async()=>{
 const h=setup();h.t.request(plan('spring'));h.requests[0].resolve();await flush();assert.equal(h.t.sample().current.plan.mapId,'forest_spring');
 h.t.request(plan('summer'));assert.equal(h.t.sample().current.plan.mapId,'forest_spring');h.at(10);h.requests[1].resolve();await flush();
 const start=h.t.sample();assert.equal(start.progress,0);assert.equal(start.from.plan.mapId,'forest_spring');assert.equal(start.to.plan.mapId,'forest_summer');
 h.at(1510);assert.equal(h.t.sample().progress,.5);assert.equal(start.progress,0);h.at(3010);assert.equal(h.t.sample().progress,1);h.t.tick();assert.equal(h.t.sample().from,null);assert.equal(h.t.sample().current.plan.mapId,'forest_summer');
});
test('lock holds seasonal yokai bundle; release after exit adopts newest prepared background',async()=>{
 const h=setup();h.t.request(plan('spring'));h.requests[0].resolve();await flush();h.t.setLocked(true);h.t.request(plan('summer'));h.requests[1].resolve();await flush();
 assert.equal(h.t.sample().current.plan.mapId,'forest_spring');assert.equal(h.t.sample().from,null);assert.equal(h.t.state.requested.season,'summer');h.t.setLocked(false);assert.equal(h.t.sample().to.plan.mapId,'forest_summer');
 assert.throws(()=>h.t.request(plan('spring','forest','yokai_021')),/background/i);
});
test('reverse completion and late failures never overwrite newest request; retry retains old normal scene',async()=>{
 const h=setup();h.t.request(plan('spring'));h.requests[0].resolve();await flush();h.t.request(plan('summer'));h.t.request(plan('autumn'));h.requests[2].reject(Error('decode'));await flush();h.requests[1].resolve();await flush();
 assert.equal(h.t.state.status,'failed');assert.equal(h.t.sample().current.plan.mapId,'forest_spring');h.t.retry();h.requests[3].resolve();await flush();assert.equal(h.t.sample().to.plan.mapId,'forest_autumn');
});
test('new request during fade queues newest scene without dropping either visible bundle',async()=>{
 const h=setup();h.t.request(plan('spring'));h.requests[0].resolve();await flush();h.t.request(plan('summer'));h.requests[1].resolve();await flush();h.at(1000);h.t.request(plan('autumn'));h.t.request(plan('winter'));h.requests[3].resolve();await flush();h.requests[2].resolve();await flush();
 assert.equal(h.t.sample().from.plan.mapId,'forest_spring');assert.equal(h.t.sample().to.plan.mapId,'forest_summer');h.at(3000);h.t.tick();assert.equal(h.t.sample().from.plan.mapId,'forest_summer');assert.equal(h.t.sample().to.plan.mapId,'forest_winter');assert.equal(h.t.sample().progress,0);
});
test('cancel prevents delayed scene adoption and keeps previous valid image',async()=>{
 const h=setup();h.t.request(plan('spring'));h.requests[0].resolve();await flush();h.t.request(plan('summer'));h.t.cancel();h.requests[1].resolve();await flush();assert.equal(h.t.sample().current.plan.mapId,'forest_spring');assert.equal(h.t.sample().to,null);
});
