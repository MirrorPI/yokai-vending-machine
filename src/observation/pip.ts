import type { SurfaceRegistry } from './surfaces.ts';
export interface DocumentPip { requestWindow(options: { width: number; height: number }): Promise<Window> }
export type PipWindow = Window & { documentPictureInPicture?: DocumentPip };
export class PipController {
  readonly surfaces: SurfaceRegistry;
  readonly opener: PipWindow;
  #pip: Window | null = null;
  #lastSize: { width: number; height: number } | null = null;
  #titleBeforeFold: string | null = null;
  folded = false;
  #opening: Promise<void> | null = null;
  #disposed = false;
  #serial = 0;
  #home: Node;
  #next: Node | null;
  #placeholder: HTMLElement | null = null;
  #listeners = new Set<() => void>();
  status: 'home' | 'opening' | 'pip' | 'failed' = 'home';
  error = '';
  constructor(surfaces: SurfaceRegistry) { this.surfaces = surfaces; this.opener = surfaces.window!;
    this.#home = surfaces.root.parentNode!; this.#next = surfaces.root.nextSibling; }
  get available() { return !this.#disposed && this.opener.isSecureContext && typeof this.opener.documentPictureInPicture?.requestWindow === 'function' && this.opener.top === this.opener; }
  subscribe = (fn: () => void) => { this.#listeners.add(fn); return () => { this.#listeners.delete(fn); }; };
  #publish() { this.#listeners.forEach(fn => fn()); }
  open(): Promise<void> {
    if (this.#opening) return this.#opening;
    if (!this.available || this.#pip) return Promise.resolve();
    const serial = ++this.#serial;
    this.status = 'opening'; this.error = ''; this.#publish();
    // requestWindow is invoked before the first await, in the actual user gesture.
    const work = async () => {
      let pip: Window | null = null;
      try {
        pip = await this.opener.documentPictureInPicture!.requestWindow({ width: 288, height: 488 });
        if (this.#disposed || serial !== this.#serial || pip.closed) { pip.close(); throw new Error('작은 창이 열리는 중 닫혔어요.'); }
        const doc = pip.document;
        doc.title = '요괴 자판기 · 작은 창'; doc.documentElement.lang = 'ko';
        const base = doc.createElement('base'); base.href = this.opener.document.baseURI; doc.head.append(base);
        for (const sheet of this.opener.document.styleSheets) {
          try { const style = doc.createElement('style'); style.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n'); doc.head.append(style); }
          catch { if (sheet.href) { const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; doc.head.append(link); await new Promise<void>((resolve,reject) => { link.onload = () => resolve(); link.onerror = () => reject(new Error('작은 창 스타일 로드 실패')); }); } }
        }
        if (this.#disposed || pip.closed || serial !== this.#serial) { pip.close(); throw new Error('작은 창이 닫혔어요.'); }
        this.#pip = pip;
        // Register return BEFORE adoption; pagehide returns the very same root.
        pip.addEventListener('pagehide', () => { if (this.#pip === pip) this.#return(); }, { once: true });
        const previous = this.surfaces.document.activeElement as HTMLElement | null;
        this.surfaces.beginMove(); doc.body.append(this.surfaces.root); this.surfaces.rebind(); this.surfaces.settleMove();
        this.#placeholder = this.opener.document.createElement('div'); this.#placeholder.className = 'pip-placeholder';
        const text = this.opener.document.createElement('p'); text.textContent = '작은 창에서 같은 게임을 관찰 중이에요. 이 탭을 닫으면 작은 창도 닫혀요.';
        const back = this.opener.document.createElement('button'); back.textContent = '이 탭으로 돌아오기'; back.onclick = () => this.close();
        this.#placeholder.append(text, back); this.#home.appendChild(this.#placeholder);
        this.status = 'pip'; this.#publish();
        if (previous?.isConnected && previous.ownerDocument === doc) previous.focus();
        else doc.querySelector<HTMLElement>('.pip-toggle')?.focus();
      } catch (e) {
        if (pip && this.#pip === pip) this.#return();
        if (!this.#disposed) { this.status = 'failed'; this.error = e instanceof Error ? e.message : String(e); this.#publish(); }
      } finally { this.#opening = null; }
    };
    this.#opening = work().finally(() => { this.#opening = null; }); return this.#opening;
  }
  /** Resize only in a user gesture. The browser may clamp the requested size. */
  fold() {
    const pip = this.#pip;
    if (!pip || this.folded) return;
    this.#lastSize = { width: pip.outerWidth, height: pip.outerHeight };
    this.folded = true;
    this.#titleBeforeFold = this.opener.document.title;
    this.opener.document.title = '작업 도구';
    this.surfaces.setSuppressed(true);
    this.#publish();
    // Request the smallest possible window; the browser enforces its own minimum.
    try { pip.resizeTo(1, 1); } catch { /* Browser may disallow resizing; keep restore visible. */ }
  }
  unfold() {
    const pip = this.#pip;
    if (!pip || !this.folded) return;
    const size = this.#lastSize;
    if (size) { try { pip.resizeTo(size.width, size.height); } catch { /* User can resize manually. */ } }
    this.folded = false; this.#lastSize = null;
    this.#restoreTitle();
    this.surfaces.setSuppressed(false);
    this.#publish();
  }
  #restoreTitle() {
    if (this.#titleBeforeFold === null) return;
    this.opener.document.title = this.#titleBeforeFold;
    this.#titleBeforeFold = null;
  }
  #return() {
    this.#restoreTitle();
    const root = this.surfaces.root;
    this.#pip = null; this.folded = false; this.#lastSize = null; this.#placeholder?.remove(); this.#placeholder = null;
    const focus = root.ownerDocument.activeElement as HTMLElement | null;
    this.surfaces.beginMove(); this.surfaces.setSuppressed(false);
    this.#home.insertBefore(root, this.#next?.parentNode === this.#home ? this.#next : null);
    this.surfaces.rebind(); this.surfaces.settleMove(); this.status = 'home'; this.#publish();
    if (focus?.isConnected && root.contains(focus)) focus.focus(); else root.querySelector<HTMLElement>('.pip-toggle')?.focus();
  }
  close() { ++this.#serial; const pip = this.#pip; if (pip) { this.#return(); pip.close(); } }
  dispose() { this.#disposed = true; this.close(); this.#listeners.clear(); }
}
