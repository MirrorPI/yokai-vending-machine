import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {initialState,emptyItem} from '../src/domain/state.ts';import {buildInventory} from '../src/inventory/model.ts';
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json')),dir=fs.mkdtempSync(path.resolve('.a08-render-'));let View;
test.before(()=>{assert.ok(fs.existsSync('src/inventory/InventoryView.tsx'),'actual inventory UI required');execFileSync('node_modules/.bin/tsc',['--ignoreConfig','--noEmit','false','--jsx','react-jsx','--module','ESNext','--moduleResolution','Bundler','--target','ES2022','--skipLibCheck','--rewriteRelativeImportExtensions','--types','vite/client','--outDir',dir,'src/inventory/InventoryView.tsx'],{encoding:'utf8'});});test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
async function render(s=initialState(),selectedId=null,extra={},viewProps={}){View??=(await import(pathToFileURL(path.join(dir,'inventory/InventoryView.js')))).InventoryView;return renderToStaticMarkup(createElement(View,{snapshot:{open:true,phase:'ready',model:buildInventory(catalog,s),filter:'all',selectedId,ticket:null,ack:{state:'idle'},error:null,...extra},onClose(){},onSelect(){},onFilter(){},onRefresh(){},onRetry(){},timeOptions:{locale:'en-GB',timeZone:'Asia/Seoul'},...viewProps}));}
function state(){const s=initialState();s.items.item_001={...emptyItem(),totalCount:5,manualCount:2,leftCount:3,unreadCount:4,unreadLeftCount:3,firstObtainedAt:'2026-10-27T00:00:00Z',lastObtainedAt:null};return s;}
test('unacquired UI locks text,alt,aria,title,icon paths including legacy capture without actual items',async()=>{const s=initialState();s.discovered.yokai_021={firstCapturedAt:'2026-10-27T00:00:00Z',captureCount:1,photos:{},coverSeason:null};const html=await render(s,'item_021');for(const value of [catalog.items[20].name,catalog.items[20].description,catalog.items[20].icon.publicPath,catalog.yokai[20].name])assert.ok(!html.includes(value));assert.doesNotMatch(html,/\?\?\?|data-item-entry=|inventory-detail/);assert.match(html,/가방이 아직 비어 있어요/);});
test('list contains actual icon/name/quantity/owner/unread/NEW and global independent sums',async()=>{const html=await render(state());for(const value of ['가방 속 물건','보유 수량',catalog.items[0].name,catalog.items[0].icon.publicPath,'×5','NEW'])assert.ok(html.includes(value),value);});
test('detail displays description/source counts/local times with null unknown, no fabricated drink',async()=>{const html=await render(state(),'item_001');for(const value of [catalog.items[0].description,'모은 수량','직접 만남','두고 간 물건','물건 이야기','획득 기록',catalog.yokai[0].name,'09:00','기록 없음','처음 획득','최근 획득'])assert.ok(html.includes(value),value);assert.ok(!html.includes(catalog.yokai[0].favoriteDrink));assert.match(html,/data-item-scope/);});
for(const [filter,count]of [['all',1],['common',1],['spring',0],['summer',0],['autumn',0],['winter',0]])test(`${filter} UI uses exclusive filter without changing global sums`,async()=>{const html=await render(state(),null,{filter});assert.equal([...html.matchAll(/data-item-entry=/g)].length,count);assert.match(html,/보유 수량 <strong>5개/);assert.doesNotMatch(html,/<progress|\?\?\?/);if(filter==='common')assert.match(html,/aria-pressed="true">사계절/);});
for(const error of ['corrupt','unsupported-version','unavailable'])test(`${error} query never renders normal empty progress`,async()=>{const html=await render(initialState(),null,{phase:'error',error,model:null});assert.ok(!html.includes('0 / 60'));assert.match(html,/물건함 다시 열기/);assert.match(html,/role="alert"/);});
test('failed read acknowledgement offers retry and never claims saved',async()=>{const html=await render(state(),'item_001',{ack:{state:'error',error:'unavailable'}});assert.match(html,/확인을 저장하지 못했어요/);assert.match(html,/확인 다시 저장/);assert.ok(!html.includes('확인 저장 완료'));});

test('docked inventory is a non-modal region with a close button',async()=>{const html=await render(initialState(),null,{}, {embedded:true});assert.match(html,/role="region"/);assert.doesNotMatch(html,/aria-modal/);assert.match(html,/aria-label="물건함 닫기"/);});

test('recent drop history is retained but no longer displayed',async()=>{
 const s=state(); s.recentDrops=[{visitId:'old',itemId:'item_001',settledAt:'2026-11-16T00:00:00Z'}];
 const before=JSON.stringify(s); const html=await render(s);
 assert.doesNotMatch(html,/최근 두고 간 물건|inventory-shelf|data-recent-drop/);
 assert.equal(JSON.stringify(s),before);
});
test('first discovery uses NEW; known items show unread increments until acknowledged',async()=>{
 const s=state(); let html=await render(s);
 assert.match(html,/inventory-slot-new/); assert.doesNotMatch(html,/inventory-slot-added|data-increased/);
 s.items.item_001.firstViewedAt='2026-10-27T01:00:00Z';
 html=await render(s);
 assert.doesNotMatch(html,/inventory-slot-new/); assert.match(html,/data-increased="true"/);
 assert.match(html,/새로 4개 추가/); assert.match(html,/>\+4<\/span>/); assert.match(html,/×5/);
 s.items.item_001.unreadCount=0; s.items.item_001.unreadLeftCount=0;
 html=await render(s);
 assert.doesNotMatch(html,/inventory-slot-new|inventory-slot-added|data-increased/); assert.match(html,/×5/);
});

test('repeated acquisition increases the existing stack and never reveals missing items',async()=>{
 const s=state();
 const before=await render(s);
 s.items.item_001.totalCount+=2; s.items.item_001.leftCount+=2;
 const after=await render(s);
 assert.equal((before.match(/data-item-entry=/g)??[]).length,1);
 assert.equal((after.match(/data-item-entry=/g)??[]).length,1);
 assert.match(before,/×5/); assert.match(after,/×7/);
 for(const i of catalog.items.slice(1)) assert.ok(!after.includes(i.icon.publicPath));
 assert.doesNotMatch(after,/data-item-entry="item_002"|60종|\?\?\?/);
});

test('detail pager exposes only acquired neighbours and disables each end',async()=>{
 const s=state();s.items.item_021={...s.items.item_001};
 let html=await render(s,'item_001',{detailOrder:['item_001','item_021']});
 assert.match(html,/aria-label="물건 넘기기"/);assert.match(html,/>1 \/ 2</);
 assert.match(html,/disabled="" aria-label="이전 물건"/);assert.match(html,new RegExp(`aria-label="다음 물건: ${catalog.items[20].name}"`));
 html=await render(s,'item_021',{detailOrder:['item_001','item_021']});
 assert.match(html,/>2 \/ 2</);assert.match(html,/disabled="" aria-label="다음 물건"/);
 html=await render(state(),'item_001',{detailOrder:['item_001','item_002']});
 assert.match(html,/>1 \/ 1</);assert.doesNotMatch(html,new RegExp(catalog.items[1].name));
});
