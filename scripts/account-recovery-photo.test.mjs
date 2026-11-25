import test from 'node:test';
import assert from 'node:assert/strict';
import * as captureApi from '../src/capture/execution.ts';
import {retryObservation} from '../src/observation/retry.ts';
import {harness} from './helpers/capture-harness.mjs';

test('remote retry preserves the original capture after a committed manual settlement loses its response',async t=>{
 const h=await harness(captureApi);
 t.after(()=>h.capture.dispose());
 h.repo.guardSemantics='remote-preflight-cas';
 await h.shown();
 const visit=h.s.state.visit,commit=h.repo.commit;
 let offline=false;
 h.repo.commit=async(command,options)=>{
  const result=await commit(command,options);
  if(command.type==='settleVisit'){
   offline=true;
   throw Error('Settlement committed, but its response was lost');
  }
  return result;
 };
 h.repo.read=async()=>offline
  ?{status:'unavailable',operation:'read',reason:'Reconciliation read is also offline'}
  :h.real.read();
 const body=visit.bundle.plan.layers.find(layer=>layer.id==='body');
 const click={...h.click(),clientX:body.x+body.width/2,clientY:body.y+body.height/2};
 assert.equal((await h.capture.click(click)).status,'blocked');
 assert.equal(h.e.status.reason,'unavailable');
 assert.equal((await h.state()).items[visit.itemId].manualCount,1);
 assert.equal((await h.state()).discovered[visit.yokaiId].photos.spring.status,'pending');
 assert.equal(h.encoded.length,0);

 offline=false;
 h.repo.commit=commit;
 const session={
  release:async()=>{h.auth.authorized=false;},
  acquire:async()=>{
   if(h.auth.authorized)return;
   const state=await h.state();
   const result=await h.real.commit({type:'claimObservation',sessionId:'s',expectedEpoch:state.observationOwner.epoch});
   assert.equal(result.status,'applied');
   h.auth.owner=result.state.observationOwner;
   h.auth.authorized=true;
  },
 };
 const host={repository:h.repo,execution:h.e,capture:h.capture,
  retry:async()=>{await h.e.retry();await h.capture.consumeReceipt();}};
 await retryObservation(host,session);
 await h.jobs.drain();
 assert.equal(h.e.status.state,'ready');
 assert.equal(h.encoded.length,1,'the retained click sample must be encoded after persisted manual settlement is confirmed');
 assert.equal(h.encoded[0].context.visitId,visit.visitId);
 assert.equal((await h.state()).discovered[visit.yokaiId].photos.spring.status,'saved');
 assert.equal((await h.state()).items[visit.itemId].totalCount,1);
 await retryObservation(host,session);
 await h.jobs.drain();
 assert.equal(h.encoded.length,1);
 assert.equal((await h.state()).items[visit.itemId].totalCount,1);
});
