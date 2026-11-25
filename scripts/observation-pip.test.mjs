import test from 'node:test';import assert from 'node:assert/strict';import { PipController } from '../src/observation/pip.ts';
function setup(request){const win={isSecureContext:true,documentPictureInPicture:{requestWindow:request}};win.top=win;const surfaces={window:win,root:{parentNode:{},nextSibling:null}};return new PipController(surfaces);}
test('feature detection requires actual secure top-level document API',()=>{for(const mode of ['missing','insecure','iframe']){const p=setup(()=>{});if(mode==='missing')p.opener.documentPictureInPicture=undefined;if(mode==='insecure')p.opener.isSecureContext=false;if(mode==='iframe')p.opener.top={};assert.equal(p.available,false);p.dispose();}});
test('duplicate opening uses one native request and rejection remains retryable',async()=>{let reject,calls=0;const p=setup(()=>{calls++;return new Promise((_,r)=>reject=r);});const a=p.open(),b=p.open();assert.equal(a,b);assert.equal(calls,1);reject(Error('NotAllowedError: gesture rejected'));await a;assert.equal(p.status,'failed');assert.match(p.error,/NotAllowedError/);const c=p.open();assert.equal(calls,2);reject(Error('again'));await c;p.dispose();});
test('closed while opening or disposed before resolution never adopts a root',async()=>{for(const mode of ['closed','disposed']){let resolve,closed=0;const p=setup(()=>new Promise(r=>resolve=r));const task=p.open();if(mode==='disposed')p.dispose();resolve({closed:mode==='closed',close(){closed++;},get document(){throw Error('must not access detached document');}});await task;assert.equal(closed,1);assert.notEqual(p.status,'pip');p.dispose();}});
test('synchronous native request exception also clears opening state for a real retry',async()=>{let calls=0;const p=setup(()=>{calls++;throw Error('synchronous API failure');});await p.open();assert.equal(p.status,'failed');await p.open();assert.equal(calls,2);p.dispose();});
test('folding and restoring PiP resizes and pauses observation without moving the game root',async()=>{
 let pagehide;const calls=[];const root={parentNode:null,nextSibling:null,contains:()=>false};
 const home={appendChild(){},insertBefore(node){node.parentNode=this;}};root.parentNode=home;
 const doc={documentElement:{},head:{append(){}},body:{append(node){node.parentNode=this;}},activeElement:null,querySelector(){return null;},createElement(){return {append(){},remove(){}};}};
 const pipWindow={document:doc,closed:false,outerWidth:320,outerHeight:520,addEventListener(type,handler){if(type==='pagehide')pagehide=handler;},resizeTo(w,h){calls.push([w,h]);},close(){this.closed=true;}};
 const opener={isSecureContext:true,documentPictureInPicture:{requestWindow:async()=>pipWindow},document:{title:'요괴 자판기',baseURI:'http://localhost/',styleSheets:[],createElement(){return {append(){},remove(){}};}}};opener.top=opener;
 root.ownerDocument=doc;root.querySelector=()=>null;
 const surfaces={window:opener,document:opener.document,root,beginMove(){},rebind(){this.document=doc;this.window=pipWindow;},settleMove(){},setSuppressed(value){calls.push(['suppressed',value]);}};
 const controller=new PipController(surfaces);await controller.open();assert.equal(controller.status,'pip');
 controller.fold();assert.equal(opener.document.title,'작업 도구');assert.equal(controller.folded,true);assert.deepEqual(calls,[['suppressed',true],[1,1]]);assert.equal(root.parentNode,doc.body);
 controller.unfold();assert.equal(opener.document.title,'요괴 자판기');assert.equal(controller.folded,false);assert.deepEqual(calls.slice(2),[[320,520],['suppressed',false]]);assert.equal(root.parentNode,doc.body);
 controller.fold();assert.equal(opener.document.title,'작업 도구');pagehide();assert.equal(opener.document.title,'요괴 자판기');
 controller.dispose();
});
