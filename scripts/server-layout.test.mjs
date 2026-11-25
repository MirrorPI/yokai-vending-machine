import test from 'node:test';import assert from 'node:assert/strict';
import {createDynamoAdapter} from '../server/adapters/aws.mjs';
import {initialState,emptyItem} from '../src/domain/state.ts';
import {hash} from '../server/common.mjs';
import {exportAccount,restoreAccount} from '../server/backup.mjs';
import {dynamoMemory} from './helpers/dynamo-memory.mjs';
const pk='USER#'+hash('alice');
function fixture(){const s=initialState();s.revision=7;s.extension={keep:['unknown']};
 for(let i=1;i<=68;i++){const id=String(i).padStart(3,'0');s.items['item_'+id]={...emptyItem(),totalCount:1,leftCount:1,unreadCount:1,unreadLeftCount:1,firstObtainedAt:'2026-11-16T00:00:00Z',lastObtainedAt:'2026-11-16T00:00:00Z'};s.discovered['yokai_'+id]={firstCapturedAt:'2026-11-16T00:00:00Z',captureCount:1,coverSeason:'spring',photos:{spring:{photoKey:'old-'+id,at:'2026-11-16T00:00:00Z',extra:{keep:true}}},unknown:'preserve'};}return s;}
function setup(){const m=dynamoMemory();const original=fixture();m.put({PK:pk,SK:'STATE',revision:7,state:original});const db=createDynamoAdapter({client:m.client,tableName:'table',compactWrites:true});return {m,db,original};}
test('legacy state upgrades atomically, preserves original and all unknown fields; flag-off reader remains compatible',async()=>{
 const {m,db,original}=setup();const next={...structuredClone(original),revision:8};next.settings.sound=true;
 assert.equal(await db.commit('alice',7,next,[],original),true);
 const root=[...m.rows.values()].find(r=>r.SK==='STATE');assert.equal(root.layout,'shards-v1');assert.ok(!root.state?.discovered);
 assert.deepEqual([...m.rows.values()].find(r=>r.SK==='ORIGINAL#STATE').value,original);
 const tx=m.calls.find(c=>c.constructor.name==='TransactWriteCommand');assert.ok(tx.input.TransactItems.length<=35);
 assert.deepEqual(await db.read('alice'),next);
 const compat=createDynamoAdapter({client:m.client,tableName:'table'});assert.deepEqual(await compat.read('alice'),next);
 const later={...next,revision:9};later.settings.sound=false;assert.equal(await compat.commit('alice',8,later,[],next),true);assert.deepEqual(await db.read('alice'),later);
});
test('one item edit rewrites only its shard plus core; stale writer cannot regress data',async()=>{
 const {m,db,original}=setup();const a={...original,revision:8};await db.commit('alice',7,a,[],original);m.calls.length=0;
 const b=structuredClone(a);b.revision=9;b.items.item_001.totalCount++;b.items.item_001.leftCount++;b.items.item_001.unreadCount++;b.items.item_001.unreadLeftCount++;
 assert.equal(await db.commit('alice',8,b,[],a),true);const tx=m.calls.find(c=>c.constructor.name==='TransactWriteCommand');assert.equal(tx.input.TransactItems.length,2);
 assert.equal(await db.commit('alice',8,{...a,revision:9},[],a),false);assert.deepEqual(await db.read('alice'),b);
});
test('failed atomic migration preserves original live state; retry after lost success does not duplicate',async()=>{
 const {m,db,original}=setup();m.beforeSend=cmd=>{if(cmd.constructor.name==='TransactWriteCommand')throw Error('offline');};
 await assert.rejects(db.commit('alice',7,{...original,revision:8},[],original));assert.deepEqual(await db.read('alice'),original);assert.equal(m.rows.size,1);
 m.beforeSend=null;assert.equal(await db.commit('alice',7,{...original,revision:8},[],original),true);assert.equal(await db.commit('alice',7,{...original,revision:8},[],original),false);
});
test('missing or corrupt shard fails closed and compact backup restores all logical state',async()=>{
 const {m,db,original}=setup();const next={...original,revision:8};await db.commit('alice',7,next,[{key:'START#'+hash('v'),value:{visitId:'v'},absent:true}],original);
 const archive=await exportAccount({db,objects:{},subject:'alice'});assert.deepEqual(archive.state,next);assert.equal(archive.records.length,1);
 const target=dynamoMemory();const restored=createDynamoAdapter({client:target.client,tableName:'target',compactWrites:true});await restoreAccount({db:restored,objects:{},subject:'bob',archive});assert.deepEqual(await restored.read('bob'),next);
 const shard=[...m.rows.values()].find(r=>r.SK.startsWith('DATA#'));assert.ok(shard);m.rows.delete(JSON.stringify([shard.PK,shard.SK]));await assert.rejects(db.read('alice'));
});

test('small accounts stay in legacy layout until collection growth makes splitting worthwhile',async()=>{
 const m=dynamoMemory(),db=createDynamoAdapter({client:m.client,tableName:'table',compactWrites:true});const next={...initialState(),revision:1};
 assert.equal(await db.commit('new-user',0,next,[],initialState()),true);assert.equal([...m.rows.values()][0].layout,undefined);assert.deepEqual(await db.read('new-user'),next);
});
test('a shard read racing a save retries instead of returning mixed revisions',async()=>{
 const {m,db,original}=setup();const next={...original,revision:8};await db.commit('alice',7,next,[],original);
 const newer=structuredClone(next);newer.revision=9;newer.items.item_001.lastObtainedAt='2026-11-16T00:01:00Z';
 let once=true;m.beforeSend=async cmd=>{if(once&&cmd.constructor.name==='QueryCommand'){once=false;await db.commit('alice',8,newer,[],next);}};
 assert.deepEqual(await db.read('alice'),newer);
});
test('legacy writer that read before migration cannot replace compact state',async()=>{
 const {m,db,original}=setup();const next={...original,revision:8};await db.commit('alice',7,next,[],original);
 const oldPut={TableName:'table',Item:{PK:pk,SK:'STATE',revision:8,state:original},ConditionExpression:'revision = :expected',ExpressionAttributeValues:{':expected':7}};
 const {TransactWriteCommand}=await import('@aws-sdk/lib-dynamodb');await assert.rejects(m.client.send(new TransactWriteCommand({TransactItems:[{Put:oldPut}]})));
 assert.deepEqual(await db.read('alice'),next);
});

test('capture, reconnect, receipt replay and private-photo access survive compact conversion',async()=>{
 const {createService}=await import('../server/service.mjs');
 const {m,db,original}=setup();const at='2026-11-16T00:00:00Z',later='2026-11-16T00:00:01Z';
 const privateBytes=Buffer.from(JSON.stringify({png:'cG5n',fullScene:'ZnVsbA==',attemptId:'old-attempt'}));
 original.discovered.yokai_001.photos.spring.attemptId='old-attempt';
 m.put({PK:pk,SK:'STATE',revision:7,state:original});m.put({PK:pk,SK:'PHOTO#'+hash('old-001'),value:{state:'saved',attemptId:'old-attempt',objectKey:'preserved-original'}});
 const objects={get:async key=>{assert.equal(key,'preserved-original');return privateBytes;}};
 let service=createService({db,objects,now:()=>Date.parse(later),log:()=>{}});
 const command=async c=>(await service.handle({subject:'alice',method:'POST',path:'/v1/commands',body:{command:c}})).body;
 assert.equal((await command({type:'claimObservation',sessionId:'a',expectedEpoch:0})).status,'applied');
 const owner={sessionId:'a',epoch:1},visit={visitId:'capture-v',yokaiId:'yokai_001',itemId:'item_001',appearedAt:at,captureDeadlineAt:'2026-11-16T00:00:20Z',dwellMs:20000,season:'spring',backgroundFamily:'forest'};
 assert.equal((await command({type:'startVisit',owner,visit})).status,'applied');
 const settle={type:'settleVisit',owner,visitId:visit.visitId,source:'manual',at:later,timing:{appearedAt:at,captureDeadlineAt:visit.captureDeadlineAt,elapsedMs:1000},photo:{shared:true,photoKey:'shared',slotSeason:'spring',sceneSeason:'spring',capturedGameSeason:'spring'}};
 const first=await command(settle);assert.equal(first.status,'applied');assert.equal(first.state.items.item_001.totalCount,2);
 // Simulated restart/lost response: reread persistent rows, not process memory.
 service=createService({db:createDynamoAdapter({client:m.client,tableName:'table'}),objects,now:()=>Date.parse(later),log:()=>{}});
 assert.equal((await command(settle)).status,'unchanged');assert.equal((await command({type:'finishVisit',owner,visitId:visit.visitId})).status,'applied');
 const final=await db.read('alice');assert.equal(final.items.item_001.totalCount,2);assert.equal(final.discovered.yokai_001.placePhotos['spring:forest'].shared,true);assert.equal(final.discovered.yokai_001.photos.spring.photoKey,'old-001');assert.equal(final.activeVisit,null);
 const oldPhoto=await service.handle({subject:'alice',method:'GET',path:'/v1/photos',query:{key:'old-001'}});assert.equal(oldPhoto.body.png,'cG5n');
});
