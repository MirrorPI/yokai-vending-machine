import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { initialState } from '../../src/domain/state.ts';
import { hash } from '../common.mjs';
import { LAYOUT, splitState, joinState } from './state-layout.mjs';
const pk=subject=>`USER#${hash(subject)}`;
const conditional=e=>e.name==='ConditionalCheckFailedException'||(e.name==='TransactionCanceledException'&&e.CancellationReasons?.some(r=>['ConditionalCheckFailed','TransactionConflict'].includes(r.Code)));
export function createDynamoAdapter({client,tableName,beforeMutation=async()=>{},compactWrites=false}) {
 const get=async(subject,SK)=>(await client.send(new GetCommand({TableName:tableName,Key:{PK:pk(subject),SK},ConsistentRead:true}))).Item;
 const query=async(subject,prefix)=>{const rows=[];let cursor;do{
  const page=await client.send(new QueryCommand({TableName:tableName,KeyConditionExpression:'PK = :pk'+(prefix?' AND begins_with(SK, :prefix)':''),ExpressionAttributeValues:{':pk':pk(subject),...(prefix?{':prefix':prefix}:{})},ConsistentRead:true,ExclusiveStartKey:cursor}));rows.push(...(page.Items??[]));cursor=page.LastEvaluatedKey;
 }while(cursor);return rows;};
 const adapter={
  async version(subject){const root=await get(subject,'STATE');if(root?.restoring)throw new Error('Account restoring');return root?.revision??0;},
  async read(subject){
   for(let retry=0;retry<4;retry++){
    const root=await get(subject,'STATE');if(!root)return initialState();if(root.restoring)return {restoring:true};
    if(root.layout===undefined)return root.state;
    const rows=await query(subject,'DATA#');
    try{return joinState(root,rows);}catch(error){const latest=await get(subject,'STATE');if(latest?.revision===root.revision)throw error;}
   }throw new Error('Account changed during read; retry');
  },
  async record(subject,sk){return (await get(subject,sk))?.value;},
  async commit(subject,expectedRevision,state,records=[],previousState){
   const root=await get(subject,'STATE');
   if(root?.restoring||(root?.revision??0)!==expectedRevision)return false;
   const statePut={TableName:tableName,Item:{PK:pk(subject),SK:'STATE',revision:state.revision,state},ConditionExpression:expectedRevision===0?'attribute_not_exists(PK) OR revision = :expected':'revision = :expected',ExpressionAttributeValues:{':expected':expectedRevision}};
   const TransactItems=[{Put:statePut},...records.map(r=>({Put:{TableName:tableName,Item:{PK:pk(subject),SK:r.key,value:r.value},...(r.absent?{ConditionExpression:'attribute_not_exists(PK)'}:{})}}))];
   if((compactWrites&&Buffer.byteLength(JSON.stringify(state))>=16384)||root?.layout){
    if(root?.layout&&root.layout!==LAYOUT)throw new Error('Unsupported storage layout');
    const next=splitState(state);
    // An old, layout-unaware server must fail validation rather than read an empty account.
    statePut.Item={PK:pk(subject),SK:'STATE',revision:state.revision,layout:LAYOUT,core:next.core,manifest:next.manifest,state:{version:0}};
    if(root&&!root.layout){
     if(previousState&&hash(previousState)!==hash(root.state))return false;
     TransactItems.push({Put:{TableName:tableName,Item:{PK:pk(subject),SK:'ORIGINAL#STATE',value:root.state},ConditionExpression:'attribute_not_exists(PK)'}});
    }
    for(const [sk,value] of Object.entries(next.parts))if(root?.manifest?.[sk]!==next.manifest[sk])TransactItems.push({Put:{TableName:tableName,Item:{PK:pk(subject),SK:sk,value}}});
   }
   try{await beforeMutation();await client.send(new TransactWriteCommand({TransactItems}));return true;}catch(e){if(conditional(e))return false;throw e;}
  },
  async snapshot(subject){
   for(let retry=0;retry<4;retry++){
    const before=await get(subject,'STATE');if(before?.restoring)return {state:{restoring:true},records:[]};
    const rows=await query(subject);
    const after=await get(subject,'STATE');
    if(!after?.restoring&&(before?.revision??0)===(after?.revision??0))return {state:joinState(after,rows)??initialState(),records:rows.filter(item=>item.SK!=='STATE'&&!item.SK.startsWith('DATA#')&&item.SK!=='ORIGINAL#STATE').map(item=>({key:item.SK,value:item.value}))};
   }
   throw new Error('Account changed during backup; retry while account is idle');
  },
  /** Admin-only staged restore. API reads fail closed until final STATE commit.
   * Same archive can resume after interruption; a different archive cannot claim the fence. */
  async restore(subject,state,records){
   const token=hash({state,records}),current=await get(subject,'STATE');
   if(current&&current.restoring!==token)throw new Error('Restore destination is occupied');
   if(!current){await beforeMutation();await client.send(new PutCommand({TableName:tableName,Item:{PK:pk(subject),SK:'STATE',revision:-1,restoring:token},ConditionExpression:'attribute_not_exists(PK)'}));}
   for(let at=0;at<records.length;at+=90){const entries=records.slice(at,at+90);await beforeMutation();await client.send(new TransactWriteCommand({TransactItems:[{ConditionCheck:{TableName:tableName,Key:{PK:pk(subject),SK:'STATE'},ConditionExpression:'restoring = :token',ExpressionAttributeValues:{':token':token}}},...entries.map(r=>({Put:{TableName:tableName,Item:{PK:pk(subject),SK:r.key,value:r.value}}}))]}));}
   await beforeMutation();await client.send(new PutCommand({TableName:tableName,Item:{PK:pk(subject),SK:'STATE',revision:state.revision,state},ConditionExpression:'restoring = :token',ExpressionAttributeValues:{':token':token}}));
  },
 };
 return adapter;
}
export function createS3Objects({client,bucketName,beforeMutation=async()=>{}}){
 const objects={
  async get(key){try{const r=await client.send(new GetObjectCommand({Bucket:bucketName,Key:key}));return Buffer.from(await r.Body.transformToByteArray());}catch(e){if(e.name==='NoSuchKey'||e.$metadata?.httpStatusCode===404)return null;throw e;}},
  async put(key,bytes){try{await beforeMutation();await client.send(new PutObjectCommand({Bucket:bucketName,Key:key,Body:bytes,ContentType:'application/json',IfNoneMatch:'*',ChecksumSHA256:Buffer.from(hash(bytes),'hex').toString('base64')}));}catch(e){if(e.name!=='PreconditionFailed'&&e.$metadata?.httpStatusCode!==412)throw e;const existing=await objects.get(key);if(!existing?.equals(bytes))throw new Error('Immutable photo differs');}},
 };return objects;
}
export function createAwsAdapters(env=process.env,{beforeMutation}={}){
 if(!env.ACCOUNT_TABLE||!env.ACCOUNT_PHOTO_BUCKET)throw new Error('Account AWS configuration missing');
 const dynamo=new DynamoDBClient({maxAttempts:2});const s3=new S3Client({maxAttempts:2});
 return {db:createDynamoAdapter({client:DynamoDBDocumentClient.from(dynamo,{marshallOptions:{removeUndefinedValues:true}}),tableName:env.ACCOUNT_TABLE,beforeMutation,compactWrites:env.ACCOUNT_COMPACT_WRITES==='1'}),objects:createS3Objects({client:s3,bucketName:env.ACCOUNT_PHOTO_BUCKET,beforeMutation})};
}
