import test from 'node:test';import assert from 'node:assert/strict';
import {photoPlatform} from './helpers/photo-idb.mjs';
import {createMemoryRepository} from '../src/storage/memory.ts';
const api=await import('../src/storage/photos.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const owner={sessionId:'s',epoch:1},at='2026-10-27T00:00:00Z';
const r={yokaiId:'yokai_021',season:'spring',photoKey:'old-key',attemptId:'visit-1'};
async function setup(options={}){
 assert.equal(typeof api.createPhotoStore,'function','A06 IndexedDB photo adapter required');
 const p=photoPlatform(options),repo=createMemoryRepository();await repo.commit({type:'claimObservation',sessionId:'s',expectedEpoch:0});
 async function reserve(attemptId='visit-1'){
 await repo.commit({type:'startVisit',owner,visit:{visitId:attemptId,yokaiId:r.yokaiId,itemId:'item_021',appearedAt:at,captureDeadlineAt:'2026-10-27T00:00:20Z',season:'spring',backgroundFamily:'forest'}});
 await repo.commit({type:'settleVisit',owner,visitId:attemptId,source:'manual',at,photo:{photoKey:r.photoKey}});
 await repo.commit({type:'finishVisit',owner,visitId:attemptId});return {...r,attemptId};}
 await reserve();
 const store=()=>api.createPhotoStore({repository:repo,indexedDB:()=>p.indexedDB,locks:()=>p.locks});
 return {p,repo,store:store(),reopen:store,reserve};
}
const png=()=>new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});
test('opens legacy DB without replacing photo bytes, adds only companion store, reads original Blob key',async()=>{
 const h=await setup();const old=png();h.p.stores.get('photos').set('legacy-key',old);
 const result=await h.store.get('legacy-key');assert.equal(result.status,'found');assert.equal(result.png,old);assert.equal(h.p.stores.get('photos').get('legacy-key'),old);assert.equal(h.p.db.version,2);assert.ok(h.p.stores.has('photoAttempts'));
});
test('file success waits for transaction complete rather than put request success',async()=>{
 const h=await setup();assert.equal((await h.store.reserve(r)).status,'ready');h.p.faults.hold=true;
 let done=false;const write=h.store.write(r,{png:png(),fullScene:png()}).then(x=>{done=true;return x;});
 await new Promise(setImmediate);await new Promise(setImmediate);assert.equal(done,false);h.p.faults.hold=false;h.p.finish();
 assert.equal((await write).status,'stored');assert.equal((await h.store.get(r.photoKey)).attemptId,r.attemptId);
});
for(const fault of ['abort','quota','readError'])test(`transaction ${fault} is never stored/saved or empty success`,async()=>{
 const h=await setup();await h.store.reserve(r);h.p.faults[fault]=true;
 const result=await h.store.write(r,{png:png(),fullScene:png()});assert.equal(result.status,'unavailable');assert.equal(h.p.stores.get('photos').has(r.photoKey),false);
});
for(const fault of ['blocked','openError','upgradeError'])test(`IndexedDB ${fault} fails closed and preserves legacy bytes`,async()=>{
 const h=await setup({[fault]:true});const old=png();h.p.stores.get('photos').set('legacy-key',old);
 assert.equal((await h.store.get('legacy-key')).status,'unavailable');assert.equal(h.p.stores.get('photos').get('legacy-key'),old);
});
test('unsupported IDB or locks never substitute a memory success',async()=>{
 const h=await setup();const store=api.createPhotoStore({repository:h.repo,indexedDB:()=>undefined,locks:()=>undefined});
 assert.equal((await store.get(r.photoKey)).status,'unavailable');assert.equal((await store.reserve(r)).status,'unavailable');
});
test('older attempt cannot reserve or overwrite new bytes after failure/rebooking and reverse completion',async()=>{
 const h=await setup();await h.store.reserve(r);
 await h.repo.commit({type:'updatePhotoStatus',...r,status:'failed'});const newer=await h.reserve('visit-2');await h.store.reserve(newer);
 const newerPNG=png();assert.equal((await h.store.write(newer,{png:newerPNG,fullScene:png()})).status,'stored');
 assert.equal((await h.reopen().reserve(r)).status,'stale');assert.equal((await h.reopen().write(r,{png:png(),fullScene:png()})).status,'stale');
 assert.equal((await h.store.get(r.photoKey)).png,newerPNG);
});
test('duplicate writes never replace bytes even for same attempt',async()=>{
 const h=await setup();await h.store.reserve(r);const first=png();await h.store.write(r,{png:first,fullScene:png()});
 const result=await h.reopen().write(r,{png:png(),fullScene:png()});assert.equal(result.status,'stored');assert.equal((await h.store.get(r.photoKey)).png,first);
});
test('restart closes missing pending fence; delayed encoder cannot create past photo, rebooking can proceed',async()=>{
 const h=await setup();await h.store.reserve(r);assert.equal((await h.reopen().closePending(r)).status,'missing');
 assert.equal((await h.store.write(r,{png:png(),fullScene:png()})).status,'stale');assert.equal((await h.store.reserve(r)).status,'stale');
 await h.repo.commit({type:'updatePhotoStatus',...r,status:'failed'});const next=await h.reserve('visit-2');assert.equal((await h.store.reserve(next)).status,'ready');
});
test('restart distinguishes matching saved file from missing pending and never rewrites legacy file',async()=>{
 const h=await setup();await h.store.reserve(r);await h.store.write(r,{png:png(),fullScene:png()});assert.equal((await h.reopen().closePending(r)).status,'found');
 const a=await setup();const old=png();a.p.stores.get('photos').set(r.photoKey,old);assert.equal((await a.store.reserve(r)).status,'preserved');assert.equal(a.p.stores.get('photos').get(r.photoKey),old);
});
test('metadata failure/rebooking cannot interleave after file latest-read and before transaction completion',async()=>{
 const h=await setup();await h.store.reserve(r);h.p.faults.hold=true;
 const writing=h.store.write(r,{png:png(),fullScene:png()});await new Promise(setImmediate);await new Promise(setImmediate);
 let changed=false;const failing=h.repo.commit({type:'updatePhotoStatus',...r,status:'failed'}).then(x=>{changed=true;return x;});await new Promise(setImmediate);
 assert.equal(changed,false,'metadata mutation must wait for the active file transaction');
 h.p.faults.hold=false;h.p.finish();await writing;await failing;
});
test('adapter without atomic snapshot inspection cannot claim stale-safe file writes',async()=>{
 const h=await setup();const store=api.createPhotoStore({repository:{read:()=>h.repo.read(),commit:(...args)=>h.repo.commit(...args)},indexedDB:()=>h.p.indexedDB,locks:()=>h.p.locks});
 assert.equal((await store.reserve(r)).status,'unavailable');assert.equal(h.p.stores.get('photos').size,0);
});
test('short snapshot lease preserves detached metadata and releases writer lock after failure',async()=>{
 const h=await setup();let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const inspection=h.repo.withSnapshot(async state=>{state.discovered.yokai_021.photos.spring.photoKey='mutated-clone';entered();await held;throw Error('file failed');});await started;
 let done=false;const update=h.repo.commit({type:'changeSettings',patch:{sound:true}}).then(r=>{done=true;return r;});await new Promise(setImmediate);assert.equal(done,false);release();assert.equal((await inspection).status,'unavailable');assert.equal((await update).status,'applied');assert.equal((await h.repo.read()).state.discovered.yokai_021.photos.spring.photoKey,r.photoKey);
});
test('browser metadata adapter and photo adapter share named writer lock without nested-lock deadlock',async()=>{
 const {createBrowserRepository}=await import('../src/storage/browser.ts');const p=photoPlatform();const values=new Map();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 const repo=createBrowserRepository({storage:()=>storage,locks:()=>p.locks});await repo.commit({type:'claimObservation',sessionId:'s',expectedEpoch:0});
 await repo.commit({type:'startVisit',owner,visit:{visitId:r.attemptId,yokaiId:r.yokaiId,itemId:'item_021',appearedAt:at,captureDeadlineAt:'2026-10-27T00:00:20Z',season:r.season,backgroundFamily:'forest'}});
 await repo.commit({type:'settleVisit',owner,visitId:r.attemptId,source:'manual',at,photo:{photoKey:r.photoKey}});
 const store=api.createPhotoStore({repository:repo,indexedDB:()=>p.indexedDB,locks:()=>p.locks});assert.equal((await store.reserve(r)).status,'ready');assert.equal((await store.write(r,{png:png(),fullScene:png()})).status,'stored');
 assert.equal((await repo.commit({type:'updatePhotoStatus',...r,status:'saved'})).status,'applied');assert.equal((await repo.read()).state.items.item_021.totalCount,1);
});
test('unknown legacy file value is preserved and returns unavailable rather than empty success',async()=>{
 const h=await setup();const legacy={original:'unknown-file-envelope',extra:['keep']};h.p.stores.get('photos').set('legacy-key',legacy);
 assert.equal((await h.store.get('legacy-key')).status,'unavailable');assert.deepEqual(h.p.stores.get('photos').get('legacy-key'),legacy);
});
test('higher existing DB version is increased once for companion and never downgraded on reopen',async()=>{
 const h=await setup({version:9});const legacy=png();h.p.stores.get('photos').set('legacy-key',legacy);
 assert.equal((await h.store.reserve(r)).status,'ready');assert.equal(h.p.db.version,10);assert.equal((await h.reopen().get('legacy-key')).png,legacy);assert.equal(h.p.db.version,10);
});
