/** Browser evidence: connected, visible document, nonzero count-summary rectangle
 * inside viewport and clipping ancestors over two animation frames. This is not
 * proof of human attention or OS compositor output. No SSR acknowledgement. */
export function watchItemPresentation(element: HTMLElement, presented: () => void): () => void {
  const doc=element.ownerDocument, win=doc.defaultView;
  if(!win)return()=>{};
  let disposed=false, first=0, second=0;
  const visible=()=>{
    if(!element.isConnected||element.ownerDocument!==doc||win.closed||doc.visibilityState!=='visible')return false;
    const rect=element.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0||rect.top<0||rect.left<0||rect.bottom>win.innerHeight||rect.right>win.innerWidth)return false;
    for(let p:HTMLElement|null=element;p;p=p.parentElement){
      const style=win.getComputedStyle(p);
      if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
      const clip=p.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(style.overflowY)&& (rect.top<clip.top||rect.bottom>clip.bottom))return false;
      if(/auto|scroll|hidden|clip/.test(style.overflowX)&& (rect.left<clip.left||rect.right>clip.right))return false;
    }
    return true;
  };
  const cancel=()=>{
    disposed=true;win.cancelAnimationFrame(first);win.cancelAnimationFrame(second);
    win.removeEventListener('scroll',schedule,true);win.removeEventListener('resize',schedule);
    doc.removeEventListener('visibilitychange',schedule);
  };
  function schedule(){
    if(disposed)return;
    win!.cancelAnimationFrame(first);win!.cancelAnimationFrame(second);
    first=win!.requestAnimationFrame(()=>{
      if(disposed||!visible())return;
      second=win!.requestAnimationFrame(()=>{if(!disposed&&visible()){cancel();presented();}});
    });
  }
  win.addEventListener('scroll',schedule,true);win.addEventListener('resize',schedule);
  doc.addEventListener('visibilitychange',schedule);schedule();return cancel;
}
