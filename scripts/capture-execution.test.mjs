import test from 'node:test';import assert from 'node:assert/strict';
import {harness} from './helpers/capture-harness.mjs';
const api=await import('../src/capture/execution.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const setup=async options=>{assert.equal(typeof api.CaptureService,'function','A06 capture coordinator required');return harness(api,options);};
test('unshown/unapproved visits, incorrect bundle/display proof and UI produce no capture or file',async()=>{
 const h=await setup();assert.equal((await h.capture.click(h.click())).status,'ignored');const ticket=await h.ready();
 assert.equal((await h.capture.click(h.click())).status,'ignored');await h.e.confirmDisplay(ticket,'actual-display-fixture');
 for(const change of [{bundle:{}},{displayToken:99},{proof:null},{modal:true},{topmostScene:false},{clientX:190,clientY:1}])await h.capture.click({...h.click(),...change});
 await h.jobs.drain();assert.deepEqual((await h.state()).items,{});assert.equal(h.encoded.length,0);
});
test('real click fixes same-time layers, settles once, then encodes only confirmed reservation',async()=>{
 const h=await setup();await h.shown();h.advance(2000);const result=await h.capture.click(h.click());await h.jobs.drain();
 assert.equal(result.status,'accepted');const state=await h.state();assert.equal(state.items.item_021.totalCount,1);assert.equal(state.discovered.yokai_021.captureCount,1);assert.equal(state.discovered.yokai_021.photos.spring.status,'saved');
 assert.equal(h.encoded.length,1);assert.equal(h.encoded[0].context.sampledAtMono,h.clock.monotonic());assert.equal((await h.store.get('yokai_021_spring')).status,'found');
});
test('duplicate clicks and repeated receipt consumption start only one file operation',async()=>{
 const h=await setup();await h.shown();await Promise.all([h.capture.click(h.click()),h.capture.click(h.click())]);
 await Promise.all([h.capture.consumeReceipt(),h.capture.consumeReceipt()]);await h.jobs.drain();assert.equal(h.encoded.length,1);assert.equal((await h.state()).items.item_021.totalCount,1);
});
for(const [delta,want] of [[17999,'manual'],[18000,'left'],[18001,'left']])test(`capture at ${delta}ms uses A05 ${want} priority`,async()=>{
 const h=await setup();await h.shown();h.advance(delta);await h.capture.click(h.click());await h.jobs.drain();
 assert.equal((await h.state()).items.item_021[`${want}Count`],1);assert.equal(h.encoded.length,want==='manual'?1:0);
});
for(const fault of ['deadline','hidden','owner'])test(`queued click invalidated by ${fault} before locked settlement never generates a file`,async()=>{
 const h=await setup();await h.shown();let once=true;h.faults.before=async c=>{if(c.type==='settleVisit'&&once){once=false;if(fault==='deadline')h.advance(18000);if(fault==='hidden')h.auth.observable=false;if(fault==='owner'){h.auth.authorized=false;}}};
 await h.capture.click(h.click());await h.jobs.drain();assert.equal(h.encoded.length,0);assert.equal((await h.state()).items.item_021?.manualCount??0,0);
});
test('encoding is not a condition of manual success; delayed image stays immutable after season, exit and next visit',async()=>{
 let release,started;const began=new Promise(r=>started=r),held=new Promise(r=>release=r);let original;
 const h=await setup({encode:async sample=>{original={bytes:sample.rgba(),draw:sample.draw,context:sample.context};started();await held;assert.deepEqual(sample.rgba(),original.bytes);assert.deepEqual(sample.draw,original.draw);return {png:new Blob(['a'],{type:'image/png'}),fullScene:new Blob(['b'],{type:'image/png'})};}});
 await h.shown();await h.capture.click(h.click());await began;assert.equal((await h.state()).items.item_021.manualCount,1);assert.equal((await h.state()).discovered.yokai_021.photos.spring.status,'pending');
 h.s.requestSeason('winter');h.s.requestFamily('hill');h.advance(1600);h.s.tick();h.advance(800);h.s.tick();await h.e.synchronize();h.advance(30000);h.s.tick();await Promise.resolve();await Promise.resolve();
 release();await h.jobs.drain();assert.equal((await h.state()).discovered.yokai_021.photos.spring.status,'saved');assert.equal(original.context.family,'forest');assert.equal(original.context.sceneSeason,'spring');
});
test('PNG failure marks only reservation failed, retains award/first capture/cover; restart grants no duplicate',async()=>{
 const h=await setup({encode:async()=>{throw Error('encoder');}});await h.shown();await h.capture.click(h.click());await h.jobs.drain();const st=await h.state();
 assert.equal(st.items.item_021.manualCount,1);assert.equal(st.discovered.yokai_021.captureCount,1);assert.equal(st.discovered.yokai_021.coverSeason,'spring');assert.equal(st.discovered.yokai_021.photos.spring.status,'failed');
 const next=await setup({driver:h.driver,id:'visit-2'});await next.e.synchronize();await next.jobs.reconcilePending();assert.equal((await next.state()).items.item_021.totalCount,1);assert.equal(next.encoded.length,0);
});
test('file committed but metadata failed is pending until restart proves same attempt file and marks saved',async()=>{
 const h=await setup();await h.shown();h.faults.photoMeta=true;await h.capture.click(h.click());await h.jobs.drain();
 assert.equal((await h.state()).discovered.yokai_021.photos.spring.status,'pending');assert.equal((await h.store.get('yokai_021_spring')).status,'found');assert.equal(h.jobs.status.state,'metadata-pending');
 h.faults.photoMeta=false;await h.jobs.reconcilePending();assert.equal((await h.state()).discovered.yokai_021.photos.spring.status,'saved');assert.equal((await h.state()).items.item_021.totalCount,1);assert.equal(h.encoded.length,1);
});
test('pending without original pixels closes missing file and marks failed without rendering current scene',async()=>{
 // Use the actual capture evidence path, then retire before the delayed encoder completes.
 let release;const held=new Promise(r=>release=r);const a=await setup({encode:async()=>{await held;return {png:new Blob(['old'],{type:'image/png'}),fullScene:new Blob(['old'],{type:'image/png'})};}});
 await a.shown();await a.capture.click(a.click());a.jobs.dispose();await a.jobs.reconcilePending();release();await a.jobs.drain();
 assert.equal((await a.state()).discovered.yokai_021.photos.spring.status,'failed');assert.equal((await a.store.get('yokai_021_spring')).status,'missing');
});
for(const status of ['saved',undefined,'pending'])test(`existing ${status??'legacy'} photo and first representative are preserved, receipt.photo=null causes no PNG`,async()=>{
 const h=await setup();const ticket=await h.ready();const state=await h.state();state.discovered.yokai_021={firstCapturedAt:'2025-01-01T00:00:00Z',captureCount:2,coverSeason:'spring',photos:{spring:{photoKey:'legacy-key',at:'2025-01-01T00:00:00Z',...(status?{status}:{}),attemptId:'other',unknown:['keep']}}};
 await h.driver.exclusive(s=>s.setItem('yokai-vending:save',JSON.stringify(state)));await h.e.confirmDisplay(ticket,'actual-display-fixture');await h.capture.click(h.click());await h.jobs.drain();
 const st=await h.state();assert.equal(h.e.receipt.photo,null);assert.equal(h.encoded.length,0);assert.equal(st.discovered.yokai_021.captureCount,3);assert.equal(st.discovered.yokai_021.photos.spring.photoKey,'legacy-key');assert.deepEqual(st.discovered.yokai_021.photos.spring.unknown,['keep']);
});
test('auto and interruption receipts without click scene never produce photos',async()=>{
 for(const hidden of [true,false]){const h=await setup();await h.shown();if(hidden){h.auth.observable=false;await h.e.interrupt();}else{h.advance(18000);await h.e.synchronize();}await h.capture.consumeReceipt();await h.jobs.drain();assert.equal(h.encoded.length,0);assert.deepEqual((await h.state()).discovered,{});}
});
test('different visit/source receipt cannot schedule an image for a held click sample',async()=>{
 const h=await setup();await h.shown();await h.capture.click(h.click());await h.jobs.drain();const sample=h.encoded[0],receipt=h.e.receipt;
 const count=h.encoded.length;for(const change of [{visitId:'other'},{source:'left'},{photo:null},{photo:{...receipt.photo,attemptId:'other'}}])assert.equal(h.jobs.schedule({...receipt,...change},sample),false);
 assert.equal(h.encoded.length,count);
});
test('ordinary capture composition opens no storage and accepts no click without verified ownership/display',async()=>{
 const {createOrdinaryCapture}=await import('../src/app/capture.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});assert.equal(typeof createOrdinaryCapture,'function');
 const h=await setup();const ordinary=createOrdinaryCapture({scheduler:h.s,clock:h.clock,observable:()=>true,photoSeasons:()=>['spring'],definition:()=>{throw Error('no scene');}});
 await ordinary.execution.synchronize();assert.equal((await ordinary.capture.click(h.click())).status,'ignored');assert.equal(ordinary.jobs.status.state,'idle');assert.equal((await h.state()).observationOwner,null);ordinary.capture.dispose();
});
test('trusted composition reconciles restart pending only after execution recovery and never encodes it',async()=>{
 const {createCaptureExecution}=await import('../src/app/capture.ts');let release,started;const began=new Promise(r=>started=r),held=new Promise(r=>release=r);
 const h=await setup({encode:async()=>{started();await held;return {png:new Blob(['old'],{type:'image/png'}),fullScene:new Blob(['old'],{type:'image/png'})};}});
 await h.shown();await h.capture.click(h.click());await began;h.capture.dispose();h.s.suspend();
 const root=createCaptureExecution({execution:{scheduler:h.s,repository:h.repo,clock:h.clock,authority:()=>h.auth,confirmDisplay:()=>false,photoSeasons:()=>['spring']},
 files:h.store,definition:()=>{throw Error('must not sample');},readRaster:()=>{throw Error('must not read');},encode:async()=>{throw Error('must not render');},confirmInput:()=>false});
 await root.synchronize();assert.equal((await h.state()).discovered.yokai_021.photos.spring.status,'failed');assert.equal((await h.state()).items.item_021.totalCount,1);release();await h.jobs.drain();root.capture.dispose();
});
test('duplicate encoder failure cannot turn an already committed exact-attempt PNG into failed metadata',async()=>{
 const h=await setup();await h.shown();h.faults.photoMeta=true;await h.capture.click(h.click());await h.jobs.drain();const sample=h.encoded[0];assert.equal((await h.state()).discovered.yokai_021.photos.spring.status,'pending');
 h.faults.photoMeta=false;const duplicate=new api.PhotoJobs({repository:h.repo,files:h.store,encode:async()=>{throw Error('second encoder fails');}});
 duplicate.schedule(h.e.receipt,sample);await duplicate.drain();assert.equal((await h.state()).discovered.yokai_021.photos.spring.status,'saved');assert.equal((await h.state()).items.item_021.totalCount,1);
});
test('new real visit retries failed original key and delayed old encode cannot replace its PNG bytes',async()=>{
 let release,started;let oldSample;const began=new Promise(r=>started=r),held=new Promise(r=>release=r);
 const first=await setup({encode:async sample=>{oldSample=sample;started();await held;return {png:new Blob(['OLD'],{type:'image/png'}),fullScene:new Blob(['OLD'],{type:'image/png'})};}});
 await first.shown();await first.capture.click(first.click());await began;first.capture.dispose();await first.jobs.reconcilePending();
 const next=await setup({driver:first.driver,id:'visit-2',photoStore:first.store});await next.shown();await next.capture.click(next.click());await next.jobs.drain();
 const bytes=await first.store.get('yokai_021_spring');assert.equal(bytes.attemptId,'visit-2');assert.equal(await bytes.png.text(),'PNG');release();await first.jobs.drain();
 assert.equal(await (await first.store.get('yokai_021_spring')).png.text(),'PNG');const state=await next.state();assert.equal(state.items.item_021.totalCount,2);assert.equal(state.discovered.yokai_021.captureCount,2);assert.equal(state.discovered.yokai_021.coverSeason,'spring');assert.equal(state.discovered.yokai_021.photos.spring.status,'saved');assert.equal(oldSample.context.visitId,'visit-1');
});
test('disposed composition does not launch pending reconciliation from delayed execution completion',async()=>{
 const {createCaptureExecution}=await import('../src/app/capture.ts');let release,started;const began=new Promise(r=>started=r),held=new Promise(r=>release=r);
 const h=await setup({encode:async()=>{started();await held;return {png:new Blob(['old'],{type:'image/png'}),fullScene:new Blob(['old'],{type:'image/png'})};}});
 await h.shown();await h.capture.click(h.click());await began;h.capture.dispose();h.s.suspend();
 const root=createCaptureExecution({execution:{scheduler:h.s,repository:h.repo,clock:h.clock,authority:()=>h.auth,confirmDisplay:()=>false,photoSeasons:()=>['spring']},files:h.store,definition:()=>{throw Error('not needed');},readRaster:()=>{throw Error('not needed');},encode:async()=>{throw Error('not needed');},confirmInput:()=>false});
 const syncing=root.synchronize();root.capture.dispose();await syncing;assert.equal((await h.state()).discovered.yokai_021.photos.spring.status,'pending');release();await h.jobs.drain();
});
test('an ignored click with no pending settlement does not block the next click',async()=>{
 const h=await setup();await h.shown();
 const requestManual=h.e.requestManual.bind(h.e);
 h.e.requestManual=async()=>{}; // The visit may be invalidated before a settlement is queued.
 assert.equal((await h.capture.click(h.click())).status,'ignored');
 h.e.requestManual=requestManual;
 assert.equal((await h.capture.click(h.click())).status,'accepted');
 assert.equal((await h.state()).discovered.yokai_021.captureCount,1);
});
test('an interrupted old click cannot block a later visit after recovery',async()=>{
 let visit=0;const h=await setup({id:()=>`visit-${++visit}`});await h.shown();
 let once=true;h.faults.before=async c=>{if(c.type==='settleVisit'&&once){once=false;h.auth.authorized=false;}};
 assert.equal((await h.capture.click(h.click())).status,'blocked');
 h.auth.authorized=true;await h.e.retry();
 h.advance(2000);h.s.tick();h.advance(2000);h.s.tick();await h.e.synchronize();
 h.advance(30000);h.s.tick();await Promise.resolve();await Promise.resolve();
 const ticket=h.e.beginPresentation(h.s.state.display.token);await h.e.confirmDisplay(ticket,'actual-display-fixture');h.advance(2000);
 assert.equal((await h.capture.click({...h.click(),clientX:40,clientY:140})).status,'accepted');
 assert.equal((await h.state()).discovered.yokai_022.captureCount,1);
});
