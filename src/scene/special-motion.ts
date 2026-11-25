import motions from '../data/generated/special-motion.json' with { type: 'json' };
import type { SceneCatalog } from './types.ts';
import type { AssetFile } from '../data/catalog.ts';

/** Runtime art revision. Historical source catalog stays intact for old captures
 * and pixel-oracle audits; current scenes use the separately authored cels. */
export function withSpecialMotion<T extends SceneCatalog>(catalog: T): T {
  const originalFiles = (catalog as T & { files?: readonly AssetFile[] }).files;
  const files = originalFiles ? [...new Map([...originalFiles, ...Object.values(motions).flatMap(m => [...m.frames, m.aura])].map(f => [f.publicPath, f])).values()] : null;
  return { ...catalog, ...(files ? { files } : {}), yokai: catalog.yokai.map(y => {
    const motion = (motions as Record<string, typeof motions.yokai_020>)[y.id];
    if (!motion || !y.art) return y;
    const original = y.art.animation;
    // Replace old detached contour effects with a broad, softly pulsing backlight.
    // Bulgae's moon remains integrated in the body cels; no fixed duplicate layer.
    const layers = [{ metadata: { type: 'ambient_aura', frameSize: [192, 256], anchor: [0, 0],
      contactPoint: [-96, 0], logicalScale: 2, order: 10,
      opacityPulse: { min: 0.38, max: 0.68, periodMs: 6000 } },
      usage: 'effect', image: motion.aura, frames: [] }];
    return { ...y, art: { ...y.art, animation: { ...original, frames: motion.frames, layers, halo: null,
      metadata: { ...original.metadata, frameCount: motion.frames.length, sequence: motion.sequence, durationsMs: motion.durationsMs, startOffsetMs: 0 } } } };
  }) } as T;
}
