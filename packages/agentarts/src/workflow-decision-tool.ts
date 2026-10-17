import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool} from '@personal-agent/contracts';
import type {WorkflowSelector} from './owned-workflows.js';
import {parseWorkflowSelectionResult} from './workflow-shadow-policy.js';
import type {WorkflowSelectionResult} from './workflow-shadow-policy.js';

export const WORKFLOW_DECISION_TOOL_NAME='decision.choose_candidate';
export const WORKFLOW_DECISION_TOOL_VERSION='1.0.0';
export const WORKFLOW_DECISION_SCOPE='decision:local';
const inputSchema={type:'object',additionalProperties:false,required:['context','candidates','requestId'],properties:{
  context:{type:'string',minLength:1},requestId:{type:'string',minLength:1},
  candidates:{type:'array',minItems:2,maxItems:16,items:{type:'object',additionalProperties:false,
    required:['id','description'],properties:{id:{type:'string',minLength:1},description:{type:'string',minLength:1},
      metadata:{type:'object'}}}}}};

/** Trusted local composition injects its existing Laya selector. No credentials or model process in the cloud. */
export function createWorkflowDecisionTool(options:{selector:WorkflowSelector}):RegisteredTool {
  if(typeof options?.selector?.select!=='function') throw new ProtocolError('INVALID_ARGUMENT','Local selector unavailable');
  return {descriptor:{name:WORKFLOW_DECISION_TOOL_NAME,version:WORKFLOW_DECISION_TOOL_VERSION,inputSchema,
    outputSchema:{type:'object',additionalProperties:false,required:['selectedId'],properties:{selectedId:{type:'string',minLength:1},metadata:{type:'object'}}},
    sideEffect:'read',requiredScopes:[WORKFLOW_DECISION_SCOPE],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
    async execute(input,context) {
      validateToolValue(inputSchema,input);
      if(!context.authorizationRef||!context.scopes.includes(WORKFLOW_DECISION_SCOPE)) throw new ProtocolError('SCOPE_DENIED','Local decision scope required');
      const value=input as {context:string;candidates:{id:string;description:string;metadata?:WorkflowSelectionResult['metadata']}[];requestId:string};
      if(new Set(value.candidates.map(candidate=>candidate.id)).size!==value.candidates.length) throw new ProtocolError('INVALID_ARGUMENT','Duplicate decision candidates');
      const ids=value.candidates.map(candidate=>candidate.id);
      for(const candidate of value.candidates)if(candidate.metadata!==undefined)
        parseWorkflowSelectionResult({selectedId:candidate.id,metadata:candidate.metadata},ids);
      const check=()=>{
        if(context.signal.aborted) throw new ProtocolError('CANCELLED','Local decision cancelled');
        if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now()) throw new ProtocolError('TIMEOUT','Local decision expired');
      };
      check();
      const selected=await options.selector.select({...structuredClone(value),deadline:context.deadline,signal:context.signal});
      check();
      let result:WorkflowSelectionResult;
      try {result=parseWorkflowSelectionResult(selected,ids);}
      catch {throw new ProtocolError('EXTERNAL_FAILURE','Selector returned an unknown candidate or invalid same-decision metadata');}
      const proposed=value.candidates.find(candidate=>candidate.id===result.selectedId)?.metadata;
      if(!result.metadata&&proposed) {
        // Candidate text cannot attest that a local or teacher call happened. Legacy selectors
        // retain advisory intent but receive no invented participation/qualification proof.
        result={selectedId:result.selectedId,metadata:{shadowPlan:{...structuredClone(proposed.shadowPlan),provenance:{
          decidedBy:'code',deepseekProposalRef:null,layaDecisionRef:null,layaQualified:false,uncertaintyResolved:false}}}};
      }
      return result;
    }};
}
