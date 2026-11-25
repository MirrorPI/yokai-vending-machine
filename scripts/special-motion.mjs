// Slice AI-authored cels and resample to the game's logical pixel grid. No warps,
// deformations, frame synthesis or changes to the original character packages.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodeRgbaPng} from '../src/capture/png.ts';
import {png} from './png-encode.mjs';
const manifest={};
const auraBytes=await readFile('docs/art/special-aura-v1/auras.png');
const auraWidth=auraBytes.readUInt32BE(16),auraHeight=auraBytes.readUInt32BE(20);
const auraRaster=await decodeRgbaPng(auraBytes,[auraWidth,auraHeight]);
await mkdir('public/special-motion',{recursive:true});
for(const [auraIndex,no] of [20,30,40,50,60,68].entries()){
 const id=`yokai_${String(no).padStart(3,'0')}`,sourcePath=`docs/art/special-motion-v3/sources/${id}.png`;
 const bytes=await readFile(sourcePath),w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
 const raster=await decodeRgbaPng(bytes,[w,h]),frames=[];
 for(let n=0;n<12;n++){
  const pixels=new Uint8ClampedArray(192*256*4);
  // One uniform scale, based on cell width. Preserve aspect ratio; any excess
  // vertical canvas is cropped at the bottom (empty scene space), never stretched.
  const cellWidth=w/3,cellHeight=h/4,scale=192/cellWidth;
  for(let y=0;y<256;y++)for(let x=0;x<192;x++){
   const localY=(y+.5)/scale;if(localY>=cellHeight)continue;
   const sx=Math.min(w-1,Math.floor((n%3)*cellWidth+(x+.5)/scale));
   const sy=Math.min(h-1,Math.floor(Math.floor(n/3)*cellHeight+localY));
   pixels.set(raster.data.subarray((sy*w+sx)*4,(sy*w+sx)*4+4),(y*192+x)*4);
  }
  const encoded=png(192,256,pixels),sha256=createHash('sha256').update(encoded).digest('hex');
  const publicPath=`special-motion/${id}-${n}-${sha256.slice(0,12)}.png`;
  await writeFile('public/'+publicPath,encoded);
  frames.push({sourcePath:`public/${publicPath}`,publicPath,sha256,bytes:encoded.length,size:[192,256]});
 }
 const auraPixels=new Uint8ClampedArray(192*256*4),auraScale=192/(auraWidth/3);
 for(let y=0;y<256;y++)for(let x=0;x<192;x++){
  const localY=(y+.5)/auraScale;if(localY>=auraHeight/2)continue;
  const sx=Math.floor((auraIndex%3)*auraWidth/3+(x+.5)/auraScale);
  const sy=Math.floor(Math.floor(auraIndex/3)*auraHeight/2+localY);
  auraPixels.set(auraRaster.data.subarray((sy*auraWidth+sx)*4,(sy*auraWidth+sx)*4+4),(y*192+x)*4);
 }
 const auraPng=png(192,256,auraPixels),auraHash=createHash('sha256').update(auraPng).digest('hex');
 const auraPath=`special-motion/${id}-aura-${auraHash.slice(0,12)}.png`;
 await writeFile('public/'+auraPath,auraPng);
 const aura={sourcePath:`public/${auraPath}`,publicPath:auraPath,sha256:auraHash,bytes:auraPng.length,size:[192,256]};
 const sequence=[...Array.from({length:12},(_,i)=>i),...Array.from({length:10},(_,i)=>10-i)];
 manifest[id]={frames,aura,sequence,durationsMs:sequence.map(cel=>cel===0||cel===11?200:180),integratedMoon:no===50};
}
await writeFile('src/data/generated/special-motion.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Special motion: six characters, 72 authored cels; 4-second adjacent-pose loops, originals preserved');
