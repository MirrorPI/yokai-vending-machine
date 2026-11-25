import test from 'node:test';
import assert from 'node:assert/strict';
import * as captureApi from '../src/capture/execution.ts';
import { ObservationSession } from '../src/observation/session.ts';
import { harness } from './helpers/capture-harness.mjs';
function observationLocks(){const held=new Set();return {request:async(name,_options,work)=>{
 if(held.has(name))return work(null);held.add(name);
 try{return await work({name});}finally{held.delete(name);}
}};}
const api=await import('../src/observation/retry.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});

test('explicit retry reacquires a displaced owner and retires the stale visit before allowing a new capture',async()=>{
 assert.equal(typeof api.retryObservation,'function');
 const h=await harness(captureApi);
 const session=new ObservationSession({repository:h.repo,locks:observationLocks(),sessionId:'s',observable:()=>true});
 await session.start();Object.assign(h.auth,session.authority());
 const ticket=await h.ready();
 await h.real.commit({type:'claimObservation',sessionId:'other-window',expectedEpoch:1});
 await h.e.confirmDisplay(ticket,'actual-display-fixture');
 assert.equal(h.s.state.startStatus,'failed');assert.equal(h.e.status.reason,'displaced');
 await session.acquire();assert.equal(session.authority().owner.epoch,1,'ordinary acquire keeps the stale held owner');
 const count=(await h.state()).items;
 try {
   await api.retryObservation({execution:h.e,capture:h.capture,retry:()=>h.e.retry()}, {
     release:async()=>{await session.release();Object.assign(h.auth,session.authority());},
     acquire:async()=>{await session.acquire();Object.assign(h.auth,session.authority());},
   });
   assert.equal(h.auth.owner.epoch,3);assert.equal(h.e.status.state,'ready');
   assert.equal(h.s.state.recoveryPending,false);assert.equal(h.s.state.visit,null);
   assert.deepEqual((await h.state()).items,count,'retry never invents a reward for the rejected visit');
   await h.shown();assert.equal(h.s.state.startStatus,'approved');
   const body=h.s.state.visit.bundle.plan.layers.find(l=>l.id==='body');
   const itemId=h.s.state.visit.itemId;
   assert.equal((await h.capture.click({...h.click(),clientX:body.x+body.width/2,clientY:body.y+body.height/2})).status,'accepted');
   assert.equal((await h.state()).items[itemId].manualCount,1);
 } finally {await session.stop();h.capture.dispose();}
});

test('ordinary storage retry preserves the original visit and does not reclaim observation',async()=>{
 assert.equal(typeof api.retryObservation,'function');
 const h=await harness(captureApi);let fail=true;
 h.faults.before=c=>{if(c.type==='startVisit'&&fail)throw Error('temporary storage failure');};
 await h.shown();const visit=h.s.state.visit;assert.equal(h.s.state.startStatus,'failed');fail=false;
 await api.retryObservation({execution:h.e,capture:h.capture,retry:()=>h.e.retry()}, {release:async()=>assert.fail('must preserve owner'),acquire:async()=>{}});
 assert.equal(h.s.state.visit,visit);assert.equal(h.s.state.startStatus,'approved');h.capture.dispose();
});
