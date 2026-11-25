export type CollectionPanel = {kind:'settings'} | {kind:'minigame'} | {kind:'encyclopedia';yokaiId?:string} | {kind:'inventory';itemId:string|null} | null;

export function toggleCollection(panel: CollectionPanel, kind: 'inventory' | 'encyclopedia' | 'minigame'): CollectionPanel {
  if (panel?.kind === kind) return null;
  return kind === 'inventory' ? {kind:'inventory', itemId:null} : {kind};
}
