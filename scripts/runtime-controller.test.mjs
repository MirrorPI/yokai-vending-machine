import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const mod=await import('../src/runtime/controller.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync(new URL('../src/data/generated/asset-catalog.json',import.meta.url)));
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function setup(){assert.equal(typeof mod.RuntimeController,'function');let mono=0,wall=Date.parse('2026-10-27T03:00:00Z'),id=0;const loads=[];
 const c=new mod.RuntimeController({catalog,clock:{wall:()=>wall,monotonic:()=>mono},offset:()=>-540,random:()=>0,createVisitId:()=>String(++id),prepare:async plan=>{loads.push(plan);return {plan,images:{},requestId:loads.length};}});
 return {c,loads,advance:n=>{mono+=n;wall+=n;},setWall:n=>{wall=n;}};
}
test('ordinary runtime computes real season but never grants observation, start, settlement or records',async()=>{
 const h=setup();h.c.pulse();await flush();h.advance(86400000);h.c.pulse();await flush();assert.equal(h.c.scheduler.state.visit,null);assert.equal(h.c.scheduler.state.phase,'suspended');assert.ok(h.loads.every(p=>p.input.yokaiId===null));
 assert.equal(h.c.snapshot().blockedBy,'a05-observation-and-recovery');
});
test('injected authority runs one candidate, locks old bundle across hour and applies pending family after exit',async()=>{
 const h=setup();h.c.pulse();await flush();h.c.scheduler.setObservation({observable:true,authorized:true});h.c.scheduler.confirmRecovery(h.c.scheduler.state.recoveryToken,true);h.advance(30000);h.c.pulse();await flush();h.c.pulse();
 const d=h.c.scheduler.state.display;assert.ok(d);h.c.scheduler.beginPresentation(d.token,{monotonicMs:30000,wallMs:Date.parse('2026-10-27T03:00:30Z')});h.c.scheduler.confirmDisplay(d.token,{monotonicMs:30000,wallMs:Date.parse('2026-10-27T03:00:30Z')});h.c.scheduler.resolveStart(h.c.scheduler.state.startRequest.token,'approved');
 const v=h.c.scheduler.state.visit,old=h.c.snapshot().background.current;h.setWall(Date.parse('2026-10-27T04:00:00Z'));h.c.requestFamily('hill');h.c.pulse();await flush();h.c.pulse();
 assert.equal(h.c.scheduler.state.visit,v);assert.equal(h.c.snapshot().background.current,old);assert.equal(h.c.snapshot().background.from,null);assert.notEqual(h.c.snapshot().gameSeason,old.plan.input.season);
 h.advance(18000);h.c.pulse();h.c.scheduler.resolveEnd(h.c.scheduler.state.endRequest.token,'settled');h.advance(800);h.c.pulse();h.c.scheduler.resolveFinish(h.c.scheduler.state.finishRequest.token,'complete');h.c.pulse();await flush();h.c.pulse();assert.equal(h.c.snapshot().background.to.plan.input.family,'hill');
 h.advance(1500);h.c.pulse();assert.equal(h.c.snapshot().background.progress,.5);
});
test('unprepared new map blocks next selection without resetting existing wait deadline',async()=>{
 const h=setup();h.c.pulse();await flush();h.c.scheduler.setObservation({observable:true,authorized:true});h.c.scheduler.confirmRecovery(h.c.scheduler.state.recoveryToken,true);const wait=h.c.scheduler.state.waitUntil;
 h.c.requestFamily('hill');h.advance(30000);h.c.pulse();assert.equal(h.c.scheduler.state.waitUntil,wait);assert.equal(h.c.scheduler.state.candidate,null);await flush();h.c.pulse();assert.equal(h.c.scheduler.state.candidate,null);h.advance(3000);h.c.pulse();await flush();assert.ok(h.c.scheduler.state.candidate);
});
test('latest season invalidates queued background before releasing a completed visit lock',async()=>{
 const h=setup();h.c.pulse();await flush();h.c.scheduler.setObservation({observable:true,authorized:true});h.c.scheduler.confirmRecovery(h.c.scheduler.state.recoveryToken,true);h.advance(30000);h.c.pulse();await flush();h.c.pulse();
 const s=h.c.scheduler,d=s.state.display;s.beginPresentation(d.token,{monotonicMs:30000,wallMs:Date.parse('2026-10-27T03:00:30Z')});s.confirmDisplay(d.token,{monotonicMs:30000,wallMs:Date.parse('2026-10-27T03:00:30Z')});s.resolveStart(s.state.startRequest.token,'approved');
 h.setWall(Date.parse('2026-10-27T04:00:00Z'));h.c.pulse();await flush();h.advance(18000);h.c.pulse();s.resolveEnd(s.state.endRequest.token,'settled');h.advance(800);h.c.pulse();s.resolveFinish(s.state.finishRequest.token,'complete');
 h.setWall(Date.parse('2026-10-27T05:00:00Z'));h.c.pulse();assert.equal(h.c.snapshot().background.to,null);await flush();h.c.pulse();assert.equal(h.c.snapshot().background.to.plan.input.season,h.c.snapshot().gameSeason);
});
test('a new wall-clock season invalidates queued background before an unlocked fade ends',async()=>{
 const h=setup();h.c.pulse();await flush();const base=Date.parse('2026-10-27T03:00:00Z');
 h.setWall(base+3600000);h.c.pulse();await flush();h.c.pulse();h.advance(1000);
 h.setWall(base+7200000);h.c.pulse();await flush();h.advance(2000);h.setWall(base+10800000);h.c.pulse();
 assert.equal(h.c.snapshot().background.to,null);await flush();h.c.pulse();assert.equal(h.c.snapshot().background.to.plan.input.season,h.c.snapshot().gameSeason);
});
test('A09 first arrival port uses only verified normal candidates within5s and keeps display approval gate',async()=>{
 let now=0;const c=new mod.RuntimeController({catalog,clock:{wall:()=>Date.parse('2026-10-27T00:00:00Z')+now,monotonic:()=>now},offset:()=>0,random:()=>0,createVisitId:()=> 'first',prepare:async plan=>({plan,images:{},requestId:1})},{verificationSeason:'spring',firstArrival:{maxDelayMs:5000}});
 c.pulse();await flush();c.scheduler.setObservation({observable:true,authorized:true});c.scheduler.confirmRecovery(c.scheduler.state.recoveryToken,true);assert.ok(c.scheduler.state.waitUntil<=5000);now=5000;c.pulse();await flush();assert.equal(c.scheduler.state.candidate.rarity,'common');assert.equal(c.scheduler.state.candidate.id,'yokai_001');assert.equal(c.scheduler.state.visit,null);c.dispose();
});
test('fixed season survives wall boundaries and automatic mode resumes the real cycle',async()=>{
 const h=setup();h.c.requestSeasonMode('winter');await flush();h.advance(180*60000);h.c.pulse();assert.equal(h.c.snapshot().gameSeason,'winter');assert.equal(h.c.snapshot().nextSeasonAt,null);
 h.c.requestSeasonMode(null);assert.notEqual(h.c.snapshot().nextSeasonAt,null);assert.notEqual(h.c.snapshot().gameSeason,'winter');
});
test('manual season selection waits for the live visit and does not relabel its capture',async()=>{
 const h=setup();h.c.pulse();await flush();const s=h.c.scheduler;s.setObservation({observable:true,authorized:true});s.confirmRecovery(s.state.recoveryToken,true);h.advance(30000);h.c.pulse();await flush();h.c.pulse();
 const d=s.state.display;s.beginPresentation(d.token,{monotonicMs:30000,wallMs:Date.parse('2026-10-27T03:00:30Z')});s.confirmDisplay(d.token,{monotonicMs:30000,wallMs:Date.parse('2026-10-27T03:00:30Z')});s.resolveStart(s.state.startRequest.token,'approved');
 const before=s.state.visit,season=s.state.season;h.c.requestSeasonMode(season==='winter'?'summer':'winter');h.c.pulse();assert.equal(s.state.visit,before);assert.equal(s.state.season,season);
});
