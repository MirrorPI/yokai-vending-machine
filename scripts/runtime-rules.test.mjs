import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const rules=await import('../src/runtime/rules.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync(new URL('../src/data/generated/asset-catalog.json',import.meta.url)));
const offset=()=>-540;
const ms=s=>Date.parse(s+'+09:00');
test('seasons advance every 45 minutes, including midnight and the former 04 reset',()=>{
  const start=ms('2026-10-27T00:00:00');
  const order=['spring','summer','autumn','winter'];
  const first=order.indexOf(rules.seasonAt(start,offset).season);
  for(let i=0;i<64;i++) {
    const at=start+i*45*60000;
    assert.equal(rules.seasonAt(at,offset).season,order[(first+i)%4]);
    assert.equal(rules.seasonAt(at,offset).nextAt,at+45*60000);
    assert.equal(rules.seasonAt(at+45*60000-1,offset).season,order[(first+i)%4]);
  }
  assert.equal(rules.seasonAt(ms('2026-10-27T03:59:59.999'),offset).season,rules.seasonAt(ms('2026-10-27T04:00:00'),offset).season);
});
test('45 minute boundaries use local time and account for DST clock jumps',()=>{
  const now=Date.parse('2026-01-01T00:00:00Z');
  assert.equal(rules.seasonAt(now,()=>-345).nextAt,now+15*60000);
  const transition=now+30*60000;
  assert.equal(rules.seasonAt(now+1,t=>t<transition?0:-60).nextAt,transition);
});
test('all48 verified candidates execute for each family/season including common30',()=>{
  assert.equal(typeof rules.candidatesFor,'function');
  for(const season of ['spring','summer','autumn','winter']) for(const family of ['forest','hill']){
    const c=rules.candidatesFor(catalog,season,family);
    assert.equal(c.rule.length,48);assert.equal(c.available.length,48);assert.equal(c.excluded.length,0);
    assert.equal(c.available.filter(x=>Number(x.id.slice(-3))<=20).length,20);
  }
});
test('missing definitions, frame files, anchors and forbidden placements are rejected without guesses',()=>{
  assert.equal(typeof rules.candidatesFor,'function');
  const c=structuredClone(catalog);
  delete c.yokai[20].weight;c.yokai[21].art.animation.frames=[];c.yokai[22].art.animation.metadata.anchor=[99,99];
  c.compatibility.metadata.verifiedDefaults=c.compatibility.metadata.verifiedDefaults.filter(x=>x.no!==24);
  const result=rules.candidatesFor(c,'spring','forest');
  for(const id of ['021','022','023','024'])assert.ok(!result.available.some(x=>x.id===`yokai_${id}`));
});
test('two stage half-open rarity ranges and original species weights; empty ranks normalize',()=>{
  assert.equal(typeof rules.drawCandidate,'function');
  const c=['common','rare','legendary','special'].map((rarity,i)=>({id:String(i),rarity,weight:10}));
  for(const [r,id] of [[0,'0'],[.659999,'0'],[.66,'1'],[.929999,'1'],[.93,'2'],[.979999,'2'],[.98,'3'],[.999999,'3']]){const q=[r,0];assert.equal(rules.drawCandidate(c,null,()=>q.shift()).id,id);}
  const weighted=[{id:'a',rarity:'rare',weight:1},{id:'b',rarity:'rare',weight:3}];
  for(const [r,id]of [[0,'a'],[.249999,'a'],[.25,'b'],[.999,'b']]){const q=[.99,r];assert.equal(rules.drawCandidate(weighted,null,()=>q.shift()).id,id);}
  assert.equal(rules.drawCandidate(weighted,'a',()=>0).id,'b');
  assert.equal(rules.drawCandidate([weighted[0]],'a',()=>{throw Error('no reroll');}),null);
  assert.throws(()=>rules.drawCandidate(c,null,()=>1),/random/i);
});
test('uniform wait and dwell endpoints, rank fade durations',()=>{
  assert.equal(typeof rules.waitDuration,'function');
  assert.equal(rules.waitDuration(()=>0),28000);assert.equal(rules.waitDuration(()=>.5),61500);assert.ok(rules.waitDuration(()=>.999999)<95000);assert.ok(rules.waitDuration(()=>.999999)>94999);
  for(const [rank,min,max,enter,exit]of [['common',18000,22000,600,800],['rare',13000,17000,600,800],['legendary',7000,9000,400,400],['special',4000,6000,200,400]]){
    assert.equal(rules.dwellDuration(rank,()=>0),min);assert.ok(rules.dwellDuration(rank,()=>.999999)<max);
    assert.deepEqual(rules.fades[rank],{enter,exit});
  }
});
test('required definition fields and incomplete timing frames exclude a species',()=>{
 for(const field of ['image','origin','lore','description','spots','size','presentation']){
  const c=structuredClone(catalog);delete c.yokai[20][field];assert.ok(!rules.candidatesFor(c,'spring','forest').available.some(x=>x.id==='yokai_021'),field);
 }
 const giant=structuredClone(catalog);delete giant.yokai[28].giant;assert.ok(!rules.candidatesFor(giant,'spring','forest').available.some(x=>x.id==='yokai_029'));
 const c=structuredClone(catalog);c.yokai[20].art.animation.frames.pop();assert.ok(!rules.candidatesFor(c,'spring','forest').available.some(x=>x.id==='yokai_021'));
});

test('66/27/5/2 rarity draws remain independent of current and expanded species counts',()=>{
 const ranks=['common','rare','legendary','special'];
 for(const counts of [[15,9,4,2],[18,12,5,3]]){
  const candidates=ranks.flatMap((rarity,i)=>Array.from({length:counts[i]},(_,j)=>({id:`${rarity}-${j}`,rarity,weight:10})));
  const observed={common:0,rare:0,legendary:0,special:0};
  for(let i=0;i<2000;i++){const random=[(i+.5)/2000,.5]; observed[rules.drawCandidate(candidates,null,()=>random.shift()).rarity]++;}
  assert.deepEqual(observed,{common:1320,rare:540,legendary:100,special:40});
 }
});
