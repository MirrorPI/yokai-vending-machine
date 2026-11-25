import test from 'node:test';
import assert from 'node:assert/strict';
const preview=await import('../src/scene/preview.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('only explicit preview opt-in changes the fixed empty scene; query parameters are not settings',()=>{
  assert.equal(typeof preview.resolveScenePreview,'function');
  const ordinary=preview.resolveScenePreview('?family=hill&season=winter&yokai=yokai_060');
  assert.deepEqual(ordinary,{preview:false,input:{family:'forest',season:'spring',yokaiId:null,placement:'verified-default',playback:{originMs:0}},fixedTimeMs:null});
  assert.deepEqual(preview.resolveScenePreview('?scenePreview=1&family=hill&season=winter&yokai=yokai_060&elapsedMs=1700'),{
    preview:true,input:{family:'hill',season:'winter',yokaiId:'yokai_060',placement:'verified-default',playback:{originMs:0}},fixedTimeMs:1700,
  });
  for(const query of ['family=bad','season=bad','elapsedMs=NaN','elapsedMs=-1','yokai=60','placement=rock_left']) assert.throws(()=>preview.resolveScenePreview(`?scenePreview=1&${query}`),/preview/i);
});
