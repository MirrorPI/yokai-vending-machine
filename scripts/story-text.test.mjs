import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withStoryText} from '../src/data/story-text.ts';
const original=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
const shortIds=[...Array.from({length:20},(_,i)=>i+1),44,46,48,51,52,53,55,59].map(n=>`yokai_${String(n).padStart(3,'0')}`);
test('only selected thin stories change; artwork, IDs, items and unrelated stories remain intact',()=>{
 const before=JSON.stringify(original),revised=withStoryText(original);let changes=0;
 for(const y of revised.yokai){const old=original.yokai.find(x=>x.id===y.id);
  assert.deepEqual({...y,description:old.description,lore:old.lore},old,y.id);
  if(shortIds.includes(y.id)){assert.ok(y.description.length>old.description.length,y.id);assert.ok(y.description.endsWith('다.'),y.id);changes++;}
  else if(y.no<93 && ![41,60,74,80,86,92].includes(y.no))assert.equal(y.description,old.description,y.id);
 }
 assert.equal(changes,28);assert.equal(JSON.stringify(original),before);assert.equal(revised.items,original.items);
 assert.equal(revised.yokai[60].description,original.yokai[60].description,'아카나메 visit retained verbatim');
});
test('Western ten have in-world stories and ten distinct long-journey passages',()=>{
 const revised=withStoryText(original),additions=[];
 for(const y of revised.yokai.filter(y=>y.origin==='western')){
  const extra=JSON.parse(fs.readFileSync('src/data/story-overrides.json'))[y.id].append;
  assert.ok(y.description.endsWith(extra));assert.match(extra,/먼|아득/);assert.ok(extra.length>35);additions.push(extra);
 }
 assert.equal(additions.length,10);assert.equal(new Set(additions).size,10);
});

test('all displayed stories stay inside the world without development explanations or Western source locations',()=>{
 const revised=withStoryText(original);
 for(const y of revised.yokai){
  const text=y.description+' '+y.lore;
  assert.doesNotMatch(text,/모티브|재해석|창작|게임|화면|등급|특수로 분류|촬영.*특수|전승|이야기에서|바탕으로|그려진/,y.id);
  if(y.origin==='western')assert.doesNotMatch(text,/영국|남서부|스코틀랜드|아일랜드|독일|스웨덴|알프스|Pixie|Brownie/,y.id);
 }
});
