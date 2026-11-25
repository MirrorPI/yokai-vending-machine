import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileScene,sceneFiles,sampleScene} from '../src/scene/composition.ts';
import {withSpecialMotion} from '../src/scene/special-motion.ts';
import {freezeCapture} from '../src/capture/scene.ts';
import {decodeRgbaPng} from '../src/capture/png.ts';
import {sharedPhotoKey} from '../src/photos/shared.ts';
const catalog=withSpecialMotion(JSON.parse(readFileSync('src/data/generated/asset-catalog.json')));
const photos=JSON.parse(readFileSync('src/data/generated/shared-photos.json'));
const rasters=new Map();
async function raster(file) {
  if(!rasters.has(file.publicPath)) rasters.set(file.publicPath,await decodeRgbaPng(readFileSync('public/'+file.publicPath),file.size));
  return rasters.get(file.publicPath);
}
test('all species, maps and animation cels preserve foreground pixels and shared-photo composition',async()=>{
  let scenes=0,cels=0;
  for(const y of catalog.yokai) for(const season of y.seasons) for(const family of ['forest','hill']) {
    const plan=compileScene(catalog,{yokaiId:y.id,season,family,playback:{originMs:0}});
    for(const file of sceneFiles(plan)) await raster(file);
    const background=rasters.get(plan.layers[0].files[0].publicPath);
    for(const layer of plan.layers.filter(l=>l.id==='foreground')) {
      assert.equal(layer.x,0);assert.equal(layer.y,0);
      const fg=rasters.get(layer.files[0].publicPath);
      for(let i=0;i<fg.data.length;i+=4) if(fg.data[i+3]) {
        assert.deepEqual(fg.data.slice(i,i+4),background.data.slice(i,i+4),`${y.id}/${family}/${season}: foreground must copy this map`);
      }
    }
    const meta=y.art.animation.metadata;
    const times=[...new Set(meta.sequence)].map(cel=>meta.durationsMs.slice(0,meta.sequence.indexOf(cel)).reduce((a,b)=>a+b,0)-(meta.startOffsetMs??0));
    for(const t of times) {
      const draw=sampleScene(plan,t), body=draw.find(l=>l.id==='body');
      assert.ok(body && body.width>0 && body.height>0);
      assert.ok(draw.findIndex(l=>l.id==='foreground')===-1 || draw.findIndex(l=>l.id==='foreground')>draw.indexOf(body));
      const sample=freezeCapture({bundle:{plan,requestId:1},sampledAtMono:meta.flight?.durationMs/2 || t,family,sceneSeason:season,gameSeason:season},{giant:y.giant,metadata:meta},f=>rasters.get(f.publicPath));
      let visible=0;
      for(let py=0;py<256;py++) for(let px=0;px<192;px++) if(sample.opaque(px,py)&&!sample.occluded(px,py)) visible++;
      assert.ok(visible>0,`${y.id}/${family}/${season}/${t}: fully hidden body`);
      cels++;
    }
    const sample=freezeCapture({bundle:{plan,requestId:1},sampledAtMono:meta.flight?.durationMs/2 || 0,family,sceneSeason:season,gameSeason:season},{giant:y.giant,metadata:meta},f=>rasters.get(f.publicPath));
    const entry=photos[sharedPhotoKey(y.id,season,family)];
    for(const [kind,size,crop] of [['full',[192,256],false],['portrait',[96,128],true]]) {
      const saved=await decodeRgbaPng(readFileSync('public/'+entry[kind]),size);
      assert.deepEqual(saved.data,sample.rgba(crop),`${y.id}/${season}/${family}/${kind}: stale photo`);
    }
    scenes++;
  }
  assert.equal(scenes,384);
  console.log(`Layer audit: ${catalog.yokai.length} species, ${scenes} placements, ${cels} animation cels, ${scenes*2} photos`);
});
