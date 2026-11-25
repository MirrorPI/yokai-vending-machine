import { MinigameZone, MinigamePanel } from './minigame.tsx';
import { useAccount } from '../account/context.tsx';
import { SettingsPanel } from '../settings/SettingsPanel.tsx';
import type { EnvironmentStatus } from '../settings/SettingsPanel.tsx';
import type { SettingsController } from '../settings/controller.ts';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { CollectionDisplay } from './collection-layout.ts';
import { toggleCollection, type CollectionPanel } from './collection-navigation.ts';
import { assetCatalog } from '../data/catalog.ts';
import { createBrowserRepository } from '../storage/browser.ts';
import { subscribeSurfaceChanges } from '../observation/changes.ts';
import { useSurface } from '../observation/context.tsx';
import { InventoryController } from '../inventory/controller.ts';
import { InventoryPanel } from '../inventory/InventoryPanel.tsx';
import { createOrdinaryEncyclopedia } from './encyclopedia.ts';
import { EncyclopediaPanel } from '../encyclopedia/EncyclopediaPanel.tsx';
/** Mounted in ordinary App only. Construction starts no I/O; badge observes saved
 * records independently of the A10 visit gate. A07 retains its readonly ports. */
export function Collections({settings,environment,display}:{settings:SettingsController;environment:EnvironmentStatus|null;display:CollectionDisplay}){
  const { host }=useSurface();
  const ports=useAccount()?.ports;
  const subscribeChanges=useMemo(()=>ports?.subscribeChanges ?? ((changed:()=>void)=>host?subscribeSurfaceChanges(host.surfaces,changed):()=>{}),[host,ports]);
  const encyclopedia=useMemo(()=>createOrdinaryEncyclopedia(subscribeChanges,ports??undefined),[subscribeChanges,ports]);
  const inventory=useMemo(()=>new InventoryController({catalog:assetCatalog,repository:ports?.repository ?? createBrowserRepository(),subscribeChanges}),[subscribeChanges,ports]);
  const snapshot=useSyncExternalStore(inventory.subscribe,()=>inventory.snapshot);
  const [showInventory,setShowInventory]=useState(true);
  const [showEncyclopedia,setShowEncyclopedia]=useState(true);
  const [panel,setPanel]=useState<CollectionPanel>(null);
  useEffect(()=>{void inventory.start();return()=>{inventory.stop();encyclopedia.close();};},[inventory,encyclopedia]);
  const openInventory=(itemId:string|null)=>{
    // Retire photo requests/URLs synchronously before an inventory can mount.
    if(display.docked){setShowInventory(true);setPanel({kind:'inventory',itemId});inventory.select(itemId);return;}
    encyclopedia.close();setPanel({kind:'inventory',itemId});
  };
  const openOwner=(itemId:string)=>{
    const yokaiId=assetCatalog.items.find(item=>item.id===itemId)?.ownerYokaiId;
    if(!yokaiId)return;
    if(display.docked){setShowEncyclopedia(true);setPanel({kind:'encyclopedia',yokaiId});void encyclopedia.select(yokaiId);return;}
    inventory.close();setPanel({kind:'encyclopedia',yokaiId});
  };
  // A viewport transition retires the old modal; it cannot reappear after PiP.
  useEffect(()=>{setPanel(null);setShowInventory(true);setShowEncyclopedia(true);},[display.docked]);
  const navigation=<nav className="collection-footer-nav" aria-label="수집 기록" data-capture-blocker>
    {!display.docked&&<button className="minigame-open" aria-expanded={panel?.kind==='minigame'} onClick={()=>{encyclopedia.close();inventory.close();setPanel(current=>toggleCollection(current,'minigame'));}}>미니게임</button>}
    <button className="inventory-open" aria-describedby="inventory-badge-status" aria-expanded={display.docked?showInventory:panel?.kind==='inventory'} onClick={e=>{e.stopPropagation();if(display.docked){setShowInventory(v=>!v);return;}encyclopedia.close();setPanel(current=>toggleCollection(current,'inventory'));}}>물건함
      {(snapshot.model?.progress.unread??0)>0&&<span aria-hidden="true" className="inventory-dot" data-inventory-unread/>}
      {snapshot.phase==='error'&&<span aria-hidden="true">!</span>}
    </button>
    <button className="encyclopedia-open" aria-expanded={display.docked?showEncyclopedia:panel?.kind==='encyclopedia'} onClick={e=>{e.stopPropagation();if(display.docked){setShowEncyclopedia(v=>!v);return;}inventory.close();setPanel(current=>toggleCollection(current,'encyclopedia'));}}>도감</button>
  </nav>;
  return <>
    <button className="settings-open" data-capture-blocker onClick={e=>{e.stopPropagation();if(!display.docked){encyclopedia.close();inventory.close();}setPanel({kind:'settings'});}}>설정</button>
    {panel?.kind==='settings'&&<SettingsPanel controller={settings} environment={environment} onClose={()=>setPanel(null)}/>}
    {display.footerTarget&&createPortal(navigation,display.footerTarget)}
    <span className="visually-hidden" id="inventory-badge-status" role="status">{snapshot.phase==='error'?'물건 저장 조회를 확인하지 못했어요.':snapshot.model?`미확인 물건 ${snapshot.model.progress.unread}개`:'물건 저장 조회 중'}</span>
    {display.docked&&<>
      {showInventory&&<aside className="collection-dock" style={{width:display.panelWidth,right:'calc(100% + 16px)'}} data-capture-blocker><InventoryPanel embedded controller={inventory} initialItemId={panel?.kind==='inventory'?panel.itemId:null} onClose={()=>setShowInventory(false)} onOpenOwner={openOwner}/></aside>}
      {showEncyclopedia&&<aside className="collection-dock" style={{width:display.panelWidth,left:'calc(100% + 16px)'}} data-capture-blocker><EncyclopediaPanel embedded controller={encyclopedia} initialYokaiId={panel?.kind==='encyclopedia'?panel.yokaiId:null} onClose={()=>setShowEncyclopedia(false)} onOpenItem={openInventory}/></aside>}
      {display.minigameTarget&&createPortal(<MinigameZone/>,display.minigameTarget)}
    </>}
    {panel?.kind==='minigame'&&<MinigamePanel onClose={()=>setPanel(null)}/>}
    {!display.docked&&panel?.kind==='encyclopedia'&&<EncyclopediaPanel controller={encyclopedia} initialYokaiId={panel.yokaiId} onClose={()=>setPanel(null)} onOpenItem={openInventory}/>}
    {!display.docked&&panel?.kind==='inventory'&&<InventoryPanel controller={inventory} initialItemId={panel.itemId} onClose={()=>setPanel(null)} onOpenOwner={openOwner}/>}
  </>;
}
