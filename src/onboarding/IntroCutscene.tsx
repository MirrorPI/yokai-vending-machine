import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useSurface } from '../observation/context.tsx';
import { installPanelBehavior } from '../encyclopedia/panel.ts';
import { introCuts } from './cutscene.ts';
import { CutsceneArt } from './CutsceneArt.tsx';
import './cutscene.css';

export function IntroCutscene({ onFinish, replay = false }: { onFinish(): void; replay?: boolean }) {
  const { host, generation } = useSurface();
  const doc = host?.surfaces.document ?? document;
  const [index, setIndex] = useState(0), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const done = useRef(false), dialog = useRef<HTMLElement>(null), latestFinish = useRef(onFinish);
  latestFinish.current = onFinish;
  const cut = introCuts[index], last = index === introCuts.length - 1;
  const finish = () => { if (!done.current) { done.current = true; latestFinish.current(); } };
  useLayoutEffect(() => {
    const el = dialog.current!;
    // The film is a body-level portal, outside all game clipping/transform containers.
    const siblings = [...doc.body.children].filter((node): node is HTMLElement => node instanceof doc.defaultView!.HTMLElement && node !== el);
    const saved = siblings.map(node => ({ node, inert: node.inert }));
    saved.forEach(({ node }) => { node.inert = true; });
    const overflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    const releaseFocus = installPanelBehavior({ dialog: el, onClose: finish });
    return () => {
      saved.forEach(({ node, inert }) => { node.inert = inert; });
      doc.body.style.overflow = overflow;
      releaseFocus();
    };
  }, [doc, generation]);
  return createPortal(<section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true"
    className="intro-cinema" aria-label={replay ? '첫 이야기 다시보기' : '요괴 자판기 첫 이야기'} data-capture-blocker
    onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <button className="cinema-next" aria-label={last ? replay ? '이야기 마치고 설정으로 돌아가기' : '이야기 마치고 관찰 시작' : `다음 장면: ${introCuts[index + 1].title}`}
      onClick={() => { if (last) finish(); else setIndex(n => Math.min(n + 1, introCuts.length - 1)); }}>
      <div key={cut.id} className="cinema-shot" data-cut={cut.id} style={{ '--cut-duration': `${cut.durationMs}ms` } as CSSProperties}>
        <CutsceneArt cut={cut.id} ready={ready} onReady={() => setReady(true)} onError={() => setFailed(true)}/>
        {!ready && <span className="cinema-loading">{failed ? '장면을 불러오지 못했어요. Esc 또는 건너뛰기로 돌아갈 수 있어요.' : '숲의 이야기를 펼치는 중…'}</span>}
        <div className="cinema-caption" aria-live="polite" aria-atomic="true"><p>{cut.line}</p></div>
      </div>
      <span className="cinema-continue">{last ? replay ? '눌러서 이야기 마치기' : '눌러서 관찰 시작' : '화면을 눌러 다음 장면'} <span aria-hidden="true">▸</span></span>
    </button>
    <button className="cinema-skip" onClick={finish}>{replay ? '닫기' : '건너뛰기'} <span>Esc</span></button>
  </section>, doc.body);
}
