import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {withSpecialMotion} from '../src/scene/special-motion.ts';
import {compileScene} from '../src/scene/composition.ts';
const preview=await import('../src/runtime/preview.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
test('runtime overrides only exist behind explicit independent scheduler preview opt-in',()=>{
 assert.equal(typeof preview.resolveRuntimePreview,'function');
 assert.equal(preview.resolveRuntimePreview('?season=winter&family=hill&seed=5'),null);
 assert.equal(preview.resolveRuntimePreview('?scenePreview=1&season=winter'),null);
 assert.deepEqual(preview.resolveRuntimePreview('?schedulerPreview=1&season=winter&family=hill&seed=5'),{season:'winter',family:'hill',seed:5});
 for(const q of ['season=bad','family=bad','seed=NaN','seed=-1'])assert.throws(()=>preview.resolveRuntimePreview(`?schedulerPreview=1&${q}`),/preview/i);
 const a=preview.seededRandom(5),b=preview.seededRandom(5);assert.deepEqual(Array.from({length:10},a),Array.from({length:10},b));
});
test('runtime DOM uses two background-only scenes in fade, one visiting body and unchanged sample geometry',async()=>{
 assert.ok(fs.existsSync('src/runtime/RuntimeView.tsx'),'RuntimeView implementation required');
 const dir=fs.mkdtempSync(path.resolve('.a04-render-'));
 try{
 execFileSync('node_modules/.bin/tsc',['--ignoreConfig','--noEmit','false','--jsx','react-jsx','--module','ESNext','--moduleResolution','Bundler','--target','ES2022','--skipLibCheck','--rewriteRelativeImportExtensions','--resolveJsonModule','--types','vite/client','--outDir',dir,'src/runtime/RuntimeView.tsx'],{encoding:'utf8'});
 const {RuntimeView}=await import(pathToFileURL(path.join(dir,'runtime/RuntimeView.js')));
 const make=(season,yokaiId=null)=>{const plan=compileScene(catalog,{family:'forest',season,yokaiId,playback:{originMs:100}});return {plan,requestId:1,images:Object.fromEntries(plan.layers.flatMap(l=>l.files).map(file=>[file.publicPath,{url:file.publicPath}]))};};
 const from=make('spring'),to=make('summer'),body=make('spring','yokai_025');
 const base={phase:'waiting',display:null,visit:null,candidate:null};
 const render=(scheduler,background)=>renderToStaticMarkup(createElement(RuntimeView,{scheduler,background,nowMs:400,scale:2}));
 const fade=render(base,{current:from,from,to,progress:.5,originMs:0,durationMs:3000,sampledAt:1500});
 assert.equal([...fade.matchAll(/data-layer="background"/g)].length,2);assert.ok(!fade.includes('data-layer="body"'));assert.match(fade,/opacity:0.5/);
 const waiting=render({...base,phase:'awaiting-display',display:{bundle:body,presentation:null},candidate:{rarity:'common'}},{current:from,from:null,to:null,progress:1});
 assert.ok(!waiting.includes('data-layer="body"'));
 const html=render({...base,phase:'appearing',display:{bundle:body},visit:{shownMono:100},candidate:{rarity:'common'}},{current:from,from:null,to:null,progress:1});
 assert.equal([...html.matchAll(/data-layer="background"/g)].length,1);assert.equal([...html.matchAll(/data-layer="body"/g)].length,1);assert.match(html,/opacity:0.5/);assert.match(html,/left:296px;top:308px;width:76px;height:86px/);
 const auraPlan=compileScene(withSpecialMotion(catalog),{family:'forest',season:'autumn',yokaiId:'yokai_050',playback:{originMs:400}});
 const auraBundle={plan:auraPlan,requestId:2,images:Object.fromEntries(auraPlan.layers.flatMap(l=>l.files).map(file=>[file.publicPath,{url:file.publicPath}]))};
 const auraHtml=render({...base,phase:'visiting',display:{bundle:auraBundle},visit:{shownMono:0},candidate:{rarity:'special'}},{current:from});
 assert.match(auraHtml, /data-layer="ambient_aura"[^>]*style="opacity:0.38;/);
 assert.doesNotMatch(auraHtml, /data-layer="mane_aura"/);
 assert.ok(!html.includes('machine.png'));assert.ok(!html.includes('support_props'));assert.ok(!html.includes('onClick'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
