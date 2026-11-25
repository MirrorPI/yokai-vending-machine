import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initialState,emptyItem} from '../src/domain/state.ts';
const api=await import('../src/encyclopedia/model.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
const at='2026-10-27T00:00:00Z';
const capture=(photos={},coverSeason=null)=>({firstCapturedAt:at,captureCount:4,photos,coverSeason});
function build(s=initialState()){assert.equal(typeof api.buildEncyclopedia,'function','public encyclopedia projection required');return api.buildEncyclopedia(catalog,s);}
test('unseen projection carries only number, season, rarity and neutral locked display',()=>{
 const m=build(),y=m.entries[20];assert.equal(y.status,'unseen');assert.equal(y.name,'???');
 const text=JSON.stringify(y);for(const secret of ['카라카사오바케','백 년','빗물 레모네이드','item_021','종이우산','origin','description','lore','favoriteDrink'])assert.ok(!text.includes(secret),secret);
 assert.equal(y.illustration,null);assert.deepEqual(y.seasons,['spring']);assert.equal(y.rarity,'common');
});
test('actual acquired item unlocks trace name and acquired item only without inventing discovered',()=>{
 const s=initialState();s.items.item_021={...emptyItem(),totalCount:3,leftCount:3,firstObtainedAt:at,lastObtainedAt:at};const before=JSON.stringify(s);
 const m=build(s),y=m.entries[20];assert.equal(y.status,'trace');assert.equal(y.name,'카라카사오바케');assert.equal(y.item.name,catalog.items[20].name);assert.equal(y.item.description,catalog.items[20].description);assert.equal(y.illustration,null);
 for(const key of ['lore','description','favoriteDrink','capture','origin','slots'])assert.ok(!(key in y));
 assert.equal(m.progress.captured,0);assert.equal(m.progress.photos,0);assert.equal(m.progress.itemKinds,1);assert.equal(m.progress.itemQuantity,3);assert.equal(JSON.stringify(s),before);
});
test('zero-count items never unlock trace; legacy capture with zero items remains captured',()=>{
 const s=initialState();s.items.item_001=emptyItem();assert.equal(build(s).entries[0].status,'unseen');
 s.discovered.yokai_001=capture({winter:{photoKey:'legacy-original',at}},'winter');
 const y=build(s).entries[0];assert.equal(y.status,'captured');assert.equal(y.name,'고다마');assert.equal(y.favoriteDrink,'아침 이슬');assert.equal(y.capture.captureCount,4);assert.equal(y.capture.firstCapturedAt,at);assert.equal(y.coverSeason,'winter');assert.equal(y.slots[3].metadata.photoKey,'legacy-original');assert.equal(y.slots[3].state,'legacy');assert.equal(y.illustration.publicPath,'game-assets/요괴/공통/pixel/yokai_001.png');
});
test('captured details use original lore, description, origin and separate drink/item',()=>{
 const s=initialState();s.discovered.yokai_021=capture({spring:{photoKey:'k',at,status:'failed'}},'spring');
 const y=build(s).entries[20],source=catalog.yokai[20];for(const key of ['description','lore','origin','favoriteDrink'])assert.equal(y[key],source[key]);assert.equal(y.item.id,'item_021');assert.notEqual(y.item.name,y.favoriteDrink);assert.equal(y.illustration.publicPath,source.art.still.publicPath);
});
test('global progress counts unique static slots including pending/failed independently from captures/items',()=>{
 const s=initialState();s.discovered.yokai_001=capture({spring:{photoKey:'a',at,status:'pending'},winter:{photoKey:'b',at,status:'failed'},future:{photoKey:'keep',at}},'winter');
 s.discovered.yokai_021=capture({spring:{photoKey:'c',at,status:'saved'}},'spring');s.discovered.unknown=capture({spring:{photoKey:'old',at}},'spring');s.items.unknown={...emptyItem(),totalCount:20,manualCount:20,firstObtainedAt:at,lastObtainedAt:at};
 const before=JSON.stringify(s),m=build(s);assert.deepEqual(m.progress,{captured:2,totalYokai:102,photos:3,totalPhotos:192,byRarity:{common:2,rare:0,legendary:0,special:0},photoStates:{empty:189,pending:1,failed:1,saved:1,legacy:0},itemKinds:0,itemQuantity:0});
 assert.deepEqual(m.preserved,{yokai:1,items:1,photoSlots:1});assert.equal(JSON.stringify(s),before);
});
test('full catalog has exactly 102 species/192 slots and independent rarity totals',()=>{
 const s=initialState();for(const y of catalog.yokai)s.discovered[y.id]=capture(Object.fromEntries(y.seasons.map(season=>[season,{photoKey:`${y.id}-${season}`,at,status:'failed'}])),y.seasons[0]);
 const m=build(s);assert.equal(m.progress.captured,102);assert.equal(m.progress.photos,192);assert.deepEqual(m.progress.byRarity,{common:46,rare:34,legendary:12,special:10});
});
test('season tabs exclude common species, retain their own eighteen and preserve global progress',()=>{
 const m=build();assert.equal(m.entries.length,102);
 for(const [i,season] of ['spring','summer','autumn','winter'].entries()) {
  const rows=api.filterEntries(m,season);
  assert.equal(rows.length,18);
  assert.deepEqual(rows.map(r=>r.no),[...Array.from({length:10},(_,n)=>21+i*10+n),...Array.from({length:6},(_,n)=>69+i*6+n),95+i*2,96+i*2]);
  assert.ok(rows.every(r=>r.seasons.length===1&&r.seasons[0]===season));
 }
 assert.equal(api.filterEntries(m,'all').length,102);
 assert.equal(api.filterEntries(m,'common').length,30);
 assert.equal(m.progress.captured,0);
});
test('common has four slots, dedicated has one, statuses and stored scene values are kept',()=>{
 const s=initialState();s.discovered.yokai_001=capture();s.discovered.yokai_021=capture({spring:{photoKey:'k',at,status:'saved',attemptId:'v',sceneSeason:'summer',capturedGameSeason:'autumn',backgroundFamily:'hill'}},'spring');
 const m=build(s);assert.equal(m.entries[0].slots.length,4);assert.equal(m.entries[20].slots.length,1);assert.deepEqual(m.entries[20].slots[0].metadata,s.discovered.yokai_021.photos.spring);
});
test('legacy cover outside current static slots is preserved without choosing another representative',()=>{
 const s=initialState();s.discovered.yokai_021=capture({winter:{photoKey:'keep-cover',at}},'winter');const y=build(s).entries[20];assert.equal(y.coverSeason,'winter');assert.equal(y.cover.metadata.photoKey,'keep-cover');assert.equal(y.slots[0].state,'empty');assert.equal(build(s).progress.photos,0);
});

test('common filter contains only the 30 all-season species and preserves overall progress',()=>{
 const m=build(), before=JSON.stringify(m.progress);
 const rows=api.filterEntries(m,'common');
 assert.equal(rows.length,30);
 assert.deepEqual(rows.map(r=>r.no),[...Array.from({length:20},(_,i)=>i+1),...Array.from({length:8},(_,i)=>i+61),93,94]);
 assert.ok(rows.every(r=>['spring','summer','autumn','winter'].every(s=>r.seasons.includes(s))));
 assert.equal(JSON.stringify(m.progress),before);
});
