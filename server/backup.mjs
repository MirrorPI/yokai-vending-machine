import { boundedState, hash, objectKey } from './common.mjs';
import { validatePng } from './png.mjs';
/** Consistent metadata snapshot plus immutable objects: later writes cannot alter exported bytes. */
export async function exportAccount({db,objects,subject}) {
 const {state,records}=await db.snapshot(subject);if(!boundedState(state))throw new Error('Invalid backup state');
 const files=[];
 for(const r of records.filter(r=>r.key.startsWith('PHOTO#')&&r.value.state==='saved')){
  const bytes=await objects.get(r.value.objectKey);if(!bytes)throw new Error('Backup object missing');
  files.push({key:r.value.objectKey,bytes:bytes.toString('base64'),sha256:hash(bytes)});
 }
 const contents={version:1,state,records,files};return {...contents,sha256:hash(contents)};
}
/** Administrative operation; never exposed through HTTP. Empty destination only. */
export async function restoreAccount({db,objects,subject,archive}){
 const {sha256,...contents}=archive??{};
 if(contents.version!==1||hash(contents)!==sha256||!boundedState(contents.state)||!Array.isArray(contents.records)||!Array.isArray(contents.files))throw new Error('Invalid backup');
 const existing=await db.snapshot(subject);if(!existing.state.restoring&&(existing.state.revision!==0||existing.records.length))throw new Error('Restore destination is occupied');
 const records=structuredClone(contents.records),keys=new Set();
 for(const r of records){if(typeof r.key!=='string'||keys.has(r.key)||!(/^(START|SETTLE|PHOTO)#[a-f0-9]{64}$/.test(r.key)||r.key==='MIGRATION'))throw new Error('Invalid backup evidence');keys.add(r.key);
  if(r.key.startsWith('PHOTO#')&&r.value.state==='saved'){
   const file=contents.files.find(f=>f.key===r.value.objectKey);if(!file)throw new Error('Missing backup photo');const bytes=Buffer.from(file.bytes,'base64');if(hash(bytes)!==file.sha256)throw new Error('Backup photo checksum mismatch');
   const decoded=JSON.parse(bytes.toString());const png=validatePng(decoded.png,96,128),scene=validatePng(decoded.fullScene,192,256);
   if(hash(png)!==r.value.pngHash||hash(scene)!==r.value.sceneHash||decoded.attemptId!==r.value.attemptId)throw new Error('Backup photo metadata mismatch');
   r.value.objectKey=objectKey(subject,r.value);await objects.put(r.value.objectKey,bytes);
  }
 }
 await db.restore(subject,structuredClone(contents.state),records);
}
