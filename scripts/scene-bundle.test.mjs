import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileScene,sceneFiles,sampleScene} from '../src/scene/composition.ts';
const bundle = await import('../src/scene/bundle.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json'));
const plan=(family='forest',no=60)=>compileScene(catalog,{family,season:'winter',yokaiId:`yokai_0${no}`,playback:{originMs:1234}});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const ready=async file=>({file,url:`./${file.publicPath}`,image:{naturalWidth:file.size[0],naturalHeight:file.size[1]}});

test('all required cels/auras finish before an atomic commit; pending keeps normal scene',async()=>{
  assert.equal(typeof bundle.SceneBundleController,'function');
  let loader=ready;const c=new bundle.SceneBundleController(file=>loader(file));
  assert.equal((await c.request(plan())).status,'committed');
  const before=c.state.current;
  const gates=sceneFiles(plan('hill')).map(()=>deferred());let i=0;
  loader=file=>gates[i++].promise.then(()=>ready(file));
  const pending=c.request(plan('hill'));
  assert.equal(i,16); // background + 5 body + 5 wing + 5 tail
  assert.equal(c.state.current,before);assert.equal(c.state.status,'loading');
  for(const g of gates.slice(1))g.resolve();await Promise.resolve();
  assert.equal(c.state.current,before);
  gates[0].resolve();assert.equal((await pending).status,'committed');
  assert.equal(c.state.current.plan.mapId,'hill_winter');
  assert.equal(c.state.current.plan.input.playback.originMs,1234);
});

test('initial failure has no fabricated scene; partial failure retains exact previous bundle and can retry',async()=>{
  let loader=async()=>{throw new Error('decode');};const c=new bundle.SceneBundleController(file=>loader(file));
  assert.equal((await c.request(plan())).status,'failed');assert.equal(c.state.current,null);
  loader=ready;await c.request(plan());const previous=c.state.current;
  loader=async file=>{if(file.sourcePath.includes('tail_aura_04'))throw new Error('one cel failed');return ready(file);};
  assert.equal((await c.request(plan('hill'))).status,'failed');
  assert.equal(c.state.current,previous);assert.match(c.state.error,/one cel/);
  loader=ready;assert.equal((await c.request(plan('hill'))).status,'committed');
});

test('reverse completion commits latest only and stale failure cannot overwrite current status',async()=>{
  let loader=ready;const c=new bundle.SceneBundleController(file=>loader(file));await c.request(plan());
  const gates=[deferred(),deferred()];let request=0;
  loader=async file=>{const gate=gates[request];await gate.promise;return ready(file);};
  const old=c.request(plan());request++;
  const latest=c.request(plan('hill'));gates[1].resolve();
  assert.equal((await latest).status,'committed');const current=c.state.current;
  gates[0].resolve();assert.equal((await old).status,'superseded');assert.equal(c.state.current,current);
  const slow=deferred();loader=async()=>slow.promise;
  const failing=c.request(plan());loader=ready;await c.request(plan('hill'));
  slow.reject(new Error('late failure'));assert.equal((await failing).status,'superseded');
  assert.equal(c.state.status,'ready');assert.equal(c.state.error,null);
});

test('latest failure still prevents earlier successful request from committing',async()=>{
  let loader=ready;const c=new bundle.SceneBundleController(file=>loader(file));await c.request(plan());const before=c.state.current;
  const gate=deferred();loader=async file=>{await gate.promise;return ready(file);};
  const old=c.request(plan('hill'));loader=async()=>{throw new Error('latest failed');};
  await c.request(plan('hill',59));gate.resolve();assert.equal((await old).status,'superseded');
  assert.equal(c.state.current,before);assert.equal(c.state.status,'failed');
});

test('cancel on unmount invalidates in-flight completion without deleting current bundle',async()=>{
  let loader=ready;const c=new bundle.SceneBundleController(file=>loader(file));await c.request(plan());const before=c.state.current;
  const gate=deferred();loader=async file=>{await gate.promise;return ready(file);};
  const task=c.request(plan('hill'));c.cancel();gate.resolve();
  assert.equal((await task).status,'superseded');assert.equal(c.state.current,before);
});

test('compile result owns input and catalog snapshot, and replacement sampling retains playback origin',async()=>{
  const c=structuredClone(catalog);const input={family:'forest',season:'winter',yokaiId:'yokai_060',playback:{originMs:100}};
  const p=compileScene(c,input);input.playback.originMs=999;c.maps.find(m=>m.id==='forest_winter').scene.publicPath='wrong.png';
  assert.equal(p.input.playback.originMs,100);assert.equal(Object.isFrozen(p.layers),true);
  assert.equal(sceneFiles(p)[0].publicPath,'game-assets/배경/forest/winter/scene.png');
  const before=sampleScene(p,1700).find(l=>l.id==='body').cel;
  const next=compileScene(c,{...p.input,family:'hill'});
  assert.equal(sampleScene(next,1700).find(l=>l.id==='body').cel,before);
});

// Image I/O fixture: load and decode are independent events, just as in the browser.
class ImageFixture {
  naturalWidth=192;naturalHeight=256;decoding='auto';src='';onload=null;onerror=null;
  decoded=deferred();decode(){return this.decoded.promise;}
}
test('browser loader waits for both load and decode, validates source dimensions and preserves base URL',async()=>{
  assert.equal(typeof bundle.createBrowserImageLoader,'function');
  const image=new ImageFixture();const file=sceneFiles(plan())[0];
  const load=bundle.createBrowserImageLoader(f=>`/nested/${f.publicPath}`,()=>image);
  let done=false;const pending=load(file).then(value=>{done=true;return value;});
  assert.equal(image.src,'/nested/game-assets/배경/forest/winter/scene.png');
  image.onload();await Promise.resolve();assert.equal(done,false);
  image.decoded.resolve();const asset=await pending;assert.equal(asset.image,image);
  const broken=new ImageFixture();const bad=bundle.createBrowserImageLoader(f=>f.publicPath,()=>broken)(file);
  broken.onload();broken.decoded.reject(new Error('bad decode'));await assert.rejects(bad,/bad decode/);
  const wrong=new ImageFixture();wrong.naturalWidth=384;
  const mismatch=bundle.createBrowserImageLoader(f=>f.publicPath,()=>wrong)(file);
  wrong.onload();wrong.decoded.resolve();await assert.rejects(mismatch,/dimensions/);
  const missing=new ImageFixture();const error=bundle.createBrowserImageLoader(f=>f.publicPath,()=>missing)(file);
  missing.onerror();await assert.rejects(error,/load/i);
});
