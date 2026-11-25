import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { candidatesFor } from '../src/runtime/rules.ts';
const mod=await import('../src/runtime/scheduler.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync(new URL('../src/data/generated/asset-catalog.json',import.meta.url)));
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function setup({defer=false,empty=false,onlyRank=null}={}){
  assert.equal(typeof mod.VisitScheduler,'function');
  let mono=1000,wall=Date.parse('2026-10-27T03:59:59Z'),draws=0,id=0;
  const loads=[];
  const clock={monotonic:()=>mono,wall:()=>wall};
  const scheduler=new mod.VisitScheduler({clock,random:()=>{draws++;return 0;},createVisitId:()=>`visit-${++id}`,
    candidates:(season,family)=>empty?[]:candidatesFor(catalog,season,family).available.filter(c=>Number(c.id.slice(-3))>20).filter(c=>!onlyRank||c.rarity===onlyRank),
    prepare:plan=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});const requestId=loads.length+1;
      const bundle={plan,images:{},requestId};loads.push({plan,resolve:()=>resolve(bundle),reject});if(!defer)resolve(bundle);return promise;},
  },{season:'spring',family:'forest'});
  return {s:scheduler,loads,clock,advance:ms=>{mono+=ms;wall+=ms;},setWall:n=>{wall=n;},draws:()=>draws};
}
function authorize(h){h.s.setObservation({observable:true,authorized:true});h.s.confirmRecovery(h.s.state.recoveryToken,true);}
async function ready(h){authorize(h);h.advance(30000);h.s.tick();await flush();return h.s.state.display;}
function show(h,display=h.s.state.display){h.s.beginPresentation(display.token,{monotonicMs:h.clock.monotonic(),wallMs:h.clock.wall()});const stamp=h.s.state.display.presentation;h.s.confirmDisplay(display.token,stamp);return h.s.state.startRequest;}
function approve(h){const request=h.s.state.startRequest;h.s.resolveStart(request.token,'approved');}
async function complete(h){const r=h.s.state.endRequest;h.s.resolveEnd(r.token,'settled');h.advance(800);h.s.tick();h.s.resolveFinish(h.s.state.finishRequest.token,'complete');await flush();}
test('no visit on preparation; display token and explicit start approval gate lifecycle',async()=>{
  const h=setup();const d=await ready(h);assert.equal(h.s.state.phase,'awaiting-display');assert.equal(h.s.state.visit,null);assert.equal(h.s.state.lastYokaiId,null);
  h.s.confirmDisplay(d.token-1,{monotonicMs:h.clock.monotonic(),wallMs:h.clock.wall()});assert.equal(h.s.state.visit,null);
  const r=show(h);assert.equal(h.s.state.phase,'awaiting-start');assert.equal(h.s.state.visit.visitId,'visit-1');assert.equal(h.s.state.lastYokaiId,'yokai_021');
  h.advance(60000);h.s.tick();assert.equal(h.s.state.endRequest,null);
  h.s.resolveStart(r.token-1,'approved');assert.equal(h.s.state.phase,'awaiting-start');approve(h);h.s.tick();assert.equal(h.s.state.phase,'end-requested');
});
test('dwell starts at first display and fades overlap, wall clock jumps never extend it',async()=>{
  const h=setup();await ready(h);show(h);approve(h);const visit=h.s.state.visit;
  assert.equal(h.s.state.phase,'appearing');assert.equal(visit.deadlineMono-visit.shownMono,18000);
  h.advance(599);h.s.tick();assert.equal(h.s.state.phase,'appearing');h.advance(1);h.s.tick();assert.equal(h.s.state.phase,'visiting');
  h.setWall(0);h.advance(17399);h.s.tick();assert.equal(h.s.state.endRequest,null);h.advance(1);h.s.tick();assert.equal(h.s.state.endRequest.reason,'deadline');
  assert.equal(h.s.state.visit,visit);const token=h.s.state.endRequest.token;h.s.tick();assert.equal(h.s.state.endRequest.token,token);
});
test('failed start and settlement and finish block every next visit until explicit retry succeeds',async()=>{
  const h=setup();await ready(h);const r=show(h);h.s.resolveStart(r.token,'failed');h.advance(999999);h.s.tick();assert.equal(h.loads.length,1);
  h.s.retryStart();assert.notEqual(h.s.state.startRequest.token,r.token);h.s.resolveStart(r.token,'approved');assert.equal(h.s.state.startStatus,'pending');approve(h);h.s.tick();
  let token=h.s.state.endRequest.token;h.s.resolveEnd(token,'failed');h.s.retryEnd();h.s.resolveEnd(token,'settled');assert.equal(h.s.state.phase,'end-requested');
  h.s.resolveEnd(h.s.state.endRequest.token,'settled');assert.equal(h.s.state.phase,'leaving');h.advance(799);h.s.tick();assert.equal(h.s.state.finishRequest,null);h.advance(1);h.s.tick();
  assert.equal(h.s.state.phase,'followup-blocked');h.s.resolveFinish(h.s.state.finishRequest.token,'failed');h.advance(999999);h.s.tick();assert.equal(h.loads.length,1);
  token=h.s.state.finishRequest.token;h.s.retryFinish();h.s.resolveFinish(token,'complete');assert.equal(h.s.state.phase,'followup-blocked');h.s.resolveFinish(h.s.state.finishRequest.token,'complete');assert.equal(h.s.state.phase,'waiting');
});
test('retry and environment requests preserve selected candidate and do not consume random again',async()=>{
  const h=setup({defer:true});authorize(h);h.advance(30000);h.s.tick();const draws=h.draws();const candidate=h.s.state.candidate;
  h.loads[0].reject(Error('decode'));await flush();assert.equal(h.s.state.loadStatus,'failed');h.s.requestFamily('hill');h.s.retryPreparation();assert.equal(h.draws(),draws);assert.equal(h.s.state.candidate,candidate);
  h.loads[1].resolve();await flush();const d=h.s.state.display;show(h,d);approve(h);const v=h.s.state.visit;
  h.s.requestSeason('summer');h.s.requestFamily('forest');h.s.requestFamily('hill');assert.equal(h.s.state.visit,v);assert.equal(h.s.state.display.bundle,v.bundle);assert.equal(h.s.state.pendingFamily,'hill');
  h.advance(18000);h.s.tick();await complete(h);assert.equal(h.s.state.season,'summer');assert.equal(h.s.state.family,'hill');assert.equal(h.s.state.pendingFamily,null);
  h.advance(30000);h.s.tick();await flush();assert.ok(h.s.state.candidate.id.startsWith('yokai_03'));
});
test('hidden cancels preparation, stale load/display/timer never creates visit or history',async()=>{
  const h=setup({defer:true});authorize(h);h.advance(30000);h.s.tick();const timer=h.s.timerToken;h.s.setObservation({observable:false,authorized:true});h.loads[0].resolve();await flush();
  assert.equal(h.s.state.visit,null);assert.equal(h.s.state.lastYokaiId,null);assert.equal(h.s.state.phase,'suspended');
  h.s.confirmDisplay(timer,{monotonicMs:h.clock.monotonic(),wallMs:h.clock.wall()});h.advance(999999);h.s.tick(timer);assert.equal(h.loads.length,1);
  h.s.setObservation({observable:true,authorized:true});assert.equal(h.s.state.phase,'suspended');h.s.confirmRecovery(h.s.state.recoveryToken,true);assert.equal(h.s.state.phase,'waiting');h.s.tick();assert.equal(h.loads.length,1);
});
test('interruption during start waits for actual start result; ends only the one shown visit',async()=>{
  const h=setup();await ready(h);show(h);h.s.setObservation({observable:false,authorized:false});assert.equal(h.s.state.endRequest,null);approve(h);assert.equal(h.s.state.endRequest.reason,'interrupted');
  const token=h.s.state.endRequest.token;h.s.setObservation({observable:false,authorized:false});assert.equal(h.s.state.endRequest.token,token);await complete(h);assert.equal(h.s.state.phase,'suspended');
});
test('resume requires fresh recovery acknowledgement; delayed timers generate no catch-up visits',async()=>{
  const h=setup();authorize(h);const old=h.s.timerToken;h.s.suspend();h.advance(86400000);h.s.resume();h.s.tick(old);assert.equal(h.loads.length,0);
  const token=h.s.state.recoveryToken;h.s.confirmRecovery(token-1,true);assert.equal(h.s.state.phase,'suspended');h.s.confirmRecovery(token,false);assert.equal(h.s.state.phase,'suspended');h.s.confirmRecovery(token,true);h.s.tick();assert.equal(h.loads.length,0);
  h.advance(86400000);h.s.tick();await flush();assert.equal(h.loads.length,1);h.s.tick();assert.equal(h.loads.length,1);
});
test('no executable candidates parks safely; explicit first-arrival input never edits records',async()=>{
  const h=setup({empty:true});authorize(h);h.advance(30000);h.s.tick();h.s.tick();assert.equal(h.s.state.phase,'no-candidates');assert.equal(h.loads.length,0);assert.equal(h.s.state.visit,null);
});
test('duplicate recovery acknowledgement cannot restart an already running wait',()=>{
 const h=setup();authorize(h);const token=h.s.state.recoveryToken,deadline=h.s.state.waitUntil,draws=h.draws();h.advance(20000);h.s.confirmRecovery(token,true);assert.equal(h.s.state.waitUntil,deadline);assert.equal(h.draws(),draws);
});
test('normal wait is measured from completed exit even when finish confirmation is delayed',async()=>{
 const h=setup();await ready(h);show(h);approve(h);h.advance(18000);h.s.tick();h.s.resolveEnd(h.s.state.endRequest.token,'settled');h.advance(800);h.s.tick();const exit=h.clock.monotonic();
 h.advance(10000);h.s.resolveFinish(h.s.state.finishRequest.token,'complete');assert.equal(h.s.state.waitUntil,exit+28000);
});
test('A09 explicit first arrival input is at most five seconds, common only and contains no saved flags',async()=>{
 assert.equal(typeof mod.VisitScheduler,'function');let mono=0;let plan=null;
 const s=new mod.VisitScheduler({clock:{monotonic:()=>mono,wall:()=>0},random:()=>.999,createVisitId:()=> 'one',candidates:()=>candidatesFor(catalog,'spring','forest').available,prepare:async p=>{plan=p;return {plan:p,images:{},requestId:1};}},{season:'spring',family:'forest',firstArrival:{maxDelayMs:5000}});
 s.setObservation({observable:true,authorized:true});s.confirmRecovery(s.state.recoveryToken,true);assert.ok(s.state.waitUntil<=5000);mono=5000;s.tick();await flush();assert.equal(s.state.candidate.rarity,'common');assert.ok(plan);assert.ok(!('firstRunDone' in s.state));
});
test('presentation binds origin once and delayed display confirmation never restarts frames or dwell',async()=>{
 const h=setup();const d=await ready(h);assert.equal(d.presentation,null);h.advance(1000);
 h.s.beginPresentation(d.token,{monotonicMs:h.clock.monotonic(),wallMs:h.clock.wall()});const presented=h.s.state.display;
 assert.equal(h.s.state.phase,'presenting');assert.equal(h.s.state.visit,null);h.advance(1000);
 h.s.confirmDisplay(d.token,{monotonicMs:presented.presentation.monotonicMs,wallMs:presented.presentation.wallMs});
 assert.equal(h.s.state.display.bundle,presented.bundle);assert.equal(h.s.state.visit.playbackOriginMs,presented.presentation.monotonicMs);assert.equal(h.s.state.visit.deadlineMono,presented.presentation.monotonicMs+18000);
});
test('external manual review uses visit generation and resolved source; holds without claiming photo completion',async()=>{
 const h=setup();await ready(h);show(h);approve(h);const v=h.s.state.visit;
 h.s.requestManualReview(v.visitId,v.generation-1);assert.equal(h.s.state.endRequest,null);
 h.s.requestManualReview(v.visitId,v.generation);assert.equal(h.s.state.endRequest.reason,'manual-review');const token=h.s.state.endRequest.token;
 h.s.resolveEnd(token,'failed','manual');h.advance(20000);h.s.tick();assert.equal(h.s.state.phase,'end-requested');h.s.retryEnd();h.s.resolveEnd(token,'settled','manual');assert.equal(h.s.state.endStatus,'pending');
 h.s.resolveEnd(h.s.state.endRequest.token,'settled','manual');assert.equal(h.s.state.phase,'settled-hold');h.advance(799);h.s.tick();assert.equal(h.s.state.phase,'settled-hold');h.advance(1);h.s.tick();assert.equal(h.s.state.phase,'leaving');
 assert.ok(!('photo' in h.s.state));h.advance(800);h.s.tick();h.s.resolveFinish(h.s.state.finishRequest.token,'complete');assert.equal(h.s.state.phase,'waiting');
});
test('manual review at deadline becomes automatic end request and interruption skips departure replay',async()=>{
 const h=setup();await ready(h);show(h);approve(h);const v=h.s.state.visit;h.advance(18000);h.s.requestManualReview(v.visitId,v.generation);assert.equal(h.s.state.endRequest.reason,'deadline');
 h.s.setObservation({observable:false,authorized:true});h.s.resolveEnd(h.s.state.endRequest.token,'settled');assert.equal(h.s.state.phase,'followup-blocked');assert.equal(h.s.state.display,null);
});
test('stale genuine display proposal and unconfirmed presentation cannot create a later visit',async()=>{
 const h=setup();const old=await ready(h);h.s.beginPresentation(old.token,{monotonicMs:h.clock.monotonic(),wallMs:h.clock.wall()});
 h.s.setObservation({observable:false,authorized:true});h.s.setObservation({observable:true,authorized:true});h.s.confirmRecovery(h.s.state.recoveryToken,true);h.advance(30000);h.s.tick();await flush();
 assert.notEqual(h.s.state.display.token,old.token);h.s.confirmDisplay(old.token,{monotonicMs:h.clock.monotonic(),wallMs:h.clock.wall()});assert.equal(h.s.state.visit,null);assert.equal(h.s.state.lastYokaiId,null);
});
test('all rarity enter/deadline/exit boundaries use their own durations',async()=>{
 for(const [onlyRank,dwell,enter,exit]of [['common',18000,600,800],['rare',13000,600,800],['legendary',7000,400,400],['special',4000,200,400]]){
  const h=setup({onlyRank});await ready(h);show(h);approve(h);h.advance(enter-1);h.s.tick();assert.equal(h.s.state.phase,'appearing');h.advance(1);h.s.tick();assert.equal(h.s.state.phase,'visiting');
  h.advance(dwell-enter-1);h.s.tick();assert.equal(h.s.state.endRequest,null);h.advance(1);h.s.tick();h.s.resolveEnd(h.s.state.endRequest.token,'settled');h.advance(exit-1);h.s.tick();assert.equal(h.s.state.phase,'leaving');h.advance(1);h.s.tick();assert.equal(h.s.state.phase,'followup-blocked');
 }
});
test('resume without a preceding freeze cancels any unconfirmed presentation before recovery',async()=>{
 const h=setup();await ready(h);const old=h.s.state.display.token;h.s.resume();assert.equal(h.s.state.candidate,null);assert.equal(h.s.state.display,null);h.s.confirmRecovery(h.s.state.recoveryToken,true);assert.equal(h.s.state.phase,'waiting');h.s.beginPresentation(old,{monotonicMs:h.clock.monotonic(),wallMs:h.clock.wall()});assert.equal(h.s.state.visit,null);
});
test('hidden while waiting on finish discards the old wait deadline even if recovery clears before finish',async()=>{
 const h=setup();await ready(h);show(h);approve(h);h.advance(18000);h.s.tick();h.s.resolveEnd(h.s.state.endRequest.token,'settled');h.advance(800);h.s.tick();
 h.s.setObservation({observable:false,authorized:true});h.advance(86400000);h.s.setObservation({observable:true,authorized:true});h.s.confirmRecovery(h.s.state.recoveryToken,true);h.s.resolveFinish(h.s.state.finishRequest.token,'complete');assert.equal(h.s.state.waitUntil,h.clock.monotonic()+28000);
});

test('explicit manual mode waits for selection, preserves authority and accepts repeat specials after settlement',async()=>{
 let mono=0,id=0;const s=new mod.VisitScheduler({clock:{monotonic:()=>mono,wall:()=>Date.parse('2026-11-16T00:00:00Z')+mono},random:()=>0,createVisitId:()=>`manual-${++id}`,candidates:(season,family)=>candidatesFor(catalog,season,family).available,prepare:async plan=>({plan,images:{},requestId:id+1})},{season:'spring',family:'forest',manualSelection:true,firstArrival:{maxDelayMs:0}});
 assert.equal(typeof s.requestImmediateVisit,'function');assert.equal(s.requestImmediateVisit('yokai_068'),false);
 s.setObservation({authorized:true,observable:true});s.confirmRecovery(s.state.recoveryToken,true);mono=100000;s.tick();assert.equal(s.state.phase,'waiting');
 assert.equal(s.requestImmediateVisit('missing'),false);assert.equal(s.requestImmediateVisit('yokai_068'),true);assert.equal(s.requestImmediateVisit('yokai_061'),false);s.tick();await flush();assert.equal(s.state.candidate.id,'yokai_068');assert.equal(s.state.visit,null);
 assert.equal(s.requestImmediateVisit('yokai_061'),false);
 const d=s.state.display;s.beginPresentation(d.token,{monotonicMs:mono,wallMs:Date.parse('2026-11-16T00:00:00Z')+mono});s.confirmDisplay(d.token,s.state.display.presentation);s.resolveStart(s.state.startRequest.token,'approved');
 mono+=5000;s.tick();s.resolveEnd(s.state.endRequest.token,'settled','left');mono+=500;s.tick();assert.equal(s.requestImmediateVisit('yokai_068'),false);s.resolveFinish(s.state.finishRequest.token,'complete');
 mono+=100000;s.tick();assert.equal(s.state.phase,'waiting');assert.equal(s.requestImmediateVisit('yokai_068'),true);s.tick();await flush();assert.equal(s.state.candidate.id,'yokai_068');
 s.setObservation({authorized:false,observable:false});assert.equal(s.requestImmediateVisit('yokai_061'),false);
});
test('ordinary scheduler cannot request an immediate visit',()=>{const h=setup();authorize(h);assert.equal(h.s.requestImmediateVisit('yokai_061'),false);});
