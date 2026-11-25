/** One root may move between actual rendering documents. The opener is NOT an
 * extra surface while its game root lives in PiP. Rebinding is synchronous. */
export class SurfaceRegistry {
  readonly root: HTMLElement;
  #doc: Document;
  #frozen = false;
  #suppressed = false;
  #retired = false;
  #disposed = false;
  #moving = false;
  #movePromise: Promise<void> = Promise.resolve();
  #moveResolve = () => {};
  #cancelMoveFrames = () => {};
  #generation = 0;
  #cleanup = () => {};
  #listeners = new Set<() => void>();
  constructor(root: HTMLElement) { this.root = root; this.#doc = root.ownerDocument; this.rebind(); }
  get moving() { return this.#moving; }
  waitForMove = () => this.#movePromise;
  beginMove() {
    this.#cancelMoveFrames();
    if (!this.#moving) this.#movePromise = new Promise<void>(resolve => this.#moveResolve = resolve);
    this.#moving = true; ++this.#generation; this.#publish();
  }
  settleMove() {
    this.#cancelMoveFrames();
    const win = this.window; let first = 0, second = 0, done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      win?.cancelAnimationFrame(first); win?.cancelAnimationFrame(second);
      this.#moving = false; ++this.#generation; this.#moveResolve(); this.#publish();
    };
    // Visibility updates around pagehide/adoption can follow the DOM operation.
    // Do not assert visible during this grace; display/input remain unavailable.
    const timer = setTimeout(finish, 100);
    if (win && !win.closed) first = win.requestAnimationFrame(() => { second = win.requestAnimationFrame(finish); });
    this.#cancelMoveFrames = () => { done = true; clearTimeout(timer); win?.cancelAnimationFrame(first); win?.cancelAnimationFrame(second); };
  }
  get document() { return this.#doc; }
  get window() { return this.#doc.defaultView; }
  get generation() { return this.#generation; }
  subscribe = (fn: () => void) => { this.#listeners.add(fn); return () => { this.#listeners.delete(fn); }; };
  setSuppressed(value: boolean) { if (value === this.#suppressed) return; this.#suppressed = value; ++this.#generation; this.#publish(); }
  observable = () => !this.#suppressed && !this.#disposed && !this.#moving && !this.#retired && !this.#frozen && this.root.isConnected && this.root.ownerDocument === this.#doc
    && !!this.window && !this.window.closed && this.#doc.visibilityState === 'visible';
  #publish() { this.#listeners.forEach(fn => fn()); }
  rebind() {
    this.#cleanup(); this.#doc = this.root.ownerDocument; this.#frozen = false; this.#retired = false; ++this.#generation;
    const doc = this.#doc, win = doc.defaultView;
    const change = () => { ++this.#generation; this.#publish(); };
    const freeze = () => { this.#frozen = true; change(); };
    const resume = () => { this.#frozen = false; change(); };
    const hide = () => { this.#retired = true; change(); };
    const show = () => { this.#retired = false; resume(); };
    doc.addEventListener('visibilitychange', change); doc.addEventListener('freeze', freeze); doc.addEventListener('resume', resume);
    win?.addEventListener('pagehide', hide); win?.addEventListener('pageshow', show);
    this.#cleanup = () => { doc.removeEventListener('visibilitychange', change); doc.removeEventListener('freeze', freeze); doc.removeEventListener('resume', resume);
      win?.removeEventListener('pagehide', hide); win?.removeEventListener('pageshow', show); };
    this.#publish();
  }
  dispose() { this.#cleanup(); this.#cancelMoveFrames(); this.#moving = false; this.#moveResolve(); this.#disposed = true; ++this.#generation; this.#publish(); this.#listeners.clear(); }
}
