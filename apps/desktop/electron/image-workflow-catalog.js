import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {getOwnedWorkflowTemplates,getOwnedWorkflowDesignCoverage,getOwnedWorkflowAdapterRequirements} from '@personal-agent/agentarts';

const NAME='workflow.image.catalog',VERSION='1.0.0',SCOPE='workflow:catalog';
const ids=Array.from({length:28},(_,index)=>'F'+String(index+1).padStart(2,'0'));
const inputSchema={type:'object',properties:{workflowId:{type:'string',enum:ids}},additionalProperties:false};
const fail=(code,message)=>{throw new ProtocolError(code,message);};

/** Read-only public design/registration inventory. Never invokes a graph or readiness provider. */
export function createImageWorkflowCatalogHost({getApplication,now=Date.now}={}) {
  if(typeof getApplication!=='function')fail('INVALID_ARGUMENT','Original application reader is required');
  const templates=getOwnedWorkflowTemplates(),coverage=getOwnedWorkflowDesignCoverage(),requirements=getOwnedWorkflowAdapterRequirements();
  let closed=false;
  function current(scope) {
    if(closed||scope.signal?.aborted)fail('CANCELLED','Workflow catalog request ended');
    const application=getApplication();
    if(!application?.runtime||typeof application.tools?.list!=='function'||typeof application.readToolConversation!=='function')fail('UNSUPPORTED_CAPABILITY','Original tool registry is unavailable');
    const task=application.runtime.getTask(scope.taskId),deadline=application.runtime.loadCheckpoint(scope.taskId,'application-deadline');
    if(typeof deadline!=='string'||!Number.isFinite(Date.parse(deadline))||now()>=Date.parse(deadline))fail('TIMEOUT','Original catalog task deadline expired');
    const conversationId=application.readToolConversation(scope.taskId);
    if(scope.deadline!==undefined&&scope.deadline!==deadline||task.cancelRequested||task.state!=='running'
      ||typeof conversationId!=='string'||!conversationId)fail('UNAUTHORIZED','Original catalog task is no longer current');
    return application;
  }
  function read(input,application) {
    validateToolValue(inputSchema,input);
    // Only compare public required names/versions. Never project arbitrary registry metadata.
    const registered=application.tools.list();
    const has=(name,version)=>registered.some(tool=>tool.name===name&&(version===undefined||tool.version===version));
    const workflows=templates.filter(template=>!input.workflowId||template.workflowId===input.workflowId).map(template=>{
      const adapters=requirements.filter(item=>item.workflowId===template.workflowId).map(item=>({nodeId:item.nodeId,kind:item.kind,
        toolName:item.toolName,version:item.toolVersion,state:has(item.toolName,item.toolVersion)?'registered_requires_task_authorization':'unavailable'}));
      const requiredTools=[...new Set(template.nodes.flatMap(node=>node.capabilities.filter(cap=>cap.kind==='tool').map(cap=>cap.name)))].map(toolName=>({toolName,
        state:has(toolName)?'registered_requires_task_authorization':'unavailable'}));
      const entryName=template.workflowId==='F15'?'coding.repair.workflow':undefined,entryRegistered=!!entryName&&has(entryName,'1.0.0');
      const missingAdapterNames=adapters.filter(item=>item.state==='unavailable').map(item=>item.toolName);
      const missingToolNames=requiredTools.filter(item=>item.state==='unavailable').map(item=>item.toolName);
      return {workflowId:template.workflowId,name:template.name,category:template.category,summary:template.summary,nodeCount:template.nodes.length,
        ...(input.workflowId?{nodes:template.nodes.map(node=>({nodeId:node.id,label:node.label,kind:node.kind}))}:{}),
        state:entryRegistered&&!missingAdapterNames.length&&!missingToolNames.length?'entry_registered_requires_task_authorization':'unavailable',
        entry:{...(entryName?{name:entryName,version:'1.0.0'}:{}),state:entryRegistered?'entry_registered_requires_task_authorization':'unavailable'},
        unavailableReasons:[...(!entryRegistered?['conversation_entry_not_registered']:[]),...(missingAdapterNames.length?['host_or_guard_adapter_not_registered']:[]),...(missingToolNames.length?['required_tool_not_registered']:[])],
        adapters,requiredTools,missingAdapterNames,missingToolNames};
    });
    const value={source:'local_public_design_and_original_registry',templateVersion:coverage.templateVersion,
      projectionSha256:coverage.projectionSha256,designWorkflowCount:coverage.workflowCount,designNodeCount:coverage.nodeCount,
      adapterRequirementCount:requirements.length,hostRequirementCount:requirements.filter(item=>item.kind==='host').length,
      guardRequirementCount:requirements.filter(item=>item.kind==='guard').length,...(input.workflowId?{requestedWorkflowId:input.workflowId}:{}),
      readinessChecked:false,authorizationGranted:false,remoteImageVerification:'unverified',workflows};
    if(Buffer.byteLength(JSON.stringify(value),'utf8')>65536)fail('INVALID_ARGUMENT','Public workflow catalog exceeds its result bound');
    return value;
  }
  const tool={descriptor:{name:NAME,version:VERSION,inputSchema,outputSchema:{type:'object'},sideEffect:'read',requiredScopes:[SCOPE],
    requiresPresence:false,idempotencySupport:true,recoverySupport:true},execute:async(input,context)=>{
    if(!context.authorizationRef||!context.scopes?.includes(SCOPE))fail('SCOPE_DENIED','Original catalog read authorization is required');
    return read(input,current(context));
  }};
  return {tools:[tool],competitionToolAvailability:[{toolName:NAME,toolVersion:VERSION,publicEnumPaths:['/workflowId'],
    available:scope=>{try{current(scope);return true;}catch{return false;}}}],
    competitionToolExports:[{toolName:NAME,toolVersion:VERSION,exportPolicyVersion:'public-image-design-registry-v1',
      accepts:scope=>{try{validateToolValue(inputSchema,scope.arguments);current(scope);return true;}catch{return false;}},
      project:scope=>{const application=current(scope),expected=read(scope.result?.requestedWorkflowId===undefined?{}:{workflowId:scope.result.requestedWorkflowId},application);
        if(!isDeepStrictEqual(scope.result,expected))fail('UNAUTHORIZED','Public workflow catalog snapshot changed');return expected;}}],
    close(){closed=true;}};
}
