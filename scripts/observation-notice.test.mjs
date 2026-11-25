import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/observation/notice.ts').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('normal startup and cooperative transfer never request a storage retry',()=>{
 assert.equal(typeof api.observationNotice,'function');
 for(const phase of ['preparing','waiting','observing'])assert.equal(api.observationNotice({phase,status:{state:'blocked',reason:'authority'}}),null);
 assert.equal(api.observationNotice({phase:'observing',busy:true,status:{state:'blocked',reason:'authority'}}),null);
});
test('displaced owner, unavailable storage and failed assets offer distinct recovery',()=>{
 assert.equal(typeof api.observationNotice,'function');
 const displaced=api.observationNotice({phase:'observing',status:{state:'blocked',reason:'displaced'}});
 const storage=api.observationNotice({phase:'observing',status:{state:'blocked',reason:'unavailable'}});
 const assets=api.observationNotice({phase:'observing',preparationFailed:true,status:{state:'ready',reason:null}});
 assert.match(displaced.message,/다른 창/);assert.match(displaced.action,/관찰/);
 assert.match(storage.message,/연결|저장/);assert.match(storage.action,/저장/);
 assert.match(assets.action,/불러오기/);
});
