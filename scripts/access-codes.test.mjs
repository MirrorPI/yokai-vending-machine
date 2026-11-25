import test from 'node:test';
import assert from 'node:assert/strict';
import { createLambdaHandler } from '../server/lambda.mjs';
const api=await import('../server/access-codes.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('exactly fifteen unique random credentials map to separate accounts; arbitrary code cannot become an account',async()=>{
 assert.equal(typeof api.generateAccessCodes,'function');
 const batch=api.generateAccessCodes();assert.equal(batch.codes.length,15);assert.equal(new Set(batch.codes.map(c=>c.code)).size,15);
 const verifier=api.createCodeVerifier(batch.config);
 for(const row of batch.codes){assert.equal((await verifier.verify(row.code)).sub,row.subject);assert.ok(!JSON.stringify(batch.config).includes(row.code));}
 await assert.rejects(()=>verifier.verify('YKV-000000-000000-000000-000000'));
 await assert.rejects(()=>verifier.verify(api.generateAccessCodes().codes[0].code));
 for(const bad of [[],batch.config.slice(0,14),[...batch.config,batch.config[0]],batch.config.map(()=>batch.config[0])])assert.throws(()=>api.createCodeVerifier(bad));
});
test('code login and all data routes authenticate at server; no Cognito or supplied subject bypass',async()=>{
 assert.equal(typeof api.generateAccessCodes,'function');
 const batch=api.generateAccessCodes(),calls=[];
 const handler=createLambdaHandler({verifier:api.createCodeVerifier(batch.config),allowedOrigin:'https://game.example',codeLogin:true,
  service:{handle:async input=>{calls.push(input);return {statusCode:200,body:{subject:input.subject}};}}});
 const event=(code,path='/v1/access/login')=>({rawPath:path,requestContext:{http:{method:path.endsWith('login')?'POST':'GET'}},headers:{origin:'https://game.example',authorization:`Bearer ${code}`}});
 assert.equal((await handler(event('wrong'))).statusCode,401);
 assert.equal((await handler(event('', '/v1/state'))).statusCode,401);
 const a=batch.codes[0],b=batch.codes[1];
 const login=await handler(event(a.code));assert.equal(login.statusCode,200);assert.equal(JSON.parse(login.body).sub,a.subject);assert.ok(!login.body.includes(a.code));assert.equal(calls.length,0);
 const state=await handler({...event(b.code,'/v1/state'),body:JSON.stringify({subject:a.subject})});assert.equal(JSON.parse(state.body).subject,b.subject);
 assert.equal((await handler({...event(a.code),headers:{authorization:`Bearer ${a.code}`,origin:'https://evil.example'}})).statusCode,403);
});
