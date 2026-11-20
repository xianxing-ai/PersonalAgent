import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {getOwnedWorkflowTemplates,getOwnedWorkflowDesignCoverage,getOwnedWorkflowAdapterRequirements} from '@personal-agent/agentarts';
import {DEFAULT_WORKFLOW_ENTRY_BINDINGS,normalizeWorkflowEntryBindings} from './workflow-graph-composition.js';

const NAME='workflow.image.catalog',VERSION='1.0.0',SCOPE='workflow:catalog';
const SOURCE='local_public_design_and_original_registry';
const ids=Array.from({length:28},(_,index)=>'F'+String(index+1).padStart(2,'0'));
const inputSchema={type:'object',properties:{workflowId:{type:'string',enum:ids}},additionalProperties:false};
const fail=(code,message)=>{throw new ProtocolError(code,message);};

/** Read-only public design/registration inventory. Never invokes a graph or readiness provider. */
export function createImageWorkflowCatalogHost({getApplication,readWorkflowEntries,now=Date.now}={}) {
  if(typeof getApplication!=='function')fail('INVALID_ARGUMENT','Original application reader is required');
  if(readWorkflowEntries!==undefined&&typeof readWorkflowEntries!=='function')fail('INVALID_ARGUMENT','Workflow entry reader must be a function');
  const templates=getOwnedWorkflowTemplates(),coverage=getOwnedWorkflowDesignCoverage(),requirements=getOwnedWorkflowAdapterRequirements();
  const outputSchema={type:'object',properties:{
    source:{const:SOURCE},projectionSha256:{const:coverage.projectionSha256},
    workflows:{type:'array',items:{type:'object',properties:{summary:{enum:[...new Set(templates.map(template=>template.summary))]}}}},
  }};
  let closed=false;
  function currentEntries() {
    if(!readWorkflowEntries)return DEFAULT_WORKFLOW_ENTRY_BINDINGS;
    return normalizeWorkflowEntryBindings(readWorkflowEntries());
  }
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
    const conversationEntries=application.readConversationToolCapabilities?.()??[];
    const entries=currentEntries();
    const has=(name,version)=>registered.some(tool=>tool.name===name&&(version===undefined||tool.version===version));
    const workflows=templates.filter(template=>!input.workflowId||template.workflowId===input.workflowId).map(template=>{
      const adapters=requirements.filter(item=>item.workflowId===template.workflowId).map(item=>({nodeId:item.nodeId,kind:item.kind,
        toolName:item.toolName,version:item.toolVersion,state:has(item.toolName,item.toolVersion)?'registered_requires_task_authorization':'unavailable'}));
      const requiredTools=[...new Set(template.nodes.flatMap(node=>node.capabilities.filter(cap=>cap.kind==='tool').map(cap=>cap.name)))].map(toolName=>({toolName,
        state:has(toolName)?'registered_requires_task_authorization':'unavailable'}));
      const f20=template.workflowId==='F20';
      const declaredEntry=entries[template.workflowId];
      const entryName=declaredEntry?.name,entryVersion=declaredEntry?.version??'1.0.0';
      const entryRegistered=!!entryName&&(has(entryName,entryVersion)
        ||conversationEntries.some(tool=>tool.name===entryName&&tool.version===entryVersion));
      const missingAdapterNames=adapters.filter(item=>item.state==='unavailable').map(item=>item.toolName);
      const missingToolNames=requiredTools.filter(item=>item.state==='unavailable').map(item=>item.toolName);
      // The F20 conversation worker binds the existing local tools directly.
      const missingGenericAdapter=!f20&&missingAdapterNames.length>0;
      return {workflowId:template.workflowId,name:template.name,category:template.category,summary:template.summary,nodeCount:template.nodes.length,
        ...(input.workflowId?{nodes:template.nodes.map(node=>({nodeId:node.id,label:node.label,kind:node.kind}))}:{}),
        state:entryRegistered&&!missingGenericAdapter&&!missingToolNames.length?'entry_registered_requires_task_authorization':'unavailable',
        entry:{...(entryName?{name:entryName,version:entryVersion}:{}),state:entryRegistered?'entry_registered_requires_task_authorization':'unavailable'},
        unavailableReasons:[...(!entryRegistered?['conversation_entry_not_registered']:[]),...(missingGenericAdapter?['host_or_guard_adapter_not_registered']:[]),...(missingToolNames.length?['required_tool_not_registered']:[])],
        adapters,requiredTools,missingAdapterNames,missingToolNames};
    });
    const value={source:SOURCE,templateVersion:coverage.templateVersion,
      projectionSha256:coverage.projectionSha256,designWorkflowCount:coverage.workflowCount,designNodeCount:coverage.nodeCount,
      adapterRequirementCount:requirements.length,hostRequirementCount:requirements.filter(item=>item.kind==='host').length,
      guardRequirementCount:requirements.filter(item=>item.kind==='guard').length,...(input.workflowId?{requestedWorkflowId:input.workflowId}:{}),
      readinessChecked:false,authorizationGranted:false,remoteImageVerification:'unverified',workflows};
    if(Buffer.byteLength(JSON.stringify(value),'utf8')>65536)fail('INVALID_ARGUMENT','Public workflow catalog exceeds its result bound');
    return value;
  }
  const tool={descriptor:{name:NAME,version:VERSION,inputSchema,outputSchema,sideEffect:'read',requiredScopes:[SCOPE],
    requiresPresence:false,idempotencySupport:true,recoverySupport:true},execute:async(input,context)=>{
    if(!context.authorizationRef||!context.scopes?.includes(SCOPE))fail('SCOPE_DENIED','Original catalog read authorization is required');
    return read(input,current(context));
  }};
  return {tools:[tool],competitionToolAvailability:[{toolName:NAME,toolVersion:VERSION,publicEnumPaths:['/workflowId'],
    available:scope=>{try{current(scope);return true;}catch{return false;}}}],
    competitionToolExports:[{toolName:NAME,toolVersion:VERSION,exportPolicyVersion:'public-image-design-registry-v2',
      accepts:scope=>{try{validateToolValue(inputSchema,scope.arguments);current(scope);return true;}catch{return false;}},
      project:scope=>{const application=current(scope),expected=read(scope.result?.requestedWorkflowId===undefined?{}:{workflowId:scope.result.requestedWorkflowId},application);
        if(!isDeepStrictEqual(scope.result,expected))fail('UNAUTHORIZED','Public workflow catalog snapshot changed');return expected;}}],
    snapshot(input={}) {
      if(closed)fail('CANCELLED','Workflow catalog request ended');
      const application=getApplication();
      if(!application?.runtime||typeof application.tools?.list!=='function')fail('UNSUPPORTED_CAPABILITY','Original tool registry is unavailable');
      return read(input??{},application);
    },
    close(){closed=true;}};
}
