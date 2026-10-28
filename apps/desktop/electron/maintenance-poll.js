/** Admission to the existing Desktop poll only: no timer, task queue, retry or
 * execution authority. Slow maintenance cannot accumulate or block other hosts. */
export function createMaintenancePoll({interval=()=>1000,now=Date.now,onError=()=>{}}={}) {
  const jobs=new Map();
  return {
    run(name,operation) {
      let job=jobs.get(name);
      if(job?.pending||now()<(job?.nextAt??0))return;
      if(!job){job={nextAt:0};jobs.set(name,job);}
      job.pending=Promise.resolve().then(operation).catch(error=>{
        try{onError(name,error);}catch{/* Diagnostics cannot hold a maintenance slot. */}
      }).finally(()=>{
        job.nextAt=now()+Math.max(1000,interval());
        job.pending=undefined;
      });
      return job.pending;
    },
  };
}
