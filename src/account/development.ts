import type { AccountIdentity } from './auth.ts';
/** Vite DEV-only dynamically imported fixture. No production auth override. The
 * separate loopback server must explicitly enable ACCOUNT_TEST_AUTH=1 as well. */
export function developmentIdentity(subject:string):AccountIdentity{
  if(!import.meta.env.DEV||!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||!/^fixture-[a-z0-9-]{1,60}$/.test(subject))throw new Error('Development fixture only');
  return {sub:subject,accessToken:`test:${subject}`,expiresAt:Date.now()+3600000};
}
