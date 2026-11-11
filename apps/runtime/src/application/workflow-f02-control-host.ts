import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

const controls=['F02_N02','F02_N06','F02_N07','F02_N08','F02_N09','F02_N10','F02_N11'] as const;
const guards=['F02_N01','F02_N05','F02_N09'] as const;
const schema={type:'object',additionalProperties:false,required:['state','questionId','questionRevision'],properties:{
  state:{type:'string',enum:['delivered','confirmed','invalidated','denied','cancellation_requested','card_available']},
  questionId:{type:'string'},questionRevision:{type:'integer'},sourceTaskId:{type:'string'},sourceRunId:{type:'string'},
  sessionId:{type:'string'},drainId:{type:'string'},playbackVerified:{const:false},stopped:{type:'boolean'},
  evidenceRefs:{type:'array',items:{type:'string'}}}};

/** Existing card/device operations only. Ports cannot issue Policy grants or
 * re-submit the original business operation; every host still uses ToolGateway. */
export function createF02ControlHosts(options:{application:Pick<RuntimeApplication,'runtime'>;
  assertCurrent:(scope:OwnedWorkflowHostScope,context:ToolContext)=>void;
  observe:(nodeId:string,scope:OwnedWorkflowHostScope,context:ToolContext)=>Promise<unknown>;
  guard:(nodeId:string,scope:OwnedWorkflowHostScope)=>Promise<'selected'|'skipped'|'unknown'>;
  now?:()=>Date;
}):RegisteredTool[] {
  if(!options?.application?.runtime||typeof options.assertCurrent!=='function'||typeof options.observe!=='function'||typeof options.guard!=='function')
    return [];
  const create=(nodeId:string,kind:'host'|'guard')=>createOwnedWorkflowAdapter({nodeId,kind,
    requiredScopes:['workflow:voice'],sideEffect:kind==='host'&&['F02_N02','F02_N06','F02_N07','F02_N08'].includes(nodeId)?'local_write':'read',
    inputSchema:kind==='host'?{type:'object',additionalProperties:false,properties:{}}:
      {type:'object',additionalProperties:false,required:['workflowId','nodeId','input','predecessorOutputs','predecessorStates'],properties:{
        workflowId:{const:'F02'},nodeId:{const:nodeId},input:{type:'object'},predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}}},
    outputSchema:schema,async execute(input,context){
      const scope=assertOwnedWorkflowHostScope({runtime:options.application.runtime,context,workflowId:'F02',nodeId,
        hostToolName:'workflow.'+kind+'.'+nodeId.toLowerCase(),proposalArguments:input,hostArguments:input,
        assertCurrent:options.assertCurrent,...(options.now?{now:options.now}:{})});
      if(kind==='guard')return {state:await options.guard(nodeId,scope)};
      const result=await options.observe(nodeId,scope,context);
      if(context.signal.aborted)throw new ProtocolError('CANCELLED','Original F02 control cancelled');
      options.assertCurrent(scope,context);return result;
    }});
  return [...controls.map(node=>create(node,'host')),...guards.map(node=>create(node,'guard'))];
}
