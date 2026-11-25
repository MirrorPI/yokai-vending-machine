import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../src/encyclopedia/panel.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
function fixture(){
 const doc=new EventTarget();const button=()=>({isConnected:true,focus(){doc.activeElement=this;},getClientRects(){return [1];}});const previous=button(),first=button(),last=button();doc.activeElement=previous;
 const dialog={ownerDocument:doc,contains:e=>e===first||e===last||e===dialog,querySelectorAll:()=>[first,last],focus(){doc.activeElement=dialog;}};
 let closed=0;assert.equal(typeof api.installPanelBehavior,'function','panel behavior required');const dispose=api.installPanelBehavior({dialog,onClose:()=>closed++});
 const key=(key,shiftKey=false)=>{const e=new Event('keydown',{cancelable:true,bubbles:true});Object.assign(e,{key,shiftKey});doc.dispatchEvent(e);return e;};return {doc,first,last,previous,dialog,key,dispose,get closed(){return closed;}};
}
test('panel focuses first control, traps forward/backward tab and restores opener on cleanup',()=>{
 const h=fixture();assert.equal(h.doc.activeElement,h.first);h.last.focus();assert.equal(h.key('Tab').defaultPrevented,true);assert.equal(h.doc.activeElement,h.first);h.key('Tab',true);assert.equal(h.doc.activeElement,h.last);h.dispose();assert.equal(h.doc.activeElement,h.previous);
});
test('ESC closes and cleanup removes keyboard listener',()=>{
 const h=fixture();assert.equal(h.key('Escape').defaultPrevented,true);assert.equal(h.closed,1);h.dispose();h.key('Escape');assert.equal(h.closed,1);
});
test('lost focus returns inside modal',()=>{
 const h=fixture();h.previous.focus();h.doc.dispatchEvent(new Event('focusin'));assert.equal(h.doc.activeElement,h.first);h.dispose();
});
test('collection navigation remains keyboard accessible while a panel is open',()=>{
 const doc=new EventTarget();
 const button=()=>({isConnected:true,focus(){doc.activeElement=this;},getClientRects(){return [1];}});
 const inside=button(),navButton=button();
 const dialog={ownerDocument:doc,contains:e=>e===inside||e===dialog,querySelectorAll:()=>[inside],focus(){doc.activeElement=dialog;}};
 const nav={contains:e=>e===navButton,querySelectorAll:()=>[navButton]};
 doc.activeElement=navButton;
 const dispose=api.installPanelBehavior({dialog,onClose:()=>{}, navigation:nav});
 navButton.focus();doc.dispatchEvent(new Event('focusin'));assert.equal(doc.activeElement,navButton);
 const e=new Event('keydown',{cancelable:true});Object.assign(e,{key:'Tab',shiftKey:false});doc.dispatchEvent(e);
 assert.equal(e.defaultPrevented,true);assert.equal(doc.activeElement,inside);dispose();
});
