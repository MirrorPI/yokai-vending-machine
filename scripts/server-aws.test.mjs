import test from 'node:test';
import assert from 'node:assert/strict';
import { createDynamoAdapter, createS3Objects } from '../server/adapters/aws.mjs';
import { initialState } from '../src/domain/state.ts';

test('Dynamo adapter writes revision CAS and immutable visit evidence in the same transaction',async()=>{
 const requests=[];const client={async send(command){requests.push(command);return {};}};const db=createDynamoAdapter({client,tableName:'test-table'});const s=initialState();s.revision=1;
 assert.equal(await db.commit('alice',0,s,[{key:'START#abc',value:{visitId:'v'},absent:true}]),true);
 const tx=requests.find(r=>r.input.TransactItems).input.TransactItems;assert.equal(tx.length,2);
 assert.match(tx[0].Put.ConditionExpression,/revision/);assert.equal(tx[0].Put.ExpressionAttributeValues[':expected'],0);
 assert.equal(tx[0].Put.Item.revision,1);assert.match(tx[0].Put.Item.PK,/^USER#[a-f0-9]{64}$/);
 assert.equal(tx[1].Put.ConditionExpression,'attribute_not_exists(PK)');assert.equal(tx[1].Put.Item.PK,tx[0].Put.Item.PK);
 await db.read('alice');await db.record('alice','START#abc');assert.equal(requests.at(-2).input.ConsistentRead,true);assert.equal(requests.at(-1).input.ConsistentRead,true);
});
test('Dynamo conditional conflict is recoverable but permission/network errors fail closed',async()=>{
 let name='TransactionCanceledException';const db=createDynamoAdapter({client:{async send(cmd){if(cmd.constructor.name==='GetCommand')return {};const e=new Error('failure');e.name=name;e.CancellationReasons=[{Code:'ConditionalCheckFailed'}];throw e;}},tableName:'test-table'});
 assert.equal(await db.commit('a',0,initialState(),[]),false);name='AccessDeniedException';await assert.rejects(db.commit('a',0,initialState(),[]));
});
test('S3 creation requires absence and retry checks the original immutable bytes',async()=>{
 let saved;const calls=[];const client={async send(cmd){calls.push(cmd);if(cmd.constructor.name==='PutObjectCommand'){if(saved){const e=new Error('exists');e.name='PreconditionFailed';throw e;}saved=Buffer.from(cmd.input.Body);return {};}return {Body:{transformToByteArray:async()=>saved}};}};
 const objects=createS3Objects({client,bucketName:'private'});await objects.put('key',Buffer.from('first'));await objects.put('key',Buffer.from('first'));
 assert.equal(calls[0].input.IfNoneMatch,'*');assert.equal(calls[0].input.ContentType,'application/json');
 await assert.rejects(objects.put('key',Buffer.from('replacement')));assert.equal((await objects.get('key')).toString(),'first');
});
test('interrupted Dynamo restore fences account reads and resumes only the same archive',async()=>{
 let stateItem;let interrupt=true;
 const client={async send(cmd){const input=cmd.input;if(cmd.constructor.name==='GetCommand')return {Item:stateItem};if(cmd.constructor.name==='PutCommand'){stateItem=input.Item;return {};}
 if(cmd.constructor.name==='TransactWriteCommand'){assert.equal(input.TransactItems[0].ConditionCheck.ExpressionAttributeValues[':token'],stateItem.restoring);if(interrupt){interrupt=false;throw new Error('connection lost');}return {};}
 throw new Error('Unexpected SDK request');}};
 const db=createDynamoAdapter({client,tableName:'test'}),state=initialState();state.revision=3;const records=[{key:'START#abc',value:{visitId:'used'}}];
 await assert.rejects(db.restore('alice',state,records));assert.deepEqual(await db.read('alice'),{restoring:true});
 await assert.rejects(db.restore('alice',{...state,revision:4},records));
 await db.restore('alice',state,records);assert.equal((await db.read('alice')).revision,3);
});
test('full backup restore API resumes an interrupted AWS fence and rejects a different archive',async()=>{
 const {restoreAccount}=await import('../server/backup.mjs');const {hash}=await import('../server/common.mjs');let stateItem;let interrupt=true;
 const client={async send(cmd){const input=cmd.input;if(cmd.constructor.name==='GetCommand')return {Item:stateItem};if(cmd.constructor.name==='PutCommand'){stateItem=input.Item;return {};}
 if(cmd.constructor.name==='QueryCommand')return {Items:[]};
 if(cmd.constructor.name==='TransactWriteCommand'){if(interrupt){interrupt=false;throw new Error('lost response');}return {};}
 throw new Error('Unexpected command');}};
 const db=createDynamoAdapter({client,tableName:'test'}),state=initialState();state.revision=2;const data={version:1,state,records:[{key:`START#${'a'.repeat(64)}`,value:{visitId:'v'}}],files:[]};const archive={...data,sha256:hash(data)};
 const input={db,objects:{},subject:'alice',archive};await assert.rejects(restoreAccount(input));
 const different={...data,state:{...state,revision:3}};await assert.rejects(restoreAccount({...input,archive:{...different,sha256:hash(different)}}));
 await restoreAccount(input);assert.equal((await db.read('alice')).revision,2);
});
test('cloud restore rechecks cost authorization before every mutation phase',async()=>{
 let writes=0,checks=0;const client={async send(cmd){if(cmd.constructor.name==='GetCommand')return {};writes++;return {};}};
 const db=createDynamoAdapter({client,tableName:'test',beforeMutation:async()=>{checks++;if(checks>1)throw new Error('Free plan no longer eligible');}});
 await assert.rejects(db.restore('alice',initialState(),[{key:'START#v',value:{}}]));assert.equal(writes,1);assert.equal(checks,2);
 const objects=createS3Objects({client,bucketName:'test',beforeMutation:async()=>{throw new Error('Denied');}});await assert.rejects(objects.put('key',Buffer.from('bytes')));assert.equal(writes,1);
});
