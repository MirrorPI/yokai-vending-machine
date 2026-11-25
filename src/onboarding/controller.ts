import type { ReadResult } from '../domain/repository.ts';
import type { GameState } from '../domain/state.ts';
import type { SettlementReceipt } from '../runtime/execution.ts';
export class OnboardingController {
  #hintEligible = false; #hintVisit: string | null = null;
  #initialized = false; #enabled = false; #done = false; #known = new Set<string>(); #pip = false; #pipUsed = false;
  #snapshot = { hint: false, pip: false };
  #listeners = new Set<() => void>();
  private readonly complete: () => void;
  constructor(complete: () => void) { this.complete = complete; }
  get snapshot() { return this.#snapshot; }
  subscribe = (fn: () => void) => { this.#listeners.add(fn); return () => { this.#listeners.delete(fn); }; };
  #publish(hint: boolean) { this.#snapshot = { hint, pip: this.#done && this.#pip && !this.#pipUsed }; this.#listeners.forEach(fn => fn()); }
  initialize(read: ReadResult) {
    if (this.#initialized || read.status !== 'ok') return false;
    this.#initialized = true;
    const s = read.state;
    this.#enabled = !s.firstRunDone && Object.keys(s.discovered).length === 0;
    this.#hintEligible = this.#enabled && read.origin === 'empty' && !s.activeVisit && !s.lastSettlement && !s.observationOwner
      && !Object.values(s.items).some(i => i.totalCount > 0);
    return this.#hintEligible;
  }
  /** Host calls only after the A05 start has been persisted and actually displayed. */
  observe(live: { visitId: string } | null, state: GameState) {
    const valid = this.#enabled && !this.#done && !!live && state.activeVisit?.visitId === live.visitId
      && state.activeVisit.state === 'VISITING' && !state.activeVisit.itemGranted;
    if (valid) { this.#known.add(live!.visitId); if (this.#hintEligible && !this.#hintVisit) this.#hintVisit = live!.visitId; }
    if (!valid && this.#hintVisit) this.#hintEligible = false;
    const hint = valid && this.#hintEligible && this.#hintVisit === live!.visitId;
    if (this.#snapshot.hint !== hint) this.#publish(hint);
  }
  /** Receipt comes from VisitExecution, never click/animation/PNG completion. */
  receipt(receipt: Pick<SettlementReceipt, 'visitId' | 'source'> & Partial<Pick<SettlementReceipt, 'yokaiId'>>, state?: GameState) {
    const v = state?.activeVisit;
    const yokaiId = receipt.yokaiId ?? (v?.visitId === receipt.visitId ? v.yokaiId : null);
    const persisted = state?.lastSettlement?.visitId === receipt.visitId && state.lastSettlement.source === 'manual'
      && !!yokaiId && (state.discovered[yokaiId]?.captureCount ?? 0) > 0;
    if (!this.#enabled || this.#done || receipt.source !== 'manual' || (!this.#known.has(receipt.visitId) && !persisted)) return;
    this.#done = true; this.#publish(false); this.complete();
  }
  acknowledgePip() { this.#pipUsed = true; this.#publish(this.#snapshot.hint); }
  /** A10 enables this only when its actual small-window feature is available. */
  setPipAvailable(available: boolean) { this.#pip = available; this.#publish(this.#snapshot.hint); }
}
