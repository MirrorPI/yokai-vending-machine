import type { AssetFile } from '../data/catalog.ts';
import { sceneFiles } from './composition.ts';
import type { ScenePlan } from './types.ts';

export interface DecodedImage {
  readonly file: AssetFile;
  readonly url: string;
  readonly image: HTMLImageElement;
  /** Optional exact source RGBA, prepared by the capture-aware browser loader. */
  readonly raster?: { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray };
}
export type ImageLoader = (file: AssetFile) => Promise<DecodedImage>;
export interface PreparedScene {
  readonly plan: ScenePlan;
  readonly images: Readonly<Record<string, DecodedImage>>;
  readonly requestId: number;
}
export interface BundleState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly current: PreparedScene | null;
  readonly error: string | null;
  readonly requestId: number;
}
export type BundleResult = { status: 'committed'; bundle: PreparedScene } | { status: 'failed' | 'superseded' };

/** Browser I/O only; caller supplies BASE_URL-aware URLs. No storage APIs. */
export function createBrowserImageLoader(urlFor: (file: AssetFile) => string,
  createImage: () => HTMLImageElement = () => new Image()): ImageLoader {
  return async file => {
    const image = createImage();
    const url = urlFor(file);
    image.decoding = 'async';
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Image load failed: ${file.publicPath}`));
        image.src = url;
      });
      await image.decode();
      if (!file.size || image.naturalWidth !== file.size[0] || image.naturalHeight !== file.size[1]) {
        throw new Error(`Image dimensions differ: ${file.publicPath}`);
      }
      return Object.freeze({ file, url, image });
    } finally {
      image.onload = null;
      image.onerror = null;
    }
  };
}

/** Resource transaction only. Ready does not mean painted, visited, captured or saved. */
export class SceneBundleController {
  #version = 0;
  #state: BundleState = Object.freeze({ status: 'idle', current: null, error: null, requestId: 0 });
  #listeners = new Set<() => void>();
  private readonly loadImage: ImageLoader;
  constructor(loadImage: ImageLoader) { this.loadImage = loadImage; }
  get state(): BundleState { return this.#state; }
  getSnapshot = (): BundleState => this.#state;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };
  #publish(state: BundleState) {
    this.#state = Object.freeze(state);
    this.#listeners.forEach(listener => listener());
  }
  async request(plan: ScenePlan): Promise<BundleResult> {
    const requestId = ++this.#version;
    this.#publish({ status: 'loading', current: this.#state.current, error: null, requestId });
    try {
      const decoded = await Promise.all(sceneFiles(plan).map(file => this.loadImage(file)));
      if (requestId !== this.#version) return { status: 'superseded' };
      const bundle: PreparedScene = Object.freeze({ plan, requestId,
        images: Object.freeze(Object.fromEntries(decoded.map(image => [image.file.publicPath, image]))),
      });
      this.#publish({ status: 'ready', current: bundle, error: null, requestId });
      return { status: 'committed', bundle };
    } catch (error) {
      if (requestId !== this.#version) return { status: 'superseded' };
      this.#publish({ status: 'failed', current: this.#state.current,
        error: error instanceof Error ? error.message : String(error), requestId });
      return { status: 'failed' };
    }
  }
  /** Owner cleanup also invalidates stale success/failure from an earlier mount. */
  cancel(): void {
    const requestId = ++this.#version;
    this.#publish({ status: this.#state.current ? 'ready' : 'idle', current: this.#state.current, error: null, requestId });
  }
}
