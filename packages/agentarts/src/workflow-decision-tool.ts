import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool} from '@personal-agent/contracts';
import type {WorkflowSelector} from './owned-workflows.js';

export const WORKFLOW_DECISION_TOOL_NAME='decision.choose_candidate';
export const WORKFLOW_DECISION_TOOL_VERSION='1.0.0';
export const WORKFLOW_DECISION_SCOPE='decision:local';
const inputSchema={type:'object',additionalProperties:false,required:['context','candidates','requestId'],properties:{
  context:{type:'string',minLength:1},requestId:{type:'string',minLength:1},
  candidates:{type:'array',minItems:2,maxItems:16,items:{type:'object',additionalProperties:false,
    required:['id','description'],properties:{id:{type:'string',minLength:1},description:{type:'string',minLength:1}}}}}};

/** Trusted local composition injects its existing Laya selector. No credentials or model process in the cloud. */
export function createWorkflowDecisionTool(options:{selector:WorkflowSelector}):RegisteredTool {
  if(typeof options?.selector?.select!=='function') throw new ProtocolError('INVALID_ARGUMENT','Local selector unavailable');
  return {descriptor:{name:WORKFLOW_DECISION_TOOL_NAME,version:WORKFLOW_DECISION_TOOL_VERSION,inputSchema,
    outputSchema:{type:'object',additionalProperties:false,required:['selectedId'],properties:{selectedId:{type:'string',minLength:1}}},
    sideEffect:'read',requiredScopes:[WORKFLOW_DECISION_SCOPE],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
    async execute(input,context) {
      validateToolValue(inputSchema,input);
      if(!context.authorizationRef||!context.scopes.includes(WORKFLOW_DECISION_SCOPE)) throw new ProtocolError('SCOPE_DENIED','Local decision scope required');
      const value=input as {context:string;candidates:{id:string;description:string}[];requestId:string};
      if(new Set(value.candidates.map(candidate=>candidate.id)).size!==value.candidates.length) throw new ProtocolError('INVALID_ARGUMENT','Duplicate decision candidates');
      const check=()=>{
        if(context.signal.aborted) throw new ProtocolError('CANCELLED','Local decision cancelled');
        if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now()) throw new ProtocolError('TIMEOUT','Local decision expired');
      };
      check();
      const selectedId=await options.selector.select({...structuredClone(value),deadline:context.deadline,signal:context.signal});
      check();
      if(!value.candidates.some(candidate=>candidate.id===selectedId)) throw new ProtocolError('EXTERNAL_FAILURE','Selector returned an unknown candidate');
      return {selectedId};
    }};
}
