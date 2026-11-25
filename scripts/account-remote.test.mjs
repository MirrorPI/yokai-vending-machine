import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/domain/state.ts';
const load=()=>import('../src/account/remote.ts').catch(()=>({}));
const identity={sub:'alice',accessToken:'access',expiresAt:1000000};
const response=body=>new Response(JSON.stringify(body));
test('account display reads coalesce and cache for 30s; commands fresh-read and CAS',async()=>{
 const {createAccountPorts}=await load();assert.equal(typeof createAccountPorts,'function');let now=0;const calls=[];
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>now,fetcher:async(url,init)=>{calls.push([url,init]);return response(init?.method==='POST'?{status:'applied',state:{...initialState(),revision:2},persistence:'account'}:{status:'ok',state:{...initialState(),revision:1},origin:'stored',persistence:'account'})}});
 const reads=await Promise.all([p.repository.read(),p.repository.read(),p.repository.read()]);assert.equal(calls.length,1);reads[0].state.revision=99;assert.equal((await p.repository.read()).state.revision,1);
 now=29999;await p.repository.read();assert.equal(calls.length,1);now=30000;await p.repository.read();assert.equal(calls.length,2);
 assert.equal((await p.repository.commit({type:'changeSettings',patch:{sound:false}},{guard:s=>s.revision===1})).status,'applied');assert.equal(calls.length,4);assert.equal(JSON.parse(calls[3][1].body).expectedRevision,1);assert.equal(calls[3][1].headers.Authorization,'Bearer access');p.dispose();
});
test('guard runs before command network; expired/retired accounts and late replies fail closed',async()=>{
 const {createAccountPorts}=await load();assert.equal(typeof createAccountPorts,'function');let finish;let sends=0;let now=0;
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>now,fetcher:async()=>{sends++;return new Promise(r=>finish=()=>r(response({status:'ok',state:initialState(),origin:'empty',persistence:'account'})))}});
 const pending=p.repository.read();await Promise.resolve();p.dispose();finish();assert.equal((await pending).status,'unavailable');assert.equal((await p.repository.read()).status,'unavailable');assert.equal(sends,1);
 const q=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>now,fetcher:async()=>{sends++;return response({status:'ok',state:initialState(),origin:'empty',persistence:'account'})}});
 assert.equal((await q.repository.commit({type:'changeSettings',patch:{}},{guard:()=>false})).status,'invalid');assert.equal(sends,2);now=1000000;assert.equal((await q.repository.commit({type:'changeSettings',patch:{}})).status,'unavailable');assert.equal(sends,2);q.dispose();
});
test('remote photo bytes use authenticated fixed endpoints and never local snapshot capability',async()=>{
 const {createAccountPorts}=await load();assert.equal(typeof createAccountPorts,'function');const calls=[];const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async(url,init)=>{calls.push([url,init]);return response({status:'found',png:btoa('PNG'),fullScene:btoa('FULL'),attemptId:'a'})}});
 assert.equal(p.repository.withSnapshot,undefined);const photo=await p.files.get('x / y');assert.equal(await photo.png.text(),'PNG');assert.match(calls[0][0],/key=x%20%2F%20y/);assert.equal(calls[0][1].headers.Authorization,'Bearer access');p.dispose();
});
test('migration is explicit, preserves supplied original and blocks unresolved visit',async()=>{
 const {createAccountPorts}=await load();assert.equal(typeof createAccountPorts,'function');const calls=[];const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async(url,init)=>{calls.push([url,init]);return response({status:'conflict',reason:'occupied'})}});
 assert.equal(calls.length,0);const raw=JSON.stringify(initialState());assert.equal((await p.migrate('migration',raw)).status,'conflict');assert.equal(JSON.parse(calls[0][1].body).raw,raw);p.dispose();
});
test('network failures are coalesced too; malformed server snapshots never become authorized state',async()=>{
 const {createAccountPorts}=await load();let calls=0;const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async()=>{calls++;return response({status:'ok',state:{revision:0},origin:'empty',persistence:'account'})}});
 for(let i=0;i<100;i++)assert.equal((await p.repository.read()).status,'unavailable');assert.equal(calls,1);p.dispose();
});
test('explicit retry bypasses cached network failure without waiting thirty seconds',async(t)=>{
 const {createAccountPorts}=await load();let online=false;
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async()=>{
  if(!online)throw Error('offline');
  return response({status:'ok',state:initialState(),origin:'empty',persistence:'account'});
 }});t.after(()=>p.dispose());
 assert.equal((await p.repository.read()).status,'unavailable');online=true;
 assert.equal((await p.repository.read({fresh:true})).status,'ok');
 assert.equal((await p.repository.read()).status,'ok');
});
test('account caches never leak across users and retired photo results are rejected',async()=>{
 const {createAccountPorts}=await load();let done;const alice=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async()=>new Promise(r=>done=()=>r(response({status:'found',png:btoa('old')})))});
 const pending=alice.files.get('same-key');alice.dispose();const bob=createAccountPorts({apiBaseUrl:'https://api.test',identity:{...identity,sub:'bob',accessToken:'b'},now:()=>0,fetcher:async()=>response({status:'missing'})});done();assert.equal((await pending).status,'unavailable');assert.equal((await bob.files.get('same-key')).status,'missing');bob.dispose();
});
test('explicit migration rejects unresolved real local visit before sending anything',async()=>{
 const {createAccountPorts}=await load();let calls=0;const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async()=>{calls++;return response({status:'applied'})}});
 const state=initialState();state.observationOwner={sessionId:'guest',epoch:1};state.activeVisit={visitId:'v',yokaiId:'y',itemId:'i',appearedAt:'2026-01-01T00:00:00Z',ownerEpoch:1,state:'VISITING',itemGranted:false,grantSource:null,settledAt:null};
 assert.equal((await p.migrate('id',JSON.stringify(state))).status,'invalid');assert.equal(calls,0);p.dispose();
});

test('a stalled account request times out and a fresh retry succeeds without logging out',async t=>{
 const {createAccountPorts}=await load();t.mock.timers.enable({apis:['setTimeout']});let stalled=true,signal;
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async(_url,init)=>{
  signal=init.signal;
  if(stalled)return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  return response({status:'ok',state:initialState(),origin:'empty',persistence:'account',serverTime:1000});
 }});t.after(()=>p.dispose());
 const request=p.repository.read();t.mock.timers.tick(15000);assert.equal(signal.aborted,true,'a stalled request must release recovery');
 assert.equal((await request).status,'unavailable');stalled=false;assert.equal((await p.repository.read({fresh:true})).status,'ok');
});

test('successful save seeds authoritative display cache without a follow-up GET',async()=>{
 const {createAccountPorts}=await load();const calls=[];let state=initialState();
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async(url,init)=>{
  calls.push(init.method);if(init.method==='POST'){state={...state,revision:1,settings:{...state.settings,sound:true}};return response({status:'applied',state,persistence:'account'});}
  return response({status:'ok',state,origin:'stored',persistence:'account',migration:{migrationId:'kept'}});
 }});
 await p.repository.commit({type:'changeSettings',patch:{sound:true}});const result=await p.repository.read();
 assert.deepEqual(calls,['GET','POST']);assert.equal(result.state.settings.sound,true);assert.equal(result.migration.migrationId,'kept');
 result.state.settings.sound=false;assert.equal((await p.repository.read()).state.settings.sound,true);p.dispose();
});
test('older overlapping save cannot overwrite newer authoritative cache',async()=>{
 const {createAccountPorts}=await load();const pending=[];let gets=0;
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async(_url,init)=>{
  if(init.method==='POST')return new Promise(resolve=>pending.push(resolve));gets++;return response({status:'ok',state:initialState(),origin:'empty',persistence:'account'});
 }});
 const a=p.repository.commit({type:'changeSettings',patch:{sound:true}});await new Promise(setImmediate);
 const b=p.repository.commit({type:'changeSettings',patch:{sound:false}});await new Promise(setImmediate);
 pending[1](response({status:'applied',state:{...initialState(),revision:2},persistence:'account'}));await b;
 pending[0](response({status:'applied',state:{...initialState(),revision:1},persistence:'account'}));await a;
 assert.equal((await p.repository.read()).state.revision,2);assert.equal(gets,2);p.dispose();
});

test('expired cache revalidates revision while explicit fresh read always requests full state',async()=>{
 const {createAccountPorts}=await load();let time=0;const paths=[];const state={...initialState(),revision:4};
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>time,fetcher:async url=>{paths.push(new URL(url).pathname+new URL(url).search);return response(url.includes('?since=')?{status:'unchanged',revision:4,serverTime:time}:{status:'ok',state,origin:'stored',persistence:'account'});}});
 await p.repository.read();time=30001;assert.equal((await p.repository.read()).state.revision,4);assert.equal(paths[1],'/v1/state?since=4');
 await p.repository.read({fresh:true});assert.equal(paths[2],'/v1/state');p.dispose();
});

test('later server revision wins even when its commit started before another commit',async()=>{
 const {createAccountPorts}=await load();let state=initialState(),release;let gets=0;
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async(_url,init)=>{
  const read=()=>response({status:'ok',state,origin:'stored',persistence:'account'});
  if(init.method==='GET'){if(++gets===1)return new Promise(r=>release=()=>r(read()));return read();}
  const {command,expectedRevision}=JSON.parse(init.body);assert.equal(expectedRevision,state.revision);
  state={...state,revision:state.revision+1,settings:{...state.settings,...command.patch}};return response({status:'applied',state,persistence:'account'});
 }});
 const a=p.repository.commit({type:'changeSettings',patch:{sound:true}});await new Promise(setImmediate);
 await p.repository.commit({type:'changeSettings',patch:{sound:false}});release();await a;
 const actual=await p.repository.read();assert.equal(actual.state.revision,2);assert.equal(actual.state.settings.sound,true);p.dispose();
});
test('poll checks another device at next tick even after a recent local save',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const {createAccountPorts}=await load();let time=0,state=initialState(),gets=0;
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>time,fetcher:async(_url,init)=>{
  if(init.method==='POST'){state={...state,revision:state.revision+1};return response({status:'applied',state,persistence:'account'});}
  gets++;return response({status:'ok',state,origin:'stored',persistence:'account'});
 }});const off=p.subscribeChanges(()=>{void p.repository.read();});t.after(()=>{off();p.dispose();});
 await p.repository.read();time=10000;await p.repository.commit({type:'changeSettings',patch:{sound:false}});await new Promise(setImmediate);
 const before=gets;state={...state,revision:2};time=30000;t.mock.timers.tick(30000);await new Promise(setImmediate);
 assert.equal(gets,before+1);assert.equal((await p.repository.read()).state.revision,2);
});

test('old successful response cannot regress cache while a fresh read temporarily clears it',async()=>{
 const {createAccountPorts}=await load();let state=initialState(),oldReply,freshReply,delayFresh=false;
 const p=createAccountPorts({apiBaseUrl:'https://api.test',identity,now:()=>0,fetcher:async(_url,init)=>{
  if(init.method==='GET'){const result={status:'ok',state:structuredClone(state),origin:'stored',persistence:'account'};if(delayFresh){delayFresh=false;return new Promise(r=>freshReply=()=>r(response(result)));}return response(result);}
  const {command,expectedRevision}=JSON.parse(init.body);assert.equal(expectedRevision,state.revision);
  state={...state,revision:state.revision+1,settings:{...state.settings,...command.patch}};const result={status:'applied',state:structuredClone(state),persistence:'account'};
  if(state.revision===1)return new Promise(r=>oldReply=()=>r(response(result)));return response(result);
 }});
 const a=p.repository.commit({type:'changeSettings',patch:{sound:true}});await new Promise(setImmediate);
 await p.repository.commit({type:'changeSettings',patch:{sound:false}});
 delayFresh=true;const fresh=p.repository.read({fresh:true});await new Promise(setImmediate);
 oldReply();await a;freshReply();assert.equal((await fresh).state.revision,2);assert.equal((await p.repository.read()).state.revision,2);p.dispose();
});
