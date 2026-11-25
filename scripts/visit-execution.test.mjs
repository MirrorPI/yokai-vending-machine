import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {VisitScheduler} from '../src/runtime/scheduler.ts';
import {candidatesFor} from '../src/runtime/rules.ts';
import {sampleScene} from '../src/scene/composition.ts';
import {createMemoryDriver,createMemoryRepository} from '../src/storage/memory.ts';
import {createBrowserRepository,SAVE_KEY} from '../src/storage/browser.ts';
const {VisitExecution}=await import('../src/runtime/execution.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
const owner={sessionId:'verified-owner',epoch:1};
const paint=Object.freeze({actualDisplay:true}),capture=Object.freeze({validClick:true});
function setup({driver=createMemoryDriver(),repository=null,authority=null,photo=true}={}){
 assert.equal(typeof VisitExecution,'function','A05 VisitExecution is required');
 let mono=1000,wall=Date.parse('2026-10-27T00:00:00Z'),serial=0;
 const faults={write:false,read:false,lose:null,conflict:null,unchanged:null,before:null};
 const io={...driver,exclusive:work=>driver.exclusive(storage=>work({
  getItem:key=>{if(faults.read)throw Error('read blocked');return storage.getItem(key);},
  setItem:(key,value)=>{if(faults.write)throw Error('write blocked');storage.setItem(key,value);},
 }))};
 const reopen=()=>createMemoryRepository(io);const real=repository??reopen();
 const repo={read:()=>real.read(),commit:async(command,options)=>{
  if(faults.before)await faults.before(command);
  if(faults.conflict===command.type){faults.conflict=null;await real.commit({type:'changeSettings',patch:{sound:true}});}
  if(faults.unchanged===command.type){faults.unchanged=null;const r=await real.read();return {status:'unchanged',state:r.state,persistence:r.persistence};}
  const r=await real.commit(command,options);
  if(faults.after)await faults.after(command,r);
  if(faults.lose===command.type){faults.lose=null;throw Error('response lost');}return r;
 }};
 const clock={monotonic:()=>mono,wall:()=>wall};let auth=authority??{owner,authorized:true,observable:true};
 const s=new VisitScheduler({clock,random:()=>0,createVisitId:()=>`real-${++serial}`,
  candidates:(season,family)=>candidatesFor(catalog,season,family).available.filter(c=>Number(c.id.slice(-3))>20),
  prepare:async plan=>({plan,images:{},requestId:serial+1})},{season:'spring',family:'forest'});
 const e=new VisitExecution({scheduler:s,repository:repo,clock,authority:()=>auth,
  confirmDisplay:(_ticket,evidence)=>evidence===paint,
  ...(photo?{confirmCapture:(_context,evidence)=>evidence===capture}:{}),
  photoSeasons:id=>catalog.yokai.find(y=>y.id===id)?.seasons??[]});
 return {e,s,clock,real,repo,driver:io,reopen,faults,setAuth:a=>{auth=a;},auth:()=>auth,
  advance:ms=>{mono+=ms;wall+=ms;},setMono:n=>{mono=n;},setWall:n=>{wall=n;}};
}
async function boot(h){const r=await h.real.read();if(!r.state?.observationOwner)await h.real.commit({type:'claimObservation',sessionId:owner.sessionId,expectedEpoch:0});await h.e.synchronize();}
async function ready(h){await boot(h);h.advance(30000);h.s.tick();await flush();assert.equal(h.s.state.phase,'awaiting-display');return h.e.beginPresentation(h.s.state.display.token);}
async function shown(h){const ticket=await ready(h);await h.e.confirmDisplay(ticket,paint);assert.equal(h.s.state.startStatus,'approved');return h.s.state.visit;}
const saved=async h=>{const r=await h.real.read();assert.equal(r.status,'ok');return r.state;};
const manual=h=>h.e.requestManual(h.e.captureContext(),capture);
async function exit(h){h.advance(800);h.s.tick();h.advance(800);h.s.tick();await h.e.synchronize();}
test('load, reservation, presentation and unconfirmed/forged display never save a visit',async()=>{
 const h=setup(),ticket=await ready(h);assert.equal((await saved(h)).activeVisit,null);
 await h.e.confirmDisplay({...ticket},paint);await h.e.confirmDisplay(ticket,{});await h.e.synchronize();assert.equal(h.s.state.visit,null);assert.deepEqual((await saved(h)).items,{});
 await h.e.interrupt();assert.equal(h.s.state.candidate,null);assert.equal((await saved(h)).activeVisit,null);
});
test('actual matching display saves its exact visit; stale display cannot create another',async()=>{
 const h=setup(),ticket=await ready(h);await h.e.confirmDisplay(ticket,paint);const v=h.s.state.visit;const state=await saved(h);
 assert.equal(state.activeVisit.visitId,v.visitId);assert.equal(state.activeVisit.appearedAt,v.appearedAt);assert.equal(state.activeVisit.itemGranted,false);
 await h.e.confirmDisplay(ticket,paint);assert.equal((await saved(h)).activeVisit.visitId,v.visitId);assert.deepEqual((await saved(h)).items,{});
});
test('failed start blocks clicks and future visits; retry keeps ID, origin and deadline',async()=>{
 const h=setup(),ticket=await ready(h);h.faults.write=true;await h.e.confirmDisplay(ticket,paint);const v=h.s.state.visit;
 assert.equal(h.s.state.startStatus,'failed');assert.equal(h.e.captureContext(),null);h.advance(100000);h.s.tick();assert.equal(h.s.state.visit,v);
 h.faults.write=false;await h.e.retry();assert.equal(h.s.state.visit,v);assert.equal((await saved(h)).activeVisit.visitId,v.visitId);assert.equal((await saved(h)).items.item_021.leftCount,1);
});
for(const command of ['startVisit','settleVisit','finishVisit'])test(`lost ${command} reply reconciles persisted proof without duplicate work`,async()=>{
 const h=setup();h.faults.lose=command;await shown(h);await manual(h);await exit(h);
 const state=await saved(h);assert.equal(state.items.item_021.totalCount,1);assert.equal(state.items.item_021.manualCount,1);assert.equal(state.activeVisit,null);
});
for(const [delta,source] of [[17999,'manual'],[18000,'left'],[18001,'left']])test(`processing ${delta}ms after display chooses ${source}`,async()=>{
 const h=setup();await shown(h);const context=h.e.captureContext();h.advance(delta);await h.e.requestManual(context,capture);
 const state=await saved(h);assert.equal(state.items.item_021.totalCount,1);assert.equal(state.items.item_021[`${source}Count`],1);assert.equal(Object.keys(state.discovered).length,source==='manual'?1:0);
});
test('duplicate clicks, deadline and interruption share one queue and one atomic award',async()=>{
 const h=setup();await shown(h);const context=h.e.captureContext();await Promise.all([h.e.requestManual(context,capture),h.e.requestManual(context,capture)]);
 await h.e.interrupt();await h.e.synchronize();const state=await saved(h);assert.equal(state.items.item_021.totalCount,1);assert.equal(state.items.item_021.manualCount,1);assert.equal(state.items.item_021.leftCount,0);assert.equal(state.activeVisit,null);
});
test('a hidden signal invalidates a queued click even when visible returns before it executes',async()=>{
 const h=setup();await shown(h);const context=h.e.captureContext();
 const pending=h.e.requestManual(context,capture);h.setAuth({...h.auth(),observable:false});const hidden=h.e.interrupt();h.setAuth({...h.auth(),observable:true});await Promise.all([pending,hidden]);
 const state=await saved(h);assert.equal(state.items.item_021.leftCount,1);assert.deepEqual(state.discovered,{});
});
test('deadline crossed inside storage lock demotes the queued manual to left',async()=>{
 const h=setup();await shown(h);let once=true;h.faults.before=async c=>{if(c.type==='settleVisit'&&once){once=false;h.advance(18000);}};
 await manual(h);const state=await saved(h);assert.equal(state.items.item_021.leftCount,1);assert.deepEqual(state.discovered,{});
});
test('hidden detected while waiting for storage demotes manual to left',async()=>{
 const h=setup();await shown(h);let once=true;h.faults.before=async c=>{if(c.type==='settleVisit'&&once){once=false;h.setAuth({...h.auth(),observable:false});}};
 await manual(h);assert.equal((await saved(h)).items.item_021.leftCount,1);
});
for(const command of ['startVisit','settleVisit','finishVisit'])test(`conflict at ${command} reloads and revalidates same intent`,async()=>{
 const h=setup();h.faults.conflict=command;await shown(h);await manual(h);await exit(h);const state=await saved(h);assert.equal(state.items.item_021.totalCount,1);assert.equal(state.settings.sound,true);assert.equal(state.activeVisit,null);
});
for(const command of ['startVisit','settleVisit','finishVisit'])test(`unchanged ${command} without matching proof is blocked`,async()=>{
 const h=setup();h.faults.unchanged=command;
 if(command==='startVisit'){const ticket=await ready(h);await h.e.confirmDisplay(ticket,paint);assert.equal(h.s.state.startStatus,'failed');assert.equal((await saved(h)).activeVisit,null);}
 else {await shown(h);await manual(h);if(command==='settleVisit'){assert.equal(h.s.state.endStatus,'failed');assert.deepEqual((await saved(h)).items,{});}else{await exit(h);assert.equal(h.s.state.finishStatus,'failed');assert.ok((await saved(h)).activeVisit);}}
 assert.equal(h.e.status.state,'blocked');
});
for(const stage of ['settle','finish'])test(`${stage} write failure blocks next visit and explicit retry grants nothing twice`,async()=>{
 const h=setup();await shown(h);if(stage==='settle'){h.faults.write=true;await manual(h);assert.equal(h.s.state.endStatus,'failed');assert.deepEqual((await saved(h)).items,{});}else{await manual(h);h.faults.write=true;await exit(h);assert.equal(h.s.state.finishStatus,'failed');}
 const v=h.s.state.visit;h.advance(86400000);h.s.tick();await h.e.synchronize();assert.equal(h.s.state.visit,v);assert.equal(h.e.status.state,'blocked');
 h.faults.write=false;await h.e.retry();await exit(h);const state=await saved(h);assert.equal(state.items.item_021.totalCount,1);assert.equal(state.activeVisit,null);
});
test('new executor and recreated adapter recover only saved real visit; repeated recovery is empty',async()=>{
 const a=setup();await shown(a);const b=setup({driver:a.driver});await b.e.synchronize();const state=await saved(b);assert.equal(state.items.item_021.leftCount,1);assert.equal(state.activeVisit,null);assert.deepEqual(state.discovered,{});
 const wait=b.s.state.waitUntil;b.advance(999999);await b.e.synchronize();assert.equal((await saved(b)).items.item_021.totalCount,1);assert.equal(b.s.state.waitUntil,wait);
});
test('settled active visit recovery only finishes it, including manual with pending photo',async()=>{
 const a=setup();await shown(a);await manual(a);const b=setup({driver:a.driver});await b.e.synchronize();const state=await saved(b);assert.equal(state.items.item_021.totalCount,1);assert.equal(state.items.item_021.leftCount,0);assert.equal(state.discovered.yokai_021.photos.spring.status,'pending');assert.equal(state.activeVisit,null);
});
test('recovery write failure blocks waiting until saved active visit is resolved',async()=>{
 const a=setup();await shown(a);const b=setup({driver:a.driver});b.faults.write=true;await b.e.synchronize();assert.equal(b.s.state.recoveryPending,true);assert.equal(b.s.state.waitUntil,null);
 b.faults.write=false;await b.e.retry();assert.equal((await saved(b)).activeVisit,null);assert.equal(b.s.state.phase,'waiting');
});
test('hidden day, sleep and return never synthesize visits; return starts fresh normal wait',async()=>{
 const h=setup();await shown(h);h.setAuth({...h.auth(),observable:false});await h.e.interrupt();h.advance(86400000);h.s.tick();await h.e.synchronize();assert.equal((await saved(h)).items.item_021.totalCount,1);assert.equal(h.s.state.waitUntil,null);
 h.setAuth({...h.auth(),observable:true});await h.e.synchronize();assert.equal(h.s.state.waitUntil,h.clock.monotonic()+28000);assert.equal(h.s.state.visit,null);
});
test('authority loss rejects old epoch callbacks and cannot start another visit',async()=>{
 const h=setup();await shown(h);const context=h.e.captureContext();await h.real.commit({type:'claimObservation',sessionId:'other',expectedEpoch:1});
 h.setAuth({owner:{sessionId:'other',epoch:2},authorized:true,observable:true});await h.e.requestManual(context,capture);await h.e.synchronize();assert.deepEqual((await saved(h)).items,{});assert.equal(h.e.status.state,'blocked');
 const b=setup({driver:h.driver,authority:h.auth()});await b.e.synchronize();assert.equal((await saved(b)).items.item_021.leftCount,1);
});
test('absence of verified authority or actual capture proof never fabricates approvals',async()=>{
 const h=setup({authority:{owner:null,authorized:false,observable:true}});await h.e.synchronize();h.advance(999999);h.s.tick();assert.equal(h.s.state.visit,null);assert.equal((await saved(h)).observationOwner,null);assert.equal(h.e.status.state,'blocked');
 const b=setup({photo:false});await shown(b);await manual(b);assert.deepEqual((await saved(b)).items,{});assert.equal(b.s.state.endRequest,null);
});
for(const wall of [Date.parse('2020-01-01'),Date.parse('2030-01-01')])test(`wall jump ${wall} keeps monotonic manual deadline and actual settlement timestamp`,async()=>{
 const h=setup();const v=await shown(h);h.setWall(wall);h.advance(17999);await manual(h);const state=await saved(h);assert.equal(state.items.item_021.manualCount,1);assert.equal(state.lastSettlement.settledAt,new Date(h.clock.wall()).toISOString());assert.equal(h.s.state.visit.deadlineMono,v.deadlineMono);
});
test('season and environment request preserve visit, scene geometry and animation origin during settlement',async()=>{
 const h=setup();const v=await shown(h);const draw=sampleScene(v.bundle.plan,h.clock.monotonic());h.s.requestSeason('winter');h.s.requestFamily('hill');await manual(h);
 assert.equal(h.s.state.visit,v);assert.equal(v.bundle.plan.input.playback.originMs,v.shownMono);assert.deepEqual(sampleScene(v.bundle.plan,h.clock.monotonic()),draw);
 const p=(await saved(h)).discovered.yokai_021.photos.spring;assert.equal(p.capturedGameSeason,'winter');assert.equal(p.sceneSeason,'spring');assert.equal(p.backgroundFamily,'forest');await exit(h);assert.equal(h.s.state.family,'hill');
});
test('stale capture context token, visit ID and bundle are rejected',async()=>{
 const h=setup();await shown(h);const old=h.e.captureContext(),current=h.e.captureContext();
 for(const context of [old,{...current,visitId:'past'},{...current,bundle:{...current.bundle}},{...current,owner:{...owner,epoch:99}}])await h.e.requestManual(context,capture);
 assert.deepEqual((await saved(h)).items,{});await h.e.requestManual(current,capture);assert.equal((await saved(h)).items.item_021.manualCount,1);
});
for(const raw of ['{damaged',JSON.stringify({version:999})])test(`protected save ${raw} is never reset or granted`,async()=>{
 const h=setup({driver:createMemoryDriver(raw)});await h.e.synchronize();assert.equal(h.e.status.state,'blocked');assert.equal(h.e.status.reason,raw.includes('999')?'unsupported-version':'corrupt');assert.equal(h.s.state.waitUntil,null);
 await h.driver.exclusive(s=>assert.equal(s.getItem(SAVE_KEY),raw));
});
test('read failure blocks with no volatile fallback and preserves existing active visit',async()=>{
 const h=setup();await shown(h);h.faults.read=true;await manual(h);assert.equal(h.e.status.reason,'unavailable');assert.equal(h.s.state.endStatus,'failed');h.faults.read=false;assert.equal((await saved(h)).activeVisit.itemGranted,false);await h.e.retry();assert.equal((await saved(h)).items.item_021.totalCount,1);
});
test('browser lock failure is preserved as storage failure, never empty successful recovery',async()=>{
 const repository=createBrowserRepository({storage:()=>{throw Error('must not reach');},locks:()=>undefined});const h=setup({repository});await h.e.synchronize();assert.equal(h.e.status.reason,'unavailable');assert.equal(h.e.status.operation,'lock');assert.equal(h.s.state.recoveryPending,true);
});
test('hidden during a delayed start reply still persists and settles the already shown visit once',async()=>{
 const h=setup(),ticket=await ready(h);let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 h.faults.before=async c=>{if(c.type==='startVisit'){entered();await held;}};
 const pending=h.e.confirmDisplay(ticket,paint);await started;h.setAuth({...h.auth(),observable:false});release();await pending;
 const state=await saved(h);assert.equal(state.items.item_021.leftCount,1);assert.equal(state.activeVisit,null);assert.equal(h.s.state.waitUntil,null);
});
test('natural deadline needs no click context and gives only one left item',async()=>{
 const h=setup();await shown(h);h.advance(18000);await h.e.synchronize();const state=await saved(h);assert.equal(state.items.item_021.leftCount,1);assert.deepEqual(state.discovered,{});await exit(h);assert.equal((await saved(h)).activeVisit,null);
});
test('capture file failure after manual commit preserves award and capture record on recovery',async()=>{
 const h=setup();await shown(h);await manual(h);const r=await h.real.commit({type:'updatePhotoStatus',yokaiId:'yokai_021',season:'spring',photoKey:'yokai_021_spring',attemptId:'real-1',status:'failed'});assert.equal(r.status,'applied');
 const b=setup({driver:h.driver});await b.e.synchronize();const state=await saved(b);assert.equal(state.items.item_021.totalCount,1);assert.equal(state.discovered.yokai_021.captureCount,1);assert.equal(state.discovered.yokai_021.photos.spring.status,'failed');assert.equal(state.activeVisit,null);
});
test('browser adapter reconstruction without termination event recovers one actual record and preserves extensions',async()=>{
 const values=new Map();let tail=Promise.resolve();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 const locks={request:(_n,_o,work)=>{const r=tail.then(work);tail=r.catch(()=>{});return r;}};
 const repo=()=>createBrowserRepository({storage:()=>storage,locks:()=>locks});const h=setup({repository:repo()});await shown(h);
 const raw=JSON.parse(values.get(SAVE_KEY));raw.unknown={untouched:['yes']};raw.settings.unknown='keep';values.set(SAVE_KEY,JSON.stringify(raw));
 const b=setup({repository:repo()});await b.e.synchronize();const state=await saved(b);assert.equal(state.items.item_021.totalCount,1);assert.deepEqual(state.unknown,{untouched:['yes']});assert.equal(state.settings.unknown,'keep');assert.equal(state.activeVisit,null);
 const c=setup({repository:repo()});await c.e.synchronize();assert.equal((await saved(c)).items.item_021.totalCount,1);assert.equal(c.e.status.persistence,'local');
});
test('ordinary host factory uses the execution gate and cannot claim, recover or save records',async()=>{
 const {createOrdinaryExecution}=await import('../src/app/execution.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});assert.equal(typeof createOrdinaryExecution,'function');
 const h=setup();const e=createOrdinaryExecution({scheduler:h.s,clock:h.clock,observable:()=>true,photoSeasons:()=>['spring']});
 await e.synchronize();h.advance(86400000);h.s.tick();await e.synchronize();assert.equal(h.s.state.visit,null);assert.equal(h.s.state.recoveryPending,true);assert.equal(e.status.reason,'authority');assert.equal((await saved(h)).observationOwner,null);
});
test('changed end request token rejects a delayed old write; latest request must be serviced again',async()=>{
 const h=setup();await shown(h);let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);let once=true;
 h.faults.before=async c=>{if(c.type==='settleVisit'&&once){once=false;entered();await held;}};
 const pending=manual(h);await started;const old=h.s.state.endRequest.token;h.s.resolveEnd(old,'failed');h.s.retryEnd();release();await pending;
 assert.deepEqual((await saved(h)).items,{});assert.equal(h.s.state.endStatus,'pending');assert.notEqual(h.s.state.endRequest.token,old);
 await h.e.synchronize();assert.equal((await saved(h)).items.item_021.totalCount,1);
});
test('manual reservation keeps an existing noncanonical legacy key, first capture and first cover',async()=>{
 const h=setup();await boot(h);const state=await saved(h);state.discovered.yokai_021={firstCapturedAt:'2025-01-01T00:00:00Z',captureCount:2,coverSeason:'spring',photos:{spring:{photoKey:'original-custom-reference',at:'2025-01-01T00:00:00Z',status:'failed',unknown:['keep']}}};
 await h.driver.exclusive(s=>s.setItem(SAVE_KEY,JSON.stringify(state)));
 h.advance(30000);h.s.tick();await flush();const ticket=h.e.beginPresentation(h.s.state.display.token);await h.e.confirmDisplay(ticket,paint);await manual(h);
 const record=(await saved(h)).discovered.yokai_021;assert.equal(record.captureCount,3);assert.equal(record.firstCapturedAt,'2025-01-01T00:00:00Z');assert.equal(record.coverSeason,'spring');assert.equal(record.photos.spring.photoKey,'original-custom-reference');assert.equal(record.photos.spring.status,'pending');assert.deepEqual(record.photos.spring.unknown,['keep']);
});
for(const stage of ['startVisit','settleVisit','finishVisit'])test(`owner changes while ${stage} awaits lock; stale epoch cannot write or advance`,async()=>{
 const h=setup();let ticket;if(stage==='startVisit')ticket=await ready(h);else await shown(h);if(stage==='finishVisit')await manual(h);
 let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);h.faults.before=async c=>{if(c.type===stage){entered();await held;}};
 const pending=stage==='startVisit'?h.e.confirmDisplay(ticket,paint):stage==='settleVisit'?manual(h):exit(h);await started;
 await h.real.commit({type:'claimObservation',sessionId:'next-owner',expectedEpoch:1});h.setAuth({owner:{sessionId:'next-owner',epoch:2},authorized:true,observable:true});release();await pending;
 const state=await saved(h);assert.equal(state.items.item_021?.totalCount??0,stage==='finishVisit'?1:0);assert.equal(h.e.status.reason,'authority');assert.ok(h.s.state.visit);assert.notEqual(h.s.state.phase,'waiting');const blockedVisit=h.s.state.visit;h.advance(999999);h.s.tick();assert.equal(h.s.state.visit,blockedVisit);
 if(stage!=='startVisit'){assert.ok(state.activeVisit);const b=setup({driver:h.driver,authority:h.auth()});await b.e.synchronize();assert.equal((await saved(b)).items.item_021.totalCount,1);assert.equal((await saved(b)).activeVisit,null);}
});
test('manual committed before hidden but delayed reply retains manual and finishes without left',async()=>{
 const h=setup();await shown(h);let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 h.faults.after=async c=>{if(c.type==='settleVisit'){entered();await held;}};
 const pending=manual(h);await started;h.setAuth({...h.auth(),observable:false});const interrupted=h.e.interrupt();release();await Promise.all([pending,interrupted]);
 const state=await saved(h);assert.equal(state.items.item_021.manualCount,1);assert.equal(state.items.item_021.leftCount,0);assert.equal(state.activeVisit,null);
});
test('lost manual reply plus failed reconciliation blocks, then retry proves manual despite later expiry and hidden',async()=>{
 const h=setup();await shown(h);h.faults.lose='settleVisit';h.faults.after=async c=>{if(c.type==='settleVisit')h.faults.read=true;};await manual(h);
 assert.equal(h.s.state.endStatus,'failed');assert.equal(h.e.status.reason,'unavailable');h.faults.after=null;h.faults.read=false;h.advance(86400000);h.setAuth({...h.auth(),observable:false});await h.e.interrupt();await h.e.retry();
 const state=await saved(h);assert.equal(state.items.item_021.manualCount,1);assert.equal(state.items.item_021.leftCount,0);assert.equal(state.discovered.yokai_021.captureCount,1);assert.equal(state.activeVisit,null);
});
test('manual receipt hands A06 only the confirmed pending reservation, never claims file success',async()=>{
 const h=setup();await shown(h);await manual(h);assert.deepEqual(h.e.receipt,{visitId:'real-1',yokaiId:'yokai_021',itemId:'item_021',source:'manual',settledAt:'2026-10-27T00:00:30.000Z',photo:{slotSeason:'spring',photoKey:'yokai_021_spring',attemptId:'real-1',status:'pending'}});
 await exit(h);assert.equal(h.e.receipt.photo.status,'pending');assert.ok(Object.isFrozen(h.e.receipt));assert.ok(Object.isFrozen(h.e.receipt.photo));
});
test('manual receipt never tells A06 to overwrite an existing successful photo',async()=>{
 const h=setup();await boot(h);const state=await saved(h);state.discovered.yokai_021={firstCapturedAt:'2025-01-01T00:00:00Z',captureCount:1,coverSeason:'spring',photos:{spring:{photoKey:'keep-first',at:'2025-01-01T00:00:00Z',status:'saved',attemptId:'older-visit'}}};await h.driver.exclusive(s=>s.setItem(SAVE_KEY,JSON.stringify(state)));
 h.advance(30000);h.s.tick();await flush();await h.e.confirmDisplay(h.e.beginPresentation(h.s.state.display.token),paint);await manual(h);
 assert.equal(h.e.receipt.photo,null);assert.equal((await saved(h)).discovered.yokai_021.photos.spring.photoKey,'keep-first');assert.equal((await saved(h)).discovered.yokai_021.captureCount,2);
});
test('legacy v3 real active visit without new runtime metadata recovers left with backward wall time',async()=>{
 const a=setup();await shown(a);const state=await saved(a);for(const key of ['captureDeadlineAt','season','backgroundFamily','dwellMs'])delete state.activeVisit[key];await a.driver.exclusive(s=>s.setItem(SAVE_KEY,JSON.stringify(state)));
 const b=setup({driver:a.driver});b.setWall(Date.parse('2020-01-01T00:00:00Z'));await b.e.synchronize();const result=await saved(b);assert.equal(result.items.item_021.leftCount,1);assert.equal(result.lastSettlement.settledAt,'2020-01-01T00:00:00.000Z');assert.equal(result.activeVisit,null);assert.deepEqual(result.discovered,{});
});
for(const recovery of [false,true])test(`observability changes during ${recovery?'restart':'live'} finish reply; current hidden state cannot start waiting`,async()=>{
 const a=setup();await shown(a);let h=a;if(recovery)h=setup({driver:a.driver});else await manual(a);
 h.faults.after=async c=>{if(c.type==='finishVisit')h.setAuth({...h.auth(),observable:false});};
 if(recovery)await h.e.synchronize();else await exit(h);
 const state=await saved(h);assert.equal(state.items.item_021.totalCount,1);assert.equal(state.activeVisit,null);assert.equal(h.s.state.waitUntil,null);assert.equal(h.s.state.recoveryPending,true);
});
