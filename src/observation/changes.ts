import { subscribeGameChanges } from '../storage/changes.ts';
import type { SurfaceRegistry } from './surfaces.ts';
/** Read-only notifications follow the rendering document; no ownership or write
 * port. Same controller and fixed read jobs survive every document rebind. */
export function subscribeSurfaceChanges(surfaces: SurfaceRegistry, changed: () => void): () => void {
  let cleanup = () => {};
  const bind = () => {
    cleanup(); const document = surfaces.document, window = surfaces.window;
    if (!window) return;
    cleanup = subscribeGameChanges(() => {
      if (surfaces.document === document && surfaces.observable()) changed();
    }, { window, document });
  };
  bind();
  const remove = surfaces.subscribe(() => { bind(); if (surfaces.observable()) changed(); });
  return () => { remove(); cleanup(); };
}
