import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileScene} from '../src/scene/composition.ts';
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
test('actual DOM view emits integer geometry and ordered original cel URLs, no machine/support duplicates',async()=>{
  assert.ok(fs.existsSync('src/scene/SceneView.tsx'),'SceneView implementation is required');
  const dir=fs.mkdtempSync(path.resolve('.a03-render-'));
  try{
    execFileSync('node_modules/.bin/tsc',['--ignoreConfig','--noEmit','false','--jsx','react-jsx','--module','ESNext','--moduleResolution','Bundler','--target','ES2022','--skipLibCheck','--rewriteRelativeImportExtensions','--resolveJsonModule','--types','vite/client','--outDir',dir,'src/scene/SceneView.tsx'],{encoding:'utf8'});
    const {SceneView}=await import(pathToFileURL(path.join(dir,'scene/SceneView.js')));
    const plan=compileScene(catalog,{family:'hill',season:'winter',yokaiId:'yokai_060',playback:{originMs:0}});
    const images=Object.fromEntries(plan.layers.flatMap(l=>l.files).map(file=>[file.publicPath,{file,url:`/nested/${file.publicPath}`} ]));
    const html=renderToStaticMarkup(createElement(SceneView,{bundle:{plan,images,requestId:1},nowMs:0,scale:2}));
    assert.deepEqual([...html.matchAll(/data-layer="([^"]+)"/g)].map(m=>m[1]),['background','wing_aura','body','tail_aura']);
    assert.match(html,/width:384px;height:512px/);
    assert.match(html,/data-layer="body"[^>]*data-cel="1"/);
    assert.ok(html.includes('/nested/game-assets/요괴/겨울/animation/frames/yokai_060_01.png'));
    assert.ok(!html.includes('machine.png'));assert.ok(!html.includes('support_props.png'));
    assert.ok(!html.includes('onClick'));
    // A delayed first bundle must sample the current clock, not restart at zero.
    const firstPaint=renderToStaticMarkup(createElement(SceneView,{bundle:{plan,images,requestId:1},nowMs:null,readNow:()=>2000,scale:2}));
    assert.match(firstPaint,/data-layer="body"[^>]*data-cel="0"/);
    const half=compileScene(catalog,{family:'forest',season:'spring',yokaiId:'yokai_025',playback:{originMs:0}});
    const halfImages=Object.fromEntries(half.layers.flatMap(l=>l.files).map(file=>[file.publicPath,{file,url:file.publicPath}]));
    const shifted=renderToStaticMarkup(createElement(SceneView,{bundle:{plan:half,images:halfImages,requestId:2},nowMs:0,scale:2}));
    assert.match(shifted,/left:296px;top:308px;width:76px;height:86px/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
