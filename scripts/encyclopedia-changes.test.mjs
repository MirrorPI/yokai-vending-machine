import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../src/storage/changes.ts');
test('visible storage/focus/timer refresh is read-only, filters unrelated keys and unsubscribes on close',()=>{
 const w=new EventTarget(),d=new EventTarget();d.visibilityState='visible';let interval,cleared=0,changes=0;
 w.setInterval=(f,ms)=>{assert.equal(ms,2000);interval=f;return 5;};w.clearInterval=id=>{assert.equal(id,5);cleared++;};
 const dispose=api.subscribeGameChanges(()=>changes++,{window:w,document:d});const storage=key=>{const e=new Event('storage');Object.assign(e,{key});w.dispatchEvent(e);};
 storage('unrelated');assert.equal(changes,0);storage('yokai-vending:save');assert.equal(changes,1);w.dispatchEvent(new Event('focus'));interval();assert.equal(changes,3);d.visibilityState='hidden';storage(null);interval();assert.equal(changes,3);d.visibilityState='visible';d.dispatchEvent(new Event('visibilitychange'));assert.equal(changes,4);dispose();w.dispatchEvent(new Event('focus'));storage(null);assert.equal(changes,4);assert.equal(cleared,1);
});
