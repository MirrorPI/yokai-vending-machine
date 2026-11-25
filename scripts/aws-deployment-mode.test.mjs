import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../infra/deployment-mode.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('deployment requires apply and exactly one explicit lifetime; persistent resources cannot enter ephemeral cleanup',()=>{
 assert.equal(typeof api.deploymentMode,'function');
 for(const args of [[],['--apply'],['--persistent'],['--apply','--persistent','--ephemeral']])assert.throws(()=>api.deploymentMode(args));
 const persistent=api.deploymentMode(['--apply','--persistent']);
 const ephemeral=api.deploymentMode(['--apply','--ephemeral']);
 assert.equal(persistent.cleanup,false);assert.equal(ephemeral.cleanup,true);
 const source={Resources:{Table:{Type:'AWS::DynamoDB::Table',DeletionPolicy:'Retain',Properties:{DeletionProtectionEnabled:true}}}};
 assert.equal(persistent.template(source).Resources.Table.DeletionPolicy,'Retain');
 assert.equal(ephemeral.template(source).Resources.Table.DeletionPolicy,'Delete');
 assert.ok(!persistent.tags('r').some(t=>t.Key==='EphemeralRun'));
});
