import { SceneView } from '../scene/SceneView.tsx';
import { sampleScene } from '../scene/composition.ts';
import { fades } from './rules.ts';
import type { SchedulerState } from './scheduler.ts';
import type { TransitionSample } from './transition.ts';
const clamp = (n: number) => Math.max(0, Math.min(1, n));
/** Projection only; displaying a proposal is never an automatic start acknowledgement. */
export function RuntimeView({ background, scheduler, nowMs, scale }: {
  background: TransitionSample; scheduler: SchedulerState; nowMs: number; scale: number;
}) {
  const bundle = scheduler.display?.bundle;
  if (bundle && scheduler.phase !== 'awaiting-display') {
    const draw = sampleScene(bundle.plan, nowMs);
    const visit = scheduler.visit;
    const presentation = scheduler.display?.presentation;
    const fade = fades[scheduler.candidate!.rarity];
    const opacity = scheduler.phase === 'presenting' && presentation ? clamp((nowMs - presentation.monotonicMs) / fade.enter) :
      visit && (scheduler.phase === 'appearing' || scheduler.phase === 'awaiting-start') ? clamp((nowMs - visit.shownMono) / fade.enter) :
      scheduler.phase === 'leaving' ? 1 - clamp((nowMs - scheduler.leavingAt!) / fade.exit) : 1;
    const image = (layer: (typeof draw)[number]) => <img key={layer.id} className="scene-layer" alt="" aria-hidden="true" draggable={false}
      data-layer={layer.id} data-cel={layer.cel} src={bundle.images[layer.file.publicPath].url}
      style={{ transform: layer.flipX ? 'scaleX(-1)' : undefined, opacity: layer.opacity, left: layer.x * scale, top: layer.y * scale, width: layer.width * scale, height: layer.height * scale }} />;
    return <div className="scene" role="img" aria-label="요괴 자판기 장면" data-map={bundle.plan.mapId} data-bundle={bundle.requestId}
      data-sampled-at={nowMs} style={{ width: 192 * scale, height: 256 * scale }}>
      {draw.filter(l => l.id === 'background').map(image)}
      <div className="runtime-overlays" style={{ opacity }}>{draw.filter(l => l.id !== 'background').map(image)}</div>
    </div>;
  }
  return <div className="scene" style={{ width: 192 * scale, height: 256 * scale }}>
    {background.current && <SceneView bundle={background.from ?? background.current} nowMs={nowMs} scale={scale} />}
    {background.to && <div className="runtime-fade" style={{ opacity: background.progress }}>
      <SceneView bundle={background.to} nowMs={nowMs} scale={scale} />
    </div>}
  </div>;
}
