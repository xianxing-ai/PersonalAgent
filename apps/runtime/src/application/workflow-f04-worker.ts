import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {KnowledgeSource} from '@personal-agent/knowledge';
import type {KnowledgeWriteReceipt} from '@personal-agent/knowledge/write';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions,RuntimeConfiguredWorkflowBinding} from './configured-workflow-worker.js';
import type {CompetitionToolExport,PrepareCompetitionToolExport} from './coordination.js';
import {createWorkflowBusinessToolBridge,readWorkflowBusinessToolSource} from './workflow-business-tool-bridge.js';
import type {WorkflowBusinessToolReceipt,WorkflowBusinessToolSourceReference} from './workflow-business-tool-bridge.js';
import {assertOwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {f04RequestSchema,f04CandidateSchema,parseF04Candidate,assertF04Lifetime,assertF04FactSource} from './workflow-f04-candidate.js';
import type {F04Input,F04Recall,F04Scope,F04SourceConfiguration} from './workflow-f04-candidate.js';
import {applyF04Projection,readF04ProjectedFact,readF04Projection} from './workflow-f04-projection.js';
import type {F04FactPort,F04ProjectionIntent} from './workflow-f04-projection.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;
type Graph=RuntimeConfiguredWorkflowBinding;
type Scope=F04Scope;
const workflowId='F04',configKey='f04:source-configuration:v1',sessionKey='f04:session-id';
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text={type:'string',minLength:1,maxLength:2048};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const empty=object({});
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
type SourceReceipt={sessionId:string;hostTaskId:string;reference:WorkflowBusinessToolSourceReference};
export interface F04RecoveryPort {
  readAvailable(scope:F04Scope):boolean;
  reconcileOriginalReadback(scope:F04Scope):Promise<{state:'unknown'|'confirmed';localTaskId:string}>;
}

export interface F04WorkflowOptions {
  getApplication:()=>RuntimeApplication;
  sourceConfiguration:()=>F04SourceConfiguration|undefined;
  facts:F04FactPort;
  readCitation:(input:{source:KnowledgeSource;configuration:F04SourceConfiguration},scope:Scope)=>Promise<string>;
  assertCitationCurrent:(input:{source:KnowledgeSource;configuration:F04SourceConfiguration},scope:Scope)=>void;
  clearIndex:(configuration:F04SourceConfiguration,scope:Scope)=>void;
  knowledgeToolExports:readonly CompetitionToolExport[];
  prepareCompetitionToolExport:PrepareCompetitionToolExport;
  authorizeExport:(request:Parameters<Worker['authorizeExport']>[0]&{workflowId:'F04'})=>Promise<boolean>;
}

/** The existing graph and tools retain authority. No second Memory or knowledge writer. */
export function createF04WorkflowWorkerPorts(options?:F04WorkflowOptions):{
  tools:RegisteredTool[];configuredWorkflowWorkerPorts:Worker[];unavailable:string|null;recovery?:F04RecoveryPort;
} {
  if(typeof options?.getApplication!=='function'||typeof options.sourceConfiguration!=='function'||typeof options.facts?.publicMemory?.listHistory!=='function'
    ||typeof options.facts.readCurrentPublicFact!=='function'||typeof options.facts.recordPublicSource!=='function'
    ||typeof options.readCitation!=='function'||typeof options.assertCitationCurrent!=='function'||typeof options.clearIndex!=='function'
    ||typeof options.authorizeExport!=='function'||typeof options.prepareCompetitionToolExport!=='function'
    ||!['knowledge.search','knowledge.apply_note_patch'].every(name=>options.knowledgeToolExports?.some(policy=>policy.toolName===name
      &&policy.toolVersion==='1.0.0'&&typeof policy.accepts==='function'&&typeof policy.project==='function')))
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f04_original_public_source_ports_unavailable'};
  const ports=options,checking=new Set<string>();
  const app=()=>ports.getApplication();
  function base(scope:Scope){
    assertF04Lifetime(scope);const parent=app().readDelegatedUserTaskParent(scope.taskId),task=app().runtime.getTask(scope.taskId);
    if(!parent||parent.deadline!==scope.deadline||task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state)
      ||app().runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline)fail('UNAUTHORIZED','F04 original user task changed');
    const configuration=ports.sourceConfiguration(),saved=app().runtime.loadCheckpoint(scope.taskId,configKey);
    if(!configuration||!configuration.sourceId||!configuration.memoryNamespace||!configuration.publicQueries.length
      ||!configuration.allowedNotePaths.length||saved!==undefined&&!isDeepStrictEqual(configuration,saved))
      fail('REVISION_CONFLICT','F04 original public scope changed');return configuration;
  }
  function graph(scope:Scope,sessionId:string):Graph {
    const value=app().readConfiguredWorkflowBinding({taskId:scope.taskId,workflowId,sessionId,signal:scope.signal});
    if(!value||value.deadline!==scope.deadline)fail('UNAUTHORIZED','Original F04 graph binding unavailable');return value;
  }
  function input(value:Graph):F04Input {
    const result=value.input as F04Input;
    if(!isDeepStrictEqual(result.configuration,ports.sourceConfiguration())||!isDeepStrictEqual(result.candidateContract,f04CandidateSchema))
      fail('REVISION_CONFLICT','Original F04 input changed');return result;
  }
  function operation(value:Graph,nodeId:string,toolName='workflow.host.'+nodeId.toLowerCase(),optional=false){
    const found=value.confirmedOperations.filter(record=>record.nodeId===nodeId&&record.toolName===toolName);
    if(found.length!==1){if(optional&&!found.length)return;fail('UNAUTHORIZED','F04 requires one original node receipt');}return found[0]!;
  }
  function selection(value:Graph){
    const original=operation(value,'F04_N02','decision.choose_candidate')!,intent=app().runtime.loadCheckpoint(original.localTaskId,'host-tool-intent') as {arguments?:Record<string,unknown>};
    let context;try{context=JSON.parse(String(intent?.arguments?.context));}catch{fail('UNAUTHORIZED','F04 original decision context unavailable');}
    if(context?.workflowId!==workflowId||context.nodeId!=='F04_N02'||!isDeepStrictEqual(context.input,value.input)
      ||!Array.isArray(context.candidateValues)||!plain(original.result))fail('UNAUTHORIZED','F04 original decision changed');
    const selectedId=original.result.selectedId;
    const selected=context.candidateValues.filter((item:Record<string,unknown>)=>item.id===selectedId);
    if(selected.length!==1||selected[0].abstain===true)fail('UNSUPPORTED_CAPABILITY','F04 decision retained uncertainty');
    return parseF04Candidate(selected[0].value,input(value));
  }
  function sourceProof(scope:Scope,nodeId:string){
    const saved=app().runtime.loadCheckpoint(scope.taskId,'f04:source:'+nodeId) as SourceReceipt|undefined;
    if(!saved||saved.sessionId!==app().runtime.loadCheckpoint(scope.taskId,sessionKey))fail('UNAUTHORIZED','F04 original source receipt unavailable');
    const toolName=nodeId==='F04_N05'?'knowledge.search':'knowledge.apply_note_patch';
    const proof=readWorkflowBusinessToolSource(app(),{parentTaskId:scope.taskId,sessionId:saved.sessionId,deadline:scope.deadline},saved.reference,toolName);
    if(proof.graph.workflowId!==workflowId||proof.graph.nodeId!==nodeId||proof.sourceHost.taskId!==saved.hostTaskId)
      fail('UNAUTHORIZED','F04 source child belongs to another original node');return proof;
  }
  function recall(value:Graph,scope:Scope):F04Recall {
    const record=operation(value,'F04_N05')!,result=record.result as F04Recall,request=input(value),proof=sourceProof(scope,'F04_N05');
    assertF04FactSource(result,request);
    const projection=readProjection(proof,scope) as {hits:{source:KnowledgeSource;excerpt:string}[]};
    if(proof.sourceHost.taskId!==record.localTaskId||!isDeepStrictEqual(result,app().runtime.loadCheckpoint(scope.taskId,'f04:recall'))
      ||!isDeepStrictEqual(proof.request.arguments,{sourceId:request.configuration.sourceId,configRevision:request.configuration.configRevision,query:request.query,limit:5})
      ||projection.hits.filter(hit=>isDeepStrictEqual(hit.source,result.source)&&hit.excerpt===result.excerpt).length!==1)
      fail('UNAUTHORIZED','F04 recall differs from its original public projection');return result;
  }
  function write(scope:Scope,original:F04Recall):KnowledgeWriteReceipt|undefined {
    if(app().runtime.loadCheckpoint(scope.taskId,'f04:source:F04_N03')===undefined)return;
    const proof=sourceProof(scope,'F04_N03'),result=proof.receipt.result as KnowledgeWriteReceipt;
    const request=input(graph(scope,String(app().runtime.loadCheckpoint(scope.taskId,sessionKey))));
    if(!isDeepStrictEqual(proof.request.arguments,{sourceId:request.configuration.sourceId,configRevision:request.configuration.configRevision,
      path:original.source.path,expectedSha256:original.source.revision,edits:[{oldText:original.excerpt,newText:request.updateText}]})
      ||result.state!=='verified'||result.beforeSha256!==original.source.revision||result.path!==original.source.path
      ||result.sourceId!==original.source.vaultId||result.configRevision!==base(scope).configRevision||!result.afterSha256)
      fail('REVISION_CONFLICT','F04 original note write did not confirm its bound source');return result;
  }
  function current(scope:Scope):void {
    const configuration=base(scope),sessionId=app().runtime.loadCheckpoint(scope.taskId,sessionKey);
    if(typeof sessionId!=='string'||checking.has(scope.taskId))return;
    checking.add(scope.taskId);
    try{
      let value=graph(scope,sessionId);
      const pending=app().runtime.loadCheckpoint(scope.taskId,'f04:last-export-operation');
      if(typeof pending==='string'){
        const original=app().runtime.loadCheckpoint(scope.taskId,'owned-workflow:operation:'+pending) as
          {proposal?:Parameters<Worker['authorizeExport']>[0]['proposal'];localTaskId?:string}|undefined;
        if(!original?.proposal||!original.localTaskId)fail('UNAUTHORIZED','F04 original pending export unavailable');
        value=exportBinding({...scope,proposal:original.proposal,localTaskId:original.localTaskId,
          value:{result:app().readHostToolTask(original.localTaskId).confirmed?.result}});
      }
      if(!operation(value,'F04_N05',undefined,true))return;
      const captured=recall(value,scope);
      const written=write(scope,captured),source=written?{...captured.source,revision:written.afterSha256}:captured.source;
      const checked=ports.assertCitationCurrent({source,configuration},scope);
      if(checked!==undefined){void Promise.resolve(checked).catch(()=>{});fail('UNAUTHORIZED','F04 source guard must be synchronous');}
      const intent=projectionIntent(scope,value,captured,written);
      if(!isDeepStrictEqual(ports.facts.readCurrentPublicFact(captured.fact.ref),captured.fact)
        &&(!intent||!readF04ProjectedFact(ports.facts,intent)))fail('REVISION_CONFLICT','F04 original Fact changed');
    }finally{checking.delete(scope.taskId);}
  }
  function projectionIntent(scope:Scope,value:Graph,captured:F04Recall,written=write(scope,captured)){
    const intent=app().runtime.loadCheckpoint(scope.taskId,'f04:projection-intent') as F04ProjectionIntent|undefined;if(!intent)return;
    if(!written?.changed)fail('UNAUTHORIZED','F04 projection lacks its original changed source');
    const proof=sourceProof(scope,'F04_N03'),expected={version:1,source:{...captured.source,revision:written.afterSha256},before:captured.fact,
      summary:input(value).updateText,observedAt:intent.observedAt,sourceTaskId:proof.receipt.taskId,sourceRunId:proof.receipt.runId,sourceOperationId:written.operationId};
    if(!Number.isFinite(Date.parse(intent.observedAt))||!isDeepStrictEqual(intent,expected))fail('UNAUTHORIZED','F04 original projection intent changed');return intent;
  }
  function readProjection(proof:ReturnType<typeof sourceProof>,scope:Scope):unknown {
    const policy=ports.knowledgeToolExports.find(item=>item.toolName===proof.receipt.toolName)!,saved=app().runtime.loadCheckpoint(proof.receipt.taskId,'f04:source-projection') as
      {policyVersion?:string;projection?:unknown;resultDigest?:string}|undefined;
    if(!saved||saved.policyVersion!==policy.exportPolicyVersion||saved.resultDigest!==toolArgumentsDigest(proof.receipt.result)
      ||policy.accepts({taskId:proof.receipt.taskId,proposalId:proof.request.commandId,arguments:structuredClone(proof.request.arguments),
        phase:'final',projection:structuredClone(saved.projection),signal:scope.signal})!==true)fail('UNAUTHORIZED','F04 original source projection was revoked');return saved.projection;
  }
  let application:RuntimeApplication|undefined,bridge:ReturnType<typeof createWorkflowBusinessToolBridge>|undefined;
  function business(){
    if(application!==app()){application=app();bridge=createWorkflowBusinessToolBridge({application,
      resolveTool:request=>['F04_N05','F04_N03'].includes(request.actionKey)?{workflowId,nodeId:request.actionKey,
        hostToolName:'workflow.host.'+request.actionKey.toLowerCase(),toolName:request.actionKey==='F04_N05'?'knowledge.search':'knowledge.apply_note_patch',
        toolVersion:'1.0.0',arguments:request.input}:undefined,
      // The original write's expected hash remains enforced by its existing writer.
      // Source validation switches only after that original child has confirmed.
      assertCurrent:scope=>{base({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal});}});}return bridge!;
  }
  function host(nodeId:string,kind:'host'|'guard',args:unknown,context:ToolContext){
    const owned=assertOwnedWorkflowHostScope({runtime:app().runtime,context,workflowId,nodeId,
      hostToolName:'workflow.'+kind+'.'+nodeId.toLowerCase(),proposalArguments:args,
      assertCurrent:scope=>current({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal})});
    const scope={taskId:owned.parentTaskId,deadline:owned.deadline,signal:owned.signal};
    const saved=app().runtime.loadCheckpoint(scope.taskId,sessionKey);
    if(saved!==undefined&&saved!==owned.sessionId)fail('REVISION_CONFLICT','F04 original session changed');
    app().runtime.saveCheckpoint(scope.taskId,sessionKey,owned.sessionId);
    return {owned,scope,binding:graph(scope,owned.sessionId)};
  }
  async function invoke(nodeId:string,args:Record<string,unknown>,context:ToolContext,scope:Scope,sessionId:string){
    const receipt=await business().invoke({actionKey:nodeId,input:args},context);
    app().runtime.saveCheckpointOnce(scope.taskId,'f04:source:'+nodeId,{sessionId,hostTaskId:context.taskId,
      reference:{taskId:receipt.taskId,runId:receipt.runId,scopeRef:receipt.scopeRef,toolVersion:receipt.toolVersion,arguments:receipt.arguments}});
    return receipt;
  }
  async function project(receipt:WorkflowBusinessToolReceipt,scope:Scope):Promise<unknown>{
    const policy=ports.knowledgeToolExports.find(item=>item.toolName===receipt.toolName)!,read=app().readHostToolTask(receipt.taskId);
    const proposal={kind:'tool_proposal' as const,proposalId:read.commandId,toolName:receipt.toolName,toolVersion:receipt.toolVersion,
      arguments:structuredClone(receipt.arguments),verification:'unverified' as const};
    const check=(phase:'preflight'|'final',projection?:unknown)=>{
      current(scope);const original=app().readHostToolTask(receipt.taskId);
      if(original.task.state!=='succeeded'||original.confirmed?.runId!==receipt.runId||!isDeepStrictEqual(original.confirmed.result,receipt.result)
        ||policy.accepts({taskId:receipt.taskId,proposalId:proposal.proposalId,arguments:structuredClone(receipt.arguments),phase,projection,signal:scope.signal})!==true)
        fail('UNAUTHORIZED','F04 original tool result export was revoked');
    };
    check('preflight');await ports.prepareCompetitionToolExport({phase:'projection',taskId:receipt.taskId,runId:receipt.runId,proposal,deadline:scope.deadline,signal:scope.signal});
    check('preflight');const projection=await policy.project({taskId:receipt.taskId,proposalId:proposal.proposalId,result:structuredClone(receipt.result),signal:scope.signal});
    check('final',projection);app().runtime.saveCheckpointOnce(receipt.taskId,'f04:source-projection',
      {policyVersion:policy.exportPolicyVersion,resultDigest:toolArgumentsDigest(receipt.result),projection:structuredClone(projection)});return projection;
  }
  const tools:RegisteredTool[]=[];
  const guardSchema=object({workflowId:{const:workflowId},nodeId:text,input:{type:'object'},predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}});
  for(const nodeId of ['F04_N03','F04_N07'])tools.push(createOwnedWorkflowAdapter({nodeId,kind:'guard',sideEffect:'read',requiredScopes:['knowledge:read','memory:read'],
    inputSchema:guardSchema,outputSchema:empty,execute:async(args,context)=>{
      const {binding}=host(nodeId,'guard',args,context),candidate=selection(binding);
      operation(binding,'F04_N06');return {state:(nodeId==='F04_N03')===(candidate.disposition==='compatible')?'selected':'skipped'};
    }}));
  for(const nodeId of ['F04_N05','F04_N06','F04_N03','F04_N07','F04_N04'])tools.push(createOwnedWorkflowAdapter({nodeId,kind:'host',
    sideEffect:['F04_N03','F04_N07','F04_N04'].includes(nodeId)?'local_write':'read',requiredScopes:['knowledge:read','memory:read',
      ...(['F04_N07','F04_N04'].includes(nodeId)?['memory:write']:[])],inputSchema:empty,outputSchema:{type:'object'},execute:async(args,context)=>{
      const {owned,scope,binding}=host(nodeId,'host',args,context),request=input(binding);
      if(nodeId==='F04_N05'){
        const page=await ports.facts.publicMemory.listCurrent({factId:request.factId,at:new Date().toISOString(),limit:1,deadline:scope.deadline,signal:scope.signal});base(scope);
        if(page.facts.length!==1)fail('UNSUPPORTED_CAPABILITY','F04 original source-owned Fact unavailable');
        const fact=page.facts[0]!,receipt=await invoke(nodeId,{sourceId:request.configuration.sourceId,configRevision:request.configuration.configRevision,
          query:request.query,limit:5},context,scope,owned.sessionId),projection=await project(receipt,scope) as {hits:{source:KnowledgeSource;excerpt:string}[]};
        const matches=projection.hits.filter(hit=>fact.sourceRef===`${hit.source.vaultId}/${hit.source.path}#L${hit.source.line}@${hit.source.revision}`);
        if(matches.length!==1)fail('UNSUPPORTED_CAPABILITY','F04 requires one original projected source for its Fact');
        const history=await ports.facts.publicMemory.listHistory({factId:request.factId,limit:5,deadline:scope.deadline,signal:scope.signal});base(scope);
        const result={fact,history:history.facts,source:matches[0]!.source,excerpt:matches[0]!.excerpt};assertF04FactSource(result,request);
        if(!isDeepStrictEqual(ports.facts.readCurrentPublicFact(fact.ref),fact))fail('REVISION_CONFLICT','F04 Fact changed during recall');
        app().runtime.saveCheckpointOnce(scope.taskId,'f04:recall',result);return result;
      }
      const captured=recall(binding,scope),candidate=selection(binding);current(scope);
      if(nodeId==='F04_N06'){
        const line=await ports.readCitation({source:captured.source,configuration:request.configuration},scope);current(scope);
        if(!line.includes(captured.excerpt)||candidate.disposition==='compatible'&&(!request.configuration.writeAvailable||line!==captured.excerpt))
          fail('UNSUPPORTED_CAPABILITY','F04 original full line or published write capability unavailable');
        if(ports.facts.readPublicSourceHead({vaultId:captured.source.vaultId,path:captured.source.path,factId:captured.fact.ref.id})!==captured.fact.ref.revision)
          fail('REVISION_CONFLICT','F04 source ownership changed');return {disposition:candidate.disposition,sourceCurrent:true};
      }
      if(nodeId==='F04_N03'){
        if(candidate.disposition!=='compatible')fail('UNAUTHORIZED','F04 write was not selected');
        const receipt=await invoke(nodeId,{sourceId:request.configuration.sourceId,configRevision:request.configuration.configRevision,
          path:captured.source.path,expectedSha256:captured.source.revision,edits:[{oldText:captured.excerpt,newText:request.updateText}]},context,scope,owned.sessionId);
        write(scope,captured);return project(receipt,scope);
      }
      if(nodeId==='F04_N07'){
        if(candidate.disposition==='compatible')fail('UNAUTHORIZED','F04 cannot quarantine the selected write branch');
        app().runtime.saveCheckpointOnce(scope.taskId,'f04:quarantined-candidate',{sessionId:owned.sessionId,input:request,candidate,source:captured.source,fact:captured.fact.ref});
        return {state:'quarantined',reason:candidate.reason,kind:candidate.kind};
      }
      ports.clearIndex(request.configuration,scope);app().runtime.saveCheckpointOnce(scope.taskId,'f04:index-invalidated',{sessionId:owned.sessionId,hostTaskId:context.taskId});
      if(candidate.disposition!=='compatible'){
        operation(binding,'F04_N07');return {state:'quarantined',fact:captured.fact.ref,sourceRevision:captured.source.revision};
      }
      operation(binding,'F04_N03');const written=write(scope,captured)!;
      if(!written.changed)return {state:'unchanged',fact:captured.fact.ref,sourceRevision:captured.source.revision};
      const proof=sourceProof(scope,'F04_N03'),source={...captured.source,revision:written.afterSha256};
      const line=await ports.readCitation({source,configuration:request.configuration},scope);current(scope);
      if(line!==request.updateText)fail('REVISION_CONFLICT','F04 written line differs from its original candidate');
      const existing=projectionIntent(scope,binding,captured,written);
      const intent=existing??{version:1 as const,source,before:captured.fact,summary:line,observedAt:new Date().toISOString(),
        sourceTaskId:proof.receipt.taskId,sourceRunId:proof.receipt.runId,sourceOperationId:written.operationId};
      app().runtime.saveCheckpointOnce(scope.taskId,'f04:projection-intent',intent);
      return applyF04Projection(ports.facts,intent,scope,()=>current(scope));
    }}));
  function predecessors(value:Graph,nodeId:string):Record<string,unknown>{
    return Object.fromEntries(getOwnedWorkflowTemplate(workflowId)!.nodes.find(node=>node.id===nodeId)!.dependencies.map(dependency=>[
      dependency.nodeId,dependency.nodeId==='F04_N01'?value.input:dependency.nodeId==='F04_N02'?selection(value)
        :operation(value,dependency.nodeId,undefined,!dependency.required||nodeId==='F04_N04')?.result??null]));
  }
  function exportBinding(request:Pick<Parameters<Worker['authorizeExport']>[0],'taskId'|'deadline'|'signal'|'proposal'|'localTaskId'|'value'>):Graph {
    const proposal=request.proposal;
    if(!proposal||!request.localTaskId||!plain(request.value))fail('UNAUTHORIZED','F04 export lacks its original receipt');
    const original=app().runtime.loadCheckpoint(request.taskId,'owned-workflow:operation:'+proposal.operationId) as
      {taskId?:string;workflowId?:string;sessionId?:string;localTaskId?:string;proposal?:unknown}|undefined;
    if(original?.taskId!==request.taskId||original.workflowId!==workflowId||!original.sessionId||original.localTaskId!==request.localTaskId
      ||!isDeepStrictEqual(original.proposal,proposal))fail('UNAUTHORIZED','F04 export operation changed');
    const value=graph(request,original.sessionId),readback=app().readHostToolTask(request.localTaskId);
    const execution=app().runtime.readToolExecutions(request.localTaskId).find(item=>item.evidenceId===readback.confirmed?.runId);
    if(readback.commandId!==proposal.operationId||readback.toolName!==proposal.toolName||readback.toolVersion!==proposal.toolVersion
      ||readback.task.state!=='succeeded'||!readback.confirmed?.evidenceRefs.includes(readback.confirmed.runId)
      ||!isDeepStrictEqual(readback.confirmed.result,request.value.result)||!execution||execution.state!=='confirmed'
      ||execution.policyDecision!=='allow'||!execution.executionStarted||!app().runtime.matchesToolExecutionInput(execution,{arguments:proposal.arguments,scopeRef:execution.evidenceId}))
      fail('UNAUTHORIZED','F04 export is not its confirmed original tool result');
    const item={nodeId:proposal.nodeId,operationId:proposal.operationId,toolName:proposal.toolName,toolVersion:proposal.toolVersion,
      localTaskId:request.localTaskId,result:readback.confirmed.result,readback};
    const prior=value.confirmedOperations.find(record=>record.operationId===proposal.operationId);
    if(prior&&!isDeepStrictEqual(prior,item))fail('REVISION_CONFLICT','F04 current receipt differs from its saved readback');
    return {...value,confirmedOperations:prior?value.confirmedOperations:[...value.confirmedOperations,item]};
  }
  function completion(value:Graph,scope:Scope){
    const captured=recall(value,scope),candidate=selection(value),result=operation(value,'F04_N04')!.result as Record<string,unknown>;
    operation(value,candidate.disposition==='compatible'?'F04_N03':'F04_N07');
    if(operation(value,candidate.disposition==='compatible'?'F04_N07':'F04_N03',undefined,true))fail('UNAUTHORIZED','F04 executed both exclusive branches');
    if(candidate.disposition==='compatible'){
      const written=write(scope,captured)!;
      if(!isDeepStrictEqual(operation(value,'F04_N03')!.result,readProjection(sourceProof(scope,'F04_N03'),scope)))fail('UNAUTHORIZED','F04 write receipt export changed');
      const intent=projectionIntent(scope,value,captured,written),expected=written.changed&&intent?readF04Projection(ports.facts,intent,scope):
        {state:'unchanged',fact:captured.fact.ref,sourceRevision:captured.source.revision};
      if(!expected||!isDeepStrictEqual(result,expected))fail('RESULT_UNKNOWN','F04 original projection lacks its complete readback');
    }else if(!isDeepStrictEqual(result,{state:'quarantined',fact:captured.fact.ref,sourceRevision:captured.source.revision}))fail('UNAUTHORIZED','F04 quarantine result changed');
    return {state:result.state,fact:result.fact,sourceRevision:result.sourceRevision,
      projection:result.state==='updated'?{batchToken:result.batchToken,graphRevision:result.graphRevision}:{}};
  }
  const requiredTools=[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),
    ...['decision.choose_candidate','knowledge.search','knowledge.apply_note_patch'].map(name=>({name,version:'1.0.0'}))];
  const worker:Worker={workflowId,toolName:'workflow.wiki.manage',toolVersion:'1.0.0',configurationVersion:'f04-public-source-v1',
    requestSchema:f04RequestSchema,inputSchema:object({...f04RequestSchema.properties,configuration:{type:'object'},candidateContract:{type:'object'}}),
    resultSchema:object({state:{enum:['updated','unchanged','quarantined']},fact:object({id:text,revision:{type:'integer',minimum:1}}),
      sourceRevision:{type:'string'},projection:{type:'object'}}),requiredTools,publicEnumPaths:['/candidateKind'],sideEffect:'local_write',assertCurrent:current,
    available:scope=>{try{current(scope);return true;}catch{return false;}},
    resolveInput:async(args,scope)=>{validateToolValue(f04RequestSchema,args);const configuration=base(scope);
      if(!configuration.publicQueries.includes(String(args.query)))fail('UNAUTHORIZED','F04 query is outside its public scope');
      app().runtime.saveCheckpointOnce(scope.taskId,configKey,configuration);return {...args,configuration:structuredClone(configuration),candidateContract:structuredClone(f04CandidateSchema)};},
    assertFrontier:request=>{
      current(request);const binding=graph(request,request.state.sessionId),proposal=request.proposal;
      if(proposal.toolName==='decision.choose_candidate'){
        let context;try{context=JSON.parse(String(proposal.arguments.context));}catch{return false;}
        if(context?.workflowId!==workflowId||context.nodeId!==proposal.nodeId
          ||!isDeepStrictEqual(context.input,binding.input)||!isDeepStrictEqual(context.predecessors,predecessors(binding,proposal.nodeId))
          ||!Array.isArray(context.candidateValues)||!Array.isArray(proposal.arguments.candidates)
          ||!isDeepStrictEqual(context.candidateValues.map((item:Record<string,unknown>)=>item.id),proposal.arguments.candidates.map(item=>plain(item)?item.id:null)))return false;
        for(const candidate of context.candidateValues){
          if(!plain(candidate)||candidate.branches!==undefined)return false;if(candidate.abstain===true)continue;
          if(proposal.nodeId==='F04_N02')parseF04Candidate(candidate.value,input(binding));
          else if(!['F04_N05','F04_N06','F04_N03','F04_N07','F04_N04'].includes(proposal.nodeId)
            ||!isDeepStrictEqual(candidate.value,{arguments:{}}))return false;
        }return true;
      }
      if(!tools.some(tool=>tool.descriptor.name===proposal.toolName&&tool.descriptor.name.endsWith('.'+proposal.nodeId.toLowerCase())))return false;
      return !proposal.toolName.startsWith('workflow.guard.')||proposal.arguments.workflowId===workflowId&&proposal.arguments.nodeId===proposal.nodeId
        &&isDeepStrictEqual(proposal.arguments.input,binding.input)&&isDeepStrictEqual(proposal.arguments.predecessorOutputs,predecessors(binding,proposal.nodeId));
    },
    authorizeExport:async request=>{
      const check=()=>{
        current(request);if(request.stage==='initial'){
          const value=request.value as F04Input;
          if(!value||!isDeepStrictEqual(value.configuration,ports.sourceConfiguration())||!isDeepStrictEqual(value.candidateContract,f04CandidateSchema))
            fail('REVISION_CONFLICT','F04 initial export changed');return;
        }
        const value=request.stage==='receipt'?exportBinding(request):graph(request,String(app().runtime.loadCheckpoint(request.taskId,sessionKey)));
        if(request.stage==='receipt')app().runtime.saveCheckpoint(request.taskId,'f04:last-export-operation',request.proposal!.operationId);
        if(operation(value,'F04_N05',undefined,true))recall(value,request);
        current(request);
        if(request.stage==='completion'&&!isDeepStrictEqual(request.value,completion(value,request)))fail('UNAUTHORIZED','F04 final export changed');
      };
      check();const allowed=await ports.authorizeExport({...request,workflowId});check();return allowed===true;
    },
    verifyCompletion:async request=>{
      const binding=graph(request,request.state.sessionId);current(request);
      for(const nodeId of ['F04_N01','F04_N05','F04_N02','F04_N06','F04_N04'])
        if(request.state.result?.nodes[nodeId]?.state!=='completed')fail('UNAUTHORIZED','F04 original graph has not completed its required nodes');
      const result=completion(binding,request);
      return {result,
        resultSummary:result.state==='quarantined'?'Candidate quarantined; existing facts were not changed':'Original source and scoped Fact projection read back'};
    }};
  function recoveryBinding(scope:Scope){
    current(scope);const sessionId=app().runtime.loadCheckpoint(scope.taskId,sessionKey);
    if(typeof sessionId!=='string')fail('UNAUTHORIZED','F04 original recovery session unavailable');
    const binding=graph(scope,sessionId),pending=app().readPendingOwnedWorkflowHostTask(scope.taskId);
    if(!pending)fail('UNSUPPORTED_CAPABILITY','F04 original pending projection unavailable');
    const localTaskId=pending.taskId,runId='host-tool-'+localTaskId;
    const parent=app().runtime.loadCheckpoint(localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const intent=app().runtime.loadCheckpoint(localTaskId,'host-tool-intent') as {toolName?:string;toolVersion?:string;arguments?:unknown;deadline?:string}|undefined;
    const original=app().runtime.loadCheckpoint(scope.taskId,'owned-workflow:intent:'+parent?.operationId) as
      {sessionId?:string;workflowId?:string;proposal?:{nodeId?:string;arguments?:unknown}}|undefined;
    if(parent?.taskId!==scope.taskId||!parent.operationId||intent?.toolName!=='workflow.host.f04_n04'||intent.toolVersion!=='1.0.0'
      ||!isDeepStrictEqual(intent.arguments,{})||intent.deadline!==scope.deadline||original?.workflowId!==workflowId||original.sessionId!==sessionId
      ||original.proposal?.nodeId!=='F04_N04'||!isDeepStrictEqual(original.proposal.arguments,{}))fail('UNAUTHORIZED','F04 recovery belongs to another original operation');
    const record=app().runtime.readToolExecutions(localTaskId).find(item=>item.evidenceId===runId),read=app().readHostToolTask(localTaskId);
    if(!record||record.toolName!==intent.toolName||record.toolVersion!==intent.toolVersion||record.policyDecision!=='allow'||!record.executionStarted
      ||!app().runtime.matchesToolExecutionInput(record,{arguments:{},scopeRef:runId}))fail('UNAUTHORIZED','F04 recovery lacks its original authorized execution');
    const index=app().runtime.loadCheckpoint(scope.taskId,'f04:index-invalidated');
    if(!isDeepStrictEqual(index,{sessionId,hostTaskId:localTaskId}))fail('RESULT_UNKNOWN','F04 original index invalidation is not confirmed');
    const captured=recall(binding,scope),candidate=selection(binding);
    if(candidate.disposition!=='compatible')fail('UNSUPPORTED_CAPABILITY','F04 projection recovery requires its original selected source write');
    operation(binding,'F04_N03');const written=write(scope,captured)!;
    if(!written.changed)fail('UNSUPPORTED_CAPABILITY','F04 original source was unchanged');
    const projection=projectionIntent(scope,binding,captured,written);
    if(!projection)fail('RESULT_UNKNOWN','F04 original projection intent is unavailable');
    return {localTaskId,runId,record,read,projection};
  }
  const recoveries=new Map<string,Promise<{state:'unknown'|'confirmed';localTaskId:string}>>();
  async function reconcile(scope:Scope):Promise<{state:'unknown'|'confirmed';localTaskId:string}>{
    const original=recoveryBinding(scope),{localTaskId,runId,record,read,projection}=original;
    if(read.task.state!=='succeeded'&&(read.task.state!=='waiting_reconciliation'||record.state!=='unknown'||app().runtime.isToolExecutionActive(record)))
      fail('RESULT_UNKNOWN','F04 original projection has not stopped');
    const result=readF04Projection(ports.facts,projection,scope);
    if(!result)return {state:'unknown',localTaskId};
    const after=recoveryBinding(scope);
    if(!isDeepStrictEqual(original,after))fail('REVISION_CONFLICT','F04 original projection changed during readback');
    if(read.task.state==='succeeded'){
      if(record.state!=='confirmed'||!isDeepStrictEqual(read.confirmed?.result,result))fail('REVISION_CONFLICT','F04 confirmed projection differs from its readback');
      return {state:'confirmed',localTaskId};
    }
    const evidenceId='f04-projection-readback-'+createHash('sha256').update(JSON.stringify([localTaskId,runId,projection,result])).digest('hex');
    app().runtime.saveCheckpoint(localTaskId,'trusted-readback-evidence:'+evidenceId,{evidenceId,kind:'observation',
      sourceRef:'runtime:f04-original-public-projection',capturedAt:new Date().toISOString(),
      summary:'Original source hash, public Fact revision and completed impact read back; no write or projection repeated',verification:'verified',sensitivity:'internal'});
    current(scope);app().runtime.reconcileToolExecution(localTaskId,runId,'applied',result,[evidenceId]);return {state:'confirmed',localTaskId};
  }
  const recovery:F04RecoveryPort={readAvailable(scope){try{const {read,record}=recoveryBinding(scope);
    return read.task.state==='succeeded'&&record.state==='confirmed'||read.task.state==='waiting_reconciliation'&&record.state==='unknown'&&!app().runtime.isToolExecutionActive(record);
  }catch{return false;}},reconcileOriginalReadback(scope){
    // Concurrent callers observe the one original operation; this never resumes the graph.
    current(scope);const prior=recoveries.get(scope.taskId);if(prior)return prior;
    const work=Promise.resolve().then(()=>reconcile(scope)).finally(()=>recoveries.delete(scope.taskId));recoveries.set(scope.taskId,work);return work;
  }};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:null,recovery};
}
