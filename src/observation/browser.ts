import type { SurfaceRegistry } from './surfaces.ts';
import type { CaptureContext, PresentationTicket } from '../runtime/execution.ts';
import type { CaptureInput } from '../capture/execution.ts';
import type { FrozenCapture } from '../capture/scene.ts';
import type { PreparedScene } from '../scene/bundle.ts';
import { sampleScene } from '../scene/composition.ts';
import { browserClickInput } from '../capture/browser.ts';

/** Browser-submitted DOM/frame evidence, not OS compositor or human-attention
 * evidence. Only this host can mint a proof; ordinary callers cannot inject one. */
export class BrowserPresentationHost {
  readonly surfaces: SurfaceRegistry;
  readonly element: HTMLElement;
  readonly monotonic: () => number;
  #displays = new WeakMap<object, { ticket: PresentationTicket; generation: number; scene: Element }>();
  #inputs = new WeakMap<object, { event: MouseEvent; generation: number; scene: Element; mono: number; eventMono: number }>();
  constructor(surfaces: SurfaceRegistry, element: HTMLElement, monotonic: () => number) { this.surfaces = surfaces; this.element = element; this.monotonic = monotonic; }
  #scene() { return this.element.querySelector<HTMLElement>(':scope > .scene'); }
  #sampleTime(now: number): number | null {
    const value = this.#scene()?.dataset.sampledAt;
    if (value === undefined || value.trim() === '') return null;
    const sampled = Number(value);
    return Number.isFinite(sampled) && Number.isFinite(now) && sampled <= now && now - sampled <= 100 ? sampled : null;
  }
  #visible(element: HTMLElement) {
    const doc = this.surfaces.document, win = this.surfaces.window;
    if (!win || !this.surfaces.observable() || !element.isConnected || element.ownerDocument !== doc || !this.surfaces.root.contains(element)) return false;
    const r = element.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.left < 0 || r.top < 0 || r.right > win.innerWidth || r.bottom > win.innerHeight) return false;
    for (let p: HTMLElement | null = element; p; p = p.parentElement) {
      const css = win.getComputedStyle(p), b = p.getBoundingClientRect();
      if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) <= 0) return false;
      if (/auto|scroll|hidden|clip/.test(css.overflowY) && (r.top < b.top || r.bottom > b.bottom)) return false;
      if (/auto|scroll|hidden|clip/.test(css.overflowX) && (r.left < b.left || r.right > b.right)) return false;
    }
    return true;
  }
  projection(bundle: PreparedScene, mono: number): boolean {
    const scene = this.#scene(), win = this.surfaces.window;
    if (!scene || !win || !this.#visible(scene) || scene.dataset.bundle !== String(bundle.requestId) || scene.dataset.map !== bundle.plan.mapId) return false;
    const r = scene.getBoundingClientRect(), scale = r.width / 192;
    if (!Number.isFinite(scale) || scale < .5 || scale > 3 || !Number.isInteger(scale*64) || r.height !== 256 * scale) return false;
    const sampled = this.#sampleTime(mono);
    if (sampled === null || sampled < bundle.plan.input.playback.originMs) return false;
    const expected = sampleScene(bundle.plan, sampled), images = [...scene.querySelectorAll<HTMLImageElement>('.scene-layer')];
    if (images.length !== expected.length) return false;
    return expected.every((layer,i) => {
      const img = images[i], decoded = bundle.images[layer.file.publicPath], b = img.getBoundingClientRect();
      let paintable = true;
      for (let p: HTMLElement | null = img; p && p !== scene; p = p.parentElement) {
        const css = win.getComputedStyle(p);
        if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) <= 0) paintable = false;
      }
      const transform = win.getComputedStyle(img).transform ?? 'none';
      const matchingDirection = layer.flipX ? transform === 'matrix(-1, 0, 0, 1, 0, 0)' : transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
      return matchingDirection && paintable && !!decoded && decoded.image.complete && decoded.image.naturalWidth === layer.file.size?.[0] && img.complete && img.naturalWidth === layer.file.size?.[0]
        && img.dataset.layer === layer.id && img.dataset.cel === String(layer.cel) && img.src === decoded.url
        && b.left === r.left + layer.x * scale && b.top === r.top + layer.y * scale && b.width === layer.width * scale && b.height === layer.height * scale;
    });
  }
  #opacity() { const overlay = this.#scene()?.querySelector<HTMLElement>('.runtime-overlays'); return overlay && this.surfaces.window ? Number(this.surfaces.window.getComputedStyle(overlay).opacity) : 0; }
  watch(ticket: PresentationTicket, confirmed: (evidence: object) => void) {
    const win = this.surfaces.window, generation = this.surfaces.generation;
    if (!win) return () => {};
    let cancelled = false, first = 0, second = 0;
    const check = () => !cancelled && generation === this.surfaces.generation && this.projection(ticket.bundle, this.monotonic()) && this.#opacity() > 0;
    const schedule = () => {
      if (cancelled) return;
      first = win.requestAnimationFrame(() => {
        if (!check()) { schedule(); return; }
        second = win.requestAnimationFrame(() => {
          if (!check()) { schedule(); return; }
          const scene = this.#scene()!, r = scene.getBoundingClientRect();
          const top = this.surfaces.document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
          if (!top || top.closest('.scene') !== scene || top.closest('[data-capture-blocker]')) { schedule(); return; }
          const evidence = Object.freeze({}); this.#displays.set(evidence, { ticket, generation, scene }); confirmed(evidence);
        });
      });
    };
    schedule(); return () => { cancelled = true; win.cancelAnimationFrame(first); win.cancelAnimationFrame(second); };
  }
  confirmDisplay = (ticket: PresentationTicket, evidence: unknown) => {
    if (!evidence || typeof evidence !== 'object') return false;
    const proof = this.#displays.get(evidence); this.#displays.delete(evidence);
    return !!proof && proof.ticket === ticket && proof.generation === this.surfaces.generation && proof.scene === this.#scene()
      && this.projection(ticket.bundle, this.monotonic()) && this.#opacity() > 0;
  };
  input(event: MouseEvent, bundle?: PreparedScene, displayToken?: number): CaptureInput {
    const eventMono = this.monotonic(), mono = this.#sampleTime(eventMono), scene = this.#scene();
    const proof = Object.freeze({});
    if (mono !== null && event.isTrusted && scene && event.currentTarget !== null && !!event.target && scene.contains(event.target as Node)) {
      this.#inputs.set(proof, { event, generation: this.surfaces.generation, scene, mono, eventMono });
    }
    return { ...browserClickInput(event, { element: this.element, bundle, displayToken, overlayOpacity: this.#opacity(), proof }), sampledAtMono: mono ?? NaN };
  }
  confirmInput = (context: CaptureContext, sample: FrozenCapture, input: CaptureInput) => {
    if (!input.proof || typeof input.proof !== 'object') return false;
    const proof = this.#inputs.get(input.proof); this.#inputs.delete(input.proof);
    const now = this.monotonic();
    if (!proof || proof.generation !== this.surfaces.generation || proof.scene !== this.#scene() || !proof.event.isTrusted
      || now < proof.eventMono || now - proof.eventMono > 100 || this.#sampleTime(now) !== proof.mono
      || proof.mono !== context.sampledAtMono || input.sampledAtMono !== context.sampledAtMono || sample.context !== context
      || proof.event.clientX !== input.clientX || proof.event.clientY !== input.clientY || !this.projection(context.bundle, now)
      || input.overlayOpacity !== this.#opacity() || input.bundle !== context.bundle || input.displayToken !== context.displayToken) return false;
    const actual = browserClickInput(proof.event, { element: this.element, bundle: context.bundle, displayToken: context.displayToken, overlayOpacity: this.#opacity(), proof: input.proof });
    return actual.topmostScene && !actual.modal && actual.blockedRects.every(r => input.clientX < r.left || input.clientY < r.top || input.clientX >= r.left+r.width || input.clientY >= r.top+r.height)
      && JSON.stringify(actual.rect) === JSON.stringify(input.rect) && proof.scene.contains(proof.event.target as Node);
  };
}
