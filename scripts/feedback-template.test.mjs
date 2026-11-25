import test from 'node:test';
import assert from 'node:assert/strict';
import {appTemplate} from '../infra/template.mjs';
test('feedback stack uses only hashed code authentication with no self-registration resources',()=>{
 const t=appTemplate({feedback:true,reservedConcurrency:null});
 assert.ok(!Object.values(t.Resources).some(r=>r.Type.startsWith('AWS::Cognito::')));
 assert.equal(t.Resources.Api.Properties.Environment.Variables.AUTH_MODE,'invite-code');
 assert.deepEqual(t.Resources.Api.Properties.Environment.Variables.ACCESS_CODE_HASHES,{Ref:'AccessCodeHashes'});
 assert.equal(t.Parameters.AccessCodeHashes.NoEcho,true);
 assert.equal(t.Parameters.CognitoDomainPrefix,undefined);assert.equal(t.Outputs.UserPoolId,undefined);
 assert.equal(t.Resources.StateTable.Properties.BillingMode,'PAY_PER_REQUEST');
 assert.equal(t.Resources.StateTable.DeletionPolicy,'Retain');
});
