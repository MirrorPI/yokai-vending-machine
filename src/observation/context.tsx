import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SurfaceRegistry } from './surfaces.ts';
import type { PipController } from './pip.ts';
export const ObservationContext = createContext<{ surfaces: SurfaceRegistry; pip: PipController } | null>(null);
const emptySubscribe = () => () => {};
export function useSurface() {
  const host = useContext(ObservationContext);
  const generation = useSyncExternalStore(host?.surfaces.subscribe ?? emptySubscribe, () => host?.surfaces.generation ?? 0);
  return { host, generation };
}
export function PipControls() {
  const { host } = useSurface();
  useSyncExternalStore(host?.pip.subscribe ?? emptySubscribe, () => `${host?.pip.status}:${host?.pip.error}`);
  if (!host) return null;
  const pip = host.pip;
  return <>
    {pip.available ? <button className="pip-toggle" data-capture-blocker disabled={pip.status === 'opening'} onClick={e => {
      e.stopPropagation(); if (pip.status === 'pip') pip.close(); else void pip.open();
    }}>{pip.status === 'opening' ? '작은 창 준비 중' : pip.status === 'pip' ? '원래 탭으로' : '작게 띄우기'}</button> :
      <span className="pip-unsupported" data-capture-blocker>작은 창 미지원 · 창을 줄여서 구석에 두세요.</span>}
    {pip.status === 'pip' && <button className="pip-fold" data-capture-blocker onClick={e => { e.stopPropagation(); pip.fold(); }}>숨기기</button>}
    {pip.status === 'failed' && <p className="pip-error" data-capture-blocker role="status">작은 창을 열지 못했어요. {pip.error} 버튼으로 다시 시도할 수 있어요.</p>}
  </>;
}
