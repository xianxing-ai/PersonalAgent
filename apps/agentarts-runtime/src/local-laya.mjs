import {createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {startLayaService} from './laya-service.mjs';
import {createOwnedLayaSelector} from './laya-selector.mjs';
import {createAdaptiveWorkflowSelector,decisionDigest} from './adaptive-decision.mjs';

/** Local trusted-host entry. The cloud main never imports/starts it; no bearer is exposed to UI callers. */
export async function createLocalWorkflowDecisionHost({onDecision,adaptive,startService=startLayaService,...configuration}) {
  const service=await startService({...configuration,cpuExecutionPolicy:'sequential'});
  try {
  const local=createOwnedLayaSelector({port:service.port,getApiKey:()=>service.key,isReady:service.isReady,
    cpuExecutionPolicy:'sequential',onDecision});
  const decision=adaptive?createAdaptiveWorkflowSelector({...adaptive,laya:local}):undefined;
  const selector=decision?{select:async input=>{
    let context;try{context=JSON.parse(input.context);}catch{context={};}
    const node=context.nodeContract?.id??context.nodeId??'observed-workflow';
    const record=await decision.decide({...input,site:(context.workflowId??'workflow')+':'+node,
      criteriaVersion:context.templateVersion??'experimental-v1',
      criteria:'Compare these original workflow candidates against the current node contract and actual predecessor evidence. '
        +'Do not demand future tool results before proposing a tool. Review if none is supported.',
      abstainIds:(context.candidateValues??[]).filter(candidate=>candidate.abstain===true).map(candidate=>candidate.id),
      sources:[{sourceId:'workflow-observation',revision:String(context.controlRevision??1),sha256:decisionDigest(context)}]});
    return record.metadata?{selectedId:record.selectedId,metadata:record.metadata}:record.selectedId;
  }}:local;
  return {tool:createWorkflowDecisionTool({selector}),stop:service.stop,
    ...(decision?{decision}:{}),
    snapshot:()=>({ready:service.isReady(),device:service.device,torchThreads:service.torchThreads,precision:service.precision,
      execution:'sequential',model:'multilingual',calibrated:false,adaptive:!!decision})};
  }catch(error){
    try {await service.stop();}catch{throw Error('Local decision initialization failed; service cleanup requires reconciliation');}
    throw error;
  }
}
