import { sampleScene } from './composition.ts';
import type { PreparedScene } from './bundle.ts';

/** Projection only. There are intentionally no visit, click, save or capture handlers. */
export function SceneView({ bundle, nowMs, scale, readNow = () => performance.now() }: {
  bundle: PreparedScene; nowMs: number | null; scale: number; readNow?: () => number;
}) {
  const draw = sampleScene(bundle.plan, nowMs ?? readNow());
  return (
    <div className="scene" role="img" aria-label="요괴 자판기 장면" data-map={bundle.plan.mapId}
      data-bundle={bundle.requestId} style={{ width: 192 * scale, height: 256 * scale }}>
      {draw.map(layer => (
        <img key={layer.id} className="scene-layer" alt="" aria-hidden="true" draggable={false}
          data-layer={layer.id} data-cel={layer.cel} src={bundle.images[layer.file.publicPath].url}
          style={{ transform: layer.flipX ? 'scaleX(-1)' : undefined, opacity: layer.opacity, left: layer.x * scale, top: layer.y * scale, width: layer.width * scale, height: layer.height * scale }} />
      ))}
    </div>
  );
}
