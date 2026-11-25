import test from 'node:test';
import assert from 'node:assert/strict';
const {GameAudio}=await import('../src/audio/player.ts').catch(()=>({}));
function fake(){
 let started=0,stopped=0,closed=0;
 const param=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}});
 const ctx={state:'running',currentTime:0,destination:{},resume:async()=>{},close:async()=>{closed++;},
  createGain:()=>({gain:param(),connect(){},disconnect(){}}),
  createOscillator:()=>({frequency:param(),connect(){},disconnect(){},start(){started++;},stop(){stopped++;}})};
 return {ctx,get started(){return started;},get stopped(){return stopped;},get closed(){return closed;}};
}
test('silent by default; independent music/chime switches; repeat visits never ring twice',async()=>{
 const f=fake();let created=0;const p=new GameAudio(()=>{created++;return f.ctx;});
 await p.unlock();p.arrival('first');assert.equal(created,0);
 p.configure({sound:false,arrivalChime:true});await p.unlock();
 p.arrival('second');const count=f.started;assert.ok(count>0);
 p.arrival('second');assert.equal(f.started,count);
 p.configure({sound:false,arrivalChime:false});p.arrival('third');assert.equal(f.started,count);
 p.configure({sound:true,arrivalChime:false});assert.ok(f.started>count);
 p.dispose();assert.equal(f.closed,1);
});
test('hidden and disposed player is silent, unsupported audio does not throw',async()=>{
 const f=fake(),p=new GameAudio(()=>f.ctx);p.configure({sound:false,arrivalChime:true});await p.unlock();
 p.setVisible(false);p.arrival('hidden');assert.equal(f.started,0);
 p.setVisible(true);p.arrival('hidden');assert.equal(f.started,0);
 p.arrival('visible');assert.ok(f.started>0);p.dispose();const count=f.started;
 p.arrival('after');assert.equal(f.started,count);
 const unavailable=new GameAudio(()=>{throw Error('unavailable');});unavailable.configure({sound:true,arrivalChime:true});await unavailable.unlock();unavailable.arrival('x');unavailable.dispose();
});
