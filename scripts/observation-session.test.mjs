import test from 'node:test';import assert from 'node:assert/strict';
import { ObservationSession } from '../src/observation/session.ts';
import { createMemoryRepository } from '../src/storage/memory.ts';
import { createAccountPorts } from '../src/account/remote.ts';
const turn=()=>new Promise(r=>setTimeout(r,0));
function locks(){const held=new Set();return {request:async(name,options,work)=>{if(held.has(name))return work(null);held.add(name);try{return await work({name});}finally{held.delete(name);}}};}
function setup(lock=locks(),repository=createMemoryRepository()){let visible=true;const s=new ObservationSession({repository,locks:lock,sessionId:crypto.randomUUID(),observable:()=>visible});return {s,repository,hide:()=>visible=false};}
test('claim follows initialization; no authority until a real lifetime lock and repository epoch',async()=>{const {s,repository}=setup();assert.equal(s.authority().authorized,false);await s.start();assert.equal(s.authority().authorized,true);assert.equal((await repository.read()).state.observationOwner.epoch,1);await s.stop();assert.equal(s.authority().authorized,false);});
test('only one observation lock; release permits next epoch and old authority is revoked',async()=>{const l=locks(),r=createMemoryRepository();const a=setup(l,r),b=setup(l,r);await a.s.start();await b.s.start();assert.equal(b.s.authority().authorized,false);const epoch=a.s.authority().owner.epoch;await a.s.stop();await b.s.acquire();assert.equal(b.s.authority().owner.epoch,epoch+1);assert.equal(a.s.authority().authorized,false);await b.s.stop();});
test('unsupported locks and hidden surfaces never claim',async()=>{for(const lock of [undefined,locks()]){const {s,repository,hide}=setup(lock);if(lock)hide();else s.ports.locks=undefined;await s.start();assert.equal(s.authority().authorized,false);assert.equal((await repository.read()).state.observationOwner,null);await s.stop();}});
test('stop while claim waits cannot resurrect an old lock callback',async()=>{let resolve;const r=createMemoryRepository();const repository={...r,read:()=>new Promise(r=>resolve=r)};const {s}=setup(locks(),repository);const p=s.start();await turn();const stop=s.stop();resolve(await r.read());await p;await stop;assert.equal(s.authority().authorized,false);assert.equal((await r.read()).state.observationOwner,null);});
test('lost claim reply is confirmed only by the exact real persisted session/epoch',async()=>{const real=createMemoryRepository();const repository={...real,commit:async(...args)=>{await real.commit(...args);throw Error('reply lost');}};const {s}=setup(locks(),repository);await s.start();assert.equal(s.authority().authorized,true);assert.equal(s.authority().owner.epoch,1);await s.stop();});
test('failed claim never fabricates authority or mutates collection state',async()=>{const real=createMemoryRepository();const repository={...real,commit:async()=>({status:'unavailable',operation:'write',reason:'test'})};const {s}=setup(locks(),repository);await s.start();assert.equal(s.authority().authorized,false);const state=(await real.read()).state;assert.equal(state.observationOwner,null);assert.deepEqual(state.items,{});await s.stop();});
test('synchronous or asynchronous browser lock rejection is a visible limitation, never authority',async()=>{for(const request of [()=>{throw Error('SecurityError');},()=>Promise.reject(Error('unsupported'))]){const {s}=setup({request});await s.start();assert.equal(s.authority().authorized,false);assert.match(s.status,/잠금/);await s.stop();}});

test('account observation claim refreshes a cached snapshot after another window changes ownership',async(t)=>{
 const real=createMemoryRepository();
 const ports=createAccountPorts({apiBaseUrl:'https://api.test',identity:{sub:'alice',accessToken:'test',expiresAt:Date.now()+60000},fetcher:async(_url,init)=>{
  const body=init.body&&JSON.parse(init.body);
  const result=body?await real.commit(body.command,{expectedRevision:body.expectedRevision}):await real.read();
  return new Response(JSON.stringify({...result,...(['ok','applied','unchanged'].includes(result.status)?{persistence:'account'}:{})}));
 }});t.after(()=>ports.dispose());
 await ports.repository.read(); // old account screen cache, revision 0
 await real.commit({type:'claimObservation',sessionId:'other-browser',expectedEpoch:0});
 const {s}=setup(locks(),ports.repository);t.after(()=>s.stop());
 await s.start();
 assert.equal(s.authority().authorized,true,'explicit ownership acquisition uses current server revision');
 assert.equal(s.authority().owner.epoch,2);
 assert.deepEqual((await real.read()).state.items,{});
});
