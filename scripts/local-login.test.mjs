import test from 'node:test';
import assert from 'node:assert/strict';
import { localAccountResponse } from '../server/local-login.mjs';

test('local login entry and authorize route present explicit fixture accounts without passwords', () => {
  for (const url of ['/local-login', '/oauth2/authorize?redirect_uri=https://example.com&state=untrusted']) {
    const r=localAccountResponse({url,host:'127.0.0.1:5174',method:'GET'});
    assert.equal(r.status,200);
    assert.match(r.body,/로컬 테스트 로그인/);
    assert.match(r.body,/fixture-manual/);
    assert.match(r.body,/fixture-second/);
    assert.match(r.body,/action="\/"/);
    assert.doesNotMatch(r.body,/example\.com|type="password"|untrusted/);
  }
});

test('fixture configuration is limited to the configured loopback host and read methods', () => {
  assert.equal(localAccountResponse({url:'/account-config.json',host:'attacker.test:5174',method:'GET'}).status,403);
  assert.equal(localAccountResponse({url:'/account-config.json',host:'127.0.0.1:5174',method:'POST'}).status,405);
  const r=localAccountResponse({url:'/account-config.json',host:'127.0.0.1:5174',method:'GET'});
  const config=JSON.parse(r.body);
  assert.equal(config.apiBaseUrl,'http://127.0.0.1:5180');
  assert.equal(config.cognitoDomain,'http://127.0.0.1:5174');
  assert.equal(localAccountResponse({url:'/src/main.tsx',host:'127.0.0.1:5174',method:'GET'}),null);
});
