import test from 'node:test';import assert from 'node:assert/strict';
import {initialState,emptyItem} from '../src/domain/state.ts';
import {createMemoryDriver,createMemoryRepository} from '../src/storage/memory.ts';
const api=await import('../src/settings/controller.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup(repo=createMemoryRepository(createMemoryDriver())){assert.equal(typeof api.SettingsController,'function');return new api.SettingsController({repository:repo});}
test('settings read/open is zero writes and defaults are off',async()=>{const repo=createMemoryRepository(createMemoryDriver());let writes=0;const c=setup({read:repo.read,commit:async x=>{writes++;return repo.commit(x);}});await c.refresh();assert.equal(writes,0);assert.deepEqual(c.snapshot.settings,initialState().settings);});
test('partial settings and completion preserve unknown, items, photos and each other',async()=>{const s=initialState();s.extension={x:1};s.settings.future='keep';s.items.retired=emptyItem();s.discovered.retired={firstCapturedAt:'2026-10-27T00:00:00Z',captureCount:1,coverSeason:'winter',photos:{winter:{photoKey:'legacy',at:'2026-10-27T00:00:00Z'}}};const repo=createMemoryRepository(createMemoryDriver(JSON.stringify(s))),c=setup(repo);await c.refresh();c.change({sound:true});c.change({arrivalChime:true});c.change({backgroundFamily:'hill'});c.completeTutorial();await c.idle();const r=(await repo.read()).state;assert.deepEqual(r.settings,{sound:true,arrivalChime:true,backgroundFamily:'hill',future:'keep'});assert.equal(r.firstRunDone,true);for(const k of ['extension','items','discovered'])assert.deepEqual(r[k],s[k]);});
test('serial writes preserve newest intent across failure, retry and pending response',async()=>{const repo=createMemoryRepository(createMemoryDriver());let release;let calls=0;const c=setup({read:repo.read,commit:async cmd=>{calls++;if(calls===1){await new Promise(r=>release=r);return {status:'unavailable',operation:'write',reason:'fault'};}return repo.commit(cmd);}});await c.refresh();c.change({backgroundFamily:'hill'});await flush();c.change({backgroundFamily:'forest',sound:true});release();await c.idle();assert.equal(c.snapshot.phase,'error');assert.equal(c.snapshot.settings.backgroundFamily,'forest');await c.retry();await c.idle();assert.equal((await repo.read()).state.settings.sound,true);assert.equal((await repo.read()).state.settings.backgroundFamily,'forest');assert.equal(c.snapshot.phase,'ready');});
test('stale refresh cannot replace newest committed settings',async()=>{const repo=createMemoryRepository(createMemoryDriver());let release;let reads=0;const c=setup({read:async()=>{const r=await repo.read();if(++reads===2)await new Promise(x=>release=x);return r;},commit:repo.commit});await c.refresh();const old=c.refresh();await flush();c.change({sound:true});await c.idle();release();await old;assert.equal(c.snapshot.settings.sound,true);});
test('completion failure retries only completion and keeps independent settings',async()=>{const repo=createMemoryRepository(createMemoryDriver());let fail=true;const c=setup({read:repo.read,commit:async cmd=>fail?{status:'unavailable',operation:'write',reason:'fault'}:repo.commit(cmd)});await c.refresh();c.completeTutorial();await c.idle();assert.equal((await repo.read()).state.firstRunDone,false);assert.equal(c.snapshot.phase,'error');await repo.commit({type:'changeSettings',patch:{sound:true}});fail=false;await c.retry();assert.equal((await repo.read()).state.firstRunDone,true);assert.equal((await repo.read()).state.settings.sound,true);});
test('late commit response cannot roll back a newer external snapshot',async()=>{const repo=createMemoryRepository(createMemoryDriver());let release;const c=setup({read:repo.read,commit:async cmd=>{const r=await repo.commit(cmd);await new Promise(x=>release=x);return r;}});await c.refresh();c.change({sound:true});await flush();await repo.commit({type:'changeSettings',patch:{backgroundFamily:'hill'}});await c.refresh();release();await c.idle();assert.equal(c.snapshot.state.settings.backgroundFamily,'hill');assert.equal(c.snapshot.settings.backgroundFamily,'hill');});
for(const result of [{status:'unavailable',operation:'read',reason:'fault'},{status:'corrupt',recovered:initialState()},{status:'unsupported-version',version:8}])test(`read ${result.status} never presents default settings as loaded`,async()=>{let writes=0;const c=setup({read:async()=>result,commit:async()=>{writes++;}});await c.refresh();c.change({sound:true});assert.equal(c.snapshot.phase,'error');assert.equal(c.snapshot.settings,null);assert.equal(writes,0);});
test('response lost after commit retries partial intent without changing records',async()=>{const repo=createMemoryRepository(createMemoryDriver());let first=true;const c=setup({read:repo.read,commit:async cmd=>{const r=await repo.commit(cmd);if(first){first=false;return {status:'unavailable',operation:'write',reason:'response lost'};}return r;}});await c.refresh();c.change({sound:true});await c.idle();const revision=(await repo.read()).state.revision;await c.retry();assert.equal(c.snapshot.phase,'ready');assert.equal((await repo.read()).state.revision,revision);});
test('intent arriving in ready-publication microtask is drained before idle resolves',async()=>{const repo=createMemoryRepository(createMemoryDriver()),c=setup(repo);await c.refresh();let once=false;c.subscribe(()=>{if(!once&&c.snapshot.phase==='ready'&&c.snapshot.settings.sound){once=true;queueMicrotask(()=>c.change({arrivalChime:true}));}});c.change({sound:true});await c.idle();assert.equal((await repo.read()).state.settings.arrivalChime,true);assert.equal(c.snapshot.phase,'ready');});
test('tutorial completion rebases a concurrent revision conflict without losing the other write',async()=>{
 const repo=createMemoryRepository(createMemoryDriver());let attempts=0;
 const c=setup({read:repo.read,commit:async command=>{
  if(++attempts===1){await repo.commit({type:'changeSettings',patch:{sound:true}});return {status:'conflict',actualRevision:(await repo.read()).state.revision};}
  return repo.commit(command);
 }});
 await c.refresh();c.completeTutorial();await c.idle();
 assert.equal(c.snapshot.phase,'ready');assert.equal(attempts,2);
 const saved=(await repo.read()).state;assert.equal(saved.firstRunDone,true);assert.equal(saved.settings.sound,true);
});
test('persistent settings conflicts stop after three attempts and remain explicitly retryable',async()=>{
 const repo=createMemoryRepository(createMemoryDriver());let attempts=0,conflicts=true;
 const c=setup({read:repo.read,commit:async command=>{attempts++;return conflicts?{status:'conflict',actualRevision:attempts}:repo.commit(command);}});
 await c.refresh();c.change({sound:true});await c.idle();assert.equal(attempts,3);assert.equal(c.snapshot.phase,'error');
 conflicts=false;await c.retry();assert.equal(c.snapshot.phase,'ready');assert.equal((await repo.read()).state.settings.sound,true);
});
test('cutscene viewing survives new sessions, separates accounts and merges other writes',async()=>{
 const repo=createMemoryRepository(createMemoryDriver()), other=createMemoryRepository(createMemoryDriver());
 const c=setup(repo);await c.start();c.markCutsceneViewed('forest-intro-v2');c.change({sound:true});await c.idle();
 const next=setup(repo);await next.start();assert.equal(next.snapshot.state.viewedCutscenes['forest-intro-v2'],true);
 assert.equal(next.snapshot.settings.sound,true);assert.equal((await other.read()).state.viewedCutscenes,undefined);
 await repo.commit({type:'changeSettings',patch:{},viewedCutscenes:['another-story']});
 const revision=(await repo.read()).state.revision;c.markCutsceneViewed('forest-intro-v2');await c.idle();
 assert.equal((await repo.read()).state.revision,revision);
 assert.equal((await repo.read()).state.viewedCutscenes['another-story'],true);
});
test('cutscene saving retries lost responses without losing watched stories',async()=>{
 const repo=createMemoryRepository(createMemoryDriver());let fail=true;
 const c=setup({read:repo.read,commit:async cmd=>{const result=await repo.commit(cmd);if(fail){fail=false;return {status:'unavailable'};}return result;}});
 await c.start();c.markCutsceneViewed('forest-intro-v2');await c.idle();assert.equal(c.snapshot.phase,'error');
 await repo.commit({type:'changeSettings',patch:{},viewedCutscenes:['another-story']});
 await c.retry();assert.equal(c.snapshot.phase,'ready');assert.deepEqual((await repo.read()).state.viewedCutscenes,{'forest-intro-v2':true,'another-story':true});
});
