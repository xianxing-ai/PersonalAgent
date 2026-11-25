import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {toolArgumentsDigest as digest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions,RuntimeConfiguredWorkflowBinding} from './configured-workflow-worker.js';
import type {CompetitionToolExport,PrepareCompetitionToolExport} from './coordination.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {createWorkflowBusinessToolBridge,type WorkflowBusinessToolReceipt} from './workflow-business-tool-bridge.js';
import {F01_LIFECYCLE_SCHEMA,readF01LifecycleInvocation} from './workflow-f01-lifecycle-host.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;
type Scope={taskId:string;deadline:string;signal:AbortSignal};
type Graph=RuntimeConfiguredWorkflowBinding;
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:2048},empty=object({}),workflowId='F01';
const contextSchema=object({fact:object({id:text,revision:{type:'integer',minimum:1}}),responsibilitySession:object({taskId:text,sessionId:text})});
const requestSchema={...object({context:contextSchema}),properties:{context:contextSchema,lifecycle:F01_LIFECYCLE_SCHEMA,expansionQuery:text}};
const candidateSchema=object({action:{enum:['dispatch','defer','expand','clarify','lifecycle']},question:{type:'string',maxLength:2048},
  subtasks:{type:'array',maxItems:3,items:object({subtaskId:text,role:{enum:['researcher','coder','reviewer','planner','coordinator']},goal:text})}});
type Candidate={action:'dispatch'|'defer'|'expand'|'clarify'|'lifecycle';question:string;subtasks:{subtaskId:string;role:string;goal:string}[]};
type Input={context:{fact:{id:string;revision:number};responsibilitySession:{taskId:string;sessionId:string}};
  lifecycle?:Record<string,unknown>;expansionQuery?:string;source:{taskId:string;goal:string};candidateContract:unknown};
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
export interface F01WorkflowOptions {
  getApplication:()=>RuntimeApplication;
  createContextPorts:(assertCurrent:(scope:OwnedWorkflowHostScope)=>void)=>{
    tools:RegisteredTool[];authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;
    available?:()=>boolean;
    assertSourcesCurrent:(scope:OwnedWorkflowHostScope,result:unknown,ownLifecycle?:unknown)=>void;
  };
  lifecycle:{tools:RegisteredTool[];authority:unknown};
  question:{requestReply:(scope:OwnedWorkflowHostScope,context:ToolContext)=>Promise<unknown>;readReply:(scope:OwnedWorkflowHostScope)=>unknown};
  assertExpansionCurrent:(query:string,result:unknown|undefined,scope:Scope)=>void;
  resolveExpansionInput:(query:string,scope:Scope)=>Record<string,unknown>;
  toolExports:readonly CompetitionToolExport[];
  prepareCompetitionToolExport:PrepareCompetitionToolExport;
  authorizeExport:(request:Parameters<Worker['authorizeExport']>[0]&{workflowId:'F01'})=>Promise<boolean>;
}

/** One original configured worker; all effects stay in the original ToolGateway. */
export function createF01WorkflowWorkerPorts(ports:F01WorkflowOptions) {
  const app=()=>ports.getApplication(),checking=new Map<string,string>();
  const context=ports.createContextPorts(host=>current({taskId:host.parentTaskId,deadline:host.deadline,signal:host.signal},host.sessionId));
  function graph(scope:Scope,sessionId:string){const value=app().readF01ContextBinding({taskId:scope.taskId,sessionId,signal:scope.signal});
    if(!value||value.binding.deadline!==scope.deadline)fail('UNAUTHORIZED','F01 original graph unavailable');return value;}
  function operation(value:Graph,nodeId:string,toolName='workflow.host.'+nodeId.toLowerCase(),optional=false){
    const found=value.confirmedOperations.filter(item=>item.nodeId===nodeId&&item.toolName===toolName);
    if(found.length!==1){if(optional&&!found.length)return;fail('UNAUTHORIZED','F01 requires one original node result');}return found[0]!;
  }
  function current(scope:Scope,session?:string):void {
    const runtime=app().runtime,task=runtime.getTask(scope.taskId),parent=app().readDelegatedUserTaskParent(scope.taskId);
    if(context.available&&context.available()!==true)fail('UNSUPPORTED_CAPABILITY','F01 original context sources unavailable');
    if(scope.signal.aborted||task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state)
      ||!parent||parent.deadline!==scope.deadline||runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline
      ||Date.parse(scope.deadline)<=Date.now())fail('UNAUTHORIZED','F01 original task is no longer current');
    const dispatcher=runtime.readToolDescriptors().find(tool=>tool.name==='subagent.dispatch'&&tool.version==='1.0.0'),savedDispatcher=runtime.loadCheckpoint(scope.taskId,'f01:dispatcher');
    if(!dispatcher||savedDispatcher!==undefined&&!isDeepStrictEqual(dispatcher,savedDispatcher))fail('UNSUPPORTED_CAPABILITY','F01 original dispatcher changed');
    const source=runtime.getTask(parent.taskId),saved=runtime.loadCheckpoint(scope.taskId,'f01:source');
    if(source.cancelRequested||source.conversationId!==parent.conversationId||!source.goal
      ||runtime.loadCheckpoint(source.taskId,'private-copy-erasure')!==undefined||runtime.loadCheckpoint(source.taskId,'private-copy-erasure-binding')!==undefined
      ||saved!==undefined&&!isDeepStrictEqual(saved,{taskId:source.taskId,goal:source.goal}))fail('REVISION_CONFLICT','F01 original instruction changed');
    const sessionId=runtime.loadCheckpoint(scope.taskId,'f01:session') as string|undefined;
    if(session!==undefined&&sessionId!==undefined&&session!==sessionId)fail('REVISION_CONFLICT','F01 session changed');
    const expected=session??sessionId;if(!expected)return;
    if(checking.has(scope.taskId)){if(checking.get(scope.taskId)!==expected)fail('UNAUTHORIZED','F01 recursive session mismatch');return;}
    checking.set(scope.taskId,expected);
    try{
      const bound=graph(scope,expected).binding,read=operation(bound,'F01_N02','workflow.host.f01_n02',true)
        ??runtime.loadCheckpoint(scope.taskId,'f01:context-receipt') as Graph['confirmedOperations'][number]|undefined;
      if(read){const confirmed=app().readHostToolTask(read.localTaskId);
        const parent=runtime.loadCheckpoint(read.localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
        const original=runtime.loadCheckpoint(scope.taskId,'owned-workflow:operation:'+read.operationId) as {taskId?:string;workflowId?:string;sessionId?:string;localTaskId?:string}|undefined;
        if(confirmed.toolName!=='workflow.host.f01_n02'||confirmed.commandId!==read.operationId||!isDeepStrictEqual(confirmed.confirmed?.result,read.result)
          ||parent?.taskId!==scope.taskId||parent.operationId!==read.operationId||original?.taskId!==scope.taskId||original.workflowId!==workflowId
          ||original.sessionId!==expected||original.localTaskId!==read.localTaskId)fail('UNAUTHORIZED','F01 original context result changed');
        const own=operation(bound,'F01_N09','workflow.host.f01_n09',true),pending=app().readPendingOwnedWorkflowHostTask(scope.taskId);
        const pendingN09=pending&&app().readHostToolTask(pending.taskId).toolName==='workflow.host.f01_n09'
          &&runtime.readToolExecutions(pending.taskId).some(record=>record.executionStarted&&record.policyDecision==='allow')?pending:undefined;
        const ownLifecycle=own?readF01LifecycleInvocation(app(),own.localTaskId,scope,'readback'):pendingN09?
          readF01LifecycleInvocation(app(),pendingN09.taskId,scope,pendingN09.state==='running'?'execute':'readback'):undefined;
        context.assertSourcesCurrent({parentTaskId:scope.taskId,sessionId:expected,localTaskId:read.localTaskId,operationId:read.operationId,...scope},read.result,ownLifecycle);
      }
      for(const nodeId of ['F01_N07','F01_N06']){
        const executed=operation(bound,nodeId,'workflow.host.'+nodeId.toLowerCase(),true)
          ??runtime.loadCheckpoint(scope.taskId,'f01:receipt:'+nodeId) as Graph['confirmedOperations'][number]|undefined;
        if(!executed)continue;
        const selection=chosen(bound);if(nodeId==='F01_N06'&&selection.action!=='dispatch')continue;
        const query=(bound.input as Input).expansionQuery;
        if(nodeId==='F01_N07')ports.assertExpansionCurrent(query!,executed.result,scope);
        const descriptor=runtime.readToolDescriptors().find(tool=>tool.name===executed.toolName&&tool.version===executed.toolVersion)!;
        const args=nodeId==='F01_N07'?ports.resolveExpansionInput(query!,scope):{subtasks:(operation(bound,'F01_N05')!.result as {subtasks:unknown[]}).subtasks};
        const child=bridge().read({actionKey:nodeId==='F01_N07'?'f01.expand':'f01.dispatch',input:args},
          {taskId:executed.localTaskId,runId:'host-tool-'+executed.localTaskId,authorizationRef:'host-tool-'+executed.localTaskId,scopes:[...descriptor.requiredScopes],deadline:scope.deadline,signal:scope.signal});
        const projected=runtime.loadCheckpoint(executed.localTaskId,'f01:business-projection') as {taskId:string;runId:string;policyVersion:string;projection:unknown}|undefined;
        const policy=ports.toolExports.find(item=>item.toolName===child.confirmed?.toolName&&item.toolVersion===child.confirmed?.toolVersion);
        if(!child.confirmed||!projected||projected.taskId!==child.taskId||projected.runId!==child.runId||!policy||policy.exportPolicyVersion!==projected.policyVersion
          ||policy.accepts({taskId:child.taskId!,proposalId:app().readHostToolTask(child.taskId!).commandId,arguments:child.confirmed.arguments,
            phase:'final',projection:projected.projection,signal:scope.signal})!==true
          ||nodeId==='F01_N07'&&!isDeepStrictEqual(executed.result,projected.projection))fail('UNAUTHORIZED','F01 original child projection changed');
      }
    }finally{checking.delete(scope.taskId);}
  }
  function chosen(value:Graph):Candidate {
    const original=operation(value,'F01_N03','decision.choose_candidate')!,intent=app().runtime.loadCheckpoint(original.localTaskId,'host-tool-intent') as {arguments?:Record<string,unknown>};
    let parsed;try{parsed=JSON.parse(String(intent?.arguments?.context));}catch{fail('UNAUTHORIZED','F01 original choice unavailable');}
    const candidates=parsed?.candidateValues?.filter((entry:Record<string,unknown>)=>entry.id===(original.result as {selectedId?:string}).selectedId);
    if(parsed?.workflowId!==workflowId||parsed.nodeId!=='F01_N03'||!isDeepStrictEqual(parsed.input,value.input)||candidates?.length!==1||candidates[0].abstain)
      fail('UNSUPPORTED_CAPABILITY','F01 plan remains unresolved');
    return candidate(candidates[0].value,value.input as Input);
  }
  function candidate(raw:unknown,input:Input):Candidate {
    validateToolValue(candidateSchema,raw);const value=raw as Candidate;
    if(value.action==='dispatch'?!value.subtasks.length:value.subtasks.length!==0)fail('INVALID_ARGUMENT','F01 action differs from its task plan');
    if(new Set(value.subtasks.map(item=>item.subtaskId)).size!==value.subtasks.length)fail('INVALID_ARGUMENT','F01 task IDs must be unique');
    if(value.question!==value.question.trim()||/[\u0000-\u001f\u007f]/u.test(value.question)
      ||(value.action==='clarify'?!value.question:value.question!==''))fail('INVALID_ARGUMENT','F01 clarification is invalid');
    if(value.action==='lifecycle'&&!input.lifecycle||value.action==='expand'&&!input.expansionQuery)fail('UNSUPPORTED_CAPABILITY','F01 required original input unavailable');
    if(value.action==='lifecycle'&&!isDeepStrictEqual(input.lifecycle!.target,input.context.responsibilitySession))fail('UNAUTHORIZED','F01 lifecycle target differs from original selection');
    return value;
  }
  function host(nodeId:string,kind:'host'|'guard',args:unknown,toolContext:ToolContext){
    const scope=assertOwnedWorkflowHostScope({runtime:app().runtime,context:toolContext,workflowId,nodeId,hostToolName:'workflow.'+kind+'.'+nodeId.toLowerCase(),
      proposalArguments:args,assertCurrent:value=>current({taskId:value.parentTaskId,deadline:value.deadline,signal:value.signal},value.sessionId)});
    app().runtime.saveCheckpointOnce(scope.parentTaskId,'f01:session',scope.sessionId);
    return {scope,bound:graph({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal},scope.sessionId).binding};
  }
  function predecessors(value:Graph,nodeId:string){const result:Record<string,unknown>={};
    for(const dependency of getOwnedWorkflowTemplate(workflowId)!.nodes.find(node=>node.id===nodeId)!.dependencies){
      const id=dependency.nodeId;result[id]=id==='F01_N01'?value.input:id==='F01_N03'?chosen(value):operation(value,id,'workflow.host.'+id.toLowerCase(),!dependency.required)?.result??null;
    }return result;
  }
  function bridge(){return createWorkflowBusinessToolBridge({application:app(),resolveTool:request=>{
    const nodeId=request.actionKey==='f01.dispatch'?'F01_N06':request.actionKey==='f01.expand'?'F01_N07':undefined;
    return nodeId?{workflowId,nodeId,hostToolName:'workflow.host.'+nodeId.toLowerCase(),toolName:nodeId==='F01_N06'?'subagent.dispatch':'knowledge.search',toolVersion:'1.0.0',arguments:request.input}:undefined;
  },assertCurrent:scope=>current({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal},scope.sessionId)});}
  async function project(receipt:WorkflowBusinessToolReceipt,scope:Scope){
    const policy=ports.toolExports.find(item=>item.toolName===receipt.toolName&&item.toolVersion===receipt.toolVersion);
    if(!policy)fail('UNSUPPORTED_CAPABILITY','F01 original child export policy unavailable');
    const original=app().readHostToolTask(receipt.taskId),proposal={kind:'tool_proposal' as const,proposalId:original.commandId,
      toolName:receipt.toolName,toolVersion:receipt.toolVersion,arguments:receipt.arguments,verification:'unverified' as const};
    const check=(phase:'preflight'|'final',projection?:unknown)=>{current(scope);const read=app().readHostToolTask(receipt.taskId);
      if(read.task.state!=='succeeded'||read.confirmed?.runId!==receipt.runId||!isDeepStrictEqual(read.confirmed.result,receipt.result)
        ||policy.accepts({taskId:receipt.taskId,proposalId:proposal.proposalId,arguments:receipt.arguments,phase,projection,signal:scope.signal})!==true)
        fail('UNAUTHORIZED','F01 original child export revoked');};
    check('preflight');await ports.prepareCompetitionToolExport({phase:'projection',taskId:receipt.taskId,runId:receipt.runId,proposal,deadline:scope.deadline,signal:scope.signal});
    check('preflight');const result=await policy.project({taskId:receipt.taskId,proposalId:proposal.proposalId,result:structuredClone(receipt.result),signal:scope.signal});check('final',result);
    const parent=app().runtime.loadCheckpoint(receipt.taskId,'coding-repair:parent') as {taskId:string};
    app().runtime.saveCheckpointOnce(parent.taskId,'f01:business-projection',{taskId:receipt.taskId,runId:receipt.runId,policyVersion:policy.exportPolicyVersion,projection:structuredClone(result)});return result;
  }
  const tools=[...context.tools,...ports.lifecycle.tools],guardSchema=object({workflowId:{const:workflowId},nodeId:text,input:{type:'object'},predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}});
  for(const [nodeId,action] of [['F01_N07','expand'],['F01_N08','clarify'],['F01_N09','lifecycle']] as const)tools.push(createOwnedWorkflowAdapter({nodeId,kind:'guard',sideEffect:'read',requiredScopes:['memory:read'],inputSchema:guardSchema,outputSchema:empty,
    async execute(args,toolContext){const {bound}=host(nodeId,'guard',args,toolContext);return {state:chosen(bound).action===action?'selected':'skipped'};}}));
  for(const nodeId of ['F01_N04','F01_N05','F01_N06','F01_N07','F01_N08'])tools.push(createOwnedWorkflowAdapter({nodeId,kind:'host',sideEffect:nodeId==='F01_N06'?'local_write':'read',requiredScopes:['memory:read'],
    inputSchema:empty,outputSchema:{type:'object'},async execute(args,toolContext){
      const {scope,bound}=host(nodeId,'host',args,toolContext),selection=chosen(bound),input=bound.input as Input;
      const lifetime={taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal};
      if(nodeId==='F01_N04')return {state:'validated',candidateDigest:digest(selection),sourceTaskId:input.source.taskId};
      if(nodeId==='F01_N05'){
        operation(bound,'F01_N04');const original=graph(lifetime,scope.sessionId).selection;if(!original)fail('UNSUPPORTED_CAPABILITY','F01 selected model unavailable');
        return {state:'mapped',candidateDigest:digest(selection),selection:original,subtasks:selection.subtasks.map(item=>({...item,model:original.modelId,...(original.reasoningEffort?{reasoningEffort:original.reasoningEffort}:{})}))};
      }
      if(nodeId==='F01_N08'){if(selection.action!=='clarify')fail('UNAUTHORIZED','F01 clarification not selected');return ports.question.requestReply(scope,toolContext);}
      if(nodeId==='F01_N07'){
        if(selection.action!=='expand'||!input.expansionQuery)fail('UNAUTHORIZED','F01 expansion not selected');
        ports.assertExpansionCurrent(input.expansionQuery,undefined,lifetime);
        const receipt=await bridge().invoke({actionKey:'f01.expand',input:ports.resolveExpansionInput(input.expansionQuery,lifetime)},toolContext);
        const result=await project(receipt,lifetime);ports.assertExpansionCurrent(input.expansionQuery,result,lifetime);return result;
      }
      const mapped=operation(bound,'F01_N05')!.result as {subtasks:Record<string,unknown>[]};
      if(selection.action==='dispatch'){
        const receipt=await bridge().invoke({actionKey:'f01.dispatch',input:{subtasks:mapped.subtasks}},toolContext);
        await project(receipt,lifetime);const tasks=app().readSubagentTasks(receipt.taskId);
        if(tasks.length!==mapped.subtasks.length||tasks.some(task=>!['succeeded','failed','cancelled'].includes(task.state)))fail('RESULT_UNKNOWN','F01 original child graph has unsettled effects');
        return {state:tasks.every(task=>task.state==='succeeded')?'completed':'partial',dispatchTaskId:receipt.taskId,
          tasks:tasks.map(task=>({taskId:task.taskId,revision:app().runtime.getTask(task.taskId).revision,state:task.state})),dependencies:[],candidateDigest:digest(selection)};
      }
      if(selection.action==='clarify')operation(bound,'F01_N08');
      if(selection.action==='expand')operation(bound,'F01_N07');
      if(selection.action==='lifecycle')operation(bound,'F01_N09');
      return {state:selection.action==='lifecycle'?'lifecycle_recorded':selection.action==='defer'?'deferred':'awaiting_replan',candidateDigest:digest(selection)};
    }}));
  const worker:Worker={workflowId,toolName:'workflow.responsibility.manage',toolVersion:'1.0.0',configurationVersion:'f01-original-context-plan-v1',requestSchema,
    inputSchema:object({...requestSchema.properties,source:object({taskId:text,goal:text}),candidateContract:{type:'object'}}),resultSchema:{type:'object',additionalProperties:false,
      required:['state','candidateDigest'],properties:{state:{enum:['completed','partial','lifecycle_recorded','deferred','awaiting_replan']},candidateDigest:text,dispatchTaskId:text,tasks:{type:'array'},dependencies:{type:'array'}}},
    requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),{name:'decision.choose_candidate',version:'1.0.0'},
      {name:'knowledge.search',version:'1.0.0'}],publicEnumPaths:[],sideEffect:'local_write',assertCurrent:current,
    available:scope=>{try{current(scope);return true;}catch{return false;}},
    async resolveInput(args,scope){validateToolValue(requestSchema,args);current(scope);const parent=app().readDelegatedUserTaskParent(scope.taskId)!,source={taskId:parent.taskId,goal:app().runtime.getTask(parent.taskId).goal!};
      app().runtime.saveCheckpointOnce(scope.taskId,'f01:dispatcher',app().runtime.readToolDescriptors().find(tool=>tool.name==='subagent.dispatch'&&tool.version==='1.0.0'));
      app().runtime.saveCheckpointOnce(scope.taskId,'f01:source',source);return {...args,source,candidateContract:candidateSchema};},
    async assertFrontier(request){current(request,request.state.sessionId);app().runtime.saveCheckpointOnce(request.taskId,'f01:session',request.state.sessionId);
      const value=graph(request,request.state.sessionId).binding,proposal=request.proposal;
      if(proposal.toolName==='decision.choose_candidate'){
        let parsed;try{parsed=JSON.parse(String(proposal.arguments.context));}catch{return false;}
        if(!plain(parsed)||parsed.workflowId!==workflowId||parsed.nodeId!==proposal.nodeId||!isDeepStrictEqual(parsed.input,value.input)
          ||!isDeepStrictEqual(parsed.predecessors,predecessors(value,proposal.nodeId))||!Array.isArray(parsed.candidateValues)||!Array.isArray(proposal.arguments.candidates)
          ||!isDeepStrictEqual(parsed.candidateValues.map(item=>plain(item)?item.id:null),proposal.arguments.candidates.map(item=>plain(item)?item.id:null)))return false;
        for(const item of parsed.candidateValues){if(!plain(item)||item.branches!==undefined)return false;if(item.abstain===true)continue;
          if(proposal.nodeId==='F01_N03')candidate(item.value,value.input as Input);
          else if(!plain(item.value)||!isDeepStrictEqual(item.value.arguments,proposal.nodeId==='F01_N09'?(value.input as Input).lifecycle:{}))return false;}
      }else if(!tools.some(tool=>tool.descriptor.name===proposal.toolName&&tool.descriptor.name.endsWith('.'+proposal.nodeId.toLowerCase())))return false;
      if(proposal.toolName.startsWith('workflow.guard.')&&(proposal.arguments.workflowId!==workflowId||proposal.arguments.nodeId!==proposal.nodeId
        ||!isDeepStrictEqual(proposal.arguments.input,value.input)||!isDeepStrictEqual(proposal.arguments.predecessorOutputs,predecessors(value,proposal.nodeId))))return false;
      if(proposal.toolName.startsWith('workflow.host.')&&!isDeepStrictEqual(proposal.arguments,proposal.nodeId==='F01_N09'?(value.input as Input).lifecycle:{}))return false;
      return true;
    },
    async authorizeExport(request){current(request);const sessionId=app().runtime.loadCheckpoint(request.taskId,'f01:session') as string|undefined;
      if(request.stage==='receipt'){
        const proposal=request.proposal,read=request.localTaskId?app().readHostToolTask(request.localTaskId):undefined;
        if(!proposal||!read?.confirmed||read.task.state!=='succeeded'||read.commandId!==proposal.operationId||!plain(request.value)||!isDeepStrictEqual(read.confirmed.result,request.value.result))fail('UNAUTHORIZED','F01 original receipt unavailable');
        const original=app().runtime.loadCheckpoint(request.taskId,'owned-workflow:operation:'+proposal.operationId) as {taskId?:string;workflowId?:string;sessionId?:string;localTaskId?:string;proposal?:unknown}|undefined;
        const execution=app().runtime.readToolExecutions(read.task.taskId).find(record=>record.evidenceId===read.confirmed!.runId);
        if(original?.taskId!==request.taskId||original.workflowId!==workflowId||original.sessionId!==sessionId||original.localTaskId!==read.task.taskId
          ||!isDeepStrictEqual(original.proposal,proposal)||read.toolName!==proposal.toolName||read.toolVersion!==proposal.toolVersion
          ||execution?.state!=='confirmed'||!execution.executionStarted||execution.policyDecision!=='allow'
          ||!app().runtime.matchesToolExecutionInput(execution,{arguments:proposal.arguments,scopeRef:execution.evidenceId}))fail('UNAUTHORIZED','F01 receipt differs from original Policy execution');
        if(proposal.nodeId==='F01_N02'&&proposal.toolName==='workflow.host.f01_n02')app().runtime.saveCheckpointOnce(request.taskId,'f01:context-receipt',
          {nodeId:proposal.nodeId,operationId:proposal.operationId,toolName:proposal.toolName,toolVersion:proposal.toolVersion,localTaskId:read.task.taskId,result:read.confirmed.result,readback:read});
        if(['F01_N06','F01_N07'].includes(proposal.nodeId)&&proposal.toolName==='workflow.host.'+proposal.nodeId.toLowerCase())app().runtime.saveCheckpointOnce(request.taskId,'f01:receipt:'+proposal.nodeId,
          {nodeId:proposal.nodeId,operationId:proposal.operationId,toolName:proposal.toolName,toolVersion:proposal.toolVersion,localTaskId:read.task.taskId,result:read.confirmed.result,readback:read});
      }
      current(request,sessionId);const allowed=await ports.authorizeExport({...request,workflowId});current(request,sessionId);return allowed===true;
    },
    async verifyCompletion(request){current(request,request.state.sessionId);const value=graph(request,request.state.sessionId).binding;
      for(const nodeId of ['F01_N01','F01_N02','F01_N03','F01_N04','F01_N05','F01_N06'])if(request.state.result?.nodes[nodeId]?.state!=='completed')fail('UNAUTHORIZED','F01 required original node incomplete');
      const last=operation(value,'F01_N06')!,choice=chosen(value);if((last.result as {candidateDigest?:string}).candidateDigest!==digest(choice))fail('REVISION_CONFLICT','F01 original plan changed');
      return {result:last.result,resultSummary:'Original Runtime plan outcome; expansion and clarification require a new explicit plan'};
    }};
  // These optional fields remain optional in the source schema.
  worker.inputSchema={...worker.inputSchema,required:['context','source','candidateContract']};
  return {tools,configuredWorkflowWorkerPorts:[worker],authority:ports.lifecycle.authority,unavailable:null};
}
