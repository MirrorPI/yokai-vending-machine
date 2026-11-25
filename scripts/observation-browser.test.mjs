import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import { BrowserPresentationHost } from '../src/observation/browser.ts';import { SurfaceRegistry } from '../src/observation/surfaces.ts';
import { candidatesFor } from '../src/runtime/rules.ts';import { sampleScene, withFlightDirection } from '../src/scene/composition.ts';
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
function setup(id,direction){const choices=candidatesFor(catalog,'spring','forest').available;const base=(id?choices.find(y=>y.id===id):choices[0]).plan;const plan=direction?withFlightDirection(base,direction):base;const frames=new Map();let serial=0;const doc=new EventTarget(),win=new EventTarget();Object.assign(win,{closed:false,innerWidth:384,innerHeight:576,requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),getComputedStyle:e=>({display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',...e.css})});Object.assign(doc,{defaultView:win,visibilityState:'visible'});const rect={left:0,top:0,width:384,height:512,right:384,bottom:512};const root={isConnected:true,ownerDocument:doc,contains:()=>true};const images=Object.fromEntries(sampleScene(plan,1000).map(l=>[l.file.publicPath,{url:'http://127.0.0.1/'+l.file.publicPath,image:{complete:true,naturalWidth:l.file.size[0]}}]));const bundle={plan,requestId:1,images};const overlay={};const imgs=sampleScene(plan,1000).map(l=>({css:{transform:l.flipX?'matrix(-1, 0, 0, 1, 0, 0)':'none'},dataset:{layer:l.id,cel:String(l.cel)},src:images[l.file.publicPath].url,complete:true,naturalWidth:l.file.size[0],getBoundingClientRect:()=>({left:l.x*2,top:l.y*2,width:l.width*2,height:l.height*2})}));const scene={...root,dataset:{bundle:'1',map:plan.mapId,sampledAt:'1000'},parentElement:null,getBoundingClientRect:()=>rect,querySelectorAll:()=>imgs,querySelector:()=>overlay};const element={querySelector:()=>scene};doc.elementFromPoint=()=>({closest:q=>q==='.scene'?scene:null});let time=1000;const surfaces=new SurfaceRegistry(root),host=new BrowserPresentationHost(surfaces,element,()=>time);const ticket={bundle,token:1,yokaiId:plan.input.yokaiId,owner:{sessionId:'s',epoch:1},monotonicMs:1000,wallMs:1000};return {doc,win,root,scene,imgs,bundle,host,ticket,surfaces,setTime:t=>time=t,frame:()=>{const a=[...frames.values()];frames.clear();a.forEach(f=>f());}};}
test('browser display requires matching DOM bundle, layers, decode, frame geometry and two frames',()=>{const h=setup();assert.equal(h.host.projection(h.bundle,1000),true);let proof;h.host.watch(h.ticket,p=>proof=p);h.frame();assert.equal(proof,undefined);h.frame();assert.ok(proof);assert.equal(h.host.confirmDisplay(h.ticket,proof),true);assert.equal(h.host.confirmDisplay(h.ticket,proof),false);h.surfaces.dispose();});
test('forged proof, detached/hidden/closed/old-document/bundle/cel/decode are rejected',()=>{for(const change of [h=>h.root.isConnected=false,h=>h.doc.visibilityState='hidden',h=>h.win.closed=true,h=>h.scene.ownerDocument={},h=>h.scene.dataset.bundle='9',h=>h.imgs[0].dataset.cel='999',h=>h.imgs[0].complete=false,h=>h.scene.css={opacity:'0'},h=>h.imgs[0].css={visibility:'hidden'}]){const h=setup();change(h);assert.equal(h.host.projection(h.bundle,1000),false);assert.equal(h.host.confirmDisplay(h.ticket,{}),false);h.surfaces.dispose();}});
test('surface generation or ticket identity invalidates an already issued proof',()=>{for(const mode of ['surface','ticket']){const h=setup();let proof;h.host.watch(h.ticket,p=>proof=p);h.frame();h.frame();if(mode==='surface')h.surfaces.rebind();assert.equal(h.host.confirmDisplay(mode==='ticket'?{...h.ticket}:h.ticket,proof),false);h.surfaces.dispose();}});
test('cancelling before confirmation and panel topmost suppression produce no proof',()=>{for(const mode of ['cancel','panel']){const h=setup();let count=0;const cancel=h.host.watch(h.ticket,()=>count++);if(mode==='cancel')cancel();else h.doc.elementFromPoint=()=>({closest:()=>null});h.frame();h.frame();assert.equal(count,0);cancel();h.surfaces.dispose();}});
test('an arbitrary input proof never authorizes frozen capture',()=>{const h=setup();assert.equal(h.host.confirmInput({}, {}, {proof:{}}),false);h.surfaces.dispose();});

test('fractional pixel-grid scaling preserves display proof and rejects displaced or stretched layers',()=>{
 const h=setup(), scale=85/64;
 const draw=sampleScene(h.bundle.plan,1000);
 const r={left:0,top:0,width:192*scale,height:256*scale,right:192*scale,bottom:256*scale};
 h.scene.getBoundingClientRect=()=>r;
 h.imgs.forEach((img,i)=>{const l=draw[i];img.getBoundingClientRect=()=>({left:l.x*scale,top:l.y*scale,width:l.width*scale,height:l.height*scale});});
 assert.equal(h.host.projection(h.bundle,1000),true);
 const rect=h.imgs[0].getBoundingClientRect;
 h.imgs[0].getBoundingClientRect=()=>({...rect(),left:1});
 assert.equal(h.host.projection(h.bundle,1000),false);
 h.imgs[0].getBoundingClientRect=rect;r.height+=1;r.bottom+=1;
 assert.equal(h.host.projection(h.bundle,1000),false);
 h.surfaces.dispose();
});

test('moving flight proves the rendered frame between ticks and rejects stale, missing or future timestamps',()=>{
 const h=setup('yokai_074');h.setTime(1017);assert.equal(h.host.projection(h.bundle,1017),true);
 let proof;h.host.watch(h.ticket,p=>proof=p);h.frame();h.frame();assert.ok(proof);assert.equal(h.host.confirmDisplay(h.ticket,proof),true);
 for(const value of ['1200','800','NaN',undefined]){h.scene.dataset.sampledAt=value;assert.equal(h.host.projection(h.bundle,1017),false);}
 h.surfaces.dispose();
});
test('flight click freezes the displayed pose, rejects frame substitution and expires old input',async()=>{
 const {freezeCapture}=await import('../src/capture/scene.ts');const {decodeRgbaPng}=await import('../src/capture/png.ts');
 for(const mode of ['accept','substitute','expired']){
  const h=setup('yokai_074');h.setTime(1017);h.doc.querySelector=()=>null;h.doc.querySelectorAll=()=>[];
  const element={ownerDocument:h.doc,querySelector:()=>h.scene};
  const host=new BrowserPresentationHost(h.surfaces,element,()=>mode==='expired'&&expired?1200:1017);let expired=false;
  const event={isTrusted:true,target:h.scene,currentTarget:element,clientX:100,clientY:160};
  const input=host.input(event,h.bundle,1);assert.equal(input.sampledAtMono,1000);
  const context={sampledAtMono:input.sampledAtMono,bundle:h.bundle,displayToken:1,family:'forest',sceneSeason:'spring',gameSeason:'spring'};
  const rasters=new Map();for(const l of sampleScene(h.bundle.plan,1000))rasters.set(l.file.sourcePath,await decodeRgbaPng(fs.readFileSync(l.file.sourcePath),l.file.size));
  const y=catalog.yokai.find(y=>y.id==='yokai_074'),sample=freezeCapture(context,{giant:null,metadata:y.art.animation.metadata},f=>rasters.get(f.sourcePath));
  assert.equal(sample.draw.find(l=>l.id==='body').x,sampleScene(h.bundle.plan,1000).find(l=>l.id==='body').x);
  if(mode==='substitute')h.scene.dataset.sampledAt='1017';if(mode==='expired')expired=true;
  assert.equal(host.confirmInput(context,sample,input),mode==='accept');h.surfaces.dispose();
 }
});

test('reverse flight proof requires the actual horizontal reflection and rejects a visually wrong facing',()=>{
 const h=setup('yokai_074','right-to-left');assert.equal(h.host.projection(h.bundle,1000),true);
 const body=h.imgs.find(i=>i.dataset.layer==='body');body.css.transform='none';assert.equal(h.host.projection(h.bundle,1000),false);
 body.css.transform='matrix(1, 0, 0, -1, 0, 0)';assert.equal(h.host.projection(h.bundle,1000),false);h.surfaces.dispose();
});
