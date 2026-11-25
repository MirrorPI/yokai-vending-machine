import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {png} from './png-encode.mjs';
import {withSpecialMotion} from '../src/scene/special-motion.ts';
import {compileScene,sceneFiles} from '../src/scene/composition.ts';
import {freezeCapture} from '../src/capture/scene.ts';
import {decodeRgbaPng} from '../src/capture/png.ts';
import {sharedPhotoKey} from '../src/photos/shared.ts';
const catalog=withSpecialMotion(JSON.parse(await readFile(new URL('../src/data/generated/asset-catalog.json',import.meta.url))));
const root=new URL('../',import.meta.url), cache=new Map(), manifest={};
await mkdir(new URL('public/shared-photos/',root),{recursive:true});
for(const y of catalog.yokai)for(const season of y.seasons)for(const family of ['forest','hill']){
 const plan=compileScene(catalog,{family,season,yokaiId:y.id,playback:{originMs:0}});
 for(const f of sceneFiles(plan))if(!cache.has(f.publicPath)){
  const bytes=await readFile(new URL('public/'+f.publicPath,root));
  if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new Error('Art checksum mismatch: '+f.publicPath);
  cache.set(f.publicPath,await decodeRgbaPng(bytes,f.size));
 }
 const sample=freezeCapture({bundle:{plan,requestId:1},sampledAtMono:y.art.animation.metadata.flight?.durationMs / 2 || 0,family,sceneSeason:season,gameSeason:season},
  {giant:y.giant,metadata:y.art.animation.metadata},file=>cache.get(file.publicPath));
 const entry={};
 for(const [kind,w,h,crop]of [['portrait',96,128,true],['full',192,256,false]]){
  const bytes=png(w,h,sample.rgba(crop));const digest=createHash('sha256').update(bytes).digest('hex').slice(0,16);
  const path=`shared-photos/${y.id}-${season}-${family}-${kind}-${digest}.png`;
  await writeFile(new URL('public/'+path,root),bytes);entry[kind]=path;
 }
 manifest[sharedPhotoKey(y.id,season,family)]=entry;
}
await writeFile(new URL('src/data/generated/shared-photos.json',root),JSON.stringify(manifest,null,2)+'\n');
console.log(`Shared photos: ${Object.keys(manifest).length} scenes; ${cache.size} original rasters verified`);
