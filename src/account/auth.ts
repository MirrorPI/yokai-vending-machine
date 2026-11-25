import { object } from '../domain/validation.ts';
export interface CognitoConfig { enabled: true; authMode?: 'cognito'; apiBaseUrl: string; cognitoDomain: string; clientId: string; userPoolId: string; region: string; redirectUri: string; logoutUri: string }
export interface CodeConfig {enabled:true;authMode:'invite-code';apiBaseUrl:string}
export type AccountConfig = CognitoConfig | CodeConfig;
export interface AccountIdentity { sub: string; accessToken: string; expiresAt: number }
type TransactionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = 'yokai-vending:pkce';
export const loopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
export function parseAccountConfig(raw: unknown, origin: string, development = false): AccountConfig | null {
  if (!object(raw) || raw.enabled !== true) return null;
  if(raw.authMode==='invite-code'){
    if(typeof raw.apiBaseUrl!=='string')throw new Error('접속 설정을 확인할 수 없어요.');
    const url=new URL(raw.apiBaseUrl);
    if(url.username||url.password||url.hash||url.search||url.pathname!=='/'||(url.protocol!=='https:'&&!(development&&loopback(url.hostname)&&url.protocol==='http:')))throw new Error('안전한 접속 주소가 필요해요.');
    return {enabled:true,authMode:'invite-code',apiBaseUrl:url.origin};
  }
  if(raw.authMode!==undefined&&raw.authMode!=='cognito')throw new Error('지원하지 않는 로그인 설정이에요.');
  for (const field of ['apiBaseUrl','cognitoDomain','clientId','userPoolId','region','redirectUri','logoutUri']) if (typeof raw[field] !== 'string' || !raw[field]) throw new Error('계정 설정을 확인할 수 없어요.');
  const config = raw as unknown as CognitoConfig;
  for (const field of ['apiBaseUrl','cognitoDomain','redirectUri','logoutUri'] as const) {
    const url = new URL(config[field]);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(development && loopback(url.hostname) && url.protocol === 'http:'))) throw new Error('안전한 계정 주소가 필요해요.');
    if ((field === 'apiBaseUrl' || field === 'cognitoDomain') && (url.pathname !== '/' || url.search)) throw new Error('계정 서버 주소가 올바르지 않아요.');
    if ((field === 'redirectUri' || field === 'logoutUri') && url.origin !== origin) throw new Error('로그인 복귀 주소가 일치하지 않아요.');
  }
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(config.region) || !config.userPoolId.startsWith(config.region + '_')) throw new Error('계정 지역 설정이 올바르지 않아요.');
  return { ...config, apiBaseUrl: config.apiBaseUrl.replace(/\/$/, ''), cognitoDomain: config.cognitoDomain.replace(/\/$/, '') };
}
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function beginLogin(config: AccountConfig, storage: TransactionStorage, now = Date.now()): Promise<string> {
  if(config.authMode==='invite-code')throw new Error('초대 코드를 입력해 주세요.');
  const verifier = random(), state = random(), nonce = random();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  storage.setItem(key, JSON.stringify({ verifier, state, nonce, createdAt: now }));
  const url = new URL('/oauth2/authorize', config.cognitoDomain);
  url.search = new URLSearchParams({ response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,scope:'openid email',state,nonce,code_challenge:challenge,code_challenge_method:'S256' }).toString();
  return url.href;
}
export function consumeCallback(search: string, storage: TransactionStorage, now = Date.now()): {code:string;verifier:string;nonce:string} {
  const raw = storage.getItem(key); storage.removeItem(key); // Failed callbacks consume the transaction too.
  const tx: unknown = raw ? JSON.parse(raw) : null, params = new URLSearchParams(search);
  if (!object(tx) || typeof tx.state !== 'string' || params.getAll('state').length !== 1 || params.get('state') !== tx.state || typeof tx.createdAt !== 'number' || now < tx.createdAt || now - tx.createdAt >= 600000 || typeof tx.verifier !== 'string' || typeof tx.nonce !== 'string') throw new Error('로그인 요청이 만료되었어요. 다시 로그인해 주세요.');
  if (params.has('error') || params.getAll('code').length !== 1 || !params.get('code')) throw new Error('로그인을 완료하지 못했어요.');
  return {code:params.get('code')!,verifier:tx.verifier,nonce:tx.nonce};
}
const bytes = (part: string) => Uint8Array.from(atob(part.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
export async function verifyIdentity(token: string, config: AccountConfig, nonce: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<{sub:string;exp:number}> {
  if(config.authMode==='invite-code')throw new Error('초대 코드로 접속해 주세요.');
  const parts = token.split('.'); if (parts.length !== 3) throw new Error('Invalid identity token');
  const header: unknown = JSON.parse(new TextDecoder().decode(bytes(parts[0]))), claims: unknown = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
  if (!object(header) || header.alg !== 'RS256' || typeof header.kid !== 'string' || !object(claims)) throw new Error('Invalid token');
  const response = await fetcher(`${issuer}/.well-known/jwks.json`, {credentials:'omit',redirect:'error'});
  if (!response.ok) throw new Error('Identity keys unavailable');
  const jwks: unknown = await response.json();
  if (!object(jwks) || !Array.isArray(jwks.keys)) throw new Error('Invalid identity keys');
  const matches = jwks.keys.filter(k => object(k) && k.kid === header.kid && k.kty === 'RSA' && k.use === 'sig' && k.alg === 'RS256');
  if (matches.length !== 1) throw new Error('Unknown identity key');
  const pub = await crypto.subtle.importKey('jwk', matches[0], {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pub,bytes(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]))) throw new Error('Invalid identity signature');
  if (claims.iss !== issuer || claims.aud !== config.clientId || claims.token_use !== 'id' || claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number' || claims.exp * 1000 <= now || typeof claims.iat !== 'number' || claims.iat * 1000 > now + 60000) throw new Error('Invalid identity claims');
  return {sub:claims.sub,exp:claims.exp};
}
export async function finishLogin(config: AccountConfig, search: string, storage: TransactionStorage, fetcher: typeof fetch = fetch): Promise<AccountIdentity> {
  if(config.authMode==='invite-code')throw new Error('초대 코드로 접속해 주세요.');
  const tx = consumeCallback(search,storage);
  const response = await fetcher(`${config.cognitoDomain}/oauth2/token`, {method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,redirect_uri:config.redirectUri,code:tx.code,code_verifier:tx.verifier})});
  if (!response.ok) throw new Error('로그인을 확인하지 못했어요.');
  const tokens: unknown = await response.json();
  if (!object(tokens) || typeof tokens.id_token !== 'string' || typeof tokens.access_token !== 'string' || tokens.token_type !== 'Bearer' || typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) throw new Error('Invalid token response');
  const identity = await verifyIdentity(tokens.id_token,config,tx.nonce,fetcher);
  // Access tokens authorize only at the verified server boundary. No client-decoded JWT grants access.
  return {sub:identity.sub,accessToken:tokens.access_token,expiresAt:Math.min(identity.exp*1000,Date.now()+tokens.expires_in*1000)};
}

export function isAccountReturn(search:string,development:boolean):boolean {
  const params=new URLSearchParams(search);return params.has('code')||params.has('error')||(development&&params.has('accountTestSubject'));
}
