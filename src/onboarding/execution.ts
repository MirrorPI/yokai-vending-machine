import type { SettingsController } from '../settings/controller.ts';
import type { OnboardingController } from './controller.ts';
import type { SettlementReceipt } from '../runtime/execution.ts';
/** A10 host port. Read failures await explicit settings retry; a receipt is consumed
 * only after successful reconciliation, and can outlive the finished visit. */
export class OnboardingExecutionBridge {
  private readonly guide: OnboardingController; private readonly settings: SettingsController;
  #busy = false; #disposed = false; #visit: string | null = null; #receipt: string | null = null; #live: string | null = null;
  constructor(guide: OnboardingController, settings: SettingsController) { this.guide = guide; this.settings = settings; }
  async synchronize(visit: { visitId: string } | null, approved: boolean, receipt: SettlementReceipt | null) {
    this.#live = approved ? visit?.visitId ?? null : null;
    if (!this.#live && this.settings.snapshot.state) this.guide.observe(null, this.settings.snapshot.state);
    const needVisit = this.#live !== null && this.#live !== this.#visit;
    const needReceipt = receipt !== null && receipt.visitId !== this.#receipt;
    if (this.#disposed || this.#busy || this.settings.snapshot.phase === 'error' || (!needVisit && !needReceipt)) return;
    this.#busy = true;
    const live = this.#live;
    try {
      const result = await this.settings.refresh();
      if (this.#disposed || result.status !== 'ok') return;
      if (needVisit && live === this.#live) { this.guide.observe(visit, result.state); this.#visit = live; }
      if (needReceipt) { this.guide.receipt(receipt!, result.state); this.#receipt = receipt!.visitId; }
    } finally { this.#busy = false; }
  }
  dispose() { this.#disposed = true; }
}
