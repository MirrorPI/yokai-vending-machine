import { useSyncExternalStore } from 'react';
import { useAccount } from './context.tsx';
import { loopback } from './auth.ts';
const none=()=>()=>{};
export function AccountSettings(){
  const account=useAccount();const state=useSyncExternalStore(account?.session.subscribe??none,()=>account?.session.snapshot??null);
  if(!account||!state)return <p>이 브라우저에 기록을 보관해요.</p>;
  if(account.session.config.authMode==='invite-code')return <section><h3>초대 계정</h3><p>이 코드의 수집 기록을 보관하고 있어요. 같은 코드로 다시 접속해 이어갈 수 있어요.</p><button disabled={state.busy} onClick={()=>void account.session.logout()}>로그아웃</button>{state.message&&<p role="status">{state.message}</p>}</section>;
  return <section><h3>계정</h3><p>{state.phase==='account'?'계정에 기록을 보관하고 있어요. 다른 기기에서도 로그인해 이어갈 수 있어요.':'현재 기록은 이 브라우저에 보관돼요.'}</p>
    {state.phase==='account'?<button disabled={state.busy} onClick={()=>void(async()=>{
      await account.session.logout();const config=account.session.config;if(config.authMode==='invite-code'||(import.meta.env.DEV&&loopback(location.hostname)&&loopback(new URL(config.apiBaseUrl).hostname)))return;const url=new URL('/logout',config.cognitoDomain);url.search=new URLSearchParams({client_id:config.clientId,logout_uri:config.logoutUri}).toString();location.assign(url.href);
    })()}>로그아웃</button>:<button disabled={state.busy} onClick={()=>void account.session.login(sessionStorage,url=>location.assign(url))}>로그인 · 가입</button>}
    {state.phase==='account'&&state.resumable&&<><p>아직 이전 중인 사진이 있어요. 원본이 있는 브라우저에서 이어서 가져와 주세요.</p><button disabled={state.busy} onClick={()=>void account.session.openImport()}>사진 가져오기 계속</button></>}
    {state.message&&<p role="status">{state.message}</p>}
    <p>이 브라우저의 게스트 기록은 계정 기록과 따로 보관해요.</p>
  </section>;
}
