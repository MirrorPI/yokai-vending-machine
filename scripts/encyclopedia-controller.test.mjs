import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {initialState,emptyItem} from '../src/domain/state.ts';
import {createMemoryDriver,createMemoryRepository} from '../src/storage/memory.ts';
import {createPhotoStore} from '../src/storage/photos.ts';
import {photoPlatform} from './helpers/photo-idb.mjs';
const api=await import('../src/encyclopedia/controller.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json')),at='2026-10-27T00:00:00Z';
const photo=(status='saved',extra={})=>({photoKey:'old-key',at,...(status?{status}:{}),...extra});
function state(p=photo()){const s=initialState();s.discovered.yokai_021={firstCapturedAt:at,captureCount:1,photos:{spring:p},coverSeason:'spring'};s.discovered.yokai_031={firstCapturedAt:at,captureCount:1,photos:{summer:photo('saved',{photoKey:'B'})},coverSeason:'summer'};return s;}
const ok=s=>({status:'ok',state:s,origin:'stored',persistence:'volatile'});
const found=(extra={})=>({status:'found',png:new Blob(['card'],{type:'image/png'}),...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(setImmediate);
function setup(options={}){assert.equal(typeof api.EncyclopediaController,'function','read-only coordinator required');let latest=options.state??state(),serial=0,reads=0,gets=[];const made=[],revoked=[];
 const controller=new api.EncyclopediaController({catalog,repository:options.repository??{read:()=>{reads++;return options.read?options.read():Promise.resolve(ok(latest));}},files:options.files??{get:k=>{gets.push(k);return options.get?options.get(k):Promise.resolve(found());}},urls:{createObjectURL:b=>{const u=`blob:${++serial}`;made.push([u,b]);return u;},revokeObjectURL:u=>revoked.push(u)},subscribeChanges:options.subscribeChanges});
 return {c:controller,made,revoked,gets,get reads(){return reads;},set latest(s){latest=s;}};}
test('construction does no I/O; open reads independently of ownership and closed controller retires URLs',async()=>{
 const h=setup();assert.equal(h.reads,0);await h.c.open();assert.equal(h.c.snapshot.phase,'ready');assert.equal(h.gets.length,0);await h.c.select('yokai_021');assert.equal(h.c.snapshot.photo.state,'ready');assert.equal(h.gets[0],'old-key');h.c.close();assert.deepEqual(h.revoked,['blob:1']);assert.equal(h.c.snapshot.open,false);
});
for(const status of ['pending','failed'])test(`${status} counts as recorded but never reads files or pretends success`,async()=>{
 const h=setup({state:state(photo(status))});await h.c.open();await h.c.select('yokai_021');assert.equal(h.c.snapshot.photo.state,status);assert.equal(h.gets.length,0);assert.equal(h.c.snapshot.model.progress.photos,2);h.c.close();
});
for(const status of [undefined,'saved'])for(const result of [{status:'missing'},{status:'unavailable',reason:'read failure'},found()])test(`${status??'legacy'} / ${result.status} keeps capture unlocked and metadata intact`,async()=>{
 const s=state(photo(status===undefined?null:status)),before=JSON.stringify(s),h=setup({state:s,get:async()=>result});await h.c.open();await h.c.select('yokai_021');assert.equal(h.c.snapshot.photo.state,result.status==='found'?'ready':result.status);assert.equal(h.c.snapshot.model.entries[20].status,'captured');assert.equal(JSON.stringify(s),before);h.c.close();
});
test('new metadata attempt mismatch or absent file attempt never displays foreign bytes; legacy remains readable',async()=>{
 for(const attemptId of ['old',undefined]){const h=setup({state:state(photo('saved',{attemptId:'new'})),get:async()=>found({attemptId})});await h.c.open();await h.c.select('yokai_021');assert.equal(h.c.snapshot.photo.state,'mismatch');assert.ok(!h.c.snapshot.photo.url);assert.deepEqual(h.revoked,['blob:1']);h.c.close();}
});
test('matching attempt supports distinct card and fullScene original blobs, legacy missing full is explicit',async()=>{
 const full=new Blob(['full']),h=setup({state:state(photo('saved',{attemptId:'v'})),get:async()=>found({attemptId:'v',fullScene:full})});await h.c.open();await h.c.select('yokai_021');assert.equal(h.made[0][1].size,4);await h.c.showFull(true);assert.equal(h.made[1][1],full);assert.deepEqual(h.revoked,['blob:1']);h.c.close();
 const legacy=setup({state:state(photo(null))});await legacy.c.open();await legacy.c.select('yokai_021');await legacy.c.showFull(true);assert.equal(legacy.c.snapshot.photo.state,'full-missing');legacy.c.close();
});
test('A to B and reverse completion cannot display A, close/reopen retires outstanding request',async()=>{
 const a=deferred(),b=deferred(),h=setup({get:k=>k==='B'?b.promise:a.promise});await h.c.open();const first=h.c.select('yokai_021'),second=h.c.select('yokai_031');b.resolve(found());await second;assert.equal(h.c.snapshot.selectedId,'yokai_031');const url=h.c.snapshot.photo.url;a.resolve(found());await first;assert.equal(h.c.snapshot.photo.url,url);assert.equal(h.made.length,1);
 h.c.close();assert.deepEqual(h.revoked,[url]);await h.c.open();assert.equal(h.c.snapshot.selectedId,null);assert.equal(h.c.snapshot.photo.state,'empty');h.c.close();
});
test('slot and mode changes invalidate old results even for same key and close before completion creates no URL',async()=>{
 const pending=[],h=setup({get:()=>{const d=deferred();pending.push(d);return d.promise;}});await h.c.open();const a=h.c.select('yokai_021'),b=h.c.showFull(true);pending[1].resolve(found({fullScene:new Blob(['full'])}));await b;pending[0].resolve(found());await a;assert.equal(h.c.snapshot.full,true);assert.equal(h.made.length,1);const c=h.c.retryPhoto();h.c.close();pending[2].resolve(found());await c;assert.equal(h.made.length,1);assert.equal(h.revoked.length,1);
});
test('common season selection rejects reverse slot response and never counts environment as another slot',async()=>{
 const s=initialState();s.discovered.yokai_001={firstCapturedAt:at,captureCount:2,coverSeason:'winter',photos:{spring:photo('saved',{photoKey:'spring-file',backgroundFamily:'forest'}),winter:photo('saved',{photoKey:'winter-file',backgroundFamily:'hill'})}};
 const spring=deferred(),winter=deferred(),h=setup({state:s,get:k=>k==='spring-file'?spring.promise:winter.promise});await h.c.open();const first=h.c.select('yokai_001'),second=h.c.selectPhoto('spring');spring.resolve(found());await second;const url=h.c.snapshot.photo.url;winter.resolve(found());await first;assert.equal(h.c.snapshot.season,'spring');assert.equal(h.c.snapshot.photo.url,url);assert.deepEqual(h.gets,['winter-file','spring-file']);assert.equal(h.c.snapshot.model.progress.photos,2);assert.equal(h.c.snapshot.model.entries[0].coverSeason,'winter');h.c.close();
});
test('same photo key with newer attempt during outstanding lookup retires previous file response',async()=>{
 const old=deferred(),fresh=deferred();let n=0;const h=setup({state:state(photo('saved',{attemptId:'old'})),get:()=>++n===1?old.promise:fresh.promise});await h.c.open();const first=h.c.select('yokai_021');h.latest=state(photo('saved',{attemptId:'new'}));const refresh=h.c.refresh();await tick();fresh.resolve(found({attemptId:'new'}));await refresh;const url=h.c.snapshot.photo.url;old.resolve(found({attemptId:'old'}));await first;assert.equal(h.c.snapshot.photo.url,url);assert.equal(h.made.length,1);h.c.close();assert.equal(h.revoked.length,1);
});
test('reverse repository responses and close cannot publish stale model',async()=>{
 const a=deferred(),b=deferred();let n=0;const h=setup({read:()=>++n===1?a.promise:b.promise});const opening=h.c.open(),refresh=h.c.refresh();const newer=state();newer.revision=2;newer.discovered.yokai_021.captureCount=9;b.resolve(ok(newer));await refresh;a.resolve(ok(state()));await opening;assert.equal(h.c.snapshot.model.entries[20].capture.captureCount,9);h.c.close();
 const d=deferred(),z=setup({read:()=>d.promise});const p=z.c.open();z.c.close();d.resolve(ok(state()));await p;assert.equal(z.c.snapshot.phase,'idle');
});
test('latest metadata status/attempt refresh replaces pending and obsolete URL; unchanged reads preserve URL',async()=>{
 let changed;const h=setup({state:state(photo('pending',{attemptId:'v'})),subscribeChanges:cb=>{changed=cb;return()=>{changed=null;};},get:async()=>found({attemptId:'v'})});await h.c.open();await h.c.select('yokai_021');h.latest=state(photo('saved',{attemptId:'v'}));changed();await tick();assert.equal(h.c.snapshot.photo.state,'ready');await h.c.refresh();assert.equal(h.made.length,1);h.latest=state(photo('failed',{attemptId:'v'}));await h.c.refresh();assert.equal(h.c.snapshot.photo.state,'failed');assert.equal(h.revoked.length,1);h.c.close();assert.equal(changed,null);
});
test('trace detail becomes captured on latest read and opens its first representative without reopening panel',async()=>{
 const s=initialState();s.items.item_021={...emptyItem(),totalCount:1,leftCount:1,firstObtainedAt:at,lastObtainedAt:at};const h=setup({state:s});await h.c.open();await h.c.select('yokai_021');assert.equal(h.c.snapshot.season,null);h.latest=state();await h.c.refresh();assert.equal(h.c.snapshot.model.entries[20].status,'captured');assert.equal(h.c.snapshot.season,'spring');assert.equal(h.c.snapshot.photo.state,'ready');h.c.close();
});
for(const failure of [{status:'corrupt',raw:'SECRET',recovered:initialState(),backup:'saved',reason:'bad'},{status:'unsupported-version',version:90},{status:'unavailable',operation:'read',reason:'blocked'}])test(`repository ${failure.status} is explicit error without empty model fallback`,async()=>{
 const h=setup({read:async()=>failure});await h.c.open();assert.equal(h.c.snapshot.phase,'error');assert.equal(h.c.snapshot.error,failure.status);assert.equal(h.c.snapshot.model,null);assert.equal(h.gets.length,0);h.c.close();
});
test('thrown read/get and image decode failure remain retryable without record changes',async()=>{
 const h=setup({read:async()=>{throw Error('offline');}});await h.c.open();assert.equal(h.c.snapshot.error,'unavailable');h.c.close();
 const s=setup();await s.c.open();await s.c.select('yokai_021');const token=s.c.snapshot.photo.token;s.c.imageFailed(token);assert.equal(s.c.snapshot.photo.state,'decode-error');assert.equal(s.revoked.length,1);await s.c.retryPhoto();s.c.imageFailed(token);assert.equal(s.c.snapshot.photo.state,'ready');s.c.close();
 const z=setup({get:async()=>{throw Error('idb');}});await z.c.open();await z.c.select('yokai_021');assert.equal(z.c.snapshot.photo.state,'unavailable');z.c.close();
});
test('real repository/PhotoStore fixture queries preserve raw, legacy bytes and unread counts with zero writes',async()=>{
 const s=state(photo(null));s.extra={keep:1};s.items.item_021={...emptyItem(),totalCount:2,leftCount:2,unreadCount:2,unreadLeftCount:2,firstObtainedAt:at,lastObtainedAt:at};const raw=JSON.stringify(s),driver=createMemoryDriver(raw),repo=createMemoryRepository(driver),platform=photoPlatform();const bytes=new Blob(['legacy'],{type:'image/png'});platform.stores.get('photos').set('old-key',bytes);
 let commands=0,fileWrites=0;const files=createPhotoStore({repository:repo,indexedDB:()=>platform.indexedDB,locks:()=>platform.locks});
 const readOnlyRepo={...repo,commit:(...args)=>{commands++;return repo.commit(...args);}},readOnlyFiles={...files};for(const method of ['reserve','write','closePending'])readOnlyFiles[method]=(...args)=>{fileWrites++;return files[method](...args);};
 const h=setup({repository:readOnlyRepo,files:readOnlyFiles});await h.c.open();h.c.setFilter('spring');await h.c.select('yokai_021');await h.c.showFull(true);await h.c.retryPhoto();h.c.close();assert.equal(await driver.exclusive(v=>v.getItem(driver.key)),raw);assert.equal(platform.stores.get('photos').get('old-key'),bytes);assert.ok(!platform.events.includes('tx:readwrite'));assert.equal(commands,0);assert.equal(fileWrites,0);
});

test('detail paging keeps filtered order stable when NEW records become viewed',async()=>{
 const h=setup();await h.c.open();h.c.setFilter('spring');
 await h.c.select('yokai_021');const order=h.c.snapshot.detailOrder;
 assert.ok(order?.length>1);assert.equal(order[0],'yokai_021');assert.ok(!order.includes('yokai_031'));
 const updated=state();updated.discovered.yokai_021.firstViewedAt=at;h.latest=updated;await h.c.refresh();
 assert.deepEqual(h.c.snapshot.detailOrder,order);
 await h.c.select(order[1]);assert.deepEqual(h.c.snapshot.detailOrder,order);
 assert.equal(h.c.snapshot.selectedId,order[1]);assert.equal(h.c.snapshot.photo.state,'empty');
 await h.c.select(null);assert.equal(h.c.snapshot.detailOrder,undefined);
 await h.c.select('yokai_021');assert.notEqual(h.c.snapshot.detailOrder,order);
 h.c.close();assert.equal(h.c.snapshot.detailOrder,undefined);
});
test('detail paging respects rarity and direct links outside the selected season',async()=>{
 const h=setup();await h.c.open();h.c.setFilter('spring');h.c.setRarity('rare');
 const visible=h.c.snapshot.model.entries.filter(e=>e.seasons.length===1&&e.seasons[0]==='spring'&&e.rarity==='rare');
 assert.ok(visible.length);await h.c.select(visible[0].id);
 assert.deepEqual(new Set(h.c.snapshot.detailOrder),new Set(visible.map(e=>e.id)));
 await h.c.select(null);await h.c.select('yokai_031');assert.deepEqual(h.c.snapshot.detailOrder,['yokai_031']);
 h.c.close();
});
