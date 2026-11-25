import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Immutable objects become visible only after their complete bytes are written. */
export function createFileObjects(directory) {
 const path=key=>{if(!/^[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/.test(key))throw new Error('Invalid object key');return join(directory,key);};
 return {
  async get(key) { try {return await readFile(path(key));} catch(e) {if(e.code==='ENOENT')return null;throw e;} },
  async put(key, bytes) { const file=path(key); await mkdir(dirname(file),{recursive:true}); const tmp=`${file}.${randomUUID()}.tmp`; await writeFile(tmp,bytes,{flag:'wx',mode:0o600}); try {await link(tmp,file);} catch(e) {if(e.code!=='EEXIST')throw e; const old=await readFile(file); if(!old.equals(bytes))throw new Error('Immutable photo differs');} finally {await unlink(tmp);} },
 };
}
