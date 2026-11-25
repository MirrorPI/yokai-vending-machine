import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function normalizeAccessCode(value) {
 if(typeof value!=='string'||value.length>64)throw new Error('Invalid access code');
 const code=value.trim().toUpperCase().replace(/[\s-]/g,'');
 if(!/^YKV[A-F0-9]{24}$/.test(code))throw new Error('Invalid access code');
 return code;
}
const digest=code=>createHash('sha256').update(normalizeAccessCode(code)).digest();
/** Exactly 15 high-entropy reusable credentials, never included in web assets. */
export function generateAccessCodes(){
 const codes=Array.from({length:15},(_,i)=>({subject:`beta-${String(i+1).padStart(2,'0')}`,code:'YKV-'+randomBytes(12).toString('hex').toUpperCase().match(/.{6}/g).join('-')}));
 return {codes,config:codes.map(({subject,code})=>({subject,sha256:digest(code).toString('hex')}))};
}
export function createCodeVerifier(config){
 if(!Array.isArray(config)||config.length!==15||config.some(r=>!r||typeof r.subject!=='string'||!/^beta-(0[1-9]|1[0-5])$/.test(r.subject)||!/^([a-f0-9]{64})$/.test(r.sha256??''))
  ||new Set(config.map(r=>r.subject)).size!==15||new Set(config.map(r=>r.sha256)).size!==15)throw new Error('Exactly 15 distinct account code hashes are required');
 const records=config.map(r=>({sub:r.subject,hash:Buffer.from(r.sha256,'hex')}));
 return {async verify(code){const hash=digest(code);let matched;
  for(const r of records)if(timingSafeEqual(hash,r.hash))matched=r.sub;
  if(!matched)throw new Error('Invalid access code');return {sub:matched};
 }};
}
