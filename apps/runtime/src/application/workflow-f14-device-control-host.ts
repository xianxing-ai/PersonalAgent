import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

const text={type:'string',minLength:1,maxLength:4096};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const values={type:'array',minItems:1,maxItems:20,items:object({label:text,text:{type:'string',maxLength:4096}})};
const specs=[
  ['F14_N01','read',object({url:text}),object({elementsFound:{type:'integer',minimum:0,maximum:100}})],
  ['F14_N02','local_write',object({lockKey:{const:'desktop_input_lock'}}),object({lockAcquired:{const:true}})],
  ['F14_N03','external_write',object({values}),object({fieldsPopulated:{type:'integer',minimum:1,maximum:20}})],
  ['F14_N05','read',object({question:text}),object({confirmed:{const:true}})],
  ['F14_N06','external_write',object({clickTarget:text}),object({receiptId:text,lockReleased:{const:true}})],
] as const;

/** Fixed F14 device nodes; concrete operations remain separately authorized
 * original Runtime business children supplied by the trusted Desktop ports. */
export function createRuntimeF14DeviceControlHost(options:{getApplication:()=>Pick<RuntimeApplication,'runtime'>;
  assertCurrent:(scope:OwnedWorkflowHostScope,context:ToolContext)=>void;
  invoke:(nodeId:string,input:Record<string,unknown>,scope:OwnedWorkflowHostScope,context:ToolContext)=>Promise<unknown>;
  now?:()=>Date;
}):{tools:RegisteredTool[]} {
  return {tools:specs.map(([nodeId,sideEffect,inputSchema,outputSchema])=>createOwnedWorkflowAdapter({nodeId,kind:'host',
    sideEffect,requiredScopes:['workflow:device'],inputSchema,outputSchema,async execute(input,context){
      const current=()=>assertOwnedWorkflowHostScope({runtime:options.getApplication().runtime,context,workflowId:'F14',nodeId,
        hostToolName:'workflow.host.'+nodeId.toLowerCase(),proposalArguments:input,hostArguments:input,
        assertCurrent:options.assertCurrent,...(options.now?{now:options.now}:{})});
      const result=await options.invoke(nodeId,input as Record<string,unknown>,current(),context);current();return result;
    }}))};
}
