import { SAVE_KEY } from './driver.ts';

/** Read refresh only; never claims observation or installs a writer. The storage
 * event covers other documents. Visible polling covers existing same-document
 * A05/A06 writers without modifying their commit or locking contracts. */
export function subscribeGameChanges(changed: () => void, host: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'>;
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
} = { window, document }): () => void {
  const visible = () => { if (host.document.visibilityState === 'visible') changed(); };
  const storage = (event: Event) => { const key = (event as StorageEvent).key; if (key === SAVE_KEY || key === null) visible(); };
  host.window.addEventListener('storage', storage);
  host.window.addEventListener('focus', visible);
  host.document.addEventListener('visibilitychange', visible);
  const timer = host.window.setInterval(visible, 2000);
  return () => {
    host.window.removeEventListener('storage', storage); host.window.removeEventListener('focus', visible);
    host.document.removeEventListener('visibilitychange', visible); host.window.clearInterval(timer);
  };
}
