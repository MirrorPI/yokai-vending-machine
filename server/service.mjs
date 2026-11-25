import { applyCommand } from '../src/domain/commands.ts';
import { initialState } from '../src/domain/state.ts';
import { decode } from '../src/storage/codec.ts';
import catalog from '../src/data/generated/asset-catalog.json' with { type: 'json' };
import { boundedState, goodId, hash, key, objectKey } from './common.mjs';
import { validatePng } from './png.mjs';

const ok=body=>({statusCode:200,body});
const fail=(statusCode,error,message)=>({statusCode,body:{error,message}});
const invalid=reason=>ok({status:'invalid',reason});
const unavailable=reason=>ok({status:'unavailable',reason});
const owns=(s,o)=>o&&s.observationOwner?.sessionId===o.sessionId&&s.observationOwner?.epoch===o.epoch;
const getPhoto=(s,r)=>Object.hasOwn(s.discovered,r.yokaiId)?s.discovered[r.yokaiId].photos[r.season]:undefined;
const reservationValid=r=>r&&goodId(r.yokaiId)&&goodId(r.photoKey)&&goodId(r.attemptId)&&['spring','summer','autumn','winter'].includes(r.season);
const present=(p,r)=>p&&p.photoKey===r.photoKey&&p.attemptId===r.attemptId;
const empty=s=>Object.keys(s.items).length===0&&Object.keys(s.discovered).length===0&&!s.activeVisit&&!s.lastSettlement;
const payload=b=>({status:'found',png:b.png,fullScene:b.fullScene,attemptId:b.attemptId});

export function createService({db,objects,now=Date.now,log=event=>console.warn(JSON.stringify(event))}) {
 const report=event=>{try{log(event);}catch{/* Logging must never change a transaction outcome. */}};
 async function load(subject) { const s=await db.read(subject); if(!boundedState(s))throw new Error('Account state is invalid or restoring');return s; }
 async function save(subject,s,next,records=[]) { next.revision=s.revision+1; if(!boundedState(next))return 'invalid'; return await db.commit(subject,s.revision,next,records,s)?'applied':'conflict'; }
 async function command(subject,body) {
  const c=body?.command, expected=body?.expectedRevision;
  if(!c||typeof c!=='object'||Array.isArray(c))return invalid('Command is required');
  if(expected!==undefined&&(!Number.isSafeInteger(expected)||expected<0))return invalid('Invalid expected revision');
  for(let retry=0;retry<5;retry++){
   const s=await load(subject),records=[];
   if(['startVisit','settleVisit','finishVisit'].includes(c.type)&&!owns(s,c.owner))return invalid('Stale observation owner');
   // These permanent receipts precede CAS so a lost response can safely be retried.
   if(c.type==='claimObservation'&&goodId(c.sessionId)&&Number.isSafeInteger(c.expectedEpoch)&&c.expectedEpoch>=0&&s.observationOwner?.sessionId===c.sessionId&&s.observationOwner.epoch===c.expectedEpoch+1)return ok({status:'unchanged',state:s,persistence:'account'});
   if(c.type==='settleVisit'){
    if(!goodId(c.visitId))return invalid('Invalid visit ID');
    const receipt=await db.record(subject,key('SETTLE',c.visitId));
    if(receipt){if(receipt.commandHash!==hash(c))return invalid('Settlement replay differs');const latest=await load(subject);if(!owns(latest,c.owner))return invalid('Stale observation owner');return ok({status:'unchanged',state:latest,persistence:'account'});}
   }
   if(c.type==='startVisit'){
    if(!goodId(c.visit?.visitId))return invalid('Invalid visit ID');
    const receipt=await db.record(subject,key('START',c.visit.visitId));
    if(receipt){if(receipt.commandHash===hash(c)&&s.activeVisit?.visitId===c.visit.visitId&&!s.activeVisit.itemGranted)return ok({status:'unchanged',state:s,persistence:'account'});return invalid('Visit ID was already used');}
   }
   if(c.type==='finishVisit'&&s.activeVisit?.visitId!==c.visitId){
    const receipt=goodId(c.visitId)&&await db.record(subject,key('SETTLE',c.visitId));
    if(receipt)return ok({status:'unchanged',state:s,persistence:'account'});
   }
   if(expected!==undefined&&expected!==s.revision)return ok({status:'conflict',actualRevision:s.revision});
   if(c.type==='startVisit'){
    const v=c.visit,y=catalog.yokai.find(y=>y.id===v.yokaiId),duration=Date.parse(v.captureDeadlineAt)-Date.parse(v.appearedAt);
    const bounds={common:[18000,22000],rare:[13000,17000],legendary:[7000,9000],special:[4000,6000]}[y?.rarity];
    if(!y||!bounds||!y.seasons.includes(v.season)||y.mainItemId!==v.itemId||!catalog.items.some(i=>i.id===v.itemId&&i.ownerYokaiId===y.id)||!['common-json','season-json'].includes(y.definitionStatus))return invalid('Visit catalog invalid');
    // The selected scene stays locked while settings may already target the next
    // background. Validate the scene itself, not the latest preference.
    if(!['forest','hill'].includes(v.backgroundFamily))return invalid('Visit background invalid');
    if(!Number.isFinite(duration)||duration<bounds[0]||duration>=bounds[1])return invalid('Visit duration invalid');
    if(!Number.isFinite(Date.parse(v.appearedAt))||Math.abs(Date.parse(v.appearedAt)-now())>30000)return invalid('Visit start outside server time window');
    records.push({key:key('START',v.visitId),value:{visitId:v.visitId,commandHash:hash(c)},absent:true});
   }
   if(c.type==='settleVisit'){
    const v=s.activeVisit,at=Date.parse(c.at),serverNow=now();
    if(!v||v.visitId!==c.visitId||!Number.isFinite(at)||at<Date.parse(v.appearedAt)||at>serverNow+30000)return invalid('Settlement time or visit invalid');
    if(c.source==='manual'&&(!c.timing||at>=Date.parse(v.captureDeadlineAt)||serverNow-at>30000||Math.abs(c.timing.elapsedMs-(at-Date.parse(v.appearedAt)))>5000||!goodId(c.photo?.photoKey)))return invalid('Manual settlement requires current wall and monotonic evidence');
    const y=catalog.yokai.find(y=>y.id===v.yokaiId),slot=c.photo?.slotSeason??v.season;
    if(c.source==='manual'&&(!y?.seasons.includes(slot)||(y.definitionStatus==='season-json'&&slot!==v.season)))return invalid('Invalid photo season');
    if(c.source==='manual'&&!c.photo?.shared){
      for(const [yid,r] of Object.entries(s.discovered))for(const [season,p] of Object.entries(r.photos))if(p.photoKey===c.photo.photoKey&&(yid!==v.yokaiId||season!==slot))return invalid('Photo key belongs to another slot');
    }
    records.push({key:key('SETTLE',c.visitId),value:{visitId:c.visitId,commandHash:hash(c),source:c.source,at:c.at},absent:true});
   }
   if(c.type==='updatePhotoStatus'){
    if(!reservationValid(c))return invalid('Invalid photo completion');
    const receipt=await db.record(subject,key('PHOTO',c.photoKey));
    if(!receipt||receipt.attemptId!==c.attemptId||receipt.state!==(c.status==='saved'?'saved':'closed'))return invalid('Photo completion has no matching durable evidence');
   }
   const result=applyCommand(s,c);
   if(result.status==='invalid')return invalid(result.reason);
   if(result.status==='unchanged')return ok({status:'unchanged',state:s,persistence:'account'});
   const status=await save(subject,s,result.state,records);
   if(status==='invalid')return invalid('Account state limit exceeded');
   if(status==='applied')return ok({status,state:result.state,persistence:'account'});
  }
  return ok({status:'conflict',actualRevision:(await load(subject)).revision});
 }
 async function photo(subject,action,body){
  const r=body?.reservation;
  if(!reservationValid(r))return unavailable('Invalid photo reservation');
  let encoded;
  for(let retry=0;retry<5;retry++){
   const s=await load(subject),p=getPhoto(s,r);
   if(!present(p,r)||p.status!=='pending')return ok({status:'stale'});
   const sk=key('PHOTO',r.photoKey),fence=await db.record(subject,sk);
   if(fence?.state==='saved'){
    if(fence.attemptId!==r.attemptId)return ok({status:'preserved'});
    if(action==='write'){
     try {validatePng(body.png,96,128);validatePng(body.fullScene,192,256);}catch(e){return unavailable(e.message);}
     if(fence.pngHash!==hash(Buffer.from(body.png,'base64'))||fence.sceneHash!==hash(Buffer.from(body.fullScene,'base64')))return unavailable('Saved photo is immutable');
     return ok({status:'stored'});
    }
    if(action==='reserve')return ok({status:'ready'});
    const raw=await objects.get(fence.objectKey);if(!raw)return unavailable('Saved photo object missing');return ok(payload(JSON.parse(raw.toString())));
   }
   if(fence?.attemptId===r.attemptId&&fence.state==='closed')return ok({status:action==='close'?'missing':'stale'});
   if(action==='write'&&(!fence||fence.attemptId!==r.attemptId||fence.state!=='reserved'))return ok({status:'stale'});
   let record={...r,state:action==='close'?'closed':'reserved'};
   if(action==='write'){
    try {
     if(!encoded){const png=validatePng(body.png,96,128),scene=validatePng(body.fullScene,192,256);encoded={raw:Buffer.from(JSON.stringify({png:body.png,fullScene:body.fullScene,attemptId:r.attemptId})),pngHash:hash(png),sceneHash:hash(scene)};}
     record={...r,state:'saved',objectKey:objectKey(subject,r),pngHash:encoded.pngHash,sceneHash:encoded.sceneHash};
     await objects.put(record.objectKey,encoded.raw);
    }catch(e){return unavailable(e.message);}
   }
   if(action==='reserve'&&fence?.attemptId===r.attemptId&&fence.state==='reserved')return ok({status:'ready'});
   const status=await save(subject,s,structuredClone(s),[{key:sk,value:record}]);
   if(status==='applied')return ok({status:action==='write'?'stored':action==='close'?'missing':'ready'});
   if(status==='invalid')return unavailable('Account state limit exceeded');
  }
  return unavailable('Photo transaction contention; retry');
 }
 async function migrate(subject,body){
  if(!goodId(body?.migrationId)||typeof body?.raw!=='string'||Buffer.byteLength(body.raw)>262144)return invalid('Invalid migration request');
  const decoded=decode(body.raw);
  if(decoded.status!=='ready'||!boundedState(decoded.state))return invalid('Invalid migration state');
  if(decoded.state.activeVisit&&!decoded.state.activeVisit.itemGranted)return invalid('Resolve the active local visit before migration');
  const fingerprint=hash(decoded.state);
  for(let retry=0;retry<5;retry++){
   const s=await load(subject),receipt=await db.record(subject,'MIGRATION');
   if(receipt)return receipt.fingerprint===fingerprint?ok({status:'unchanged',state:s}):ok({status:'conflict',reason:'Account was already migrated'});
   if(!empty(s))return ok({status:'conflict',reason:'Account is not empty'});
   const next=structuredClone(decoded.state);next.observationOwner={sessionId:`migration:${fingerprint.slice(0,48)}`,epoch:(s.observationOwner?.epoch??0)+1};next.activeVisit=null;
   const photoKeys=new Set();
   for(const [yid,r] of Object.entries(next.discovered))for(const [season,p] of Object.entries(r.photos)){
    if(!goodId(yid)||!['spring','summer','autumn','winter'].includes(season)||!goodId(p.photoKey))return invalid('Migration contains unsupported or duplicate photo slots');
    if(p.shared)continue;
    if(photoKeys.has(p.photoKey))return invalid('Migration contains duplicate private photo keys');
    photoKeys.add(p.photoKey);p.status='pending';p.attemptId=`migration:${hash(`${fingerprint}:${yid}:${season}`).slice(0,48)}`;
   }
   const records=[{key:'MIGRATION',value:{migrationId:body.migrationId,fingerprint,revision:s.revision+1},absent:true}];
   if(next.lastSettlement)records.push({key:key('START',next.lastSettlement.visitId),value:{visitId:next.lastSettlement.visitId,migrated:true},absent:true});
   const status=await save(subject,s,next,records);
   if(status==='applied')return ok({status:'applied',state:next});
   if(status==='invalid')return invalid('Migration exceeds account limits');
  }
  return ok({status:'conflict',reason:'Account changed during migration'});
 }
 async function handle({subject,method,path,query={},body,requestId}){
  if(method==='GET'&&path==='/health')return ok({status:'ok'});
  if(!goodId(subject))return fail(401,'unauthorized','Authentication required');
  try {
   if(body!==undefined&&Buffer.byteLength(JSON.stringify(body))>750000)return fail(413,'too_large','Request exceeds limit');
   if(method==='GET'&&path==='/v1/state'){
    if(typeof query.since==='string'&&/^(0|[1-9][0-9]*)$/.test(query.since)&&Number.isSafeInteger(Number(query.since))&&typeof db.version==='function'){
     const revision=await db.version(subject);if(revision===Number(query.since))return ok({status:'unchanged',revision,serverTime:now()});
    }
    let state=await load(subject);const migration=await db.record(subject,'MIGRATION');if(migration?.revision>state.revision)state=await load(subject);return ok({status:'ok',state,serverTime:now(),origin:state.revision===0?'empty':'stored',persistence:'account',...(migration?{migration:{migrationId:migration.migrationId,fingerprint:migration.fingerprint}}:{})});}
   if(method==='POST'&&path==='/v1/commands')return await command(subject,body);
   if(method==='POST'&&path==='/v1/migrate')return await migrate(subject,body);
   if(method==='POST'&&['/v1/photos/reserve','/v1/photos/write','/v1/photos/close'].includes(path))return await photo(subject,path.split('/').at(-1),body);
   if(method==='GET'&&path==='/v1/photos'){
    if(!goodId(query.key))return fail(400,'invalid','Photo key required');
    const s=await load(subject);const p=Object.values(s.discovered).flatMap(r=>Object.values(r.photos)).find(p=>p.photoKey===query.key);
    const fence=p&&await db.record(subject,key('PHOTO',query.key));
    if(!fence||fence.state!=='saved'||fence.attemptId!==p.attemptId)return ok({status:'missing'});
    const raw=await objects.get(fence.objectKey);if(!raw)return unavailable('Saved photo object missing');return ok(payload(JSON.parse(raw.toString())));
   }
   return fail(404,'not_found','Route not found');
  }catch(e){report({event:'account_exception',requestId,account:hash(subject).slice(0,16),errorType:/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(e?.name)?e.name:'Error'});return fail(503,'unavailable','Account storage unavailable; retry safely');}
 }
 return {async handle(input){
  const result=await handle(input),c=input.body?.command;
  if(input.path==='/v1/commands'||result.statusCode>=400||result.body?.status==='unavailable'){
   const known=['claimObservation','startVisit','settleVisit','finishVisit','changeSettings','updatePhotoStatus','markItemViewed','markYokaiViewed'];
   report({event:'account_request',requestId:input.requestId,account:goodId(input.subject)?hash(input.subject).slice(0,16):undefined,
    command:known.includes(c?.type)?c.type:undefined,status:result.body?.status??result.body?.error,httpStatus:result.statusCode,
    reason:result.body?.status==='invalid'?result.body.reason:undefined,
    visit:goodId(c?.visitId??c?.visit?.visitId)?hash(c.visitId??c.visit.visitId).slice(0,16):undefined});
  }
  return result;
 }};
}
