// Pointer lighting stays within the panel. No screen capture, timer or IPC.
export function mountPanelLight(panel) {
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,point;
  const reset=()=>{
    cancelAnimationFrame(frame);frame=0;point=undefined;
    panel.style.removeProperty('--light-x');panel.style.removeProperty('--light-y');
  };
  const move=event=>{
    if(event.pointerType==='touch'||motion.matches||document.documentElement.dataset.calm==='true')return;
    point={x:event.clientX,y:event.clientY};
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;if(!point)return;
      const bounds=panel.getBoundingClientRect();
      panel.style.setProperty('--light-x',`${point.x-bounds.x}px`);
      panel.style.setProperty('--light-y',`${point.y-bounds.y}px`);
    });
  };
  panel.addEventListener('pointermove',move);panel.addEventListener('pointerleave',reset);
  motion.addEventListener('change',reset);window.addEventListener('preferences-changed',reset);
  return ()=>{
    reset();panel.removeEventListener('pointermove',move);panel.removeEventListener('pointerleave',reset);
    motion.removeEventListener('change',reset);window.removeEventListener('preferences-changed',reset);
  };
}
