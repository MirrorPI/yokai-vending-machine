import { useSurface } from '../observation/context.tsx';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { assetUrl } from '../data/catalog.ts';
import { installPanelBehavior } from '../encyclopedia/panel.ts';
import type { InventoryController } from './controller.ts';
import { InventoryView } from './InventoryView.tsx';
import { watchItemPresentation } from './presentation.ts';
export function InventoryPanel({controller,onClose,onOpenOwner,initialItemId=null,embedded=false}:{controller:InventoryController;onClose():void;onOpenOwner?(itemId:string):void;initialItemId?:string|null;embedded?:boolean}){
  const { host, generation } = useSurface();
  const snapshot=useSyncExternalStore(controller.subscribe,()=>controller.snapshot);
  const dialog=useRef<HTMLElement>(null),scope=useRef<HTMLDivElement>(null),close=useRef(onClose);
  const scroll = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const previousEntry = useRef<string | null>(null);
  close.current=onClose;
  useEffect(()=>{
    void controller.open(initialItemId);
    return()=>{controller.close();};
  },[controller,initialItemId]);
  useEffect(()=>{if(!embedded)return installPanelBehavior({dialog:dialog.current!,navigation:dialog.current!.ownerDocument.querySelector('.collection-footer-nav'),onClose:()=>close.current()});},[generation,embedded]);
  useLayoutEffect(() => {
    const el = scroll.current, id = snapshot.selectedId;
    if (!el || snapshot.phase !== 'ready') return;
    if (id) {
      el.scrollTop = 0;
      el.querySelector<HTMLElement>('[data-detail-heading]')?.focus({ preventScroll: true });
    } else if (previousEntry.current) {
      el.scrollTop = listPosition.current;
      const card = [...el.querySelectorAll<HTMLButtonElement>('[data-item-entry]')].find(node =>
        node.dataset.itemEntry === previousEntry.current &&
        node.getBoundingClientRect().bottom > el.getBoundingClientRect().top &&
        node.getBoundingClientRect().top < el.getBoundingClientRect().bottom);
      (card ?? el.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
    }
    previousEntry.current = id;
  }, [snapshot.selectedId, snapshot.phase]);
  useEffect(()=>{
    const ticket=snapshot.ticket,element=scope.current;
    if(!ticket||!element||snapshot.phase!=='ready')return;
    return watchItemPresentation(element,()=>{if(!host||host.surfaces.generation===generation)void controller.presented(ticket);});
  },[controller,snapshot.ticket,snapshot.phase,generation]);
  const view=<InventoryView snapshot={snapshot} dialogRef={dialog} scopeRef={scope} scrollRef={scroll} assetHref={assetUrl} onClose={onClose} onOpenOwner={onOpenOwner} embedded={embedded}
    onRarity={r=>controller.setRarity(r)} onSelect={id=>{ if (id && !snapshot.selectedId) listPosition.current = scroll.current?.scrollTop ?? 0; controller.select(id); }} onFilter={f=>controller.setFilter(f)} onRefresh={()=>{void controller.refresh();}} onRetry={()=>{void controller.retryViewed();}}/>;
  if(embedded)return view;
  return <div className="encyclopedia-backdrop inventory-backdrop" data-capture-blocker onPointerDown={e=>e.stopPropagation()}
    onClick={e=>{e.stopPropagation();if(e.target===e.currentTarget)onClose();}}>
    {view}
  </div>;
}
