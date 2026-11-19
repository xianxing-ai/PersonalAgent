import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

/** Recovery is a real registered operation supplied by its owner. There is no
 * fallback which releases a lock or resumes an unknown task from log wording. */
export function createRuntimeF13DiagnosticControlHost(options:{getApplication:()=>Pick<RuntimeApplication,'runtime'>;
  assertCurrent:(scope:OwnedWorkflowHostScope,context:ToolContext)=>void;
  recover:(targetLock:string,scope:OwnedWorkflowHostScope,context:ToolContext)=>Promise<{lockReleased:boolean;taskResumed:boolean}>;
  now?:()=>Date;
}):{tools:RegisteredTool[]} {
  return {tools:[createOwnedWorkflowAdapter({nodeId:'F13_N04',kind:'host',sideEffect:'local_write',requiredScopes:['workflow:diagnostics'],
    inputSchema:{type:'object',additionalProperties:false,required:['targetLock'],properties:{targetLock:{type:'string',minLength:1,maxLength:2048}}},
    outputSchema:{type:'object',additionalProperties:false,required:['lockReleased','taskResumed'],properties:{lockReleased:{type:'boolean'},taskResumed:{type:'boolean'}}},
    async execute(input,context){
      const current=()=>assertOwnedWorkflowHostScope({runtime:options.getApplication().runtime,context,workflowId:'F13',nodeId:'F13_N04',
        hostToolName:'workflow.host.f13_n04',proposalArguments:input,hostArguments:input,assertCurrent:options.assertCurrent,...(options.now?{now:options.now}:{})});
      const result=await options.recover((input as {targetLock:string}).targetLock,current(),context);current();return result;
    }})]};
}
