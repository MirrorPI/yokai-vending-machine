import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleScene } from '../src/scene/composition.ts';
test('flight moves one way with a shallow arc, never loops position or deforms body',()=>{
 const file={size:[48,48]},plan={input:{playback:{originMs:100}},layers:[{id:'body',files:[file],x:-16,y:72,width:48,height:48,flight:{distance:240,durationMs:4000,arcHeight:8}}]};
 const frames=[0,1000,2000,3000,4000,6000].map(t=>sampleScene(plan,t+100)[0]);
 assert.deepEqual(frames.map(f=>f.x),[-16,44,104,164,224,224]);
 assert.ok(frames.every(f=>f.width===48&&f.height===48));assert.equal(frames[2].y,64);assert.equal(frames[4].y,72);
});
test('right-to-left reflects the trajectory and sprite, not its size, timing or background',()=>{
 const file={size:[48,48]},plan={input:{playback:{originMs:100},flightDirection:'right-to-left'},layers:[{id:'background',files:[file],x:0,y:0,width:192,height:256},{id:'body',files:[file],x:-16,y:72,width:48,height:48,flight:{distance:240,durationMs:4000,arcHeight:8}}]};
 const frames=[0,1000,2000,3000,4000,6000].map(t=>sampleScene(plan,t+100));
 assert.deepEqual(frames.map(f=>f[1].x),[160,100,40,-20,-80,-80]);
 assert.ok(frames.every(f=>f[1].flipX===true&&f[1].width===48&&f[0].flipX===undefined&&f[0].x===0));
 assert.equal(frames[2][1].y,64);
});

test('a flight visit samples direction once and keeps it through failed preparation and origin binding',async()=>{
 const {VisitScheduler}=await import('../src/runtime/scheduler.ts');const {candidatesFor}=await import('../src/runtime/rules.ts');const fs=await import('node:fs');
 const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
 for(const [random,direction]of [[.1,'left-to-right'],[.9,'right-to-left']]){
  let now=1000,draws=0,attempts=0;const plans=[];
  const s=new VisitScheduler({clock:{monotonic:()=>now,wall:()=>1700000000000+now},random:()=>{draws++;return random;},createVisitId:()=> 'flight-test',candidates:(season,family)=>candidatesFor(catalog,season,family).available,
   prepare:async plan=>{plans.push(plan);if(++attempts===1)throw Error('decode once');return {plan,requestId:1,images:{}};}},{season:'spring',family:'forest',manualSelection:true});
  s.setObservation({observable:true,authorized:true});s.confirmRecovery(s.state.recoveryToken,true);
  assert.equal(s.requestImmediateVisit('yokai_074'),true);s.tick();await Promise.resolve();await Promise.resolve();
  assert.equal(s.state.loadStatus,'failed');assert.equal(plans[0].input.flightDirection,direction);
  const before=draws;s.retryPreparation();await Promise.resolve();await Promise.resolve();
  assert.equal(draws,before);assert.equal(plans[0],plans[1]);
  now+=100;s.beginPresentation(s.state.display.token,{monotonicMs:now,wallMs:1700000000000+now});
  assert.equal(s.state.display.bundle.plan.input.flightDirection,direction);assert.equal(s.state.display.bundle.plan.input.playback.originMs,now);
 }
});

test('mirrored capture pixels, hit targets and face crop follow the rendered sprite',async()=>{
 const {freezeCapture,hitCapture}=await import('../src/capture/scene.ts');
 const file={sourcePath:'asymmetric',publicPath:'asymmetric',sha256:'test',size:[4,2]},rgba=new Uint8ClampedArray(4*2*4);
 rgba.set([255,10,20,255],0); // only source top-left is opaque
 const forward={input:{family:'forest',season:'spring',yokaiId:'yokai_074',playback:{originMs:0}},layers:[{id:'body',files:[file],x:50,y:80,width:40,height:20,flight:{distance:100,durationMs:4000,arcHeight:0}}]};
 const mirrored={...forward,input:{...forward.input,flightDirection:'right-to-left'}};
 const definition={giant:null,metadata:{giant:false,anchor:[2,1],sourceOrigin:[0,0],faceAnchor:[.5,.5]}},read=()=>({width:4,height:2,data:rgba});
 const freeze=plan=>freezeCapture({bundle:{plan,requestId:1},sampledAtMono:0,family:'forest',sceneSeason:'spring',gameSeason:'spring'},definition,read);
 const a=freeze(forward),b=freeze(mirrored);
 assert.deepEqual(a.bounds,{left:50,top:80,right:60,bottom:90});assert.deepEqual(b.bounds,{left:132,top:80,right:142,bottom:90});
 assert.deepEqual(a.crop,{x:7,y:21,width:96,height:128});assert.deepEqual(b.crop,{x:89,y:21,width:96,height:128});
 assert.deepEqual([...a.rgba().slice((80*192+50)*4,(80*192+50)*4+4)],[255,10,20,255]);
 assert.deepEqual([...b.rgba().slice((80*192+141)*4,(80*192+141)*4+4)],[255,10,20,255]);
 const input=x=>({clientX:x,clientY:85,rect:{left:0,top:0,width:192,height:256},topmostScene:true,modal:false,blockedRects:[]});
 assert.equal(hitCapture(b,input(137)),true);assert.equal(hitCapture(b,input(55)),false);
});
