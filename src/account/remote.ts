import type { GameRepository, ReadResult, CommitResult } from '../domain/repository.ts';
import type { GameState } from '../domain/state.ts';
import { validState, object } from '../domain/validation.ts';
import type { PhotoStore, PhotoResult } from '../storage/photos.ts';
import { decode } from '../storage/codec.ts';
import type { AccountIdentity } from './auth.ts';
export interface GamePorts { repository: GameRepository; files: PhotoStore; subscribeChanges(changed: () => void): () => void; accountKey?: string; serverNow?():number; registerStop?(stop: () => Promise<void>): () => void }
export type MigrationResult = {status:'applied'|'unchanged'|'conflict'|'invalid';state?:GameState;reason?:string};
const failure = (e: unknown) => ({status:'unavailable' as const,operation:'read' as const,reason:e instanceof Error ? e.message : String(e)});
export function createAccountPorts(options: {apiBaseUrl:string;identity:AccountIdentity;fetcher?:typeof fetch;now?:()=>number}) {
  const fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now, abort = new AbortController();
  const identity = {...options.identity};
  let alive = true, cache: {at:number;result:ReadResult} | null = null, inFlight: Promise<ReadResult> | null = null, revision = 0;
  let serverOffset = 0;
  // Keep the revision high-water mark even while an explicit fresh read clears cache.
  // Only validated successful server responses enter this account-local snapshot.
  let authoritative: Extract<ReadResult, {status:'ok'}> | null = null;
  function remember(result: Extract<ReadResult, {status:'ok'}>) {
    if (!authoritative || result.state.revision >= authoritative.state.revision) authoritative = structuredClone(result);
    return structuredClone(authoritative);
  }
  const listeners = new Set<() => void>();
  let poll: ReturnType<typeof setInterval> | null = null;
  const check = () => { if (!alive || now() >= identity.expiresAt) throw new Error('로그인이 만료되었어요. 다시 로그인해 주세요.'); };
  const invalidate = () => { ++revision; cache = null; inFlight = null; };
  async function request(path: string, body?: unknown): Promise<unknown> {
    check();
    const requestAbort = new AbortController();
    const retire = () => requestAbort.abort();
    abort.signal.addEventListener('abort', retire, {once:true});
    const timeout = setTimeout(() => requestAbort.abort(new Error('서버 응답이 늦어 요청을 멈췄어요. 연결을 확인하고 계속해 주세요.')), 15000);
    try {
      const response = await fetcher(options.apiBaseUrl + path, {method:body === undefined ? 'GET' : 'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:requestAbort.signal,headers:{Authorization:`Bearer ${identity.accessToken}`,...(body === undefined ? {} : {'Content-Type':'application/json'})},...(body === undefined ? {} : {body:JSON.stringify(body)})});
      check();
      if (!response.ok) throw new Error(response.status === 401 ? '로그인이 만료되었어요. 다시 로그인해 주세요.' : '서버 저장을 확인하지 못했어요. 다시 시도해 주세요.');
      const result: unknown = await response.json(); check(); return result;
    } finally { clearTimeout(timeout); abort.signal.removeEventListener('abort', retire); }
  }
  async function freshRead(known?: ReadResult): Promise<ReadResult> {
    try {
      const started = now();
      const baseline = known?.status === 'ok' ? known : null;
      const value = await request('/v1/state' + (baseline ? `?since=${baseline.state.revision}` : ''));
      if (baseline && object(value) && value.status === 'unchanged' && value.revision === baseline.state.revision) {
        if (typeof value.serverTime === 'number' && Number.isFinite(value.serverTime)) serverOffset = value.serverTime - (started + now()) / 2;
        return remember(baseline);
      }
      if (!object(value) || value.status !== 'ok' || !validState(value.state) || value.persistence !== 'account' || !['empty','stored','migrated'].includes(value.origin as string)) throw new Error('서버 기록을 확인하지 못했어요.');
      if (typeof value.serverTime === 'number' && Number.isFinite(value.serverTime)) serverOffset = value.serverTime - (started + now()) / 2;
      return remember(value as unknown as Extract<ReadResult, {status:'ok'}>);
    } catch(e) { return failure(e); }
  }
  const repository: GameRepository = {
    // This explicitly uses a pre-send browser guard + authoritative server CAS,
    // NOT the local repository's callback-under-lock guarantee.
    guardSemantics: 'remote-preflight-cas',
    async read(options) {
      try { check(); } catch(e) {return failure(e);}
      if (options?.fresh) invalidate();
      if (cache && now()-cache.at < 30000) return structuredClone(cache.result);
      if (!inFlight) {
        const stamp = revision;
        const pending = freshRead(cache?.result).then(result => { if (alive && stamp === revision) cache = {at:now(),result}; return result; });
        inFlight = pending;
        void pending.finally(() => {if (inFlight === pending) inFlight = null;});
      }
      return structuredClone(await inFlight);
    },
    async commit(command, options) {
      invalidate();
      let saved: ReadResult | null = null;
      const latest = await freshRead();
      if (latest.status !== 'ok') return latest;
      try {
        check();
        if (options?.expectedRevision !== undefined && latest.state.revision !== options.expectedRevision) return {status:'conflict',actualRevision:latest.state.revision};
        if (options?.guard && !options.guard(structuredClone(latest.state))) return {status:'invalid',reason:'현재 화면에서 저장을 계속할 수 없어요.'};
        const result = await request('/v1/commands',{command,expectedRevision:latest.state.revision});
        if (!object(result) || !['applied','unchanged','conflict','invalid'].includes(result.status as string) || (['applied','unchanged'].includes(result.status as string) && (!validState(result.state) || result.persistence !== 'account')) || (result.status === 'conflict' && !Number.isSafeInteger(result.actualRevision))) throw new Error('서버 저장 결과를 확인하지 못했어요.');
        if ((result.status === 'applied' || result.status === 'unchanged') && validState(result.state)) {
          saved = { ...latest, state: structuredClone(result.state), origin: latest.origin === 'empty' && result.state.revision > 0 ? 'stored' : latest.origin };
        }
        return result as unknown as CommitResult;
      } catch(e) { return failure(e); }
      finally {
        if (alive) {
          // Start order is not commit order: compare authoritative server revisions.
          if (!saved || saved.status !== 'ok') invalidate();
          else if (!authoritative || saved.state.revision >= authoritative.state.revision) {
            invalidate(); cache = { at: now(), result: remember(saved) };
          }
          listeners.forEach(fn=>fn());
        }
      }
    },
  };
  async function photo(path:string, body?:unknown): Promise<PhotoResult> {
    try {
      const value = await request(path,body);
      if (!object(value)) throw new Error('Invalid photo response');
      if (value.status === 'found') {
        const blob = (raw:unknown) => { if(typeof raw !== 'string' || raw.length > 350000) throw new Error('Invalid photo bytes');return new Blob([Uint8Array.from(atob(raw),c=>c.charCodeAt(0))],{type:'image/png'}); };
        return {status:'found',png:blob(value.png),...(value.fullScene ? {fullScene:blob(value.fullScene)} : {}),...(typeof value.attemptId === 'string' ? {attemptId:value.attemptId} : {})};
      }
      if (!['ready','stored','missing','stale','preserved','unavailable'].includes(value.status as string)) throw new Error('Invalid photo result');
      return value as unknown as PhotoResult;
    } catch(e) {return failure(e);}
  }
  async function encode(blob:Blob) {
    if(blob.type !== 'image/png' || !blob.size || blob.size > 262144) throw new Error('Invalid photo size');
    const bytes = new Uint8Array(await blob.arrayBuffer()); let s=''; for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);
  }
  const files: PhotoStore = {
    get:key=>photo('/v1/photos?key='+encodeURIComponent(key)),reserve:reservation=>photo('/v1/photos/reserve',{reservation}),closePending:reservation=>photo('/v1/photos/close',{reservation}),
    async write(reservation,bytes) {try {return await photo('/v1/photos/write',{reservation,png:await encode(bytes.png),fullScene:await encode(bytes.fullScene)});}catch(e){return failure(e);}},
  };
  return {repository,files,accountKey:identity.sub,serverNow:()=>now()+serverOffset,
    isActive:()=>alive&&now()<identity.expiresAt,
    subscribeChanges(changed:()=>void) {
      const listener=()=>changed();listeners.add(listener);
      poll ??= setInterval(()=>{if(alive){if(cache)cache.at=now()-30000;listeners.forEach(fn=>fn());}},30000);
      return()=>{listeners.delete(listener);if(!listeners.size&&poll){clearInterval(poll);poll=null;}};
    },
    async migrate(migrationId:string,raw:string):Promise<MigrationResult> {
      const decoded=decode(raw);if(decoded.status!=='ready'||decoded.state.activeVisit)return {status:'invalid',reason:'이 브라우저에서 진행 중인 방문을 먼저 마쳐 주세요.'};
      try {const result=await request('/v1/migrate',{migrationId,raw});if(!object(result)||!['applied','unchanged','conflict','invalid'].includes(result.status as string)||(result.state!==undefined&&!validState(result.state)))throw new Error('기록 이전 결과를 확인하지 못했어요.');return result as unknown as MigrationResult;}
      finally {invalidate();if(alive)listeners.forEach(fn=>fn());}
    },
    dispose() {alive=false;abort.abort();identity.accessToken='';invalidate();authoritative=null;listeners.clear();if(poll)clearInterval(poll);poll=null;},
    freshRead,
  };
}
export type AccountPorts = ReturnType<typeof createAccountPorts>;
