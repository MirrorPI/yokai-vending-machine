import type { AccountConfig, AccountIdentity } from './auth.ts';
import { beginLogin } from './auth.ts';
import { exchangeAccessCode } from './code-login.ts';
import { createAccountPorts } from './remote.ts';
import type { AccountPorts } from './remote.ts';
import { SAVE_KEY, createBrowserRepository } from '../storage/browser.ts';
import { createPhotoStore } from '../storage/photos.ts';
import type { PhotoStore } from '../storage/photos.ts';
import type { GameState } from '../domain/state.ts';
import { decode } from '../storage/codec.ts';
export interface AccountSnapshot {phase:'guest'|'stopping'|'connecting'|'choose'|'account'|'error';generation:number;ports:AccountPorts|null;message:string|null;busy:boolean;resumable:boolean}
export class AccountSession {
  readonly config: AccountConfig;
  #snapshot:AccountSnapshot={phase:'guest',generation:0,ports:null,message:null,busy:false,resumable:false};
  #listeners=new Set<()=>void>(); #stops=new Set<()=>Promise<void>>(); #generation=0; #ports:AccountPorts|null=null;
  #migration: {migrationId:string;fingerprint:string}|null=null;
  #pendingPhotos(state:GameState){return Object.values(state.discovered).some(r=>Object.values(r.photos).some(p=>p.status==='pending'&&p.attemptId?.startsWith('migration:')));}
  #expiry:ReturnType<typeof setTimeout>|null=null;
  private options:{fetcher?:typeof fetch;readGuest?:()=>string|null;guestFiles?:Pick<PhotoStore,'get'>};
  constructor(config:AccountConfig,options:AccountSession['options']={}){this.config=config;this.options=options;}
  get snapshot(){return this.#snapshot;}
  subscribe=(fn:()=>void)=>{this.#listeners.add(fn);return()=>{this.#listeners.delete(fn);};};
  registerStop=(fn:()=>Promise<void>)=>{this.#stops.add(fn);return()=>{this.#stops.delete(fn);};};
  #publish(patch:Partial<AccountSnapshot>){this.#snapshot={...this.#snapshot,...patch};this.#listeners.forEach(fn=>fn());}
  async #stop(){const stops=[...this.#stops];this.#publish({busy:true});await Promise.all(stops.map(stop=>stop()));}
  async login(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,navigate:(url:string)=>void){
    const generation=++this.#generation;
    try {await this.#stop();if(generation!==this.#generation)return;
      this.#ports?.dispose();this.#ports=null;
      this.#publish({phase:'connecting',ports:null,generation,message:null});
      const raw=this.options.readGuest?.()??localStorage.getItem(SAVE_KEY),decoded=decode(raw);
      if(decoded.status!=='ready'||decoded.state.activeVisit)throw new Error('진행 중인 방문 저장을 먼저 확인해 주세요.');
      const url=await beginLogin(this.config,storage);if(generation===this.#generation)navigate(url);
    }catch(e){if(generation===this.#generation)this.#publish({phase:'guest',generation,busy:false,message:String(e instanceof Error?e.message:e)});}
  }
  async connect(identity:AccountIdentity){
    const generation=++this.#generation;
    await this.#stop();if(generation!==this.#generation)return;
    this.#ports?.dispose();this.#migration=null;if(this.#expiry)clearTimeout(this.#expiry);
    this.#publish({phase:'connecting',generation,ports:null,message:null});
    const ports=createAccountPorts({apiBaseUrl:this.config.apiBaseUrl,identity,fetcher:this.options.fetcher});this.#ports=ports;
    const read=await ports.repository.read();
    if(generation!==this.#generation){ports.dispose();return;}
    if(read.status!=='ok'){ports.dispose();this.#ports=null;this.#publish({phase:'error',busy:false,message:'계정 기록을 확인하지 못했어요. 다시 로그인해 주세요.'});return;}
    const empty=!Object.keys(read.state.items).length&&!Object.keys(read.state.discovered).length&&!read.state.activeVisit&&!read.state.lastSettlement;
    this.#migration=read.migration??null;const resumable=this.#pendingPhotos(read.state);
    this.#publish({phase:empty||resumable?'choose':'account',ports,generation,busy:false,resumable});
    this.#expiry=setTimeout(()=>{if(generation===this.#generation){++this.#generation;ports.dispose();this.#ports=null;this.#migration=null;this.#publish({phase:'error',ports:null,busy:false,generation:this.#generation,resumable:false,message:'로그인이 만료되었어요. 다시 로그인해 주세요.'});}},Math.max(0,Math.min(2147483647,identity.expiresAt-Date.now())));
  }
  async connectCode(code:string){
    if(this.config.authMode!=='invite-code')return;
    const generation=++this.#generation;
    try{
      await this.#stop();if(generation!==this.#generation)return;
      this.#ports?.dispose();this.#ports=null;
      this.#publish({phase:'connecting',generation,ports:null,message:null});
      const identity=await exchangeAccessCode(this.config,code,this.options.fetcher);
      if(generation!==this.#generation)return;
      await this.connect(identity);
      this.continueAccount();
    }catch(e){if(generation===this.#generation)this.#publish({phase:'guest',ports:null,busy:false,message:e instanceof Error?e.message:'코드를 확인하지 못했어요.'});}
  }
  continueAccount(){if(this.#snapshot.phase==='choose'&&!this.#snapshot.busy&&this.#ports?.isActive()&&this.#snapshot.ports===this.#ports)this.#publish({phase:'account'});}
  async openImport(){
    const ports=this.#ports,generation=this.#generation;
    if(this.#snapshot.phase!=='account'||this.#snapshot.ports!==ports||!ports?.isActive()||this.#snapshot.busy)return;
    await this.#stop();
    if(generation!==this.#generation||ports!==this.#ports||!ports.isActive()||this.#snapshot.phase!=='account'||this.#snapshot.ports!==ports)return;
    this.#publish({phase:'choose',generation:this.#snapshot.generation+1,busy:false});
  }
  async importGuest(){
    const ports=this.#ports;if(this.#snapshot.phase!=='choose'||this.#snapshot.ports!==ports||!ports?.isActive()||this.#snapshot.busy)return;
    const generation=this.#generation;this.#publish({busy:true,message:null});
    try {
      const raw=this.options.readGuest?this.options.readGuest():localStorage.getItem(SAVE_KEY);
      if(!raw)throw new Error('이 브라우저에 가져올 기록이 없어요. 처음 가져온 브라우저에서 사진을 이어서 가져와 주세요.');
      const local=decode(raw);if(local.status!=='ready')throw new Error('이 브라우저의 원본 사진 정보를 확인하지 못했어요.');
      let state:GameState;
      if(this.#migration){
        // A durable receipt authorizes only resuming its existing pending slots.
        // Guest counters/revision may have advanced; never re-import that new snapshot.
        const latest=await ports.freshRead();
        if(latest.status!=='ok'||latest.migration?.migrationId!==this.#migration.migrationId)throw new Error('이전 중인 계정 기록을 확인하지 못했어요.');
        state=latest.state;
      }else{
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');
        const result=await ports.migrate('local-'+hash,raw);
        if(generation!==this.#generation)return;
        if(result.status==='conflict')throw new Error('계정에 기록이 있어요. 덮어쓰지 않고 계정 기록을 사용해 주세요.');
        if(result.status==='invalid'||!result.state)throw new Error(result.reason??'이전할 기록을 확인하지 못했어요.');
        state=result.state;
        const latest=await ports.freshRead();
        if(latest.status==='ok')this.#migration=latest.migration??null;
      }
      // Only explicit import reads local photos. Match immutable source metadata
      // before reading pixels, so an unrelated browser's same slot is not uploaded.
      const localFiles=this.options.guestFiles??createPhotoStore({repository:createBrowserRepository()});let missing=0;
      for(const [yokaiId,record] of Object.entries(state.discovered))for(const [season,p] of Object.entries(record.photos)){
        if(generation!==this.#generation)return;
        if(p.status!=='pending'||!p.attemptId?.startsWith('migration:')||!['spring','summer','autumn','winter'].includes(season))continue;
        const source=local.state.discovered[yokaiId]?.photos[season];
        if(!source||source.photoKey!==p.photoKey||source.at!==p.at){missing++;continue;}
        const r={yokaiId,season:season as 'spring'|'summer'|'autumn'|'winter',photoKey:p.photoKey,attemptId:p.attemptId};
        const original=await localFiles.get(p.photoKey);
        if(original.status!=='found'||!original.fullScene){missing++;continue;}
        const reserved=await ports.files.reserve(r);
        if(reserved.status!=='ready'){missing++;continue;}
        const written=await ports.files.write(r,{png:original.png,fullScene:original.fullScene});
        if(written.status!=='stored'){missing++;continue;}
        const marked=await ports.repository.commit({type:'updatePhotoStatus',...r,status:'saved'});
        if(marked.status!=='applied'&&marked.status!=='unchanged')missing++;
      }
      if(generation===this.#generation)this.#publish({phase:'choose',busy:false,resumable:missing>0,message:missing?`기록은 가져왔지만 사진 ${missing}장은 아직 이전 중이에요. 원본은 이 브라우저에 남아 있어요. 설정이나 다음 로그인에서 이어서 가져올 수 있어요.`:'기록과 준비된 사진을 가져왔어요. 이 브라우저의 원본도 그대로 남아 있어요.'});
    }catch(e){if(generation===this.#generation)this.#publish({busy:false,message:e instanceof Error?e.message:String(e)});}
  }
  async logout(){
    const generation=++this.#generation;if(this.#expiry)clearTimeout(this.#expiry);this.#expiry=null;
    // Revoke remote ingress immediately. In-flight server commands may already have committed;
    // their replies cannot enter the next account or the guest store.
    this.#ports?.dispose();this.#ports=null;
    this.#publish({phase:'stopping',ports:null,busy:true});
    await this.#stop();if(generation!==this.#generation)return;
    this.#migration=null;this.#publish({phase:'guest',ports:null,generation,busy:false,message:null,resumable:false});
  }
  dispose(){++this.#generation;this.#ports?.dispose();this.#migration=null;if(this.#expiry)clearTimeout(this.#expiry);this.#stops.clear();this.#listeners.clear();}
}
