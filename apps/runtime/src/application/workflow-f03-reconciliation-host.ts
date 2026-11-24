import {isDeepStrictEqual} from 'node:util';
import {createOriginalReconciliationHost} from './workflow-f24-reconciliation-host.js';
import type {F24OriginalEffectBinding,F24ReconciliationHostOptions} from './workflow-f24-reconciliation-host.js';

type F03Options=F24ReconciliationHostOptions & {
  /** Verify that this original effect and the change cause are covered by the
   * same graph's confirmed N06 receipt; the model cannot pick the effect. */
  verifyOriginalEffectCause:(input:{binding:F24OriginalEffectBinding;predecessorResult:unknown})=>Promise<boolean>;
};

/** Read the original reconciliation record only; unknown writes are never retried. */
export function createRuntimeF03ReconciliationHost(options?:F03Options) {
  if(!options||typeof options.verifyOriginalEffectCause!=='function')
    return {tools:[],unavailable:'f03_original_effect_cause_port_unavailable'};
  const resolve=options.resolveOriginalEffect;
  if(typeof resolve!=='function')return {tools:[],unavailable:'f03_original_reconciliation_ports_unavailable'};
  return createOriginalReconciliationHost('F03',{...options,resolveOriginalEffect:async scope=>{
    const binding=await resolve(scope);
    if(!binding)return undefined;
    const graph=options.application.runtime.loadCheckpoint(scope.parentTaskId,options.driverCheckpointKey) as {
      sessionId?:string;confirmedOperations?:Record<string,{nodeId?:string;toolName?:string;localTaskId?:string;operationId?:string;result?:unknown}>}|undefined;
    if(graph?.sessionId!==scope.sessionId)return undefined;
    const records=Object.entries(graph.confirmedOperations??{}).filter(([key,value])=>value.nodeId==='F03_N06'
      &&value.toolName==='workflow.host.f03_n06'&&value.operationId===key&&typeof value.localTaskId==='string');
    if(records.length!==1)return undefined;
    const [operationId,record]=records[0]!;
    const saved=options.application.readHostToolTask(record.localTaskId!);
    if(saved.commandId!==operationId||saved.toolName!==record.toolName||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!=='host-tool-'+record.localTaskId||!saved.confirmed.evidenceRefs.includes(saved.confirmed.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,record.result))return undefined;
    if(await options.verifyOriginalEffectCause({binding:structuredClone(binding),predecessorResult:structuredClone(record.result)})!==true)return undefined;
    return binding;
  }});
}
