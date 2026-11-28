// Pointer lighting stays within the panel. No screen capture, timer or IPC.
// Composited transform on a dedicated leaf layer avoids full-subtree style recalc and full-window paint.
export function mountPanelLight(panel) {
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const light=typeof document?.createElement==='function'?document.createElement('span'):null;
  if(light){light.className='panel-light';light.setAttribute('aria-hidden','true');panel.prepend?.(light);}
  let frame=0,point,originX=0,originY=0,measured=false;
  const measure=()=>{
    const bounds=panel.getBoundingClientRect?.();
    if(bounds){originX=bounds.x;originY=bounds.y;measured=bounds.width>0||bounds.height>0;}
  };
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{measured=false;}):null;
  observer?.observe(panel);
  const reset=()=>{
    cancelAnimationFrame(frame);frame=0;point=undefined;
    panel.style.removeProperty('--light-x');panel.style.removeProperty('--light-y');
    light?.style.removeProperty('transform');
  };
  const move=event=>{
    if(event.pointerType==='touch'||motion.matches||document.documentElement.dataset.calm==='true')return;
    point={x:event.clientX,y:event.clientY};
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;if(!point)return;
      if(!measured)measure();
      const x=Math.round(point.x-originX),y=Math.round(point.y-originY);
      panel.style.setProperty('--light-x',`${x}px`);
      panel.style.setProperty('--light-y',`${y}px`);
      if(light)light.style.transform=`translate3d(${x}px,${y}px,0)`;
    });
  };
  panel.addEventListener('pointermove',move);panel.addEventListener('pointerleave',reset);
  motion.addEventListener('change',reset);window.addEventListener('preferences-changed',reset);
  return ()=>{
    reset();observer?.disconnect();light?.remove?.();
    panel.removeEventListener('pointermove',move);panel.removeEventListener('pointerleave',reset);
    motion.removeEventListener('change',reset);window.removeEventListener('preferences-changed',reset);
  };
}
