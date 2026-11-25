import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { installPanelBehavior } from '../encyclopedia/panel.ts';

const FireRainGame = lazy(() => import('../minigame/FireRainGame.tsx').then(module => ({ default: module.FireRainGame })));

export function MinigameZone() {
  const [playing, setPlaying] = useState(false);
  if (playing) return <section className="minigame-active" aria-label="도깨비불아, 비를 피해!" data-capture-blocker>
    <button data-stone="back" type="button" onClick={() => setPlaying(false)}>← 미니게임 목록</button>
    <Suspense fallback={<p role="status">게임을 불러오는 중…</p>}><FireRainGame/></Suspense>
  </section>;
  return <section className="minigame-zone" aria-label="미니게임 존" data-capture-blocker>
    <h2>미니게임 존</h2>
    <div className="minigame-unlock">
      <button data-stone="primary" type="button"
        onClick={() => setPlaying(true)}>도깨비불아, 비를 피해!</button>

    </div>
  </section>;
}
export function MinigamePanel({onClose}:{onClose():void}) {
  const dialog=useRef<HTMLElement>(null);
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>installPanelBehavior({dialog:dialog.current!,navigation:dialog.current!.ownerDocument.querySelector('.collection-footer-nav'),onClose:()=>close.current()}),[]);
  return <div className="encyclopedia-backdrop" data-capture-blocker onClick={e=>{e.stopPropagation();if(e.target===e.currentTarget)onClose();}}>
    <section ref={dialog} className="encyclopedia-panel minigame-panel" role="dialog" aria-modal="true" aria-label="미니게임" tabIndex={-1}>
      <header className="encyclopedia-header"><h2>미니게임</h2><button onClick={onClose}>닫기</button></header>
      <MinigameZone/>
    </section>
  </div>;
}
