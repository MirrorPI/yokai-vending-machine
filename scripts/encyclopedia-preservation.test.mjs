import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createBrowserRepository} from '../src/storage/browser.ts';
import {EncyclopediaController} from '../src/encyclopedia/controller.ts';
const catalog=JSON.parse(fs.readFileSync('src/data/generated/asset-catalog.json')),key='yokai-vending:save',at='2020-01-01T00:00:00Z';
const setup=raw=>{const values=new Map([[key,raw]]);let commands=0,gets=0;const repo=createBrowserRepository({storage:()=>({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}),locks:()=>({request:(_n,_o,f)=>f()})});
 const c=new EncyclopediaController({catalog,repository:{...repo,commit:(...args)=>{commands++;return repo.commit(...args);}},files:{get:async()=>{gets++;return {status:'missing'};}}});return {c,values,get commands(){return commands;},get gets(){return gets;}};};
test('A07 delegates v2 compatibility to A02, keeps original backup/keys/unknown IDs and never grants legacy items',async()=>{
 const record={firstCapturedAt:at,captureCount:7,coverSeason:'winter',photos:{winter:{photoKey:'original-2020',at}},unknownField:'keep'};
 const raw=JSON.stringify({version:2,discovered:{yokai_001:record,retired:record},settings:{sound:true,extra:true},extension:{nested:['keep']}}),h=setup(raw);await h.c.open();const m=h.c.snapshot.model;assert.equal(m.progress.captured,1);assert.equal(m.progress.photos,1);assert.equal(m.progress.itemKinds,0);assert.equal(m.preserved.yokai,1);assert.equal(h.values.get(`${key}.v2`),raw);const migrated=h.values.get(key);await h.c.select('yokai_001');await h.c.retryPhoto();h.c.close();await h.c.open();assert.equal(h.values.get(key),migrated);assert.deepEqual(JSON.parse(migrated).discovered,{yokai_001:record,retired:record});assert.deepEqual(JSON.parse(migrated).extension,{nested:['keep']});assert.equal(h.commands,0);h.c.close();
});
for(const [raw,error] of [['{broken','corrupt'],['{"version":99,"untouched":[1]}','unsupported-version']])test(`${error} through real browser adapter stays error and preserves authoritative raw`,async()=>{
 const h=setup(raw);await h.c.open();assert.equal(h.c.snapshot.error,error);assert.equal(h.c.snapshot.model,null);assert.equal(h.values.get(key),raw);assert.equal(h.commands,0);assert.equal(h.gets,0);if(error==='corrupt')assert.equal(h.values.get(`${key}.corrupt`),raw);h.c.close();
});
