import type { AccountIdentity, CodeConfig } from './auth.ts';
export async function exchangeAccessCode(config:CodeConfig,raw:string,fetcher:typeof fetch=fetch):Promise<AccountIdentity>{
  const code=raw.trim().toUpperCase().replace(/[\s-]/g,'');
  if(raw.length>64||!/^YKV[A-F0-9]{24}$/.test(code))throw new Error('초대 코드를 다시 확인해 주세요.');
  const response=await fetcher(config.apiBaseUrl+'/v1/access/login',{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${code}`}});
  if(!response.ok)throw new Error(response.status===401?'초대 코드가 올바르지 않아요.':'연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  const result:unknown=await response.json();
  if(!result||typeof result!=='object'||!('sub' in result)||typeof result.sub!=='string'||!/^beta-(0[1-9]|1[0-5])$/.test(result.sub)
    ||!('expiresAt' in result)||typeof result.expiresAt!=='number'||result.expiresAt<=Date.now()||result.expiresAt>Date.now()+9*3600000)throw new Error('접속 정보를 확인하지 못했어요.');
  return {sub:result.sub,accessToken:code,expiresAt:result.expiresAt};
}
