import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initialState,emptyItem} from '../src/domain/state.ts';
import {applyCommand} from '../src/domain/commands.ts';
import {buildEncyclopedia,filterEntries} from '../src/encyclopedia/model.ts';
import {buildInventory,filterInventory} from '../src/inventory/model.ts';
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
const at='2026-11-16T00:00:00Z';
test('season and rarity intersect independently in both collections',()=>{
 const s=initialState();
 for(const season of ['all','common','spring','summer','autumn','winter'])for(const rarity of ['common','rare','legendary','special']) {
  const expected=catalog.yokai.filter(y=>(season==='all'||(season==='common'?y.seasons.length===4:y.seasons.length===1&&y.seasons.includes(season)))&&y.rarity===rarity);
  assert.deepEqual(filterEntries(buildEncyclopedia(catalog,s),season,rarity).map(e=>e.id),expected.map(y=>y.id));
  assert.deepEqual(filterInventory(buildInventory(catalog,s),season,rarity).map(e=>e.id),expected.map(y=>y.mainItemId));
 }
});
test('NEW and unread first within filters; source ordering unchanged',()=>{
 const s=initialState(); s.discovered.yokai_030={firstCapturedAt:at,captureCount:1,photos:{},coverSeason:null};
 s.items.item_030={...emptyItem(),totalCount:1,manualCount:1,unreadCount:1,firstObtainedAt:at,lastObtainedAt:at};
 const e=buildEncyclopedia(catalog,s),i=buildInventory(catalog,s),before=JSON.stringify([e,i]);
 assert.equal(filterEntries(e,'spring')[0].id,'yokai_030');
 assert.equal(filterEntries(e,'spring')[0].isNew,true);
 assert.equal(filterInventory(i,'spring')[0].id,'item_030');
 assert.equal(JSON.stringify([e,i]),before);
});
test('view acknowledgement clears only captured NEW and is idempotent',()=>{
 const s=initialState(); s.discovered.yokai_030={firstCapturedAt:at,captureCount:2,photos:{},coverSeason:null};
 const command={type:'markYokaiViewed',yokaiId:'yokai_030',viewedAt:at};
 const result=applyCommand(s,command); assert.equal(result.status,'changed');
 assert.deepEqual(result.state.items,s.items); assert.deepEqual(result.state.discovered.yokai_030.photos,{});
 assert.equal(result.state.discovered.yokai_030.captureCount,2);
 assert.equal(buildEncyclopedia(catalog,result.state).entries[29].isNew,false);
 assert.equal(applyCommand(result.state,command).status,'unchanged');
 assert.equal(applyCommand(s,{...command,yokaiId:'missing'}).status,'invalid');
 assert.equal(applyCommand(s,{...command,viewedAt:'bad'}).status,'invalid');
});

test('failed NEW acknowledgement remains visible and explicit retry clears it',async()=>{
 const {EncyclopediaController}=await import('../src/encyclopedia/controller.ts');
 const s=initialState();s.discovered.yokai_030={firstCapturedAt:at,captureCount:1,photos:{},coverSeason:null};
 let fail=true;
 const controller=new EncyclopediaController({catalog,repository:{read:async()=>({status:'ok',state:s})},files:{get:async()=>({status:'missing'})},
  markViewed:async id=>{if(fail)return false;s.discovered[id].firstViewedAt=at;return true;}});
 await controller.open();await controller.select('yokai_030');await controller.presented('yokai_030');
 assert.equal(controller.snapshot.viewed,'error');assert.equal(controller.snapshot.model.entries[29].isNew,true);
 fail=false;await controller.presented('yokai_030');assert.equal(controller.snapshot.viewed,null);assert.equal(controller.snapshot.model.entries[29].isNew,false);
 controller.close();
});

test('most recent NEW appears before older NEW in both lists',()=>{
 const s=initialState();
 for(const n of ['021','030']){
  const time=n==='030'?'2026-11-16T02:00:00Z':at;
  s.discovered['yokai_'+n]={firstCapturedAt:time,captureCount:1,photos:{},coverSeason:null};
  s.items['item_'+n]={...emptyItem(),totalCount:1,manualCount:1,firstObtainedAt:time,lastObtainedAt:time};
 }
 assert.equal(filterEntries(buildEncyclopedia(catalog,s),'spring')[0].id,'yokai_030');
 assert.equal(filterInventory(buildInventory(catalog,s),'spring')[0].id,'item_030');
});
