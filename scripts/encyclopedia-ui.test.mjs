import {withStoryText} from '../src/data/story-text.ts';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {initialState,emptyItem} from '../src/domain/state.ts';import {buildEncyclopedia} from '../src/encyclopedia/model.ts';
const catalog=withStoryText(JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'))),at='2026-10-27T00:00:00Z';
const dir=fs.mkdtempSync(path.resolve('.a07-render-'));
let View;
test.before(()=>{
 assert.ok(fs.existsSync('src/encyclopedia/EncyclopediaView.tsx'),'actual encyclopedia UI required');
 execFileSync('node_modules/.bin/tsc',['--ignoreConfig','--noEmit','false','--jsx','react-jsx','--module','ESNext','--moduleResolution','Bundler','--target','ES2022','--skipLibCheck','--rewriteRelativeImportExtensions','--types','vite/client','--outDir',dir,'src/encyclopedia/EncyclopediaView.tsx'],{encoding:'utf8'});
});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
async function render(s,selectedId=null,photo={state:'empty',token:0},extra={},viewProps={}){
 View??=(await import(pathToFileURL(path.join(dir,'encyclopedia/EncyclopediaView.js')))).EncyclopediaView;
 const snapshot={open:true,phase:'ready',error:null,model:buildEncyclopedia(catalog,s),filter:'all',selectedId,season:'spring',full:false,photo,...extra};
 return renderToStaticMarkup(createElement(View,{snapshot,onClose(){},onFilter(){},onSelect(){},onPhoto(){},onFull(){},onRetry(){},onRefresh(){},onImageError(){},...viewProps}));
}
test('docked encyclopedia is a named non-modal region with a close button',async()=>{
 const html=await render(initialState(),null,undefined,{}, {embedded:true});
 assert.match(html,/role="region"/);assert.match(html,/aria-label="도감"/);
 assert.doesNotMatch(html,/aria-modal/);assert.match(html,/aria-label="도감 닫기"/);
});
test('unseen UI text/alt/aria/tooltips never leaks locked name/item/product/origin/body',async()=>{
 const html=await render(initialState(),'yokai_021');for(const secret of [catalog.yokai[20].name,catalog.yokai[20].description,catalog.yokai[20].lore,catalog.yokai[20].favoriteDrink,catalog.items[20].name,catalog.items[20].description])assert.ok(!html.includes(secret),secret);assert.match(html,/미촬영/);assert.match(html,/\?\?\?/);
});
test('registered grid cards display the actual yokai portrait while locked cards keep art hidden',async()=>{
 const s=initialState();s.discovered.yokai_001={firstCapturedAt:at,captureCount:1,photos:{},coverSeason:null};
 const html=await render(s);
 assert.match(html,/<img[^>]+class="encyclopedia-portrait"[^>]+src="game-assets\/요괴\/공통\/pixel\/yokai_001.png"/);
 assert.match(html,/alt="고다마 모습"/);
 assert.doesNotMatch(html,/✦|사진 대체 표시 · 상세 조회/);
 assert.ok(!html.includes(catalog.yokai[20].art.still.publicPath));
});
test('place UI has only forest and hill, without duplicate original slots or counts',async()=>{
 const s=initialState();s.discovered.yokai_001={firstCapturedAt:at,captureCount:2,coverSeason:'spring',photos:{spring:{photoKey:'old-forest',at,status:'saved',sceneSeason:'spring',backgroundFamily:'forest'},summer:{photoKey:'unknown-place',at,status:'saved'}}};
 const before=JSON.stringify(s),model=buildEncyclopedia(catalog,s,{places:true});
 const html=await render(s,'yokai_001',undefined,{model,season:'spring:forest'});
 assert.match(html,/숲 사진칸/);assert.match(html,/밤하늘 사진칸/);
 assert.doesNotMatch(html,/이전 원본|data-photo-slot="legacy:/);
 assert.match(html,/1 \/ 8칸/);assert.equal((html.match(/data-photo-slot=/g)??[]).length,8);
 assert.equal(JSON.stringify(s),before);
});
test('trace UI reveals only owner and actual item; has no full art, lore, origin, drink or photo slots',async()=>{
 const s=initialState();s.items.item_021={...emptyItem(),totalCount:1,leftCount:1,firstObtainedAt:at,lastObtainedAt:at};const html=await render(s,'yokai_021');for(const shown of [catalog.yokai[20].name,catalog.items[20].name,catalog.items[20].description,'흔적 발견'])assert.ok(html.includes(shown),shown);
 for(const secret of [catalog.yokai[20].description,catalog.yokai[20].lore,catalog.yokai[20].favoriteDrink,catalog.yokai[20].art.still.publicPath])assert.ok(!html.includes(secret));assert.ok(!html.includes('data-photo-slot'));
});
test('captured UI includes original detail and separate product/item with fixed cover and distinct dimensions',async()=>{
 const s=initialState();s.discovered.yokai_021={firstCapturedAt:at,captureCount:8,photos:{spring:{photoKey:'k',at,status:'saved',sceneSeason:'summer',capturedGameSeason:'spring',backgroundFamily:'hill'}},coverSeason:'spring'};
 const html=await render(s,'yokai_021',{state:'ready',token:1,url:'blob:card'});for(const shown of [catalog.yokai[20].name,catalog.yokai[20].description,catalog.yokai[20].lore,catalog.yokai[20].favoriteDrink,catalog.items[20].name,at,'8회','장면 계절','언덕'])assert.ok(html.includes(shown),shown);assert.match(html,/width="96" height="128"/);assert.match(html,/>요괴 사진<\/button>/);assert.match(html,/>전체 장면<\/button>/);
 const full=await render(s,'yokai_021',{state:'ready',token:2,url:'blob:full'},{full:true});assert.match(full,/width="192" height="256"/);
});
test('common four/dedicated one slots, progress, static season filter and registered common art render safely',async()=>{
 const s=initialState();s.discovered.yokai_001={firstCapturedAt:at,captureCount:1,photos:{},coverSeason:null};const html=await render(s,'yokai_001');assert.equal([...html.matchAll(/data-photo-slot=/g)].length,4);assert.match(html,/game-assets\/요괴\/공통\/pixel\/yokai_001.png/);assert.doesNotMatch(html,/일러스트 미제작/);const list=await render(s);assert.match(list,/<progress aria-label="촬영한 요괴" value="1" max="102"/);assert.match(list,/<progress aria-label="모은 사진" value="0" max="192"/);
 const filtered=await render(initialState(),null,undefined,{filter:'winter'});assert.equal([...filtered.matchAll(/data-entry=/g)].length,18);assert.match(filtered,/겨울 · 18종/);assert.ok(!filtered.includes('data-entry="yokai_001"'));assert.ok(!filtered.includes('사계절 공통 요괴 포함'));
});
test('captured shared Korean/Japanese origins display a readable label for every registered species',async()=>{
 const shared=catalog.yokai.filter(y=>y.origin==='kr_jp');assert.equal(shared.length,4);
 for(const y of shared){const s=initialState();s.discovered[y.id]={firstCapturedAt:at,captureCount:1,photos:{},coverSeason:null};
  const html=await render(s,y.id);assert.match(html,/요괴 이야기<\/h4><span>한국·일본<\/span>/,y.id);assert.doesNotMatch(html,/<dd>kr_jp<\/dd>/);
 }
});
for(const [state,label] of [['pending','사진을 저장하고 있어요'],['failed','이 사진을 저장하지 못했어요'],['missing','사진 파일을 찾을 수 없어요'],['unavailable','사진을 불러오지 못했어요'],['mismatch','촬영 기록과 일치하는 사진을 찾지 못했어요'],['full-missing','이 사진에는 전체 장면이 없어요'],['decode-error','사진을 표시할 수 없어요']])test(`${state} UI is explicit and retains captured detail`,async()=>{
 const s=initialState();s.discovered.yokai_021={firstCapturedAt:at,captureCount:1,photos:{spring:{photoKey:'k',at,...(['pending','failed'].includes(state)?{status:state}:{})}},coverSeason:'spring'};
 const html=await render(s,'yokai_021',{state,token:1});assert.ok(html.includes(label));assert.ok(html.includes(catalog.yokai[20].description));assert.ok(!html.includes('blob:'));if(state==='failed')assert.ok(html.includes(catalog.yokai[20].art.still.publicPath));assert.doesNotMatch(html,/대표/);assert.equal(html.includes('사진 다시 열기'),!['pending','failed','full-missing'].includes(state));
});
test('read errors are visible without empty progress and provide query retry',async()=>{
 for(const error of ['corrupt','unsupported-version','unavailable']){const html=await render(initialState(),null,undefined,{phase:'error',error,model:null});assert.ok(!html.includes('0 / 60'));assert.match(html,/role="alert"/);assert.match(html,/도감 다시 열기/);}
});

test('common tab renders only 30 entries with the selected count',async()=>{
 const html=await render(initialState(),null,undefined,{filter:'common'});
 assert.equal([...html.matchAll(/data-entry=/g)].length,30);
 assert.match(html,/aria-pressed="true">사계절/);
 assert.match(html,/사계절 · 30종/);
 assert.ok(!html.includes('data-entry="yokai_021"'));
});

test('rarity filter composes with season and exposes color labels',async()=>{
 const html=await render(initialState(),null,undefined,{filter:'spring',rarity:'rare'});
 assert.equal([...html.matchAll(/data-entry=/g)].length,6);
 assert.match(html,/aria-label="등급 필터"/);
 assert.match(html,/data-rarity="rare"/);
});

test('capture dates render local year, month, day and time to seconds with the original machine timestamp', async()=>{
 const s=initialState(), first='2026-11-15T15:02:07.321Z', later='2026-11-16T09:33:04.987Z';
 s.discovered.yokai_021={firstCapturedAt:first,captureCount:2,photos:{spring:{photoKey:'k',at:later,status:'saved'}},coverSeason:'spring'};
 const html=await render(s,'yokai_021',{state:'ready',token:1,url:'blob:card'},{},{timeZone:'Asia/Seoul'});
 assert.ok(html.includes(`<time dateTime="${later}">2026년 11월 16일 18:33:04</time>`));
 assert.ok(html.includes(`<time dateTime="${first}">2026년 11월 16일 00:02:07</time>`));
 assert.doesNotMatch(html,/>[^<]*T(?:09:33|15:02):/);
});

test('detail pager shows position, disables boundaries and hides unseen neighbor names',async()=>{
 const s=initialState(),detailOrder=['yokai_021','yokai_022','yokai_023'];
 const first=await render(s,detailOrder[0],undefined,{detailOrder});
 assert.match(first,/aria-label="요괴 넘기기"/);assert.match(first,/1 \/ 3/);
 assert.match(first,/<button[^>]*disabled=""[^>]*aria-label="이전 요괴"/);
 assert.match(first,/aria-label="다음 요괴: \?\?\?"/);
 for(const y of catalog.yokai.filter(y=>detailOrder.includes(y.id)))assert.ok(!first.includes(y.name));
 const middle=await render(s,detailOrder[1],undefined,{detailOrder});assert.match(middle,/2 \/ 3/);
 assert.match(middle,/aria-label="이전 요괴: \?\?\?"/);assert.match(middle,/aria-label="다음 요괴: \?\?\?"/);
 const last=await render(s,detailOrder[2],undefined,{detailOrder});assert.match(last,/3 \/ 3/);
 assert.match(last,/<button[^>]*disabled=""[^>]*aria-label="다음 요괴"/);
});

test('Western captured details use the readable folklore label',async()=>{
 const s=initialState();s.discovered.yokai_093={firstCapturedAt:at,captureCount:1,photos:{},coverSeason:null};
 const html=await render(s,'yokai_093');assert.match(html,/요괴 이야기<\/h4><span>먼 나라<\/span>/);
 assert.ok(html.includes('브라우니'));
});
