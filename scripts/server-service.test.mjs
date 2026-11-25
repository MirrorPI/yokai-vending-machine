import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createService } from '../server/service.mjs';
import { createSqliteAdapter } from '../server/adapters/sqlite.mjs';
import { createFileObjects } from '../server/adapters/files.mjs';
import { exportAccount, restoreAccount } from '../server/backup.mjs';
import { initialState } from '../src/domain/state.ts';
import { boundedState } from '../server/common.mjs';
import { readFileSync } from 'node:fs';

const NOW = Date.parse('2026-11-15T00:00:00Z');
const iso = n => new Date(NOW + n).toISOString();
const owner = { sessionId: 'tab-a', epoch: 1 };
const visit = id => ({ visitId: id, yokaiId: 'yokai_001', itemId: 'item_001', appearedAt: iso(0), captureDeadlineAt: iso(20_000), dwellMs: 20_000, season: 'spring', backgroundFamily: 'forest' });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'yokai-api-'));
  let db = createSqliteAdapter(join(dir, 'state.sqlite'));
  const objects = createFileObjects(join(dir, 'objects'));
  let service = createService({ db, objects, now: () => NOW + 1000 });
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const api = async (path, body, subject = 'alice', method = body === undefined ? 'GET' : 'POST', query = {}) => service.handle({ subject, method, path, query, body });
  const command = async (command, expectedRevision, subject) => (await api('/v1/commands', { command, expectedRevision }, subject)).body;
  return { dir, objects, api, command, get db() { return db; }, restart() { db.close(); db = createSqliteAdapter(join(dir, 'state.sqlite')); service = createService({ db, objects, now: () => NOW + 1000 }); } };
}
async function claim(f) { assert.equal((await f.command({ type: 'claimObservation', sessionId: 'tab-a', expectedEpoch: 0 })).status, 'applied'); }
async function start(f, id) { return f.command({ type: 'startVisit', owner, visit: visit(id) }); }
const settle = (id, source = 'left') => ({ type: 'settleVisit', owner, visitId: id, source, at: iso(1000), ...(source === 'manual' ? { timing: { appearedAt: iso(0), captureDeadlineAt: iso(20_000), elapsedMs: 1000 }, photo: { photoKey: 'photo-1', slotSeason: 'spring' } } : {}) });
const reservation = { yokaiId: 'yokai_001', season: 'spring', photoKey: 'photo-1', attemptId: 'visit-1' };

test('expanded account crosses photo 120→121→192, reloads, migrates and restores without losing old records',async t=>{
 const f=await fixture(t),catalog=JSON.parse(readFileSync('src/data/generated/asset-catalog.json'));
 const legacy=initialState();legacy.firstRunDone=true;
 for(const y of catalog.yokai.filter(y=>y.no<=60))legacy.discovered[y.id]={firstCapturedAt:iso(0),captureCount:y.seasons.length,firstViewedAt:iso(0),coverSeason:y.seasons[0],photos:Object.fromEntries(y.seasons.map(s=>[s,{photoKey:`old-${y.id}-${s}`,at:iso(0),status:'failed'}]))};
 assert.equal(Object.values(legacy.discovered).reduce((n,r)=>n+Object.keys(r.photos).length,0),120);
 assert.equal((await f.api('/v1/migrate',{migrationId:'expand',raw:JSON.stringify(legacy)})).body.status,'applied');
 const claimed=await f.command({type:'claimObservation',sessionId:'tab-a',expectedEpoch:1});assert.equal(claimed.status,'applied');
 const owner=claimed.state.observationOwner;let count=120;
 for(const y of catalog.yokai.filter(y=>y.no>=61))for(const season of y.seasons){
  const id=`expand-${y.id}-${season}`;
  const dwellMs={common:20000,rare:15000,legendary:8000,special:5000}[y.rarity];
  const v={...visit(id),yokaiId:y.id,itemId:y.mainItemId,season,dwellMs,captureDeadlineAt:iso(dwellMs)};
  assert.equal((await f.command({type:'startVisit',owner,visit:v})).status,'applied');
  const c={...settle(id,'manual'),owner,timing:{appearedAt:iso(0),captureDeadlineAt:iso(dwellMs),elapsedMs:1000},photo:{photoKey:`new-${id}`,slotSeason:season}};
  assert.equal((await f.command(c)).status,'applied',`photo ${++count}`);
  assert.equal((await f.command({type:'finishVisit',owner,visitId:id})).status,'applied');
 }
 assert.equal(count,192);f.restart();const saved=(await f.api('/v1/state')).body.state;
 assert.equal(Object.values(saved.discovered).reduce((n,r)=>n+Object.keys(r.photos).length,0),192);
 for(const y of catalog.yokai.filter(y=>y.no<=60))for(const season of y.seasons)assert.equal(saved.discovered[y.id].photos[season].photoKey,legacy.discovered[y.id].photos[season].photoKey);
 assert.equal((await f.api('/v1/migrate',{migrationId:'full176',raw:JSON.stringify(saved)},'expanded-copy')).body.status,'applied');
 const archive=await exportAccount({db:f.db,objects:f.objects,subject:'alice'});
 await restoreAccount({db:f.db,objects:f.objects,subject:'expanded-restore',archive});
 assert.equal(Object.keys((await f.api('/v1/state',undefined,'expanded-restore')).body.state.discovered).length,102);
});
test('expanded capacity still rejects excessive photo count and oversized snapshots',()=>{
 const s=initialState();s.discovered.legacy={firstCapturedAt:iso(0),captureCount:481,coverSeason:null,photos:Object.fromEntries(Array.from({length:481},(_,i)=>[`legacy-${i}`,{photoKey:`p${i}`,at:iso(0)}]))};
 assert.equal(boundedState(s),false);const large=initialState();large.extension='x'.repeat(262144);assert.equal(boundedState(large),false);
});
function crc(bytes) { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let k = 0; k < 8; k++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; }
function png(w, h, color = 0) { const chunk = (name, bytes) => { const b = Buffer.alloc(bytes.length + 12); b.writeUInt32BE(bytes.length); b.write(name, 4); bytes.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; }; const hdr = Buffer.alloc(13); hdr.writeUInt32BE(w); hdr.writeUInt32BE(h, 4); hdr[8] = 8; hdr[9] = 6; const raw = Buffer.alloc((w * 4 + 1) * h, color); for (let y=0;y<h;y++) raw[y*(w*4+1)]=0; return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR', hdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64'); }
const bytes = () => ({ png: png(96, 128), fullScene: png(192, 256) });
async function pending(f) { await claim(f); await start(f, 'visit-1'); assert.equal((await f.command(settle('visit-1', 'manual'))).status, 'applied'); }

test('trusted authentication and account isolation reject JSON subject substitution', async t => {
 const f=await fixture(t); assert.equal((await f.api('/v1/state', undefined, '')).statusCode,401);
 assert.equal((await f.api('/health', undefined, '')).statusCode,200);
 await f.api('/v1/commands',{subject:'bob',command:{type:'changeSettings',patch:{sound:true}}});
 assert.equal((await f.api('/v1/state',undefined,'bob')).body.state.settings.sound,false);
 assert.equal((await f.api('/v1/state')).body.persistence,'account');
 assert.equal((await f.command({type:'replaceState',state:initialState()})).status,'invalid');
});
test('CAS permits one competing update, invalid start validates catalog and dwell', async t=>{
 const f=await fixture(t); await claim(f);
 const results=await Promise.all([f.command({type:'changeSettings',patch:{sound:true}},1), f.command({type:'changeSettings',patch:{arrivalChime:true}},1)]);
 assert.deepEqual(results.map(x=>x.status).sort(),['applied','conflict']);
 for(const changed of [{itemId:'item_999'},{yokaiId:'unknown'},{dwellMs:1,captureDeadlineAt:iso(1)},{appearedAt:iso(600000),captureDeadlineAt:iso(620000)}]) assert.equal((await f.command({type:'startVisit',owner,visit:{...visit('bad'),...changed}})).status,'invalid');
});
test('permanent visit fences survive later settlements, response loss and actual database reopen',async t=>{
 const f=await fixture(t); await claim(f);
 await start(f,'old'); await f.command(settle('old')); await f.command({type:'finishVisit',owner,visitId:'old'});
 await start(f,'new'); await f.command(settle('new')); await f.command({type:'finishVisit',owner,visitId:'new'});
 f.restart(); assert.equal((await start(f,'old')).status,'invalid');
 assert.equal((await f.command(settle('old'))).status,'unchanged');
 assert.equal((await f.api('/v1/state')).body.state.items.item_001.totalCount,2);
 assert.equal((await f.command({...settle('old'),source:'manual',photo:{photoKey:'evil'}})).status,'invalid');
});
test('new observation owner fences stale starts and settlements',async t=>{
 const f=await fixture(t); await claim(f); await start(f,'visit-1');
 await f.command({type:'claimObservation',sessionId:'tab-b',expectedEpoch:1});
 assert.equal((await f.command(settle('visit-1'))).status,'invalid');
 assert.equal((await f.command({...settle('visit-1'),owner:{sessionId:'tab-b',epoch:2}})).status,'applied');
});
test('manual grant validates monotonic and wall evidence and cannot invent saved files',async t=>{
 const f=await fixture(t); await claim(f); await start(f,'visit-1');
 assert.equal((await f.command({...settle('visit-1','manual'),at:iso(60000)})).status,'invalid');
 assert.equal((await f.command({...settle('visit-1','manual'),timing:{appearedAt:iso(0),captureDeadlineAt:iso(20000),elapsedMs:20000}})).status,'invalid');
 await f.command(settle('visit-1','manual'));
 assert.equal((await f.command({type:'updatePhotoStatus',...reservation,status:'saved'})).status,'invalid');
});
test('photos require pending reservation, dimensions, complete PNG and immutable attempt bytes',async t=>{
 const f=await fixture(t); const write=b=>f.api('/v1/photos/write',{reservation,...b});
 assert.equal((await write(bytes())).body.status,'stale'); await pending(f);
 assert.equal((await write(bytes())).body.status,'stale');
 assert.equal((await f.api('/v1/photos/reserve',{reservation})).body.status,'ready');
 for(const png of ['AAAA', Buffer.alloc(262145).toString('base64'), bytes().png.slice(0,-12), globalThis.Buffer.from('invalid').toString('base64')]) assert.equal((await write({...bytes(),png})).body.status,'unavailable');
 assert.equal((await write({...bytes(),png:png(97,128)})).body.status,'unavailable');
 assert.equal((await write(bytes())).body.status,'stored');
 assert.equal((await write(bytes())).body.status,'stored');
 assert.equal((await write({...bytes(),png:png(96,128,255)})).body.status,'unavailable');
 assert.equal((await f.api('/v1/photos',undefined,'bob','GET',{key:'photo-1'})).body.status,'missing');
 f.restart(); const read=(await f.api('/v1/photos',undefined,'alice','GET',{key:'photo-1'})).body;
 assert.equal(read.status,'found'); assert.equal(read.png,bytes().png);
 const closed=(await f.api('/v1/photos/close',{reservation})).body; assert.equal(closed.status,'found');
 assert.equal((await f.command({type:'updatePhotoStatus',...reservation,status:'saved'})).status,'applied');
});
test('closing a missing photo durably fences a late upload without reverting grant',async t=>{
 const f=await fixture(t); await pending(f); await f.api('/v1/photos/reserve',{reservation});
 assert.equal((await f.api('/v1/photos/close',{reservation})).body.status,'missing');
 f.restart(); assert.equal((await f.api('/v1/photos/write',{reservation,...bytes()})).body.status,'stale');
 assert.equal((await f.command({type:'updatePhotoStatus',...reservation,status:'failed'})).status,'applied');
 assert.equal((await f.api('/v1/state')).body.state.items.item_001.totalCount,1);
});
test('migration is empty-only, fingerprint-idempotent, retains unknown IDs and makes photos pending',async t=>{
 const f=await fixture(t); const state=initialState(); state.firstRunDone=true; state.discovered.unknown={firstCapturedAt:iso(0),captureCount:1,photos:{spring:{photoKey:'old',at:iso(0),status:'saved'}},coverSeason:'spring'};
 const raw=JSON.stringify(state); const input={migrationId:'import-1',raw};
 const a=(await f.api('/v1/migrate',input)).body; assert.equal(a.status,'applied'); assert.equal(a.state.discovered.unknown.photos.spring.status,'pending');
 assert.equal((await f.api('/v1/migrate',input)).body.status,'unchanged');
 assert.equal((await f.api('/v1/migrate',{...input,migrationId:'another'})).body.status,'unchanged');
 assert.equal((await f.api('/v1/migrate',{...input,raw:JSON.stringify(initialState())})).body.status,'conflict');
 assert.equal(JSON.parse(raw).discovered.unknown.photos.spring.status,'saved');
 await f.command({type:'changeSettings',patch:{sound:true}},undefined,'bob');
 await f.command({type:'claimObservation',sessionId:'tab-a',expectedEpoch:0},undefined,'bob');
 assert.equal((await f.api('/v1/migrate',input,'bob')).body.status,'applied');
 await f.command({type:'claimObservation',sessionId:'tab-a',expectedEpoch:0},undefined,'occupied');
 await f.command({type:'startVisit',owner,visit:visit('occupied')},undefined,'occupied');
 await f.command(settle('occupied'),undefined,'occupied');
 assert.equal((await f.api('/v1/migrate',input,'occupied')).body.status,'conflict');
});
test('migration rejects unresolved visit and malformed payload',async t=>{
 const f=await fixture(t); await claim(f); await start(f,'visit-1');
 const active=(await f.api('/v1/state')).body.state;
 assert.equal((await f.api('/v1/migrate',{migrationId:'import',raw:JSON.stringify(active)},'bob')).body.status,'invalid');
 assert.equal((await f.api('/v1/migrate',{migrationId:'import',raw:'{}'},'bob')).body.status,'invalid');
});
test('backup restore retains photos and permanent replay evidence, rejects occupied destination',async t=>{
 const f=await fixture(t); await pending(f); await f.api('/v1/photos/reserve',{reservation}); await f.api('/v1/photos/write',{reservation,...bytes()});
 await f.command({type:'updatePhotoStatus',...reservation,status:'saved'}); await f.command({type:'finishVisit',owner,visitId:'visit-1'});
 const archive=await exportAccount({db:f.db,objects:f.objects,subject:'alice'});
 await restoreAccount({db:f.db,objects:f.objects,subject:'restored',archive});
 const s=(await f.api('/v1/state',undefined,'restored')).body.state; assert.equal(s.items.item_001.totalCount,1);
 assert.equal((await f.api('/v1/photos',undefined,'restored','GET',{key:'photo-1'})).body.png,bytes().png);
 assert.equal((await f.command({type:'startVisit',owner,visit:visit('visit-1')},undefined,'restored')).status,'invalid');
 await assert.rejects(restoreAccount({db:f.db,objects:f.objects,subject:'restored',archive}));
});

test('lost claim response retries without taking a second owner epoch',async t=>{
 const f=await fixture(t);await claim(f);
 const r=await f.command({type:'claimObservation',sessionId:'tab-a',expectedEpoch:0},0);
 assert.equal(r.status,'unchanged');assert.equal(r.state.observationOwner.epoch,1);
});
test('replay racing a concurrent settlement returns the committed state, not the preceding read',async t=>{
 const f=await fixture(t);await claim(f);await start(f,'race');let injected=false;
 const db={...f.db,async record(subject,key){if(!injected&&key.startsWith('SETTLE#')){injected=true;await f.command(settle('race'));}return f.db.record(subject,key);}};
 const service=createService({db,objects:f.objects,now:()=>NOW+1000});
 const r=await service.handle({subject:'alice',method:'POST',path:'/v1/commands',body:{command:settle('race')}});
 assert.equal(r.body.status,'unchanged');assert.equal(r.body.state.items.item_001?.totalCount,1);
});
test('closing during file upload fences late completion and leaves no readable orphan',async t=>{
 const f=await fixture(t);await pending(f);await f.api('/v1/photos/reserve',{reservation});let closed=false;
 const objects={...f.objects,async put(key,bytes){await f.objects.put(key,bytes);if(!closed){closed=true;assert.equal((await f.api('/v1/photos/close',{reservation})).body.status,'missing');}}};
 const service=createService({db:f.db,objects,now:()=>NOW+1000});
 const result=await service.handle({subject:'alice',method:'POST',path:'/v1/photos/write',body:{reservation,...bytes()}});
 assert.equal(result.body.status,'stale');assert.equal((await f.api('/v1/photos',undefined,'alice','GET',{key:'photo-1'})).body.status,'missing');
 assert.equal((await f.api('/v1/state')).body.state.items.item_001.totalCount,1);
});
test('backup detects damaged archives and missing immutable photo objects',async t=>{
 const f=await fixture(t);await pending(f);await f.api('/v1/photos/reserve',{reservation});await f.api('/v1/photos/write',{reservation,...bytes()});
 const archive=await exportAccount({db:f.db,objects:f.objects,subject:'alice'});archive.state.items.item_001.totalCount=99;
 await assert.rejects(restoreAccount({db:f.db,objects:f.objects,subject:'restored',archive}));
 await assert.rejects(exportAccount({db:f.db,objects:{get:async()=>null},subject:'alice'}));
});
test('migration receipt remains available after restart for safe interrupted photo resume',async t=>{
 const f=await fixture(t);const state=initialState();state.firstRunDone=true;const migrated=(await f.api('/v1/migrate',{migrationId:'resume-id',raw:JSON.stringify(state)})).body;
 assert.equal(migrated.status,'applied');f.restart();const read=(await f.api('/v1/state')).body;
 assert.equal(read.migration.migrationId,'resume-id');assert.match(read.migration.fingerprint,/^[a-f0-9]{64}$/);
 assert.equal((await f.api('/v1/state',undefined,'bob')).body.migration,undefined);
});
test('migration revokes prior owner epochs instead of reusing them on next claim',async t=>{
 const f=await fixture(t);await claim(f);const result=(await f.api('/v1/migrate',{migrationId:'fence',raw:JSON.stringify(initialState())})).body;assert.equal(result.status,'applied');
 const epoch=result.state.observationOwner?.epoch??0;await f.command({type:'claimObservation',sessionId:'tab-a',expectedEpoch:epoch});
 assert.equal((await start(f,'stale-after-import')).status,'invalid');
});

test('a prepared old-background visit stays valid when settings change before its start',async t=>{
 const f=await fixture(t);await claim(f);await f.command({type:'changeSettings',patch:{backgroundFamily:'hill'}});
 const r=await start(f,'prepared-forest');assert.equal(r.status,'applied');assert.equal(r.state.activeVisit.backgroundFamily,'forest');assert.equal(r.state.settings.backgroundFamily,'hill');
});
test('rejected commands log safe cause and request correlation without recording payload or tokens',async()=>{
 const logs=[];const s=createService({db:{read:async()=>initialState()},objects:{},log:e=>logs.push(e)});
 const r=await s.handle({subject:'private-user',requestId:'req-123',method:'POST',path:'/v1/commands',body:{accessToken:'secret-token',command:{type:'startVisit',owner:{sessionId:'s',epoch:1},visit:{visitId:'v'}}}});
 assert.equal(r.body.status,'invalid');assert.equal(logs.length,1);assert.equal(logs[0].requestId,'req-123');assert.equal(logs[0].reason,'Stale observation owner');assert.equal(logs[0].command,'startVisit');
 assert.doesNotMatch(JSON.stringify(logs),/private-user|secret-token|accessToken/);
});

test('shared capture stores metadata only, survives restart/migration/backup and remains account isolated',async t=>{
 const f=await fixture(t);await claim(f);await start(f,'shared-1');
 const c=settle('shared-1','manual');c.photo={...c.photo,shared:true,sceneSeason:'spring',capturedGameSeason:'spring'};
 const applied=await f.command(c);assert.equal(applied.status,'applied');
 const p=applied.state.discovered.yokai_001.placePhotos['spring:forest'];
 assert.equal(p.status,'saved');assert.equal(p.photoKey,'shared-v1:yokai_001:spring:forest');
 assert.equal((await f.command(c)).status,'unchanged');
 assert.equal((await f.api('/v1/state',undefined,'bob')).body.state.discovered.yokai_001,undefined);
 const snapshot=await f.db.snapshot('alice');assert.equal(snapshot.records.filter(r=>r.key.startsWith('PHOTO#')).length,0);
 f.restart();const saved=(await f.api('/v1/state')).body.state;
 assert.equal(saved.discovered.yokai_001.placePhotos['spring:forest'].captureCount,1);
 const migrated=await f.api('/v1/migrate',{migrationId:'shared-migration',raw:JSON.stringify(saved)},'shared-copy');
 assert.equal(migrated.body.status,'applied');assert.deepEqual(migrated.body.state.discovered,saved.discovered);
 const archive=await exportAccount({db:f.db,objects:f.objects,subject:'alice'});assert.equal(archive.files.length,0);
 await restoreAccount({db:f.db,objects:f.objects,subject:'shared-restore',archive});
 assert.deepEqual((await f.api('/v1/state',undefined,'shared-restore')).body.state.discovered,saved.discovered);
});

test('migration accepts two season aliases of one shared scene after a season boundary',async t=>{
 const f=await fixture(t);await claim(f);
 await f.command({type:'startVisit',owner,visit:{...visit('boundary-first'),season:'winter'}});
 const c=settle('boundary-first','manual');c.photo={photoKey:'ignored',slotSeason:'spring',sceneSeason:'winter',shared:true};
 assert.equal((await f.command(c)).status,'applied');
 await f.command({type:'finishVisit',owner,visitId:'boundary-first'});
 await f.command({type:'startVisit',owner,visit:{...visit('boundary-second'),season:'winter'}});
 const c2=settle('boundary-second','manual');c2.photo={photoKey:'ignored',slotSeason:'winter',sceneSeason:'winter',shared:true};
 const state=(await f.command(c2)).state;assert.equal(state.discovered.yokai_001.photos.spring.photoKey,state.discovered.yokai_001.photos.winter.photoKey);
 const migrated=await f.api('/v1/migrate',{migrationId:'shared-boundary',raw:JSON.stringify(state)},'boundary-copy');
 assert.equal(migrated.body.status,'applied');assert.deepEqual(migrated.body.state.discovered,state.discovered);
});

test('unchanged revision checks skip full-state reads, while legacy clients still receive state',async()=>{
 const {createService}=await import('../server/service.mjs');let reads=0,versions=0;
 const s=initialState();s.revision=3;
 const api=createService({db:{version:async()=>{versions++;return 3;},read:async()=>{reads++;return s;},record:async()=>null},objects:{},now:()=>100});
 const same=await api.handle({subject:'a',method:'GET',path:'/v1/state',query:{since:'3'}});
 assert.deepEqual(same.body,{status:'unchanged',revision:3,serverTime:100});assert.equal(reads,0);assert.equal(versions,1);
 const changed=await api.handle({subject:'a',method:'GET',path:'/v1/state',query:{since:'2'}});assert.equal(changed.body.state.revision,3);
 const legacy=await api.handle({subject:'a',method:'GET',path:'/v1/state'});assert.equal(legacy.body.state.revision,3);assert.equal(reads,2);
});

test('new cutscene is saved per account and survives server restart',async t=>{
 const f=await fixture(t);
 await f.command({type:'changeSettings',patch:{},firstRunDone:true});
 assert.equal((await f.api('/v1/state')).body.state.viewedCutscenes,undefined);
 const saved=await f.command({type:'changeSettings',patch:{},viewedCutscenes:['forest-intro-v2']});
 assert.equal(saved.status,'applied');
 f.restart();
 assert.equal((await f.api('/v1/state')).body.state.viewedCutscenes['forest-intro-v2'],true);
 assert.equal((await f.api('/v1/state',undefined,'bob')).body.state.viewedCutscenes,undefined);
 assert.equal((await f.command({type:'changeSettings',patch:{},viewedCutscenes:['forest-intro-v2']})).status,'unchanged');
 assert.equal((await f.command({type:'changeSettings',patch:{},viewedCutscenes:['__proto__']})).status,'invalid');
});
