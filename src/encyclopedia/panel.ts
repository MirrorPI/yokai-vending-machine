/** A07 modal lifetime only. No global panel manager or observation policy. */
export function installPanelBehavior({ dialog, onClose, navigation }: {
  dialog: HTMLElement; onClose(): void; navigation?: HTMLElement | null;
}): () => void {
  const doc = dialog.ownerDocument;
  const previous = doc.activeElement as HTMLElement | null;
  const selector = 'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]';
  const contains = (element: Element | null) => dialog.contains(element) || !!navigation?.contains(element);
  const controls = () => [...dialog.querySelectorAll<HTMLElement>(selector), ...(navigation ? navigation.querySelectorAll<HTMLElement>(selector) : [])]
    .filter(e => e.getClientRects().length > 0);
  const focusFirst = () => (controls()[0] ?? dialog).focus();
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const elements = controls(), first = elements[0], last = elements.at(-1);
    if (!first || !contains(doc.activeElement) || doc.activeElement === dialog
      || (event.shiftKey ? doc.activeElement === first : doc.activeElement === last)) {
      event.preventDefault(); (event.shiftKey ? last ?? dialog : first ?? dialog).focus();
    }
  };
  const focusin = () => { if (!contains(doc.activeElement)) focusFirst(); };
  doc.addEventListener('keydown', keydown, true); doc.addEventListener('focusin', focusin);
  focusFirst();
  return () => {
    doc.removeEventListener('keydown', keydown, true); doc.removeEventListener('focusin', focusin);
    if (previous?.isConnected) previous.focus();
  };
}
