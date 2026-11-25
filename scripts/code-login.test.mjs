import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAccountConfig} from '../src/account/auth.ts';
import {AccountSession} from '../src/account/session.ts';
import {initialState} from '../src/domain/state.ts';
const config={enabled:true,authMode:'invite-code',apiBaseUrl:'https://api.example'};
const code='YKV-ABCDEF-123456-ABCDEF-123456';
const response=b=>new Response(JSON.stringify(b));
test('code config needs no Cognito and rejects insecure or path-bearing API endpoints',()=>{
 assert.equal(parseAccountConfig(config,'https://game.example').authMode,'invite-code');
 for(const url of ['http://api.example','https://x:y@api.example','https://api.example/other','https://api.example/?q=secret'])assert.throws(()=>parseAccountConfig({...config,apiBaseUrl:url},'https://game.example'));
});
test('code login checks server identity and opens its own empty account directly without guest import',async(t)=>{
 const requests=[];const session=new AccountSession(config,{fetcher:async(url,init)=>{requests.push([url,init]);return response(url.endsWith('/login')?{sub:'beta-01',expiresAt:Date.now()+60000}:{status:'ok',state:initialState(),origin:'empty',persistence:'account'});}});t.after(()=>session.dispose());
 assert.equal(typeof session.connectCode,'function');await session.connectCode(code);
 assert.equal(session.snapshot.phase,'account');assert.equal(session.snapshot.ports.accountKey,'beta-01');
 assert.equal(requests[0][1].headers.Authorization,'Bearer YKVABCDEF123456ABCDEF123456');assert.ok(requests.every(([url])=>!url.includes('ABCDEF')));
 await session.logout();assert.equal(session.snapshot.phase,'guest');assert.equal(session.snapshot.ports,null);
});
test('invalid code or late login reply cannot mount a guest game or resurrect a logged-out account',async(t)=>{
 let finish;const session=new AccountSession(config,{fetcher:async()=>new Promise(r=>finish=()=>r(response({sub:'beta-01',expiresAt:Date.now()+60000})))});t.after(()=>session.dispose());
 assert.equal(typeof session.connectCode,'function');const pending=session.connectCode(code);await new Promise(r=>setImmediate(r));await session.logout();finish();await pending;assert.equal(session.snapshot.phase,'guest');assert.equal(session.snapshot.ports,null);
 const invalid=new AccountSession(config,{fetcher:async()=>new Response('{}',{status:401})});t.after(()=>invalid.dispose());await invalid.connectCode(code);assert.equal(invalid.snapshot.ports,null);assert.match(invalid.snapshot.message,/코드/);
});
