import { useState } from 'react';
import { assetCatalog } from '../data/catalog.ts';
import type { SchedulerState } from './scheduler.ts';
import './local-visit-tools.css';
const guests = assetCatalog.yokai.filter(y => y.no >= 61 && y.no <= 68);
const ranks: Record<string,string> = { common:'일반', rare:'희귀', legendary:'전설', special:'특수' };
export function LocalVisitTools({ state, request }: { state?: SchedulerState; request(id:string):boolean }) {
  const [selected,setSelected] = useState('yokai_061');
  const [last,setLast] = useState<string|null>(null);
  const [expanded,setExpanded] = useState(true);
  const [pending,setPending] = useState(false);
  const idle = !!state && !state.recoveryPending && !state.visit && !state.candidate && ['waiting','no-candidates'].includes(state.phase);
  // State publication after an accepted request makes duplicate clicks unavailable.
  if (pending && state && state.phase !== 'waiting') setPending(false);
  const spawn = (id:string) => { if (request(id)) { setSelected(id);setLast(id);setPending(true);setExpanded(false); } };
  const current = guests.find(y=>y.id===state?.candidate?.id);
  return <aside className="local-visit-tools" data-capture-blocker aria-label="새 요괴 로컬 테스트">
    <button className="local-test-heading" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>새 요괴 테스트 <span>{expanded?'접기':'펼치기'}</span></button>
    {expanded && <><p>전용 테스트 계정에 저장됩니다.<br/>요괴를 누르면 사진과 물건을 수집해요.</p>
      <label>등장시킬 요괴<select value={selected} disabled={!idle || pending} onChange={e=>setSelected(e.target.value)}>
        {guests.map(y=><option key={y.id} value={y.id}>{y.no} · {y.name} · {ranks[y.rarity]}</option>)}
      </select></label>
      <button disabled={!idle || pending} onClick={()=>spawn(selected)}>바로 등장</button>
      <div className="local-test-actions"><button disabled={!idle || pending || !last} onClick={()=>last && spawn(last)}>같은 요괴 다시</button><button disabled={!idle || pending} onClick={()=>{const i=guests.findIndex(y=>y.id===(last??selected));spawn(guests[(i+1)%guests.length].id);}}>다음 요괴</button></div>
      <p>수집 후 도감의 NEW·사진과 물건함의 수량을 확인하세요. 읽은 물건을 다시 수집하면 +1 표시를 볼 수 있어요.</p>
    </>}
    <p className="local-test-status" role="status">{current?`${current.name} · ${state?.phase==='visiting'||state?.phase==='appearing'?'화면의 요괴를 눌러 수집하세요':'등장·저장을 처리하고 있어요'}`:idle?'선택한 요괴를 바로 부를 수 있어요.':'이전 방문과 저장을 확인하고 있어요.'}</p>
  </aside>;
}
