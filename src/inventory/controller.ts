import type { RarityFilter } from '../encyclopedia/model.ts';
import type { Command, GameRepository } from '../domain/repository.ts';
import { buildInventory, filterInventory } from './model.ts';
import type { Inventory, InventoryCatalog, InventoryFilter } from './model.ts';
export interface DisplayTicket { readonly generation: number; readonly itemId: string; readonly manualCount: number; readonly leftCount: number }
type ViewedCommand = Extract<Command, { type: 'markItemViewed' }>;
export interface InventorySnapshot {
  open: boolean; phase: 'idle' | 'loading' | 'ready' | 'error'; error: string | null;
  rarity?: RarityFilter;
  /** Frozen while browsing details so read acknowledgements cannot reorder neighbours. */
  detailOrder?: readonly string[];
  model: Inventory | null; filter: InventoryFilter; selectedId: string | null;
  ticket: DisplayTicket | null;
  ack: { state: 'idle' | 'saving' | 'saved' | 'error'; error?: string };
}
export interface InventoryPorts {
  catalog: InventoryCatalog; repository: Pick<GameRepository, 'read' | 'commit'>;
  now?(): string; subscribeChanges?(changed: () => void): () => void;
}
interface Acknowledgement { ticket: DisplayTicket; command: Readonly<ViewedCommand>; pending: boolean }
/** No photos/ownership/grants capability. UI presentation is a separate, cancellable
 * step from reading/selecting. Commit results never replace the latest query model. */
export class InventoryController {
  private value: InventorySnapshot = { open:false,phase:'idle',error:null,model:null,filter:'all',selectedId:null,ticket:null,ack:{state:'idle'} };
  private ports: InventoryPorts;
  private listeners = new Set<() => void>();
  private readGeneration = 0;
  private generation = 0;
  private observing = false;
  private unsubscribe: (()=>void) | null = null;
  private job: Acknowledgement | null = null;
  constructor(ports: InventoryPorts) { this.ports=ports; }
  get snapshot() { return this.value; }
  subscribe = (f:()=>void) => { this.listeners.add(f); return ()=>{this.listeners.delete(f);}; };
  private publish(patch:Partial<InventorySnapshot>) { this.value={...this.value,...patch};this.listeners.forEach(f=>f()); }
  private listen() { this.unsubscribe ??= this.ports.subscribeChanges?.(()=>{return this.refresh();}) ?? null; }
  async start() { if(this.observing)return;this.observing=true;this.listen();await this.refresh(); }
  stop() { this.observing=false;this.close(); }
  async open(itemId: string | null = null) {
    if(this.value.open){this.select(itemId);return;}
    this.publish({open:true,filter:'all'});this.select(itemId);this.listen();await this.refresh();
  }
  close() {
    this.readGeneration++;this.generation++;this.job=null;
    if(!this.observing){this.unsubscribe?.();this.unsubscribe=null;}
    this.publish({open:false,selectedId:null,detailOrder:undefined,ticket:null,ack:{state:'idle'},
      ...(!this.observing?{model:null,phase:'idle' as const,error:null}:{})});
  }
  async refresh() {
    if(!this.value.open&&!this.observing)return;
    const generation=++this.readGeneration;
    if(!this.value.model)this.publish({phase:'loading'});
    let result;
    try{result=await this.ports.repository.read();}catch{result={status:'unavailable' as const};}
    if(generation!==this.readGeneration||(!this.value.open&&!this.observing))return;
    if(result.status!=='ok') { this.publish({phase:'error',error:result.status,model:null,ticket:null});return; }
    const model=buildInventory(this.ports.catalog,result.state);
    this.value={...this.value,model,phase:'ready',error:null};
    this.updateTicket();this.publish({});
  }
  setRarity(rarity:RarityFilter) { this.select(null); this.publish({rarity}); }
  setFilter(filter:InventoryFilter) { if(filter===this.value.filter)return;this.select(null);this.publish({filter}); }
  select(id:string|null) {
    this.generation++;this.job=null;
    this.value={...this.value,selectedId:id,
      detailOrder:id && this.value.selectedId && this.value.detailOrder?.includes(id) ? this.value.detailOrder : undefined,
      ticket:null,ack:{state:'idle'}};
    this.updateTicket();this.publish({});
  }
  private updateTicket() {
    if(!this.value.open||this.job)return;
    const entry=this.value.model?.entries.find(e=>e.id===this.value.selectedId);
    if(entry?.status!=='acquired'){this.value={...this.value,ticket:null};return;}
    if (!this.value.detailOrder) {
      const ids=filterInventory(this.value.model!,this.value.filter,this.value.rarity)
        .filter(e=>e.status==='acquired').map(e=>e.id);
      // A direct encyclopedia link can open an item outside the active filter.
      this.value={...this.value,detailOrder:ids.includes(entry.id)?ids:[entry.id]};
    }
    const old=this.value.ticket;
    if(old?.itemId===entry.id&&old.manualCount===entry.manualCount&&old.leftCount===entry.leftCount)return;
    const ticket=Object.freeze({generation:++this.generation,itemId:entry.id,manualCount:entry.manualCount,leftCount:entry.leftCount});
    this.value={...this.value,ticket};
  }
  async presented(ticket:DisplayTicket|null) {
    if(!ticket||!this.value.open||this.value.phase!=='ready'||ticket!==this.value.ticket||this.job)return;
    const job:Acknowledgement={ticket,command:Object.freeze({type:'markItemViewed',itemId:ticket.itemId,
      viewedAt:this.ports.now?.()??new Date().toISOString(),manualCount:ticket.manualCount,leftCount:ticket.leftCount}),pending:false};
    this.job=job;await this.execute(job);
  }
  async retryViewed() { const job=this.job;if(!job||job.pending||this.value.ack.state!=='error')return;await this.execute(job); }
  private async execute(job:Acknowledgement) {
    job.pending=true;this.publish({ack:{state:'saving'}});
    let result;
    try{result=await this.ports.repository.commit(job.command);}catch{result={status:'unavailable' as const};}
    job.pending=false;
    // Sent commands may finish after closing. They still merge their original scope
    // in the repository, but cannot update another detail's acknowledgement state.
    if(this.job===job&&this.value.open)this.publish({ack:result.status==='applied'||result.status==='unchanged'
      ?{state:'saved'}:{state:'error',error:result.status}});
    if(this.value.open||this.observing)await this.refresh();
  }
}
