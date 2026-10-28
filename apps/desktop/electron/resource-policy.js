const budgets = Object.freeze({
  normal: Object.freeze({mode:'normal',fps:30,maxDpr:2,publishIntervalMs:16,maintenanceIntervalMs:1000,inferencePendingLimit:16}),
  constrained: Object.freeze({mode:'constrained',fps:20,maxDpr:1.5,publishIntervalMs:32,maintenanceIntervalMs:2000,inferencePendingLimit:8}),
  critical: Object.freeze({mode:'critical',fps:12,maxDpr:1,publishIntervalMs:50,maintenanceIntervalMs:5000,inferencePendingLimit:4}),
});
const rank = {normal:0,constrained:1,critical:2};

// These are adaptive workload thresholds, not a promise of fixed product memory consumption.
// Pressure rises immediately and recovers only after sustained headroom; no tasks are cancelled,
// windows reloaded, facts deleted, or model ownership changed by this policy.
export function createResourcePolicy({now=Date.now,recoveryMs=30_000}={}) {
  let mode='normal',recoverySince,revision=0;
  return {
    sample({freeBytes,totalBytes,cores,onBattery=false,thermalState='unknown',speedLimit=100}={}) {
      const validMemory=Number.isFinite(freeBytes)&&Number.isFinite(totalBytes)&&totalBytes>0&&freeBytes>=0&&freeBytes<=totalBytes;
      const ratio=validMemory?freeBytes/totalBytes:undefined;
      let next=ratio!==undefined&&ratio<=.06||thermalState==='critical'?'critical'
        :ratio!==undefined&&ratio<=.12||onBattery||['fair','serious'].includes(thermalState)
          ||Number.isFinite(cores)&&cores<=4||Number.isFinite(speedLimit)&&speedLimit<80?'constrained':'normal';
      if(rank[next]<rank[mode]) {
        const headroom=ratio!==undefined&&ratio>=(mode==='critical'?.10:.20);
        if(!headroom){recoverySince=undefined;next=mode;}
        else {recoverySince??=now();if(now()-recoverySince<recoveryMs)next=mode;}
      } else recoverySince=undefined;
      if(next!==mode){
        if(mode==='critical'&&next==='normal')next='constrained';
        mode=next;revision++;recoverySince=undefined;return true;
      }
      return false;
    },
    snapshot(){return {...budgets[mode],revision};},
  };
}
