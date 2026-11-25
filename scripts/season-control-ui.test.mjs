import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {buildSync} from 'esbuild';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {initialState} from '../src/domain/state.ts';
const dir=fs.mkdtempSync(path.resolve('.season-ui-'));
let View;
test.before(async()=>{buildSync({entryPoints:['src/settings/SeasonControl.tsx'],bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},outfile:path.join(dir,'view.mjs')});View=(await import(pathToFileURL(path.join(dir,'view.mjs')))).SeasonControl;});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
function render(count){const state=initialState();for(let n=1;n<=count;n++)state.discovered[`yokai_${String(n).padStart(3,'0')}`]={captureCount:1};const controller={subscribe:()=>()=>{},snapshot:{state,phase:'ready'},change(){}};return renderToStaticMarkup(createElement(View,{controller}));}
test('locked season selector has a padlock, fixed 50 species condition and no cycle duration',()=>{
 const html=render(49);assert.match(html,/class="season-lock"/);assert.match(html,/계절 선택 잠김 · 49\/50종 촬영/);assert.match(html,/49종 촬영, 50종에 잠금 해제/);
 assert.match(html,/<summary[^>]*>계절<\/summary>/);assert.match(html,/<fieldset[^>]*season-control-group--locked/);assert.match(html,/<legend[^>]*>.*49 \/ 50.*<\/legend>/);
 assert.match(html,/도감에 서로 다른 요괴 50종을 촬영해 등록하면 계절 고정이 열려요\./);
 assert.match(html,/title="도감에 촬영한 서로 다른 요괴 수: 49 \/ 50종"/);
 assert.doesNotMatch(html,/45|50%|102종 중/);assert.equal([...html.matchAll(/disabled=""/g)].length,4);
});
test('exactly 50 species removes the padlock and enables all four season buttons',()=>{
 const html=render(50);assert.doesNotMatch(html,/season-lock|disabled=|45/);assert.match(html,/자동 순환<\/button>/);assert.match(html,/원하는 계절에 머물러/);
});
test('each season option exposes its own season for distinct visual treatment',()=>{
 const html=render(50);
 for(const [season,label] of [['spring','봄'],['summer','여름'],['autumn','가을'],['winter','겨울']])
  assert.match(html,new RegExp(`<button[^>]*data-season="${season}"[^>]*>${label}</button>`));
});
