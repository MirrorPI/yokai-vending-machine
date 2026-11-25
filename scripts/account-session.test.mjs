import test from 'node:test';import assert from 'node:assert/strict';
import {initialState} from '../src/domain/state.ts';
const load=()=>import('../src/account/session.ts').catch(()=>({}));
const config={apiBaseUrl:'https://api.test'};
const identity={sub:'alice',accessToken:'a',expiresAt:Date.now()+3600000};
test('account entry stops guest first; empty account waits for explicit choice; logout retires old ports',async()=>{
 const {AccountSession}=await load();assert.equal(typeof AccountSession,'function');const events=[];
 const session=new AccountSession(config,{fetcher:async()=>{events.push('read');return new Response(JSON.stringify({status:'ok',state:initialState(),origin:'empty',persistence:'account'}));}});
 session.registerStop(async()=>events.push('stop'));
 await session.connect(identity);assert.deepEqual(events,['stop','read']);assert.equal(session.snapshot.phase,'choose');session.continueAccount();assert.equal(session.snapshot.phase,'account');const old=session.snapshot.ports;await session.logout();assert.equal(session.snapshot.phase,'guest');assert.equal((await old.repository.read()).status,'unavailable');
});
test('account switch cannot accept late previous login and leaves guest bytes unchanged',async()=>{
 const {AccountSession}=await load();assert.equal(typeof AccountSession,'function');let finish;const raw=JSON.stringify(initialState());let source=raw;
 const session=new AccountSession(config,{readGuest:()=>source,fetcher:async()=>new Promise(r=>finish=()=>r(new Response(JSON.stringify({status:'ok',state:initialState(),origin:'empty',persistence:'account'}))))});
 const connecting=session.connect(identity);await new Promise(r=>setImmediate(r));await session.logout();finish();await connecting;assert.equal(session.snapshot.phase,'guest');assert.equal(source,raw);
});
test('expired account must never mount even if server read was started while valid',async()=>{
 const {AccountSession}=await load();const session=new AccountSession(config,{fetcher:async()=>new Response(JSON.stringify({status:'ok',state:initialState(),origin:'empty',persistence:'account'}))});
 await session.connect({...identity,expiresAt:Date.now()-1});assert.equal(session.snapshot.phase,'error');assert.equal(session.snapshot.ports,null);session.dispose();
});
test('account observation lifetime lock is isolated from guest and other accounts',async()=>{
 const {ObservationSession}=await import('../src/observation/session.ts');let requested;
 const session=new ObservationSession({repository:{},sessionId:'tab',lockName:'account:alice',observable:()=>true,locks:{request:async(name,options,work)=>{requested=name;return work(null);}}});
 await session.start();assert.equal(requested,'account:alice');await session.stop();
});
test('fresh login resumes pending imported photos before ordinary runtime can close them',async(t)=>{
 const {AccountSession}=await load();const state=initialState();state.discovered={yokai_001:{captureCount:1,firstCapturedAt:'2026-01-01T00:00:00Z',coverSeason:'winter',photos:{winter:{photoKey:'yokai_001_winter',at:'2026-01-01T00:00:00Z',status:'pending',attemptId:'migration:abc'}}}};
 const session=new AccountSession(config,{fetcher:async()=>new Response(JSON.stringify({status:'ok',state,origin:'stored',persistence:'account',migration:{migrationId:'local-original',fingerprint:'fingerprint'}}))});
 t.after(()=>session.dispose());await session.connect(identity);assert.equal(session.snapshot.phase,'choose');assert.equal(session.snapshot.resumable,true);
});
test('ordinary account reconciliation preserves pending migration attempts for explicit resume',async()=>{
 const {PhotoJobs}=await import('../src/capture/execution.ts');const state=initialState();state.discovered={yokai_001:{captureCount:1,firstCapturedAt:'2026-01-01T00:00:00Z',coverSeason:'winter',photos:{winter:{photoKey:'key',at:'2026-01-01T00:00:00Z',status:'pending',attemptId:'migration:abc'}}}};let closed=0;
 const jobs=new PhotoJobs({repository:{read:async()=>({status:'ok',state})},files:{closePending:async()=>{closed++;return {status:'missing'}}},encode:()=>{},reconcilePhoto:r=>!r.attemptId.startsWith('migration:')});
 await jobs.reconcilePending();assert.equal(closed,0);
});
test('resumed photo import uses durable slots after guest advances without re-importing counters',async(t)=>{
 const {AccountSession}=await load();const state=initialState();state.revision=5;state.discovered={yokai_001:{captureCount:1,firstCapturedAt:'2026-01-01T00:00:00Z',coverSeason:'winter',photos:{winter:{photoKey:'yokai_001_winter',at:'2026-01-01T00:00:00Z',status:'pending',attemptId:'migration:abc'}}}};
 const guest=structuredClone(state);guest.revision=99;guest.discovered.yokai_001.captureCount=8;guest.discovered.yokai_001.photos.winter.status='saved';guest.discovered.yokai_001.photos.winter.attemptId='original-local-visit';let uploads=0,migrations=0;
 const session=new AccountSession(config,{readGuest:()=>JSON.stringify(guest),guestFiles:{get:async()=>({status:'found',png:new Blob(['thumbnail'],{type:'image/png'}),fullScene:new Blob(['fullscene'],{type:'image/png'})})},fetcher:async(url,init)=>{
  const body=init?.body?JSON.parse(init.body):null;
  if(url.endsWith('/v1/migrate')){migrations++;return new Response(JSON.stringify({status:'conflict'}));}
  if(url.endsWith('/photos/reserve'))return new Response(JSON.stringify({status:'ready'}));
  if(url.endsWith('/photos/write')){uploads++;assert.equal(atob(body.png),'thumbnail');return new Response(JSON.stringify({status:'stored'}));}
  if(url.endsWith('/v1/commands')){assert.equal(body.command.type,'updatePhotoStatus');state.discovered.yokai_001.photos.winter.status='saved';state.revision++;return new Response(JSON.stringify({status:'applied',state,persistence:'account'}));}
  return new Response(JSON.stringify({status:'ok',state,origin:'stored',persistence:'account',migration:{migrationId:'local-original',fingerprint:'fingerprint'}}));
 }});t.after(()=>session.dispose());await session.connect(identity);await session.importGuest();assert.equal(uploads,1);assert.equal(migrations,0);assert.equal(state.discovered.yokai_001.captureCount,1);assert.equal(guest.discovered.yokai_001.captureCount,8);assert.equal(session.snapshot.resumable,false);
});
test('delayed import-screen stop cannot resurrect retired account after logout',async(t)=>{
 const {AccountSession}=await load();const session=new AccountSession(config,{fetcher:async()=>new Response(JSON.stringify({status:'ok',state:initialState(),origin:'empty',persistence:'account'}))});t.after(()=>session.dispose());
 await session.connect(identity);session.continueAccount();let release,calls=0;session.registerStop(()=>++calls===1?new Promise(r=>release=r):Promise.resolve());
 const opening=session.openImport();await session.logout();assert.equal(session.snapshot.phase,'guest');release();await opening;assert.equal(session.snapshot.phase,'guest');session.continueAccount();assert.equal(session.snapshot.phase,'guest');assert.equal(session.snapshot.ports,null);
});
test('expiry during delayed import-screen stop cannot revive account with absent ports',async(t)=>{
 const {AccountSession}=await load();const session=new AccountSession(config,{fetcher:async()=>new Response(JSON.stringify({status:'ok',state:initialState(),origin:'empty',persistence:'account'}))});t.after(()=>session.dispose());
 await session.connect({...identity,expiresAt:Date.now()+150});session.continueAccount();let release;session.registerStop(()=>new Promise(r=>release=r));const opening=session.openImport();
 await new Promise(r=>setTimeout(r,180));assert.equal(session.snapshot.phase,'error');assert.equal(session.snapshot.ports,null);release();await opening;session.continueAccount();assert.equal(session.snapshot.phase,'error');assert.equal(session.snapshot.ports,null);
});
