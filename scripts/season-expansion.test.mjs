import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {candidatesFor} from '../src/runtime/rules.ts';
import {withSpecialMotion} from '../src/scene/special-motion.ts';
import {ACTIVE_YOKAI_COUNT} from '../src/domain/season-control.ts';
import {compileScene,sampleScene} from '../src/scene/composition.ts';
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
test('24 seasonal additions have exact rarity allocation and every old definition stays byte-identical',()=>{
 assert.equal(catalog.yokai.length,ACTIVE_YOKAI_COUNT);
 const old=JSON.parse(fs.readFileSync('docs/development/season-expansion-legacy-hashes.json'));
 for(const group of ['yokai','items'])for(const row of old[group])assert.equal(createHash('sha256').update(JSON.stringify(catalog[group].find(y=>y.id===row.id))).digest('hex'),row.sha256,row.id);
 for(const season of ['spring','summer','autumn','winter']){
  const added=catalog.yokai.filter(y=>y.no>=69&&y.no<=92&&y.seasons.includes(season));assert.equal(added.length,6);
  assert.deepEqual(added.map(y=>y.rarity),['common','common','rare','rare','legendary','special']);
  assert.ok(added.every(y=>y.origin==='original'&&y.art&&y.mainItemId));
 }
});
test('all new and existing animated specials stay eligible on both maps',()=>{
 const current=withSpecialMotion(catalog);
 for(const season of ['spring','summer','autumn','winter'])for(const family of ['forest','hill']){
  const result=candidatesFor(current,season,family);assert.deepEqual(result.excluded,[]);assert.equal(result.available.length,48);
 }
 for(const y of catalog.yokai.filter(y=>y.no>=69&&y.no<=92&&y.rarity==='special')){
  assert.equal(y.art.animation.frames.length,16);
  const plan=compileScene(catalog,{family:'forest',season:y.seasons[0],yokaiId:y.id,playback:{originMs:0}});
  const a=sampleScene(plan,0).find(l=>l.id==='body'),b=sampleScene(plan,2000).find(l=>l.id==='body'),c=sampleScene(plan,4500).find(l=>l.id==='body');
  assert.ok(a.x<0&&b.x>a.x&&c.x>=192);assert.equal(a.width,c.width);
 }
});
