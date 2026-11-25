import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),refs=new Map();
function collect(value){if(!value||typeof value!=='object')return;
 if(typeof value.publicPath==='string'&&/^[a-f0-9]{64}$/.test(value.sha256??''))refs.set(value.publicPath,value);
 else for(const v of Object.values(value))collect(v);
}
for(const name of ['asset-catalog','special-motion'])collect(JSON.parse(await readFile(new URL(`src/data/generated/${name}.json`,root),'utf8')));
await rm(new URL('public/game-content/',root),{force:true,recursive:true});await mkdir(new URL('public/game-content/',root),{recursive:true});
const unique=new Set();let bytes=0;
for(const ref of refs.values()){
 const data=await readFile(new URL('public/'+ref.publicPath,root));if(createHash('sha256').update(data).digest('hex')!==ref.sha256)throw Error('Asset checksum mismatch: '+ref.publicPath);
 const extension=ref.publicPath.split('.').at(-1);if(!/^[a-z0-9]+$/.test(extension))throw Error('Invalid asset extension');
 const name=`${ref.sha256}.${extension}`;if(unique.has(name))continue;unique.add(name);bytes+=data.length;
 await writeFile(new URL('public/game-content/'+name,root),data);
}
console.log(JSON.stringify({contentAddressedFiles:unique.size,bytes}));
