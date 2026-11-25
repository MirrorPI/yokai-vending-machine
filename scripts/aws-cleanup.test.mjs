import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupTargets, ephemeralTemplate } from '../infra/ephemeral.mjs';

test('cleanup refuses every existing or unrelated stack without this exact run ownership', () => {
  const owned={StackName:'yokai-test-abc',Tags:[{Key:'EphemeralRun',Value:'run-1'}],Outputs:[{OutputKey:'SiteBucket',OutputValue:'site'}]};
  assert.deepEqual(cleanupTargets(owned,'run-1','yokai-test-abc'),['site']);
  assert.throws(()=>cleanupTargets(owned,'run-2','yokai-test-abc'),/ownership/);
  assert.throws(()=>cleanupTargets(owned,'run-1','production'),/ownership/);
  assert.throws(()=>cleanupTargets({...owned,Tags:[]},'run-1','yokai-test-abc'),/ownership/);
});
test('ephemeral stack does not retain idle resources and does not alter production template', () => {
  const template={Resources:{Table:{Type:'AWS::DynamoDB::Table',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{DeletionProtectionEnabled:true}},Bucket:{Type:'AWS::S3::Bucket',DeletionPolicy:'Retain',Properties:{}}}};
  const result=ephemeralTemplate(template);
  assert.equal(result.Resources.Table.Properties.DeletionProtectionEnabled,false);
  assert.equal(result.Resources.Table.DeletionPolicy,'Delete');
  assert.equal(result.Resources.Bucket.DeletionPolicy,'Delete');
  assert.equal(template.Resources.Table.DeletionPolicy,'Retain');
  assert.equal(template.Resources.Table.Properties.DeletionProtectionEnabled,true);
});

const ownedStack={StackName:'yokai-test-abc',StackStatus:'CREATE_COMPLETE',Tags:[{Key:'EphemeralRun',Value:'run-1'}],Outputs:[{OutputKey:'SiteBucket',OutputValue:'site'},{OutputKey:'PhotoBucket',OutputValue:'photos'}]};
async function exerciseCleanup(s3,finalStatus='absent') {
  const {cleanupStack}=await import('../infra/ephemeral.mjs');
  const calls=[];let deleted=false;
  const cf={send:async command=>{
    calls.push(command.constructor.name);
    if(command.constructor.name==='DeleteStackCommand'){deleted=true;return {};}
    if(deleted){
      if(finalStatus==='absent')throw Object.assign(new Error('Stack does not exist'),{name:'ValidationError'});
      return {Stacks:[{...ownedStack,StackStatus:finalStatus}]};
    }
    return {Stacks:[ownedStack]};
  }};
  return {promise:cleanupStack({cf,s3,name:ownedStack.StackName,runId:'run-1'}),calls};
}
test('bucket access failure still deletes stack and visits remaining buckets',async()=>{
  const buckets=[];
  const s3={send:async c=>{buckets.push(c.input.Bucket);if(c.input.Bucket==='site')throw new Error('AccessDenied');return {};}};
  const {promise,calls}=await exerciseCleanup(s3);
  const result=await promise;
  assert.equal(result.status,'deleted');assert.deepEqual(buckets,['site','photos']);
  assert.ok(calls.includes('DeleteStackCommand'));assert.equal(result.bucketErrors[0].error,'AccessDenied');
});
test('partial object delete failure does not prevent stack delete and reports remaining stack',async()=>{
  const s3={send:async c=>c.constructor.name==='ListObjectsV2Command'?{Contents:[{Key:'test'}]}:{Errors:[{Key:'test',Code:'AccessDenied'}]}};
  const {promise,calls}=await exerciseCleanup(s3,'DELETE_FAILED');
  await assert.rejects(promise,/deletion failed.*bucket errors/);
  assert.ok(calls.includes('DeleteStackCommand'));
});
test('successful cleanup empties test objects before deleting stack',async()=>{
  const calls=[];const emptied=new Set();
  const s3={send:async c=>{calls.push(c.constructor.name);if(c.constructor.name==='DeleteObjectsCommand'){emptied.add(c.input.Bucket);return {};}
    return emptied.has(c.input.Bucket)?{}:{Contents:[{Key:'test'}]};}};
  const {promise,calls:cfCalls}=await exerciseCleanup(s3);
  assert.equal((await promise).status,'deleted');assert.equal(emptied.size,2);
  assert.equal(calls.filter(x=>x==='DeleteObjectsCommand').length,2);assert.ok(cfCalls.includes('DeleteStackCommand'));
});
test('unexecuted REVIEW_IN_PROGRESS change set can be deleted immediately',async()=>{
 const {cleanupStack}=await import('../infra/ephemeral.mjs');let deleted=false;
 const cf={send:async c=>{
  if(c.constructor.name==='DeleteStackCommand'){deleted=true;return {};}
  if(deleted)throw Object.assign(new Error('Stack does not exist'),{name:'ValidationError'});
  return {Stacks:[{...ownedStack,StackStatus:'REVIEW_IN_PROGRESS',Outputs:[]}]};
 }};
 const result=await cleanupStack({cf,s3:{send:async()=>{throw new Error('No bucket expected');}},name:ownedStack.StackName,runId:'run-1'});
 assert.equal(result.status,'deleted');assert.equal(deleted,true);
});
