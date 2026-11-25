import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {deflateSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {createBrowserRasterReader} from '../src/capture/browser.ts';
const api=await import('../src/capture/png.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const browser=await import('../src/capture/browser.ts');
function png(rows,width=1,height=5){const chunk=(kind,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(kind,4);data.copy(b,8);return b;};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from(rows))),chunk('IEND',Buffer.alloc(0))]);}
test('lossless RGBA8 PNG reader reverses all five row filters without premultiplying alpha',async()=>{
 assert.equal(typeof api.decodeRgbaPng,'function');
 const raster=await api.decodeRgbaPng(png([0,10,20,30,40,1,15,25,35,45,2,5,5,5,5,3,30,35,40,45,4,10,10,10,10]),[1,5]);
 assert.deepEqual([...raster.data],[10,20,30,40,15,25,35,45,20,30,40,50,40,50,60,70,50,60,70,80]);
});
test('all 1023 registered original PNG rasters match independent Pillow RGBA hashes exactly',async()=>{
 assert.equal(typeof api.decodeRgbaPng,'function');const c=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json')),files=c.files.filter(f=>f.sourcePath.endsWith('.png'));assert.equal(files.length,1023);
 const hashes=JSON.parse(fs.readFileSync('scripts/helpers/png-rgba-hashes.json')); // Independent Pillow oracle recorded during A11, no Python runtime required by npm test.
 for(const f of files){const r=await api.decodeRgbaPng(fs.readFileSync(f.sourcePath),f.size);assert.equal(createHash('sha256').update(r.data).digest('hex'),hashes[f.sourcePath],f.sourcePath);}
});
test('original raster is used instead of lossy Canvas readback; cache detaches the source bytes',()=>{
 const file={publicPath:'effect',sha256:'sha',size:[1,1]},data=new Uint8ClampedArray([127,63,17,15]),bundle={images:{effect:{file,image:{},raster:{width:1,height:1,data}}}};
 const read=createBrowserRasterReader(()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray([119,68,17,15])})})}));
 const got=read({bundle},file);assert.deepEqual([...got.data],[127,63,17,15]);data.fill(0);assert.deepEqual([...read({bundle},file).data],[127,63,17,15]);
});
test('capture loader rejects changed source bytes before publishing a prepared raster',async()=>{
 assert.equal(typeof browser.createBrowserCaptureImageLoader,'function');const bytes=png([0,1,2,3,4],1,1),file={publicPath:'one.png',sha256:createHash('sha256').update(bytes).digest('hex'),size:[1,1]};
 const native=async f=>({file:f,url:'/one.png',image:{}});const load=browser.createBrowserCaptureImageLoader(()=>'/one.png',{loadImage:native,fetch:async()=>new Response(bytes)});
 const decoded=await load(file);assert.deepEqual([...decoded.raster.data],[1,2,3,4]);
 const tampered=browser.createBrowserCaptureImageLoader(()=>'/one.png',{loadImage:native,fetch:async()=>new Response(Buffer.concat([bytes,Buffer.from([1])]))});await assert.rejects(tampered(file),/hash/i);
 const failed=browser.createBrowserCaptureImageLoader(()=>'/one.png',{loadImage:native,fetch:async()=>new Response(null,{status:503})});await assert.rejects(failed(file),/503/);
});
test('malformed PNG, unsupported encoding, wrong size and invalid row filters fail closed',async()=>{
 assert.equal(typeof api.decodeRgbaPng,'function');await assert.rejects(api.decodeRgbaPng(new Uint8Array(3),[1,1]));
 const wrong=png([0,1,2,3,4],1,1);wrong[24]=16;await assert.rejects(api.decodeRgbaPng(wrong,[1,1]));
 await assert.rejects(api.decodeRgbaPng(png([0,1,2,3,4],1,1),[2,1]));await assert.rejects(api.decodeRgbaPng(png([5,1,2,3,4],1,1),[1,1]));await assert.rejects(api.decodeRgbaPng(png([0,1],1,1),[1,1]));
});
