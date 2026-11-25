import { useState } from 'react';
import type { AccountSession, AccountSnapshot } from './session.ts';
export function CodeLogin({session,state}:{session:AccountSession;state:AccountSnapshot}){
  const [code,setCode]=useState('');
  return <section className="code-gate" aria-label="초대 코드 로그인">
    <div className="code-card">
      <span className="code-eyebrow">숲속에서 도착한 초대장</span>
      <h1>요괴 자판기</h1>
      <p>낯선 자판기 곁에 작은 흔적이 남아 있어요.<br/>받은 코드를 입력하고 관찰을 시작해 보세요.</p>
      <form onSubmit={e=>{e.preventDefault();if(!state.busy&&code){const entered=code;setCode('');void session.connectCode(entered);}}}>
        <label htmlFor="access-code">초대 코드</label>
        <input id="access-code" type="password" autoComplete="off" autoCapitalize="characters" spellCheck={false}
          value={code} maxLength={64} disabled={state.busy} required placeholder="받은 코드를 붙여넣어 주세요" onChange={e=>setCode(e.target.value)}/>
        <button type="submit" disabled={state.busy||!code.trim()}>{state.busy?'초대장을 확인하고 있어요…':'관찰 시작하기'}</button>
      </form>
      {state.message&&<p className="code-error" role="alert">{state.message}</p>}
      <small>코드 하나에 한 사람의 수집 기록이 저장돼요.<br/>다른 사람에게 코드를 공유하지 말아 주세요.</small>
    </div>
  </section>;
}
