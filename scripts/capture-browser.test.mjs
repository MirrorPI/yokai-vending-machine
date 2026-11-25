import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../src/capture/browser.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const sample={rgba:cropped=>new Uint8ClampedArray((cropped?96*128:192*256)*4).fill(127)};
function canvasFixture({nullBlob=false,throws=false}={}){const calls=[],canvases=[];return {calls,canvases,create:()=>{const canvas={width:0,height:0,getContext:()=>({imageSmoothingEnabled:true,createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:(image,x,y)=>{calls.push({w:canvas.width,h:canvas.height,data:image.data,x,y});if(throws)throw Error('canvas');}}),toBlob:cb=>cb(nullBlob?null:new Blob(['PNG'],{type:'image/png'}))};canvases.push(canvas);return canvas;}};}
test('browser encoder writes original RGBA at 96x128 and full 192x256, releases canvases',async()=>{
 assert.equal(typeof api.createBrowserEncoder,'function');const c=canvasFixture();const bytes=await api.createBrowserEncoder(c.create)(sample);
 assert.equal(bytes.png.type,'image/png');assert.deepEqual(c.calls.map(x=>[x.w,x.h,x.x,x.y]),[[96,128,0,0],[192,256,0,0]]);assert.equal(c.calls[0].data[0],127);assert.ok(c.canvases.every(c=>c.width===0&&c.height===0));
});
for(const fault of ['nullBlob','throws'])test(`PNG ${fault} rejects and releases canvas resources`,async()=>{
 assert.equal(typeof api.createBrowserEncoder,'function');const c=canvasFixture({[fault]:true});await assert.rejects(api.createBrowserEncoder(c.create)(sample));assert.ok(c.canvases.every(c=>c.width===0));
});
test('object URL lease releases superseded, stale and disposed file resources',async()=>{
 assert.equal(typeof api.createPhotoUrlLease,'function');const made=[],revoked=[];let delayed;
 const store={get:async key=>key==='late'?new Promise(r=>delayed=r):{status:'found',png:new Blob([key])}};
 const lease=api.createPhotoUrlLease(store,{createObjectURL:b=>{const v=`blob:${made.length}`;made.push(b);return v;},revokeObjectURL:u=>revoked.push(u)});
 assert.equal((await lease.load('first')).status,'ready');const late=lease.load('late');assert.equal((await lease.load('second')).status,'ready');delayed({status:'found',png:new Blob(['late'])});assert.equal((await late).status,'superseded');
 lease.dispose();assert.deepEqual(revoked,['blob:0','blob:1']);assert.equal((await lease.load('last')).status,'superseded');
});
test('browser ingress uses current scene rect, topmost surface and modal/ad blockers without authorizing paint',()=>{
 assert.equal(typeof api.browserClickInput,'function');
 const rect={left:31,top:57,width:384,height:512},scene={getBoundingClientRect:()=>rect};let blocked=false,modal=false;
 const top={closest:selector=>selector==='.scene'?scene:blocked?{}:null};const doc={elementFromPoint:()=>top,querySelector:()=>modal?{}:null,querySelectorAll:()=>[{getBoundingClientRect:()=>({left:31,top:569,width:384,height:64})}]};
 const element={ownerDocument:doc,querySelector:()=>scene};const surface={element,bundle:{requestId:3},displayToken:5,overlayOpacity:0.5,proof:null};
 const input=api.browserClickInput({clientX:100,clientY:200},surface);assert.deepEqual(input.rect,rect);assert.equal(input.topmostScene,true);assert.equal(input.proof,null);assert.equal(input.blockedRects[0].top,569);
 blocked=true;assert.equal(api.browserClickInput({clientX:100,clientY:200},surface).topmostScene,false);modal=true;assert.equal(api.browserClickInput({clientX:100,clientY:200},surface).modal,true);
});
test('raster reader uses original decoded image pixels once per bundle and releases canvas on read errors',()=>{
 assert.equal(typeof api.createBrowserRasterReader,'function');let reads=0,throws=false;const canvases=[];
 const factory=()=>{const c={width:0,height:0,getContext:()=>({drawImage:()=>{},getImageData:()=>{reads++;if(throws)throw Error('tainted');return {data:new Uint8ClampedArray([1,2,3,255])};}})};canvases.push(c);return c;};
 const file={publicPath:'body',sha256:'sha',size:[1,1]},bundle={images:{body:{file,image:{}}}},read=api.createBrowserRasterReader(factory);
 const a=read({bundle},file);assert.deepEqual([...a.data],[1,2,3,255]);read({bundle},file);assert.equal(reads,1);throws=true;assert.throws(()=>read({bundle:{...bundle}},file));assert.ok(canvases.every(c=>c.width===0&&c.height===0));
});
