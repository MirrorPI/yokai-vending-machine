import { useEffect, useState, useSyncExternalStore } from 'react';
import { assetUrl } from '../data/catalog.ts';
import { createBrowserImageLoader, SceneBundleController } from './bundle.ts';
import { SceneView } from './SceneView.tsx';
import type { ScenePlan } from './types.ts';

/** Bundle preparation is independent of the frame clock and every game policy. */
export function Scene({ plan, scale, fixedTimeMs = null }: { plan: ScenePlan; scale: number; fixedTimeMs?: number | null }) {
  const [controller] = useState(() => new SceneBundleController(createBrowserImageLoader(assetUrl)));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    void controller.request(plan);
    return () => controller.cancel();
  }, [controller, plan]);
  useEffect(() => {
    if (fixedTimeMs !== null || !state.current) return;
    let handle: number;
    const tick = (now: number) => { setNowMs(now); handle = requestAnimationFrame(tick); };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [fixedTimeMs, state.current]);
  return (
    <div className="scene-container" style={{ width: 192 * scale, height: 256 * scale }}>
      {state.current && <SceneView bundle={state.current} nowMs={fixedTimeMs ?? nowMs} scale={scale} />}
      <p className="scene-status" role="status">
        {state.status === 'failed' ? state.current ? '다음 장면을 불러오지 못했어요. 현재 장면을 유지해요.' : '장면을 불러오지 못했어요.' :
          state.status === 'loading' ? '장면을 준비하고 있어요.' : ''}
      </p>
    </div>
  );
}
