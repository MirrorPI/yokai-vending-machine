import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createCognitoVerifier, createLambdaHandler } from '../server/lambda.mjs';
import { createService } from '../server/service.mjs';
import { createSqliteAdapter } from '../server/adapters/sqlite.mjs';
import { createFileObjects } from '../server/adapters/files.mjs';

const pool='ap-northeast-2_TestPool',client='testclient',issuer=`https://cognito-idp.ap-northeast-2.amazonaws.com/${pool}`;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'known',alg:'RS256',use:'sig'};
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function token(overrides={},badSignature=false){ const body=`${encode({alg:'RS256',kid:'known'})}.${encode({iss:issuer,sub:'alice',client_id:client,token_use:'access',exp:Math.floor(Date.now()/1000)+300,iat:Math.floor(Date.now()/1000),...overrides})}`;return `${body}.${badSignature?Buffer.alloc(256).toString('base64url'):sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url')}`; }
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'yokai-auth-')); const db=createSqliteAdapter(join(dir,'db.sqlite'));t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});const service=createService({db,objects:createFileObjects(join(dir,'objects'))}); const verifier=createCognitoVerifier({userPoolId:pool,clientId:client});verifier.cacheJwks({keys:[jwk]});return createLambdaHandler({service,verifier,allowedOrigin:'https://game.example'});}
const event=(jwt,body,extra={})=>({rawPath:body?'/v1/commands':'/v1/state',requestContext:{http:{method:body?'POST':'GET'}},headers:{authorization:`Bearer ${jwt}`,origin:'https://game.example'},body:body?JSON.stringify(body):undefined,...extra});

test('Lambda verifies real signatures, issuer, expiry, client and access-token use',async t=>{
 const handler=await setup(t);
 assert.equal((await handler(event(token()))).statusCode,200);
 for(const jwt of [token({},true),token({iss:'https://attacker.invalid'}),token({client_id:'other'}),token({exp:1}),token({token_use:'id',aud:client}), 'test:alice'])assert.equal((await handler(event(jwt))).statusCode,401);
});
test('Lambda ignores claimed subjects and authorizer contexts; only approved CORS origin succeeds',async t=>{
 const handler=await setup(t);
 await handler(event(token(),{subject:'bob',command:{type:'changeSettings',patch:{sound:true}}}));
 assert.equal(JSON.parse((await handler(event(token({sub:'bob'})))).body).state.settings.sound,false);
 assert.equal((await handler(event('',undefined,{requestContext:{http:{method:'GET'},authorizer:{jwt:{claims:{sub:'alice'}}}}}))).statusCode,401);
 assert.equal((await handler(event(token(),undefined,{headers:{authorization:`Bearer ${token()}`,origin:'https://evil.example'}}))).statusCode,403);
 const cors=await handler(event('',undefined,{requestContext:{http:{method:'OPTIONS'}}}));assert.equal(cors.statusCode,204);assert.equal(cors.headers['access-control-allow-origin'],'https://game.example');
 assert.equal((await handler(event(token(),undefined,{requestContext:{http:{method:'POST'}},rawPath:'/v1/commands',body:'{'}))).statusCode,400);
});
async function startProcess(dir){const child=spawn(process.execPath,['--experimental-strip-types','server/local.mjs'],{cwd:process.cwd(),env:{...process.env,ACCOUNT_TEST_AUTH:'1',ACCOUNT_DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});let output=''; const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Server start timed out: ${output}`)),5000);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}: ${output}`));});child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(m[0]);}});child.stderr.on('data',chunk=>{output+=chunk;});});return {url,child,async stop(){child.kill('SIGTERM');await once(child,'exit');}};}
test('real loopback HTTP process persists through stop/restart and never trusts JSON identity',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'yokai-http-'));let server=await startProcess(dir);t.after(async()=>{if(server.child.exitCode===null)await server.stop();await rm(dir,{recursive:true,force:true});});
 const request=(path,body,auth='test:alice')=>fetch(server.url+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 assert.equal((await request('/v1/state',undefined,'')).status,401);
 assert.equal((await request('/v1/commands',{subject:'bob',command:{type:'changeSettings',patch:{sound:true}}})).status,200);
 await server.stop();server=await startProcess(dir);
 assert.equal((await (await request('/v1/state')).json()).state.settings.sound,true);
 assert.equal((await (await request('/v1/state',undefined,'test:bob')).json()).state.settings.sound,false);
 assert.equal((await fetch(server.url+'/v1/state',{headers:{authorization:'Bearer test:alice',origin:'https://evil.example'}})).status,403);
});
test('local test authentication is disabled without explicit opt-in',async()=>{
 const child=spawn(process.execPath,['--experimental-strip-types','server/local.mjs'],{env:{...process.env,ACCOUNT_TEST_AUTH:''},stdio:'ignore'});const [code]=await once(child,'exit');assert.notEqual(code,0);
});
