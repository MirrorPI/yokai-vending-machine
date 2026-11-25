import test from 'node:test';import assert from 'node:assert/strict';
import {isLocalCollectionTest} from '../src/runtime/local-collection-test.ts';
const good={development:true,hostname:'127.0.0.1',search:'?collectionTest=new8&accountTestSubject=fixture-new-yokai',apiBaseUrl:'http://127.0.0.1:5180',accountKey:'fixture-new-yokai'};
test('manual collection requires DEV plus local browser/API and dedicated connected identity',()=>{
 assert.equal(isLocalCollectionTest(good),true);
 for(const patch of [{development:false},{hostname:'game.example'},{apiBaseUrl:'https://api.example'},{accountKey:'fixture-manual'},{accountKey:undefined},{search:'?collectionTest=new8'},{search:'?accountTestSubject=fixture-new-yokai'},{apiBaseUrl:'bad'}])assert.equal(isLocalCollectionTest({...good,...patch}),false,JSON.stringify(patch));
});
