import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {candidatesFor} from '../src/runtime/rules.ts';
import {withSpecialMotion} from '../src/scene/special-motion.ts';
import {ACTIVE_YOKAI_COUNT} from '../src/domain/season-control.ts';
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
test('Western expansion adds exactly one common and one rare to each of five exclusive categories',()=>{
 assert.equal(catalog.yokai.length,102);assert.equal(ACTIVE_YOKAI_COUNT,102);
 const rows=catalog.yokai.filter(y=>y.no>=93);assert.equal(rows.length,10);
 for(const season of ['all','spring','summer','autumn','winter']){
  const group=rows.filter(y=>season==='all'?y.seasons.length===4:y.seasons.length===1&&y.seasons[0]===season);
  assert.deepEqual(group.map(y=>y.rarity),['common','rare']);
  assert.ok(group.every(y=>y.origin==='western'&&y.art.animation.frames.length===4));
 }
});
test('all 92 prior yokai and item definitions are byte-identical',()=>{
 const old=JSON.parse(fs.readFileSync('docs/development/western-expansion-legacy-hashes.json'));
 for(const group of ['yokai','items'])for(const r of old[group])assert.equal(createHash('sha256').update(JSON.stringify(catalog[group].find(y=>y.id===r.id))).digest('hex'),r.sha256,r.id);
});
test('Western spirits are eligible only in their declared seasons, on both maps',()=>{
 const current=withSpecialMotion(catalog);
 for(const season of ['spring','summer','autumn','winter'])for(const family of ['forest','hill']){
  const result=candidatesFor(current,season,family);assert.deepEqual(result.excluded,[]);assert.equal(result.available.length,48);
  assert.deepEqual(result.available.filter(y=>Number(y.id.slice(6))>=93).map(y=>y.id).sort(),catalog.yokai.filter(y=>y.no>=93&&y.seasons.includes(season)).map(y=>y.id).sort());
 }
});
