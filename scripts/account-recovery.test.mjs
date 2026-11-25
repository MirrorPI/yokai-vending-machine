import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createService} from '../server/service.mjs';
import {initialState} from '../src/domain/state.ts';
import {createAccountPorts} from '../src/account/remote.ts';
import {ObservationSession} from '../src/observation/session.ts';
import {retryObservation} from '../src/observation/retry.ts';
import {VisitScheduler} from '../src/runtime/scheduler.ts';
import {VisitExecution} from '../src/runtime/execution.ts';
import {candidatesFor} from '../src/runtime/rules.ts';
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
async function fixture(t,{skew=0}={}){
 let wall=Date.parse('2026-11-15T00:00:00Z'),mono=1000,state=initialState(),serial=0,held=false;
 const records=new Map(),events=[],commands=[],fault={start:false,loseStart:false,settle:false};
 const db={read:async()=>structuredClone(state),record:async(_,k)=>records.get(k),commit:async(_,rev,next,rs=[])=>{if(rev!==state.revision)return false;state=structuredClone(next);for(const r of rs)records.set(r.key,r.value);return true;}};
 const service=createService({db,objects:{},now:()=>wall,log:e=>events.push(e)});
 const ports=createAccountPorts({apiBaseUrl:'https://fixture.invalid',identity:{sub:'fixture',accessToken:'secret-not-for-logs',expiresAt:wall+86400000},now:()=>wall+skew,fetcher:async(url,opts)=>{
  const body=opts.body?JSON.parse(opts.body):undefined,c=body?.command;
  if(c){commands.push(c);if((fault.start&&c.type==='startVisit')||(fault.settle&&c.type==='settleVisit'))throw Error('Offline');}
  const r=await service.handle({subject:'fixture',method:opts.method,path:new URL(url).pathname,body,requestId:'request-fixture'});
  if(c?.type==='startVisit'&&fault.loseStart)throw Error('Lost response after commit');
  return new Response(JSON.stringify(r.body),{status:r.statusCode});
 }});
 const session=new ObservationSession({repository:ports.repository,sessionId:'same-login',observable:()=>true,locks:{request:async(_,__,fn)=>{if(held)return fn(null);held=true;try{return await fn({});}finally{held=false;}}}});
 await session.start();
 const clock={monotonic:()=>mono,wall:()=>ports.serverNow?.()??wall+skew};
 const s=new VisitScheduler({clock,random:()=>0,createVisitId:()=>`visit-${++serial}`,candidates:(season,family)=>candidatesFor(catalog,season,family).available.filter(c=>c.rarity==='common'),prepare:async plan=>({plan,images:{},requestId:serial+1})},{season:'spring',family:'forest'});
 const e=new VisitExecution({scheduler:s,repository:ports.repository,clock,authority:session.authority,confirmDisplay:()=>true,confirmCapture:()=>true,photoSeasons:id=>catalog.yokai.find(y=>y.id===id).seasons});
 const advance=n=>{wall+=n;mono+=n;};
 const present=async(delay=0)=>{await e.synchronize();advance(30000);s.tick();await new Promise(r=>setImmediate(r));const ticket=e.beginPresentation(s.state.display.token);advance(delay);await e.confirmDisplay(ticket,{});};
 const recover=()=>retryObservation({repository:ports.repository,execution:e,capture:{retireTransfer(){}},retry:()=>e.retry()},session);
 const finish=async()=>{advance(30000);await e.synchronize();advance(1000);s.tick();await e.synchronize();};
 t.after(async()=>{await session.stop();ports.dispose();});
 return {ports,session,s,e,advance,present,recover,finish,fault,commands,events,state:()=>state};
}

test('remote start failure after its deadline recovers in the same login and next visit collects once',async t=>{
 const h=await fixture(t);h.fault.start=true;await h.present();assert.equal(h.s.state.startStatus,'failed');h.advance(60000);h.fault.start=false;
 await h.recover();assert.equal(h.e.status.state,'ready');assert.equal(h.s.state.visit,null);assert.equal(h.s.state.recoveryPending,false);
 assert.deepEqual(h.state().items,{});await h.present();assert.equal(h.s.state.startStatus,'approved');await h.finish();assert.equal(Object.values(h.state().items)[0].leftCount,1);assert.equal(h.state().activeVisit,null);
});
test('same-login recovery preserves a saved visit and awards it exactly once after settlement failure',async t=>{
 const h=await fixture(t);await h.present();h.fault.settle=true;h.advance(22000);await h.e.synchronize();assert.equal(h.s.state.endStatus,'failed');h.fault.settle=false;
 await h.recover();assert.equal(h.e.status.state,'ready');await h.finish();assert.equal(h.state().activeVisit,null);assert.equal(Object.values(h.state().items)[0].leftCount,1);
 await h.recover();assert.equal(Object.values(h.state().items)[0].totalCount,1);
});
test('display blocked beyond dwell is discarded before sending a stale start and next visit remains playable',async t=>{
 const h=await fixture(t);await h.present(31001);assert.equal(h.e.status.state,'ready');assert.equal(h.s.state.visit,null);assert.equal(h.commands.filter(c=>c.type==='startVisit').length,0);
 await h.present();assert.equal(h.s.state.startStatus,'approved');
});
test('server clock corrects a slow client clock before the first start and manual collection',async t=>{
 const h=await fixture(t,{skew:-120000});await h.present();assert.equal(h.s.state.startStatus,'approved');h.advance(1000);await h.e.requestManual(h.e.captureContext(),{});
 assert.equal(Object.values(h.state().items)[0].manualCount,1);
});
test('accepted start with lost response reconciles without repeating the reward on recovery',async t=>{
 const h=await fixture(t);h.fault.loseStart=true;await h.present();assert.equal(h.s.state.startStatus,'approved');h.fault.loseStart=false;await h.finish();await h.recover();assert.equal(Object.values(h.state().items)[0].totalCount,1);
});
