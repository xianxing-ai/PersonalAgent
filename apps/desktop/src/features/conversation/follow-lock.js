/** Sticky bottom-follow belief for the panel thread (审点 #62).
 * Only a real user scroll can change the belief: passive content growth and
 * pre-judgment reflow never unlock following, and our own programmatic
 * scroll-to-bottom events are ignored via a short suppression window. */
export function createFollowLock({ threshold=90, now=()=>performance.now() }={}){
  let atBottom=true;
  let programmaticUntil=0;
  return {
    get atBottom(){ return atBottom; },
    /** Feed the current distance-from-bottom on every thread scroll event. */
    onScroll(distanceFromBottom){
      if(now()<programmaticUntil) return;
      atBottom=distanceFromBottom<=threshold;
    },
    /** Call right before assigning scrollTop programmatically. */
    markProgrammatic(windowMs=80){ programmaticUntil=now()+windowMs; },
    /** Active conversation changed: following restarts engaged. */
    reset(){ atBottom=true; programmaticUntil=0; },
  };
}
