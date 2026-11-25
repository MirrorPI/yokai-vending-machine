import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseConcurrency } from '../infra/concurrency.mjs';
import {appTemplate} from '../infra/template.mjs';
test('small verified account quota uses existing ten-execution account ceiling without quota increase',()=>{
 const policy=chooseConcurrency({ConcurrentExecutions:10,UnreservedConcurrentExecutions:10});
 assert.equal(policy.reservedConcurrency,null);assert.equal(policy.accountCeiling,10);
 assert.equal(Object.hasOwn(appTemplate(policy).Resources.Api.Properties,'ReservedConcurrentExecutions'),false);
});
test('account with reservation capacity still limits function to two',()=>{
 const policy=chooseConcurrency({ConcurrentExecutions:1000,UnreservedConcurrentExecutions:900});
 assert.equal(policy.reservedConcurrency,2);assert.equal(appTemplate(policy).Resources.Api.Properties.ReservedConcurrentExecutions,2);
});
test('unknown or larger unreservable quota fails closed',()=>{
 for(const limit of [undefined,{}, {ConcurrentExecutions:100,UnreservedConcurrentExecutions:100},{ConcurrentExecutions:1000,UnreservedConcurrentExecutions:101},{ConcurrentExecutions:10,UnreservedConcurrentExecutions:11}])assert.throws(()=>chooseConcurrency(limit));
});
