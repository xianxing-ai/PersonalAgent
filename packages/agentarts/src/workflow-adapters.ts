import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {getOwnedWorkflowTemplates} from './owned-workflow-templates.js';
import {workflowHostToolName,workflowGuardToolName} from './owned-workflows.js';

/** Public wiring manifest: declarations are requirements, never proof of connected services. */
export function getOwnedWorkflowAdapterRequirements() {
  return getOwnedWorkflowTemplates().flatMap(template=>template.nodes.flatMap(node=>[
    ...(node.kind==='host'?[{workflowId:template.workflowId,nodeId:node.id,kind:'host' as const,
      toolName:workflowHostToolName(node.id),toolVersion:'1.0.0',effect:node.effect,
      label:node.label,capabilities:node.capabilities,inputFields:node.inputFields,outputFields:node.outputFields}]:[]),
    ...(node.condition?[{workflowId:template.workflowId,nodeId:node.id,kind:'guard' as const,
      toolName:workflowGuardToolName(node.id),toolVersion:'1.0.0',effect:'read' as const,
      label:node.label,capabilities:node.capabilities,inputFields:node.inputFields,outputFields:['state']}]:[]),
  ]));
}

/** An adapter is explicitly implemented/registered by its owner and still goes through Policy/ToolGateway. */
export function createOwnedWorkflowAdapter(options:{nodeId:string;kind:'host'|'guard';inputSchema:Record<string,unknown>;
  outputSchema:Record<string,unknown>;requiredScopes:string[];sideEffect:'read'|'local_write'|'external_write';
  execute:(input:unknown,context:ToolContext)=>Promise<unknown>}):RegisteredTool {
  const requirement=getOwnedWorkflowAdapterRequirements().find(item=>item.nodeId===options.nodeId&&item.kind===options.kind);
  if(!requirement||typeof options.execute!=='function'||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||(requirement.effect==='write'?!['local_write','external_write'].includes(options.sideEffect):options.sideEffect!=='read')) {
    throw new ProtocolError('INVALID_ARGUMENT','Unknown workflow adapter or missing trusted scope');
  }
  const outputSchema=options.kind==='guard'?{type:'object',additionalProperties:false,required:['state'],
    properties:{state:{type:'string',enum:['selected','skipped','unknown']}}}:structuredClone(options.outputSchema);
  const descriptor={name:requirement.toolName,version:requirement.toolVersion,inputSchema:structuredClone(options.inputSchema),
    outputSchema,sideEffect:options.sideEffect,
    requiredScopes:[...options.requiredScopes],idempotencySupport:false,recoverySupport:false,requiresPresence:false};
  return {descriptor,async execute(input,context) {
    validateToolValue(descriptor.inputSchema,input);
    const check=()=>{
      if(!context.authorizationRef||!descriptor.requiredScopes.every(scope=>context.scopes.includes(scope))) throw new ProtocolError('SCOPE_DENIED','Workflow adapter scope required');
      if(context.signal.aborted) throw new ProtocolError('CANCELLED','Workflow adapter cancelled');
      if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now()) throw new ProtocolError('TIMEOUT','Workflow adapter expired');
    };
    check();const result=await options.execute(input,context);check();validateToolValue(outputSchema,result);return result;
  }};
}
