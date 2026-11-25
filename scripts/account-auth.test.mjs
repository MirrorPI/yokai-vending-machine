import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../src/account/auth.ts').catch(() => ({}));
const config = {enabled:true,apiBaseUrl:'https://api.example.com',cognitoDomain:'https://game.auth.ap-northeast-2.amazoncognito.com',clientId:'client',userPoolId:'ap-northeast-2_pool',region:'ap-northeast-2',redirectUri:'https://game.example.com/',logoutUri:'https://game.example.com/'};
const storage = () => {const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
test('account config rejects insecure endpoints, credentials, redirect mismatch and disabled remains guest',async()=>{
 const {parseAccountConfig}=await load(); assert.equal(typeof parseAccountConfig,'function');
 assert.equal(parseAccountConfig(null,'https://game.example.com'),null);
 assert.equal(parseAccountConfig({enabled:false},'https://game.example.com'),null);
 assert.equal(parseAccountConfig(config,'https://game.example.com').clientId,'client');
 for(const patch of [{apiBaseUrl:'http://api.example.com'},{apiBaseUrl:'https://u:p@api.example.com'},{redirectUri:'https://evil.example.com/'},{userPoolId:'other_pool'}])assert.throws(()=>parseAccountConfig({...config,...patch},'https://game.example.com'));
});
test('PKCE uses S256 and one-use state even on error, rejects expiry',async()=>{
 const {beginLogin,consumeCallback}=await load();assert.equal(typeof beginLogin,'function'); const store=storage();
 const url=new URL(await beginLogin(config,store,100)); assert.equal(url.searchParams.get('code_challenge_method'),'S256'); assert.equal(url.searchParams.has('client_secret'),false);
 const state=url.searchParams.get('state'); assert.throws(()=>consumeCallback('?code=x&state=wrong',store,101));
 assert.throws(()=>consumeCallback(`?code=x&state=${state}`,store,101));
 const next=new URL(await beginLogin(config,store,100));assert.throws(()=>consumeCallback(`?error=access_denied&state=${next.searchParams.get('state')}`,store,101));
 const old=new URL(await beginLogin(config,store,100));assert.throws(()=>consumeCallback(`?code=x&state=${old.searchParams.get('state')}`,store,600101));
});
test('verified identity checks signature, nonce, issuer, client, expiry',async()=>{
 const {verifyIdentity}=await load();assert.equal(typeof verifyIdentity,'function');
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'key',alg:'RS256',use:'sig'};
 const sign=async patch=>{const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const input=enc({alg:'RS256',kid:'key'})+'.'+enc({iss:'https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_pool',aud:'client',token_use:'id',sub:'alice',nonce:'nonce',exp:200,iat:90,...patch});return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(input))).toString('base64url')};
 const fetcher=async()=>new Response(JSON.stringify({keys:[jwk]}));
 assert.equal((await verifyIdentity(await sign({}),config,'nonce',fetcher,100000)).sub,'alice');
 for(const patch of [{nonce:'wrong'},{aud:'other'},{exp:99},{iss:'https://evil.test'},{token_use:'access'}]){const bad=await sign(patch);await assert.rejects(()=>verifyIdentity(bad,config,'nonce',fetcher,100000));}
 const token=await sign({});await assert.rejects(()=>verifyIdentity(token.slice(0,-10)+'AAAAAAAAAA',config,'nonce',fetcher,100000));
});
test('auth return URLs hold guest startup only for an explicit OAuth or development fixture return',async()=>{
 const {isAccountReturn}=await load();assert.equal(typeof isAccountReturn,'function');assert.equal(isAccountReturn('?code=x&state=s',false),true);assert.equal(isAccountReturn('?error=denied&state=s',false),true);assert.equal(isAccountReturn('?accountTestSubject=fixture-alice',false),false);assert.equal(isAccountReturn('?accountTestSubject=fixture-alice',true),true);assert.equal(isAccountReturn('?preview=scene',true),false);
});
