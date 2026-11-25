import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AccountContext } from './context.tsx';
import { AccountSession } from './session.ts';
import { parseAccountConfig, finishLogin, loopback, isAccountReturn } from './auth.ts';
import { CodeLogin } from './CodeLogin.tsx';
import { isLocalCollectionTest } from '../runtime/local-collection-test.ts';
const none=()=>()=>{};
export function AccountBoundary({children}:{children:ReactNode}){
  const [session,setSession]=useState<AccountSession|null>(null);
  const [loading,setLoading]=useState(true);
  const required=!import.meta.env.DEV||import.meta.env.VITE_ACCOUNT_REQUIRED==='1';
  const [returning,setReturning]=useState(()=>isAccountReturn(location.search,import.meta.env.DEV));
  useEffect(()=>{
    let alive=true,active:AccountSession|null=null;
    void(async()=>{
      try {
        const response=await fetch('/account-config.json',{cache:'no-store'});if(!response.ok)return;
        const config=parseAccountConfig(await response.json(),location.origin,import.meta.env.DEV);if(!config||!alive)return;
        active=new AccountSession(config);setSession(active);
        if(config.authMode==='invite-code')return;
        if(import.meta.env.DEV&&loopback(location.hostname)&&loopback(new URL(config.apiBaseUrl).hostname)){
          const subject=new URLSearchParams(location.search).get('accountTestSubject');
          if(subject){const {developmentIdentity}=await import('./development.ts');await active.connect(developmentIdentity(subject));
            if(isLocalCollectionTest({development:true,hostname:location.hostname,search:location.search,apiBaseUrl:config.apiBaseUrl,accountKey:active.snapshot.ports?.accountKey}))active.continueAccount();
            return;}
        }
        if(new URLSearchParams(location.search).has('code')||new URLSearchParams(location.search).has('error')){
          const search=location.search;history.replaceState(null,'',location.pathname);
          try {const identity=await finishLogin(config,search,sessionStorage);if(alive)await active.connect(identity);}
          catch {if(alive)setNotice('로그인을 완료하지 못했어요. 설정에서 다시 로그인해 주세요.');}
        }
      }catch{/* Missing/disabled/malformed optional configuration leaves the guest game intact. */}
      finally {if(alive){setReturning(false);setLoading(false);}}
    })();
    return()=>{alive=false;active?.dispose();};
  },[]);
  const [notice,setNotice]=useState<string|null>(null);
  const state=useSyncExternalStore(session?.subscribe??none,()=>session?.snapshot??null);
  if(returning||loading)return <p className="account-gate" role="status">접속을 준비하고 있어요.</p>;
  if(!session||!state)return required?<div className="account-gate" role="alert"><h2>접속을 준비하지 못했어요</h2><p>연결을 확인한 뒤 다시 시도해 주세요.</p><button onClick={()=>location.reload()}>다시 불러오기</button></div>:children;
  if(session.config.authMode==='invite-code')return <AccountContext.Provider value={{session,ports:state.ports}}>
    {state.phase==='account'&&state.ports?<div key={state.generation} style={{display:'contents'}}>{children}</div>:<CodeLogin session={session} state={state}/>}
  </AccountContext.Provider>;
  // Account mode must never fall through to guest storage when its ports retire.
  const playable=state.phase==='guest'||(state.phase==='account'&&state.ports!==null);
  return <AccountContext.Provider value={{session,ports:state.ports}}>
    {playable?<div key={state.generation} style={{display:'contents'}}>{children}</div>:<div className="account-gate" data-capture-blocker role="status">
      <h2>{state.phase==='choose'?'계정 기록':'계정 연결'}</h2>
      <p>{state.phase==='choose'?(state.resumable?'이전 중인 사진이 있어요. 처음 가져온 브라우저에서 이어서 가져올 수 있어요. 나중에 설정에서도 다시 열 수 있어요.':'이 브라우저의 기록을 계정으로 가져오거나 계정으로 계속할 수 있어요. 원본은 이 브라우저에 남아요.'):state.busy?'기록을 확인하고 있어요.':state.message}</p>
      {state.phase==='choose'&&<><button disabled={state.busy} onClick={()=>void session.importGuest()}>{state.resumable?'사진 이어서 가져오기':'이 브라우저 기록 가져오기'}</button><button disabled={state.busy} onClick={()=>session.continueAccount()}>계정으로 계속</button></>}
      <button onClick={()=>void session.logout()}>게스트로 돌아가기</button>
      {state.phase==='choose'&&state.message&&<p>{state.message}</p>}
    </div>}
    {notice&&<p className="account-notice" role="status" data-capture-blocker>{notice}<button onClick={()=>setNotice(null)}>닫기</button></p>}
  </AccountContext.Provider>;
}
