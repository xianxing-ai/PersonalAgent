// The existing Desktop Windows readback window, shared by all native reconciliation actions.
const READBACK_WINDOW_MS=60_000;

/** New observation scope only; this never renews the original tool or execution authorization. */
export async function withNativeReadbackScope({owner,signal,deadline,now=Date.now}={},operation) {
  if(owner?.isDestroyed?.())throw Error('核实窗口已经关闭');
  const controller=new AbortController(),onClose=()=>controller.abort();
  owner?.once?.('closed',onClose);
  const context={signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,
    deadline:new Date(Math.min(now()+READBACK_WINDOW_MS,deadline===undefined?Infinity:Date.parse(deadline))).toISOString()};
  try {
    if(context.signal.aborted||Date.parse(context.deadline)<=now())throw Error('核实请求已经停止或过期');
    return await operation(context);
  }finally{owner?.removeListener?.('closed',onClose);controller.abort();}
}
