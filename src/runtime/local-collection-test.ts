const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export function isLocalCollectionTest(input: { development: boolean; hostname: string; search: string; apiBaseUrl?: string; accountKey?: string }): boolean {
  if (!input.development || !local(input.hostname) || input.accountKey !== 'fixture-new-yokai') return false;
  const query = new URLSearchParams(input.search);
  if (query.get('collectionTest') !== 'new8' || query.get('accountTestSubject') !== input.accountKey) return false;
  try { const api = new URL(input.apiBaseUrl ?? ''); return api.protocol === 'http:' && local(api.hostname); } catch { return false; }
}
