import { AccountBoundary } from '../account/AccountBoundary.tsx';
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { assetCatalog } from '../data/catalog.ts';
import { compileScene } from '../scene/composition.ts';
import { collectionLayout } from './collection-layout.ts';
import { resolveScenePreview } from '../scene/preview.ts';
import { Scene } from '../scene/Scene.tsx';
import { RuntimeStage } from '../runtime/RuntimeStage.tsx';
import { resolveRuntimePreview } from '../runtime/preview.ts';
import { ObservationContext } from '../observation/context.tsx';
import { SurfaceRegistry } from '../observation/surfaces.ts';
import { PipController } from '../observation/pip.ts';
import { OrdinaryExperience } from './experience.tsx';
import { browserOffset, seasonAt } from '../runtime/rules.ts';
import type { Season } from '../domain/state.ts';
import './mini-window.css';
const noSubscribe = () => () => {};

function FoldedToolbar({ onRestore }: { onRestore(): void }) {
  return <div className="pip-folded"><button type="button" aria-label="게임 펼치기" onClick={onRestore}>
    <span className="pip-folded-icons" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>
      <svg viewBox="0 0 24 24" focusable="false"><path d="M6.2 3.8 9 3l2.1 4.7-2 1.8a15.5 15.5 0 0 0 5.4 5.4l1.8-2L21 15l-.8 2.8c-.4 1.3-1.8 2-3.1 1.6A18.6 18.6 0 0 1 4.6 6.9c-.4-1.3.3-2.7 1.6-3.1Z"/></svg>
      <svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16M8 14h2m4 0h2m-8 3h2"/></svg>
      <svg viewBox="0 0 24 24" focusable="false"><path d="M4 7h7l2 2h7v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"/><path d="M4 10h16"/></svg>
    </span>
  </button></div>;
}

export function App({ guestOnly = false }: { guestOnly?: boolean }) {
  const [viewport, setViewport] = useState({ width: 384, height: 576 });
  const [sceneSeason, setSceneSeason] = useState<Season>(() => seasonAt(Date.now(), browserOffset).season);
  const [minigameTarget,setMinigameTarget]=useState<HTMLDivElement|null>(null);
  const [footerTarget,setFooterTarget]=useState<HTMLDivElement|null>(null);
  const [host, setHost] = useState<{ surfaces: SurfaceRegistry; pip: PipController } | null>(null);
  const folded = useSyncExternalStore(host?.pip.subscribe ?? noSubscribe, () => host?.pip.folded ?? false);
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    const surfaces = new SurfaceRegistry(root), pip = new PipController(surfaces);
    setHost({ surfaces, pip });
    return () => { pip.dispose(); surfaces.dispose(); };
  }, []);
  useEffect(() => {
    const win = host?.surfaces.window ?? window;
    const measure = () => setViewport({ width: win.innerWidth, height: win.innerHeight });
    measure();
    win.addEventListener('resize', measure);
    const remove = host?.surfaces.subscribe(measure);
    return () => { win.removeEventListener('resize', measure); remove?.(); };
  }, [host, host?.surfaces.generation]);
  const selection = useMemo(() => {
    try {
      const search=import.meta.env.DEV?window.location.search:'';
      const preview = resolveScenePreview(search);
      return { ...preview, runtimePreview: preview.preview ? null : resolveRuntimePreview(search), plan: compileScene(assetCatalog, preview.input), error: null };
    } catch (error) {
      const preview = resolveScenePreview('');
      return { ...preview, runtimePreview: null, plan: compileScene(assetCatalog, preview.input), error: String(error) };
    }
  }, []);
  const { scene: { scale, left, top }, docked, panelWidth, footerHeight, compact } = collectionLayout(viewport.width, viewport.height);
  const experience = <OrdinaryExperience scale={scale} onSceneSeason={setSceneSeason}
    collectionDisplay={{ docked, panelWidth, footerTarget, minigameTarget }} />;
  return (
    <ObservationContext.Provider value={host}>{folded && <FoldedToolbar onRestore={() => host?.pip.unfold()}/> }<main hidden={folded} className={`game-shell${compact?' game-shell-compact':''}`} aria-label="요괴 자판기"
      data-ui-season={selection.preview || selection.error ? selection.plan.input.season : sceneSeason}
      style={{ width: 192 * scale, left, top, '--footer-height':`${footerHeight}px` } as CSSProperties}>
      <div className="game-scene-area" style={{ height: 256 * scale }}>
        {selection.preview || selection.error ? <Scene plan={selection.plan} scale={scale} fixedTimeMs={selection.fixedTimeMs} /> :
          selection.runtimePreview ? <RuntimeStage scale={scale} verification={selection.runtimePreview} onSceneSeason={setSceneSeason} /> :
            host && (guestOnly ? experience : <AccountBoundary>{experience}</AccountBoundary>)}
      </div>
      <footer className="ad-band" aria-label="하단 배너 영역">
        <div className="collection-nav-slot" ref={setFooterTarget}/>
        <a className="ad-slot" href="https://apps.apple.com/kr/app/%EC%83%B7%EC%8A%A4%EC%BC%80%EC%A4%84/id6821328198"
          target="_blank" rel="noopener noreferrer" aria-label="샷스케줄 · 스크린샷을 일정으로 · App Store에서 보기 (새 탭)" data-capture-blocker>
          <span className="ad-caption">ADVERTISEMENT</span>
          <span className="ad-title">샷스케줄 <span aria-hidden="true">↗</span></span>
          <span className="ad-placeholder">스크린샷을 일정으로 · App Store에서 보기</span>
        </a>
      </footer>
      <div ref={setMinigameTarget} className="minigame-zone-slot" style={docked?{width:192*scale+2*(panelWidth+16),marginLeft:-(panelWidth+16)}:undefined}/>
      {(selection.preview || selection.error) && <p className="preview-note" role="status">
        {selection.error ? '검증 입력을 사용할 수 없어 기본 배경을 표시해요.' : '장면 검증 · 방문과 수집 기록을 만들지 않아요.'}
      </p>}
    </main></ObservationContext.Provider>
  );
}
