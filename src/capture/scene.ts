import { roundTiesToEven, sampleScene } from '../scene/composition.ts';
import type { CaptureContext } from '../runtime/execution.ts';
import type { AssetFile } from '../data/catalog.ts';
import type { DrawLayer } from '../scene/types.ts';

export interface Raster { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }
export type RasterReader = (file: AssetFile) => Raster;
export interface CaptureDefinition {
  giant: { faceAnchor: readonly number[] } | null;
  metadata: { giant: boolean; anchor: readonly number[]; sourceOrigin: readonly number[]; faceAnchor?: readonly number[] };
}
export interface Rect { left: number; top: number; width: number; height: number }
export interface ClickGeometry {
  clientX: number; clientY: number; rect: Rect;
  /** Host's elementFromPoint/modal result. Missing/false proof fails closed. */
  topmostScene: boolean; modal: boolean; blockedRects: readonly Rect[];
}
export function photoCrop(point: readonly number[]) {
  if (point.length !== 2 || !point.every(Number.isFinite)) throw new Error('Missing original photo anchor');
  return Object.freeze({ x: Math.max(0, Math.min(96, roundTiesToEven(point[0] - 48))),
    y: Math.max(0, Math.min(128, roundTiesToEven(point[1] - 64))), width: 96, height: 128 });
}
function over(dst: Uint8ClampedArray, at: number, src: Uint8ClampedArray, from: number, opacity = 1) {
  const a = src[from + 3] / 255 * opacity, b = dst[at + 3] / 255 * (1 - a), out = a + b;
  if (!out) return;
  for (let c = 0; c < 3; c++) dst[at + c] = Math.round((src[from + c] * a + dst[at + c] * b) / out);
  dst[at + 3] = Math.round(out * 255);
}
function plane(layer: DrawLayer, raster: Raster): Uint8ClampedArray {
  if (raster.width !== layer.file.size?.[0] || raster.height !== layer.file.size?.[1]
    || raster.data.length !== raster.width * raster.height * 4 || layer.width <= 0 || layer.height <= 0) throw new Error('Invalid raster');
  const pixels = new Uint8ClampedArray(192 * 256 * 4);
  for (let y = Math.max(0, layer.y); y < Math.min(256, layer.y + layer.height); y++) {
    for (let x = Math.max(0, layer.x); x < Math.min(192, layer.x + layer.width); x++) {
      const forwardX = Math.floor((x - layer.x) * raster.width / layer.width), sy = Math.floor((y - layer.y) * raster.height / layer.height);
      const sx = layer.flipX ? raster.width - 1 - forwardX : forwardX;
      pixels.set(raster.data.subarray((sy * raster.width + sx) * 4, (sy * raster.width + sx) * 4 + 4), (y * 192 + x) * 4);
    }
  }
  return pixels;
}
/** Private copied pixels outlive DOM images and bundles; callers only receive copies. */
export class FrozenCapture {
  readonly context: CaptureContext;
  readonly draw: readonly DrawLayer[];
  readonly crop: ReturnType<typeof photoCrop>;
  readonly giant: boolean;
  readonly opacity: number;
  readonly family: CaptureContext['family'];
  readonly sceneSeason: CaptureContext['sceneSeason'];
  readonly gameSeason: CaptureContext['gameSeason'];
  readonly bundleId: number;
  readonly bounds: Readonly<{ left: number; top: number; right: number; bottom: number }> | null;
  #pixels: Uint8ClampedArray;
  #body: Uint8ClampedArray;
  #blocked: Uint8ClampedArray;
  constructor(context: CaptureContext, definition: CaptureDefinition, read: RasterReader, opacity: number) {
    if (!Number.isFinite(context.sampledAtMono) || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('Invalid capture sample');
    const input = context.bundle.plan.input;
    if (!input.yokaiId || input.family !== context.family || input.season !== context.sceneSeason) throw new Error('Capture bundle mismatch');
    this.context = context;
    this.family = context.family; this.sceneSeason = context.sceneSeason; this.gameSeason = context.gameSeason;
    this.bundleId = context.bundle.requestId; this.giant = definition.metadata.giant; this.opacity = opacity;
    this.draw = Object.freeze(structuredClone(sampleScene(context.bundle.plan, context.sampledAtMono)).map(l => {
      Object.freeze(l.file.size); Object.freeze(l.file); return Object.freeze(l);
    }));
    const body = this.draw.find(l => l.id === 'body');
    if (!body) throw new Error('No body in capture');
    // giant.faceAnchor is in the original, unpadded body source coordinates.
    // Small faceAnchor, when authored, is already in padded frame coordinates.
    // Older seasonal sprites retain their original support-anchor crop.
    const anchor = this.giant ? definition.giant?.faceAnchor : definition.metadata.faceAnchor ?? definition.metadata.anchor;
    if (!anchor) throw new Error('Missing original giant face anchor');
    const origin = this.giant ? definition.metadata.sourceOrigin : [0, 0];
    const faceX = anchor[0] + origin[0];
    this.crop = photoCrop([body.x + (body.flipX ? body.file.size![0] - faceX : faceX) * body.width / body.file.size![0],
      body.y + (anchor[1] + origin[1]) * body.height / body.file.size![1]]);
    this.#pixels = new Uint8ClampedArray(192 * 256 * 4);
    this.#body = new Uint8ClampedArray(this.#pixels.length);
    this.#blocked = new Uint8ClampedArray(this.#pixels.length);
    const overlays = new Uint8ClampedArray(this.#pixels.length);
    let afterBody = false;
    for (const layer of this.draw) {
      const p = plane(layer, read(layer.file));
      if (layer.id === 'body') { this.#body = p; afterBody = true; }
      if (afterBody && layer.id === 'foreground') this.#blocked = p;
      // opacity=1 is the ordinary sequential source-over stack (A03 oracle).
      // Fractional entry opacity uses the isolated DOM overlay group.
      const target = layer.id === 'background' || opacity === 1 ? this.#pixels : overlays;
      for (let i = 0; i < target.length; i += 4) over(target, i, p, i, layer.opacity ?? 1);
    }
    if (opacity !== 1) for (let i = 0; i < this.#pixels.length; i += 4) over(this.#pixels, i, overlays, i, opacity);
    let left = 192, top = 256, right = 0, bottom = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 192; x++) if (this.#body[(y * 192 + x) * 4 + 3]) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
    this.bounds = right > left ? Object.freeze({ left, top, right, bottom }) : null;
    Object.freeze(this);
  }
  opaque(x: number, y: number): boolean { return this.#body[(y * 192 + x) * 4 + 3] > 0; }
  occluded(x: number, y: number): boolean { return this.#blocked[(y * 192 + x) * 4 + 3] > 0; }
  rgba(cropped = false): Uint8ClampedArray {
    if (!cropped) return this.#pixels.slice();
    const out = new Uint8ClampedArray(96 * 128 * 4);
    for (let y = 0; y < 128; y++) {
      const from = ((this.crop.y + y) * 192 + this.crop.x) * 4;
      out.set(this.#pixels.subarray(from, from + 96 * 4), y * 96 * 4);
    }
    return out;
  }
}
export function freezeCapture(context: CaptureContext, definition: CaptureDefinition, read: RasterReader, opacity = 1) {
  return new FrozenCapture(context, definition, read, opacity);
}
function inside(x: number, y: number, r: Rect) { return x >= r.left && y >= r.top && x < r.left + r.width && y < r.top + r.height; }
export function hitCapture(sample: FrozenCapture, input: ClickGeometry): boolean {
  const { rect: r, clientX, clientY } = input;
  if (!sample.bounds || sample.opacity <= 0 || input.topmostScene !== true || input.modal !== false
    || ![clientX, clientY, r.left, r.top, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0
    || !inside(clientX, clientY, r) || input.blockedRects.some(b => inside(clientX, clientY, b))) return false;
  const x = (clientX - r.left) * 192 / r.width, y = (clientY - r.top) * 256 / r.height;
  const ix = Math.floor(x), iy = Math.floor(y);
  if (sample.occluded(ix, iy) || y >= 230) return false;
  if (sample.opaque(ix, iy)) return true;
  if (sample.giant) return false;
  const b = sample.bounds;
  // Internal transparent holes never count. Expansion only pads outside the tight
  // opaque bounding box to the minimum CSS screen size at the actual display scale.
  if (x >= b.left && x < b.right && y >= b.top && y < b.bottom) return false;
  const w = Math.max(b.right - b.left, 44 * 192 / r.width), h = Math.max(b.bottom - b.top, 44 * 256 / r.height);
  return inside(x, y, { left: (b.left + b.right - w) / 2, top: (b.top + b.bottom - h) / 2, width: w, height: h });
}
