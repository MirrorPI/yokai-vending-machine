import type { CaptureContext } from '../runtime/execution.ts';
import type { AssetFile } from '../data/catalog.ts';
import type { PreparedScene } from '../scene/bundle.ts';
import type { PhotoBytes, PhotoStore } from '../storage/photos.ts';
import type { FrozenCapture, Raster } from './scene.ts';
import type { CaptureInput } from './execution.ts';
import { createBrowserImageLoader } from '../scene/bundle.ts';
import type { ImageLoader } from '../scene/bundle.ts';
import { decodeRgbaPng } from './png.ts';

/** Decode authenticated original samples before a bundle becomes ready. The
 * native image still drives DOM display; a failed source decode never approves
 * a visit or falls back to lossy pixels in ordinary capture. */
export function createBrowserCaptureImageLoader(urlFor: (file: AssetFile) => string, options: {
  loadImage?: ImageLoader; fetch?: typeof fetch;
} = {}): ImageLoader {
  const load = options.loadImage ?? createBrowserImageLoader(urlFor);
  const get = options.fetch ?? globalThis.fetch.bind(globalThis);
  return async file => {
    const [decoded, raster] = await Promise.all([load(file), (async () => {
      const response = await get(urlFor(file));
      if (!response.ok) throw new Error(`PNG source load failed: ${response.status}`);
      const bytes = await response.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== file.sha256) throw new Error(`PNG source hash differs: ${file.publicPath}`);
      if (!file.size) throw new Error('PNG source dimensions missing');
      return decodeRgbaPng(new Uint8Array(bytes), file.size);
    })()]);
    return Object.freeze({ ...decoded, raster });
  };
}

/** Read only already decoded original assets. Cache belongs to the bundle's
 * lifetime (WeakMap); no object URLs or new image loads are created here. */
export function createBrowserRasterReader(createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')) {
  const cache = new WeakMap<PreparedScene, Map<string, Raster>>();
  return (context: CaptureContext, file: AssetFile): Raster => {
    let images = cache.get(context.bundle);
    if (!images) { images = new Map(); cache.set(context.bundle, images); }
    const existing = images.get(file.publicPath);
    if (existing) return existing;
    const decoded = context.bundle.images[file.publicPath];
    if (!decoded || decoded.file.sha256 !== file.sha256 || !file.size) throw new Error('Capture image unavailable');
    if (decoded.raster) {
      const r = decoded.raster;
      if (r.width !== file.size[0] || r.height !== file.size[1] || r.data.length !== r.width * r.height * 4) throw new Error('Capture source raster unavailable');
      const raster = { width: r.width, height: r.height, data: r.data.slice() };
      images.set(file.publicPath, raster); return raster;
    }
    const canvas = createCanvas();
    try {
      canvas.width = file.size[0]; canvas.height = file.size[1];
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas pixel access unavailable');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(decoded.image, 0, 0);
      const raster = { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
      images.set(file.publicPath, raster); return raster;
    } finally { canvas.width = 0; canvas.height = 0; }
  };
}
export function createBrowserEncoder(createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')) {
  return async (sample: FrozenCapture): Promise<PhotoBytes> => {
    const encode = async (cropped: boolean) => {
      const canvas = createCanvas();
      try {
        canvas.width = cropped ? 96 : 192; canvas.height = cropped ? 128 : 256;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('PNG canvas unavailable');
        ctx.imageSmoothingEnabled = false;
        const data = ctx.createImageData(canvas.width, canvas.height);
        data.data.set(sample.rgba(cropped)); ctx.putImageData(data, 0, 0);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
          if (blob?.type === 'image/png' && blob.size) resolve(blob); else reject(new Error('PNG encoding failed'));
        }, 'image/png'));
      } finally { canvas.width = 0; canvas.height = 0; }
    };
    return { png: await encode(true), fullScene: await encode(false) };
  };
}
/** Converts DOM geometry only. This never asserts actual display/ownership proof. */
export function browserClickInput(event: MouseEvent, surface: {
  element: HTMLElement; bundle: PreparedScene | null | undefined; displayToken: number | undefined;
  overlayOpacity: number; proof: unknown;
}): CaptureInput {
  const doc = surface.element.ownerDocument;
  const scene = surface.element.querySelector('.scene');
  const top = doc.elementFromPoint(event.clientX, event.clientY);
  const rect = scene?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
  return { clientX: event.clientX, clientY: event.clientY, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    topmostScene: !!scene && top?.closest('.scene') === scene && !top.closest('[data-capture-blocker]'),
    modal: !!doc.querySelector('[aria-modal="true"],dialog[open]'),
    blockedRects: [...doc.querySelectorAll('.ad-band,[data-capture-blocker]')].map(e => {
      const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height };
    }), bundle: surface.bundle, displayToken: surface.displayToken, overlayOpacity: surface.overlayOpacity, proof: surface.proof };
}
/** A07 query boundary. Latest request owns one URL; stale reads create none. */
export function createPhotoUrlLease(files: Pick<PhotoStore, 'get'>,
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL) {
  let serial = 0, current: string | null = null, disposed = false;
  const release = () => { if (current) urls.revokeObjectURL(current); current = null; };
  return {
    async load(photoKey: string, fullScene = false): Promise<
      { status: 'ready'; url: string; attemptId?: string } | { status: 'missing' | 'unavailable' | 'superseded' }> {
      if (disposed) return { status: 'superseded' };
      const token = ++serial;
      let read;
      try { read = await files.get(photoKey); } catch { read = { status: 'unavailable' as const }; }
      if (disposed || token !== serial) return { status: 'superseded' };
      release();
      if (read.status !== 'found') return { status: read.status === 'missing' ? 'missing' : 'unavailable' };
      const blob = fullScene ? read.fullScene : read.png;
      if (!blob) return { status: 'missing' };
      try { current = urls.createObjectURL(blob); return { status: 'ready', url: current, attemptId: read.attemptId }; }
      catch { return { status: 'unavailable' }; }
    },
    dispose() { disposed = true; serial++; release(); },
  };
}
