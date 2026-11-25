import type { ObservationSession } from './session.ts';
import type { LiveTransfer } from './transfer.ts';
export interface ObservationChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}
/** Focus requests are coordination, never a lock. No force-steal: the current
 * observer drains storage/photos, offers a stable checkpoint and releases. */
export class ObservationCoordinator {
  readonly session: ObservationSession;
  private channel: ObservationChannel | null;
  private ports: { offer(): Promise<LiveTransfer | 'idle' | null>; accept(transfer: LiveTransfer | null): Promise<void>; retire(): void };
  #request: { from: string; token: string } | null = null;
  #token = '';
  #operations = 0;
  #awaitingOffer = false;
  #processingOffer = false;
  #offerTimer: ReturnType<typeof setTimeout> | null = null;
  #consumed = '';
  #yielding = false;
  #disposed = false;
  constructor(session: ObservationSession, channel: ObservationChannel | null, ports: ObservationCoordinator['ports']) {
    this.session = session; this.channel = channel; this.ports = ports; channel?.addEventListener('message', this.#message);
  }
  get busy() { return this.#operations > 0 || this.#awaitingOffer || this.#processingOffer || this.#yielding; }
  async request() {
    if (this.#disposed || !this.session.ports.observable() || this.session.authority().authorized || this.busy) return;
    this.#token = crypto.randomUUID();
    this.channel?.postMessage({ type: 'request', from: this.session.ports.sessionId, token: this.#token });
    // On startup/crash there may be no cooperative peer. Real lock still decides.
    await this.acquire();
  }
  async acquire() {
    if (this.#disposed || this.busy || !this.session.ports.observable() || this.session.authority().authorized) return;
    this.#operations++;
    try { await this.session.acquire(); if (this.session.authority().authorized && !this.#disposed && !this.#awaitingOffer && !this.#processingOffer) await this.ports.accept(null); }
    finally { this.#operations--; }
  }
  async pulse() {
    if (this.#request && !this.#yielding && this.session.authority().authorized) await this.#yield();
    else if (!this.busy && !this.session.authority().authorized) await this.acquire();
  }
  #message = (event: MessageEvent) => {
    const m = event.data;
    if (this.#disposed || !m || m.from === this.session.ports.sessionId) return;
    if (m.type === 'request' && typeof m.from === 'string' && typeof m.token === 'string' && this.session.authority().authorized) {
      this.#request = { from: m.from, token: m.token }; void this.#yield();
    }
    if (m.to !== this.session.ports.sessionId || m.token !== this.#token) return;
    if (m.type === 'offering' && !this.session.authority().authorized) {
      this.#awaitingOffer = true;
      if (this.#offerTimer) clearTimeout(this.#offerTimer);
      this.#offerTimer = setTimeout(() => {
        this.#offerTimer = null; this.#awaitingOffer = false;
        // A message timeout only ends negotiation. Actual acquisition still
        // requires the real Web Lock; no lease or time-based ownership.
        if (!this.#disposed) void this.acquire();
      }, 1500);
    }
    if (m.type === 'offer' && this.#consumed !== m.token && !this.#processingOffer) {
      this.#consumed = m.token; this.#awaitingOffer = false; this.#processingOffer = true;
      if (this.#offerTimer) clearTimeout(this.#offerTimer); this.#offerTimer = null;
      void (async () => {
        try {
          // Wait for actual lock release, without stealing or assuming a timeout.
          for (let i=0; i<20 && !this.#disposed && this.session.ports.observable() && !this.session.authority().authorized; i++) {
            await this.session.acquire();
            if (!this.session.authority().authorized) await new Promise(r => setTimeout(r, 25));
          }
          if (!this.#disposed && this.session.authority().authorized) await this.ports.accept(m.transfer === 'idle' ? null : m.transfer);
        } finally { this.#processingOffer = false; }
      })();
    }
  };
  async #yield() {
    if (this.#yielding || !this.#request || this.#disposed) return;
    this.#yielding = true;
    const target = this.#request;
    try {
      const transfer = await this.ports.offer();
      if (transfer === null || this.#disposed) return; // uncertain work stays here
      this.channel?.postMessage({ type: 'offering', from: this.session.ports.sessionId, to: target.from, token: target.token });
      this.ports.retire();
      await this.session.release();
      this.channel?.postMessage({ type: 'offer', from: this.session.ports.sessionId, to: target.from, token: target.token, transfer });
      this.#request = null;
    } finally { this.#yielding = false; }
  }
  dispose() { this.#disposed = true; if (this.#offerTimer) clearTimeout(this.#offerTimer); this.channel?.removeEventListener('message', this.#message); this.channel?.close(); }
}
