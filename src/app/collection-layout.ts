export function collectionLayout(width: number, height: number) {
  const compact=width<=600;
  const minFooterHeight=74;
  // Layout units are 1/64 CSS px in Chromium. Quantizing the scale keeps every
  // integer source coordinate exact while filling narrow floating windows.
  const scale=Math.max(.5,Math.floor(Math.min(compact?3:2,width/192,(height-minFooterHeight)/256)*64)/64);
  const panelWidth=Math.min(320,Math.floor((width-192*scale)/2)-32);
  const docked=panelWidth>=240&&height>=600;
  const footerHeight=minFooterHeight;
  const scene={scale,left:Math.max(0,Math.floor((width-192*scale)/2)),
    top:docked?16:compact?0:Math.max(0,Math.floor((height-256*scale-footerHeight)/2))};
  return {scene,docked,panelWidth:Math.max(0,panelWidth),footerHeight,compact};
}
export interface CollectionDisplay {
  docked: boolean;
  panelWidth: number;
  footerTarget: HTMLElement | null;
  minigameTarget?: HTMLElement | null;
}
