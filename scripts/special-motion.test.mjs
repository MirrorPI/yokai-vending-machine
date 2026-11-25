import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {withSpecialMotion} from '../src/scene/special-motion.ts';import {compileScene,sampleScene} from '../src/scene/composition.ts';import {decodeRgbaPng} from '../src/capture/png.ts';
const original=JSON.parse(await readFile('src/data/generated/asset-catalog.json'));
test('special motion uses twelve real distinct transparent cels without mutating historical assets',async()=>{
 const before=JSON.stringify(original),catalog=withSpecialMotion(original),special=catalog.yokai.filter(y=>y.rarity==='special' && y.no<=68);
 assert.equal(special.length,6);
 for(const y of special){
  const a=y.art.animation;assert.equal(a.frames.length,12);assert.equal(new Set(a.frames.map(f=>f.sha256)).size,12);
  for(const f of a.frames){const bytes=await readFile('public/'+f.publicPath);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);const r=await decodeRgbaPng(bytes,[192,256]);assert.ok(r.data.some((v,i)=>i%4===3&&v===0));}
  for(const season of y.seasons)for(const family of ['forest','hill'])for(const effectsEnabled of [false,true]){
   const plan=compileScene(catalog,{yokaiId:y.id,season,family,effectsEnabled,playback:{originMs:0}});
   for(let t=0;t<12000;t+=25)assert.ok(sampleScene(plan,t).every(l=>l.file));
  }
 }
 assert.equal(JSON.stringify(original),before);
});

test('Bulgae carries its moon inside every body cel with no duplicate fixed moon layer',()=>{
 const catalog=withSpecialMotion(original),y=catalog.yokai.find(y=>y.id==='yokai_050');
 const plan=compileScene(catalog,{yokaiId:y.id,season:'autumn',family:'forest',playback:{originMs:0}});
 assert.equal(plan.layers.some(l=>l.id==='moon'||l.id==='moon_aura'),false);
 assert.equal(y.art.animation.frames.length,12);
});
test('special loops last four seconds, return through adjacent poses, and never hold for 900ms',()=>{
 const catalog=withSpecialMotion(original);
 for(const y of catalog.yokai.filter(y=>y.rarity==='special' && y.no<=68)){
  const t=y.art.animation.metadata,total=t.durationsMs.reduce((a,b)=>a+b,0);
  assert.equal(total,4000);assert.ok(Math.max(...t.durationsMs)<=240);
  assert.equal(new Set(t.sequence).size,12);
  for(let i=0;i<t.sequence.length;i++)assert.equal(Math.abs(t.sequence[i]-t.sequence[(i+1)%t.sequence.length]),1);
  const plan=compileScene(catalog,{yokaiId:y.id,season:y.seasons[0],family:'forest',playback:{originMs:0}});
  assert.equal(sampleScene(plan,0).find(l=>l.id==='body').cel,sampleScene(plan,total).find(l=>l.id==='body').cel);
 }
});

test('special aura is behind the body, breathes gently and respects effects-off; Bulgae has no neon lines',()=>{
 const catalog=withSpecialMotion(original);
 for(const y of catalog.yokai.filter(y=>y.rarity==='special' && y.no<=68)){
  const input={yokaiId:y.id,season:y.seasons[0],family:'forest',playback:{originMs:0}};
  const plan=compileScene(catalog,input),at0=sampleScene(plan,0),aura=at0.find(l=>l.id==='ambient_aura');
  assert.ok(aura,'soft atmosphere layer exists');
  assert.ok(at0.indexOf(aura)<at0.findIndex(l=>l.id==='body'));
  assert.ok(aura.opacity>0&&aura.opacity<0.8);
  assert.notEqual(aura.opacity,sampleScene(plan,3000).find(l=>l.id==='ambient_aura').opacity);
  assert.equal(aura.opacity,sampleScene(plan,6000).find(l=>l.id==='ambient_aura').opacity);
  assert.equal(compileScene(catalog,{...input,effectsEnabled:false}).layers.some(l=>l.id==='ambient_aura'),false);
  if(y.id==='yokai_050')assert.equal(plan.layers.some(l=>['mane_aura','front_mist','moon_aura','moon'].includes(l.id)),false);
 }
});
