import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions} from './configured-workflow-worker.js';
import {assertOwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import type {CompetitionToolExport,PrepareCompetitionToolExport} from './coordination.js';
import {createWorkflowBusinessToolBridge,readWorkflowBusinessToolSource,type WorkflowBusinessToolReceipt} from './workflow-business-tool-bridge.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;
type Scope=Parameters<Worker['assertCurrent']>[0];
export interface F27ContextWorkflowOptions {
  application:RuntimeApplication;
  getApplication?:()=>RuntimeApplication;
  readKnowledge?:(scope:Scope,queryIndex:number)=>{sourceId:string;configRevision:number;queryIndex:number;query:string};
  knowledgeToolExport?:CompetitionToolExport;
  prepareCompetitionToolExport?:PrepareCompetitionToolExport;
  readModels:(scope:Scope)=>{revision:string;models:Record<string,unknown>[]};
  authorizeExport:(request:Parameters<Worker['authorizeExport']>[0]&{workflowId:'F27'})=>Promise<boolean>;
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:2048};
const key='f27:original-context';
const hostIds=['F27_N01','F27_N05','F27_N03','F27_N06','F27_N04','F27_N07'];
function fail(code:string,message:string):never{throw new ProtocolError(code,message);}

/** Consume the actual original compiler/ModelGateway mapping. This graph cannot
 * ask a second model to replace an instruction, grant or original source. */
export function createF27ContextWorkflowPorts(options?:F27ContextWorkflowOptions):{
  tools:RegisteredTool[];configuredWorkflowWorkerPorts:Worker[];unavailable:string|null;
} {
  if(!options?.application||typeof options.readModels!=='function'||typeof options.authorizeExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f27_original_compiler_ports_unavailable'};
  const app=options.application;
  function read(scope:Scope,queryIndex?:number){
    const original=app.readF27ContextBinding(scope),models=options!.readModels(scope);
    if(!models?.revision||models.models.length!==1||models.models[0]?.id!==original.selection.modelId
      ||models.models[0]?.verification!=='conditional')fail('UNAUTHORIZED','Original F27 model declarations unavailable');
    const knowledge=queryIndex===undefined?undefined:options!.readKnowledge?.(scope,queryIndex);
    if(queryIndex!==undefined&&(!knowledge||options!.knowledgeToolExport?.toolName!=='knowledge.search'
      ||options!.knowledgeToolExport.toolVersion!=='1.0.0'||!options!.prepareCompetitionToolExport))
      fail('UNSUPPORTED_CAPABILITY','Original F27 public knowledge source/export is unavailable');
    return {context:original.binding,models,selection:original.selection,destination:original.destination,...(knowledge?{knowledge}:{})};
  }
  function current(scope:Scope){
    const saved=app.runtime.loadCheckpoint(scope.taskId,key) as ReturnType<typeof read>|undefined;
    const observed=read(scope,saved?.knowledge?.queryIndex);
    if(saved!==undefined&&!isDeepStrictEqual(saved,observed))fail('REVISION_CONFLICT','Original F27 compiler, source or model changed');
    return observed;
  }
  const branches=(value:ReturnType<typeof read>)=>[{nodeId:'F27_N03',state:value.context.compactionReceiptDigest?'selected':'skipped'},
    {nodeId:'F27_N06',state:value.knowledge?'selected':'skipped'},{nodeId:'F27_N04',state:'selected'}];
  const decision=(value:ReturnType<typeof read>)=>({contextMode:'existing_compiler',
    summary:value.context.compactionReceiptDigest?'original_model_gateway_receipt':'not_required',expansion:value.knowledge?'original_public_knowledge':'not_requested'});
  const input=(value:ReturnType<typeof read>)=>({contextDigest:hash(value.context),sourceMapDigest:hash(value.context.sourceMap),
    modelRevision:value.models.revision,decisionOutput:decision(value),branches:branches(value)});
  function expansion(scope:Scope){
    if(!current(scope).knowledge)return {state:'not_requested'};
    const saved=app.runtime.loadCheckpoint(scope.taskId,'f27:knowledge') as
      {sessionId:string;receipt:WorkflowBusinessToolReceipt;projection:unknown;policyVersion:string}|undefined;
    if(!saved)fail('RESULT_UNKNOWN','Original F27 knowledge read is not confirmed');
    const proof=readWorkflowBusinessToolSource(app,{parentTaskId:scope.taskId,sessionId:saved.sessionId,deadline:scope.deadline},saved.receipt,'knowledge.search');
    const policy=options!.knowledgeToolExport!,readback=app.readHostToolTask(saved.receipt.taskId);
    if(proof.actionKey!=='f27.knowledge.search'||proof.graph.nodeId!=='F27_N06'||saved.policyVersion!==policy.exportPolicyVersion
      ||policy.accepts({taskId:saved.receipt.taskId,proposalId:readback.commandId,arguments:saved.receipt.arguments,
        phase:'final',projection:saved.projection,signal:scope.signal})!==true)fail('UNAUTHORIZED','Original F27 knowledge export changed');
    return {state:'confirmed',taskId:saved.receipt.taskId,runId:saved.receipt.runId,evidenceRefs:saved.receipt.evidenceRefs,
      projection:structuredClone(saved.projection)};
  }
  const result=(scope:Scope,value:ReturnType<typeof read>)=>({state:'current',contextVersion:hash(value.context),sourceMapDigest:hash(value.context.sourceMap),
    modelRevision:value.models.revision,modelVerification:'conditional',sourceCoverage:'original_compiled_context',
    sourceCount:value.context.sourceMap!.sources.length,selectedCount:value.context.sourceMap!.selected.length,
    budget:value.context.budget,compaction:value.context.compactionReceiptDigest?'original_model_gateway_receipt':'not_required',
    instructionBindingPreserved:true,authorizationReplaced:false,capabilityVerification:'unverified',knowledgeExpansion:expansion(scope)});
  function hostValue(nodeId:string,value:ReturnType<typeof read>,scope:Scope){
    if(nodeId==='F27_N01')return value.models;
    if(nodeId==='F27_N05')return {sourceMap:value.context.sourceMap,selection:value.context.selection,
      sourceCoverage:'original_compiled_context',privateContextIncluded:value.context.privateBindingDigest!==undefined};
    if(nodeId==='F27_N03'){
      if(!value.context.compactionReceiptDigest)fail('UNAUTHORIZED','Original model summary is not present');
      return {state:'original_compiler_consumed',receiptDigest:value.context.compactionReceiptDigest,sourceMapDigest:hash(value.context.sourceMap)};
    }
    if(nodeId==='F27_N06')return expansion(scope);
    return result(scope,value);
  }
  const resultSchema=object({state:{const:'current'},contextVersion:text,sourceMapDigest:text,modelRevision:text,modelVerification:{const:'conditional'},
    sourceCoverage:{const:'original_compiled_context'},sourceCount:{type:'integer',minimum:0},selectedCount:{type:'integer',minimum:0},budget:{type:'object'},
    compaction:{enum:['original_model_gateway_receipt','not_required']},instructionBindingPreserved:{const:true},authorizationReplaced:{const:false},capabilityVerification:{const:'unverified'},knowledgeExpansion:{type:'object'}});
  function host(context:ToolContext,nodeId:string){
    const scope=assertOwnedWorkflowHostScope({runtime:app.runtime,context,workflowId:'F27',nodeId,hostToolName:'workflow.host.'+nodeId.toLowerCase(),
      proposalArguments:{},hostArguments:{}}),owner={taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal};
    const value=current(owner),binding=app.readConfiguredWorkflowBinding({taskId:owner.taskId,workflowId:'F27',sessionId:scope.sessionId,signal:scope.signal});
    const record=app.runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId),grant=app.runtime.policy.get(context.authorizationRef);
    if(!binding||binding.deadline!==scope.deadline||!isDeepStrictEqual(binding.input,input(value))||context.authorizationRef!==context.runId
      ||!record||record.policyDecision!=='allow'||!record.executionStarted||record.state!=='started'||!app.runtime.isToolExecutionActive(record)
      ||record.toolName!=='workflow.host.'+nodeId.toLowerCase()||record.toolVersion!=='1.0.0'
      ||!app.runtime.matchesToolExecutionInput(record,{arguments:{},scopeRef:context.runId})||!grant||grant.taskId!==context.taskId
      ||grant.toolName!==record.toolName||grant.argumentsDigest!==toolArgumentsDigest({})||Date.parse(grant.expiresAt)<=Date.now())
      fail('UNAUTHORIZED','Original F27 host execution unavailable');
    return {owner,value,scope};
  }
  let bridge:ReturnType<typeof createWorkflowBusinessToolBridge>|undefined;
  async function retrieve(context:ToolContext){
    const {owner,value,scope}=host(context,'F27_N06');if(!value.knowledge)fail('UNSUPPORTED_CAPABILITY','Original knowledge query unavailable');
    bridge??=createWorkflowBusinessToolBridge({application:options!.getApplication?.()??app,
      assertCurrent:scope=>{current({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal});},
      resolveTool:(request,scope)=>{const source=current({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal}).knowledge;
        return request.actionKey==='f27.knowledge.search'&&isDeepStrictEqual(request.input,{})&&source?{
          workflowId:'F27',nodeId:'F27_N06',hostToolName:'workflow.host.f27_n06',toolName:'knowledge.search',toolVersion:'1.0.0',
          arguments:{query:source.query,limit:5}}:undefined;}});
    const receipt=await bridge.invoke({actionKey:'f27.knowledge.search',input:{}},context),policy=options!.knowledgeToolExport!;
    const proposal={kind:'tool_proposal' as const,proposalId:app.readHostToolTask(receipt.taskId).commandId,toolName:receipt.toolName,
      toolVersion:receipt.toolVersion,arguments:receipt.arguments,verification:'unverified' as const};
    const check=(phase:'preflight'|'final',projection?:unknown)=>{
      host(context,'F27_N06');readWorkflowBusinessToolSource(app,scope,receipt,'knowledge.search');
      if(policy.accepts({taskId:receipt.taskId,proposalId:proposal.proposalId,arguments:receipt.arguments,phase,projection,signal:owner.signal})!==true)
        fail('UNAUTHORIZED','Original knowledge content export denied');
    };
    check('preflight');await options!.prepareCompetitionToolExport!({phase:'projection',taskId:receipt.taskId,runId:receipt.runId,proposal,deadline:owner.deadline,signal:owner.signal});
    check('preflight');const projection=await policy.project({taskId:receipt.taskId,proposalId:proposal.proposalId,result:structuredClone(receipt.result),signal:owner.signal});
    check('final',projection);const saved={sessionId:scope.sessionId,receipt,projection,policyVersion:policy.exportPolicyVersion};
    const previous=app.runtime.loadCheckpoint(owner.taskId,'f27:knowledge');
    if(previous!==undefined&&!isDeepStrictEqual(previous,saved)||previous===undefined&&!app.runtime.saveCheckpointOnce(owner.taskId,'f27:knowledge',saved))
      fail('REVISION_CONFLICT','Original F27 knowledge result changed');
    return expansion(owner);
  }
  const tools=hostIds.map(nodeId=>createOwnedWorkflowAdapter({nodeId,kind:'host',sideEffect:nodeId==='F27_N07'?'local_write':'read',
    requiredScopes:['workflow:context'],inputSchema:object({}),outputSchema:['F27_N04','F27_N07'].includes(nodeId)?resultSchema:{type:'object'},
    async execute(_args,context){
      if(nodeId==='F27_N06')return retrieve(context);
      const {owner,value}=host(context,nodeId),output=hostValue(nodeId,value,owner);
      if(nodeId==='F27_N07'){
        const marker={version:1,contextDigest:hash(value.context),modelRevision:value.models.revision,sourceMapDigest:hash(value.context.sourceMap)};
        const saved=app.runtime.loadCheckpoint(owner.taskId,'f27:validated-mapping');
        if(saved!==undefined&&!isDeepStrictEqual(saved,marker)||saved===undefined&&!app.runtime.saveCheckpointOnce(owner.taskId,'f27:validated-mapping',marker))
          fail('REVISION_CONFLICT','Original F27 mapping checkpoint changed');
      }
      return output;
    }}));
  function exportCurrent(request:Parameters<Worker['authorizeExport']>[0]){
    const value=current(request);
    if(request.stage==='initial'&&!isDeepStrictEqual(request.value,input(value)))fail('UNAUTHORIZED','F27 initial input changed');
    if(request.stage==='completion'&&!isDeepStrictEqual(request.value,result(request,value)))fail('REVISION_CONFLICT','F27 mapping changed before completion');
    if(request.stage==='receipt'){
      const p=request.proposal,readback=request.localTaskId&&app.readHostToolTask(request.localTaskId);
      if(!p||!readback||readback.commandId!==p.operationId||readback.toolName!==p.toolName||!readback.confirmed
        ||!isDeepStrictEqual((request.value as {result?:unknown}).result,readback.confirmed.result))fail('UNAUTHORIZED','F27 original receipt changed');
      if(p.toolName!=='decision.choose_candidate'&&!isDeepStrictEqual(readback.confirmed.result,hostValue(p.nodeId,value,request)))
        fail('REVISION_CONFLICT','F27 source/model changed before receipt export');
    }
  }
  const worker:Worker={workflowId:'F27',toolName:'workflow.f27.prepare_context',toolVersion:'1.0.0',configurationVersion:'f27-original-compiler-v2',
    requestSchema:{type:'object',additionalProperties:false,properties:{knowledgeQueryIndex:{type:'integer',minimum:0,maximum:15}}},
    inputSchema:object({contextDigest:text,sourceMapDigest:text,modelRevision:text,decisionOutput:{type:'object'},branches:{type:'array'}}),
    resultSchema,publicEnumPaths:[],sideEffect:'local_write',requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),
      {name:'decision.choose_candidate',version:'1.0.0'}],
    available(scope){try{current(scope);return true;}catch{return false;}},assertCurrent(scope){current(scope);},
    async resolveInput(args,scope){const value=read(scope,(args as {knowledgeQueryIndex?:number}).knowledgeQueryIndex),saved=app.runtime.loadCheckpoint(scope.taskId,key);
      if(saved!==undefined&&!isDeepStrictEqual(saved,value))fail('REVISION_CONFLICT','Original F27 request changed');
      if(saved===undefined&&!app.runtime.saveCheckpointOnce(scope.taskId,key,value))fail('REVISION_CONFLICT','F27 mapping concurrently changed');return input(current(scope));},
    assertFrontier(request){
      const value=current(request),p=request.proposal,expected=input(value);
      if(!isDeepStrictEqual(request.input,expected)||p.toolVersion!=='1.0.0')return false;
      if(p.toolName!=='decision.choose_candidate')return hostIds.includes(p.nodeId)&&p.toolName==='workflow.host.'+p.nodeId.toLowerCase()&&isDeepStrictEqual(p.arguments,{});
      let context:{workflowId:string;nodeId:string;input:unknown;candidateValues:{value:unknown;branches?:unknown;abstain?:boolean}[]};
      try{context=JSON.parse(p.arguments.context as string);}catch{return false;}
      return context.workflowId==='F27'&&context.nodeId===p.nodeId&&isDeepStrictEqual(context.input,expected)&&!!context.candidateValues?.length
        &&context.candidateValues.every(candidate=>candidate.abstain===true||(p.nodeId==='F27_N02'
          ?isDeepStrictEqual(candidate.value,decision(value))&&isDeepStrictEqual(candidate.branches,branches(value))
          :hostIds.includes(p.nodeId)&&isDeepStrictEqual(candidate.value,{arguments:{}})&&candidate.branches===undefined));
    },
    async authorizeExport(request){exportCurrent(request);const allowed=await options.authorizeExport({...request,workflowId:'F27'});exportCurrent(request);return allowed===true;},
    async verifyCompletion(request){
      const value=current(request);
      for(const nodeId of [...hostIds.filter(id=>!branches(value).some(branch=>branch.nodeId===id&&branch.state==='skipped')),'F27_N02']){
        const toolName=nodeId==='F27_N02'?'decision.choose_candidate':'workflow.host.'+nodeId.toLowerCase();
        const op=Object.values(request.state.confirmedOperations??{}).find(item=>item.nodeId===nodeId&&item.toolName===toolName);
        if(!op||!request.readbacks.some(read=>read.task.taskId===op.localTaskId&&read.task.state==='succeeded'
          &&read.confirmed?.evidenceRefs.includes(read.confirmed.runId)&&isDeepStrictEqual(read.confirmed.result,op.result))
          ||nodeId!=='F27_N02'&&!isDeepStrictEqual(op.result,hostValue(nodeId,value,request)))fail('UNAUTHORIZED','F27 original node receipt unavailable');
      }
      if(!isDeepStrictEqual(app.runtime.loadCheckpoint(request.taskId,'f27:validated-mapping'),{version:1,contextDigest:hash(value.context),
        modelRevision:value.models.revision,sourceMapDigest:hash(value.context.sourceMap)}))fail('REVISION_CONFLICT','F27 mapping version checkpoint changed');
      return {result:result(request,value),resultSummary:'Original compiled context mapping retained; model declarations remain conditional, no capability probe claimed'};
    }};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:null};
}
