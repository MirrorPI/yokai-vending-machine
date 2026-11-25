import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileScene} from '../src/scene/composition.ts';
const api=await import('../src/capture/scene.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
const solid=(w,h,a=255)=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>i%4===3?a:80)});
function fixture({giant=false,opacity=1,foreground=false,bodyY=80}={}) {
 assert.equal(typeof api.freezeCapture,'function','A06 immutable scene sample required');
 const file=id=>({publicPath:id,sourcePath:id,sha256:id,bytes:1,size:[10,10]});
 const bg={...file('bg'),size:[192,256]},body=file('body'),fg={...file('fg'),size:[192,256]};
 const plan={input:{family:'forest',season:'spring',yokaiId:'yokai_021',playback:{originMs:0}},mapId:'forest_spring',layers:[
 {id:'background',files:[bg],x:0,y:0,width:192,height:256,order:0},
 {id:'body',files:[body],x:40,y:bodyY,width:10,height:10,order:20},
 ...(foreground?[{id:'foreground',files:[fg],x:0,y:0,width:192,height:256,order:30}]:[])]};
 const pixels={bg:solid(192,256),body:solid(10,10),fg:solid(192,256,0)};
 pixels.body.data[4*(5*10+5)+3]=0;
 if(foreground)pixels.fg.data[4*(82*192+42)+3]=255;
 const context={token:1,visitId:'v1',generation:1,owner:{sessionId:'a',epoch:1},displayToken:4,bundle:{plan,images:{},requestId:2},sampledAtMono:100,gameSeason:'winter',sceneSeason:'spring',family:'forest',slotSeason:'spring'};
 const definition={giant:giant?{faceAnchor:[5,5]}:null,metadata:{giant,anchor:[5,10],sourceOrigin:[0,0]}};
 return {context,pixels,sample:api.freezeCapture(context,definition,f=>pixels[f.publicPath],opacity)};
}
const input=(x,y,scale=1)=>({clientX:17+x*scale,clientY:29+y*scale,rect:{left:17,top:29,width:192*scale,height:256*scale},topmostScene:true,modal:false,blockedRects:[]});
test('normal target expands to 44 screen px while transparent interior holes and foreground stay blocked',()=>{
 const {sample}=fixture({foreground:true});
 assert.equal(api.hitCapture(sample,input(30,84)),true);
 assert.equal(api.hitCapture(sample,input(45,85)),false);
 assert.equal(api.hitCapture(sample,input(42,82)),false);
 assert.equal(api.hitCapture(sample,input(22,84)),false);
 assert.equal(api.hitCapture(sample,input(40,80)),true);
});
for(const scale of [1,2,3,1.25])test(`screen offset and scale ${scale} determine the logical hit`,()=>{
 const {sample}=fixture();assert.equal(api.hitCapture(sample,input(41,81,scale)),true);
 assert.equal(api.hitCapture(sample,input(45,85,scale)),false);
 assert.equal(api.hitCapture(sample,input(-1,80,scale)),false);
});
test('giant only uses opaque body, never minimum expansion, y>=230, ads, UI or modal',()=>{
 const {sample}=fixture({giant:true});
 assert.equal(api.hitCapture(sample,input(30,84)),false);assert.equal(api.hitCapture(sample,input(41,81)),true);
 for(const change of [{modal:true},{topmostScene:false},{blockedRects:[{left:17+40,top:29+80,width:10,height:10}]},{clientY:29+230},{clientY:29+256}])assert.equal(api.hitCapture(sample,{...input(41,81),...change}),false);
});
test('zero displayed opacity and invalid viewport fail closed',()=>{
 const {sample}=fixture({opacity:0});assert.equal(api.hitCapture(sample,input(41,81)),false);
 const {sample:s}=fixture();assert.equal(api.hitCapture(s,{...input(41,81),rect:{left:0,top:0,width:0,height:0}}),false);
});
test('sample copies original pixels, draw, seasons and origin; later asset mutation cannot change capture',()=>{
 const {sample,pixels,context}=fixture();const before=sample.rgba();pixels.body.data.fill(0);context.bundle.plan.input.family='hill';
 assert.deepEqual(sample.rgba(),before);assert.equal(sample.family,'forest');assert.equal(sample.gameSeason,'winter');assert.equal(sample.draw[1].cel,0);assert.ok(Object.isFrozen(sample.draw));
 const copy=sample.rgba();copy.fill(0);assert.deepEqual(sample.rgba(),before);
});
test('crop uses source anchor transforms, ties-to-even, clamps all edges without padding or resize',()=>{
 assert.equal(typeof api.photoCrop,'function');
 for(const [point,want] of [[[0,0],[0,0]],[[192,256],[96,128]],[[100.5,100.5],[52,36]],[[30,194],[0,128]]])assert.deepEqual(api.photoCrop(point),{x:want[0],y:want[1],width:96,height:128});
 const {sample}=fixture();assert.deepEqual(sample.crop,{x:0,y:26,width:96,height:128});assert.equal(sample.rgba(true).length,96*128*4);
});
test('real approved 384 scenes preserve exact body/auxiliary frame sample and giant face anchor',()=>{
 assert.equal(typeof api.freezeCapture,'function');let count=0;
 for(const entry of catalog.compatibility.metadata.verifiedDefaults)for(const family of entry.families){
 const y=catalog.yokai.find(y=>y.no===entry.no),plan=compileScene(catalog,{family,season:entry.season,yokaiId:y.id,playback:{originMs:713}});
 const context={token:1,visitId:'v',generation:1,owner:{sessionId:'x',epoch:1},displayToken:1,bundle:{plan,images:{},requestId:1},sampledAtMono:2713,gameSeason:entry.season,sceneSeason:entry.season,family,slotSeason:entry.season};
 const s=api.freezeCapture(context,{giant:y.giant??null,metadata:y.art.animation.metadata},f=>solid(...f.size));
 assert.equal(s.draw[0].id,'background');assert.equal(s.rgba(true).length,49152);assert.equal(s.rgba().length,196608);
 if(y.giant)assert.deepEqual(s.crop,api.photoCrop(y.giant.faceAnchor));count++;
 }assert.equal(count,384);
});
test('fully visible soft auxiliary pixels match original sequential RGBA rounding',()=>{
 const {context,pixels}=fixture();pixels.bg.data.set([17,23,43,255],0);
 const file=id=>({publicPath:id,sourcePath:id,sha256:id,bytes:1,size:[192,256]});
 const aura=file('aura'),mane=file('mane');const plan=context.bundle.plan;
 plan.layers.push({id:'aura',files:[aura],x:0,y:0,width:192,height:256,order:10},{id:'mane',files:[mane],x:0,y:0,width:192,height:256,order:30});plan.layers.sort((a,b)=>a.order-b.order);
 pixels.aura=solid(192,256,0);pixels.aura.data.set([246,190,100,145],0);pixels.mane=solid(192,256,0);pixels.mane.data.set([5,3,1,2],0);
 const sample=api.freezeCapture(context,{giant:null,metadata:{giant:false,anchor:[5,10],sourceOrigin:[0,0]}},f=>pixels[f.publicPath]);
 assert.deepEqual([...sample.rgba().slice(0,4)],[146,117,74,255]);
});
for(const giant of [false,true])test(`safe band y>=230 excludes ${giant?'giant':'normal'} opaque target and minimum hit extension`,()=>{
 const {sample}=fixture({giant,bodyY:225});assert.equal(api.hitCapture(sample,input(41,229)),true);assert.equal(api.hitCapture(sample,input(41,230)),false);
});

test('capture freezes the same aura opacity as the scene without expanding the clickable body',()=>{
 const {context,pixels}=fixture({giant:true});
 for(let i=0;i<pixels.bg.data.length;i+=4){pixels.bg.data[i]=pixels.bg.data[i+1]=pixels.bg.data[i+2]=0;}
 const aura={publicPath:'aura',size:[1,1]};pixels.aura={width:1,height:1,data:new Uint8ClampedArray([255,0,0,255])};
 context.bundle.plan.layers.splice(1,0,{id:'ambient_aura',files:[aura],x:10,y:10,width:1,height:1,order:10,opacityPulse:{min:0.2,max:0.6,periodMs:2000}});
 const definition={giant:{faceAnchor:[5,5]},metadata:{giant:true,anchor:[5,10],sourceOrigin:[0,0]}};
 for(const [t,want]of [[0,51],[1000,153],[2000,51]]){
  const sample=api.freezeCapture({...context,sampledAtMono:t},definition,f=>pixels[f.publicPath]);
  assert.deepEqual([...sample.rgba().slice((10*192+10)*4,(10*192+10)*4+4)],[want,0,0,255]);
  assert.equal(api.hitCapture(sample,input(10,10)),false);
 }
});
