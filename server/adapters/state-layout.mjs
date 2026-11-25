import { boundedState, hash } from '../common.mjs';
export const LAYOUT = 'shards-v1';
/** At most 32 collection items, so conversion + core + receipts fit one transaction. */
export function splitState(state) {
 if(!boundedState(state))throw new Error('Invalid logical state');
 const {items,discovered,...core}=structuredClone(state),parts={};
 for(const [kind,collection] of Object.entries({items,discovered}))for(const [id,value] of Object.entries(collection)){
  const sk=`DATA#${kind}#${hash(id).slice(0,1)}`;
  parts[sk]??={};Object.defineProperty(parts[sk],id,{value,enumerable:true,configurable:true,writable:true});
 }
 return {core,parts,manifest:Object.fromEntries(Object.entries(parts).map(([sk,value])=>[sk,hash(value)]))};
}
export function joinState(root,rows) {
 if(root?.restoring)return {restoring:true};
 if(!root)return null;
 if(root.layout===undefined)return root.state;
 if(root.layout!==LAYOUT||!root.core||!root.manifest||root.core.revision!==root.revision)throw new Error('Unsupported state storage layout');
 const parts=new Map(rows.map(row=>[row.SK,row.value]));const state={...structuredClone(root.core),items:{},discovered:{}};
 for(const [sk,digest] of Object.entries(root.manifest)){
  const match=/^DATA#(items|discovered)#[a-f0-9]$/.exec(sk),part=parts.get(sk);
  if(!match||!part||hash(part)!==digest)throw new Error('Missing or mismatched state shard');
  for(const [id,value] of Object.entries(part)){
   if(`DATA#${match[1]}#${hash(id).slice(0,1)}`!==sk||Object.hasOwn(state[match[1]],id))throw new Error('Invalid state shard placement');
   Object.defineProperty(state[match[1]],id,{value:structuredClone(value),enumerable:true,writable:true,configurable:true});
  }
 }
 if(!boundedState(state))throw new Error('Invalid reconstructed state');return state;
}
