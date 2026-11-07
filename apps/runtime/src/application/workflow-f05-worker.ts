import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {f05AnswerCandidateSchema} from '@personal-agent/contracts/f05-answer';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {MemoryQueryPort,FactVersion} from '@personal-agent/memory';
import type {KnowledgeSource} from '@personal-agent/knowledge';
import type {RuntimeApplication} from './runtime-application.js';
import type {CompetitionToolExport,PrepareCompetitionToolExport} from './coordination.js';
import type {WorkflowBusinessToolReceipt,WorkflowBusinessToolSourceProof} from './workflow-business-tool-bridge.js';
import type {RuntimeConfiguredWorkflowOptions,RuntimeConfiguredWorkflowBinding} from './configured-workflow-worker.js';
import {assertOwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {createWorkflowBusinessToolBridge,readWorkflowBusinessToolSource} from './workflow-business-tool-bridge.js';
import {assertF05Sources,assertF05SourcesCurrent,bindF05Answer,f05KnowledgeEvidence,type F05SourceEvidence,type F05SourceReadScope} from './f05-source-evidence.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;
type Graph=RuntimeConfiguredWorkflowBinding;
type Scope=F05SourceReadScope;
export interface F05SourceConfiguration {sourceId:string;configRevision:number;publicQueries:string[];memoryNamespace:string;}
export interface F05WorkflowOptions {
  getApplication:()=>RuntimeApplication;
  sourceConfiguration:()=>F05SourceConfiguration|undefined;
  memory:Pick<MemoryQueryPort,'listCurrent'>;
  readCurrentFact:(ref:FactVersion['ref'])=>FactVersion|undefined;
  readCitation:(input:{source:KnowledgeSource;configuration:F05SourceConfiguration},scope:Scope)=>Promise<string>;
  assertCitationCurrent:(input:{source:KnowledgeSource;configuration:F05SourceConfiguration},scope:Scope)=>void;
  knowledgeToolExport:CompetitionToolExport;
  prepareCompetitionToolExport:PrepareCompetitionToolExport;
  authorizeExport:(request:Parameters<Worker['authorizeExport']>[0]&{workflowId:'F05'})=>Promise<boolean>;
}
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:2048};
const empty=object({}),workflowId='F05',configurationKey='f05:source-configuration:v1';
const requestSchema=object({query:text,factId:text,limit:{type:'integer',minimum:1,maximum:5}});
const reviewSchema=object({verdict:{enum:['supported','unknown']},claimIds:{type:'array',maxItems:16,items:text},
  unresolved:{type:'array',maxItems:16,items:text}});
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
type Input={query:string;factId:string;limit:number;configuration:F05SourceConfiguration;answerContract:Record<string,unknown>};
type Review={verdict:'supported'|'unknown';claimIds:string[];unresolved:string[]};

/** Original IMAGE28/ToolGateway consumer. Sources and model judgments keep separate evidence identities. */
export function createF05WorkflowWorkerPorts(options?:F05WorkflowOptions):{tools:RegisteredTool[];configuredWorkflowWorkerPorts:Worker[];unavailable:string|null} {
  if(typeof options?.getApplication!=='function'||typeof options.sourceConfiguration!=='function'||typeof options.memory?.listCurrent!=='function'
    ||typeof options.readCurrentFact!=='function'||typeof options.readCitation!=='function'||typeof options.assertCitationCurrent!=='function'||typeof options.authorizeExport!=='function'
    ||options.knowledgeToolExport?.toolName!=='knowledge.search'||options.knowledgeToolExport.toolVersion!=='1.0.0'
    ||typeof options.knowledgeToolExport.accepts!=='function'||typeof options.knowledgeToolExport.project!=='function'
    ||typeof options.prepareCompetitionToolExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f05_original_source_ports_unavailable'};
  const ports=options;
  const checkingSources=new Set<string>();
  function current(scope:Scope):void {
    if(scope.signal.aborted)fail('CANCELLED','F05 original request cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.now()>=Date.parse(scope.deadline))fail('TIMEOUT','F05 original request expired');
    const app=ports.getApplication(),parent=app.readDelegatedUserTaskParent(scope.taskId),task=app.runtime.getTask(scope.taskId);
    if(!parent||parent.deadline!==scope.deadline||task.cancelRequested||!['running','waiting_approval'].includes(task.state)
      ||app.runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline)fail('UNAUTHORIZED','F05 original user request unavailable');
    const config=ports.sourceConfiguration(),saved=app.runtime.loadCheckpoint(scope.taskId,configurationKey);
    if(!config||!config.sourceId||!Number.isSafeInteger(config.configRevision)||config.configRevision<1||!config.memoryNamespace
      ||!Array.isArray(config.publicQueries)||!config.publicQueries.length||config.publicQueries.some(query=>typeof query!=='string'||!query)
      ||saved!==undefined&&!isDeepStrictEqual(saved,config))fail('REVISION_CONFLICT','F05 original public source configuration changed');
    const session=app.runtime.loadCheckpoint(scope.taskId,'f05:session-id');
    if(typeof session==='string'&&!checkingSources.has(scope.taskId)){
      // The public binding also calls this guard. Reentry still checks the original
      // task/configuration; the outer call alone rereads the bounded source set.
      checkingSources.add(scope.taskId);
      try{
        let value=graph(scope,session);
        const pending=app.runtime.loadCheckpoint(scope.taskId,'f05:last-export-operation');
        if(typeof pending==='string'){
          const original=app.runtime.loadCheckpoint(scope.taskId,'owned-workflow:operation:'+pending) as
            {proposal?:Parameters<Worker['authorizeExport']>[0]['proposal'];localTaskId?:string}|undefined;
          if(!original?.proposal||!original.localTaskId)fail('UNAUTHORIZED','F05 original pending export unavailable');
          value=exportBinding({...scope,proposal:original.proposal,localTaskId:original.localTaskId,
            value:{result:app.readHostToolTask(original.localTaskId).confirmed?.result}});
        }
        if(operation(value,'F05_N02','workflow.host.f05_n02',true))
          assertF05SourcesCurrent(evidence(value),reader(input(value).configuration),scope);
      }finally{checkingSources.delete(scope.taskId);}
    }
  }
  function graph(scope:Scope,sessionId:string):Graph {
    current(scope);const value=ports.getApplication().readConfiguredWorkflowBinding({taskId:scope.taskId,workflowId,sessionId,signal:scope.signal});
    if(!value||value.deadline!==scope.deadline)fail('UNAUTHORIZED','Original F05 graph binding unavailable');return value;
  }
  function input(value:Graph):Input {
    const request=value.input as Input;
    if(!request||!isDeepStrictEqual(request.configuration,ports.sourceConfiguration())
      ||!isDeepStrictEqual(request.answerContract,f05AnswerCandidateSchema()))fail('REVISION_CONFLICT','Original F05 input changed');return request;
  }
  function operation(value:Graph,nodeId:string,toolName:string,optional=false) {
    const found=value.confirmedOperations.filter(item=>item.nodeId===nodeId&&item.toolName===toolName);
    if(found.length!==1){if(optional&&found.length===0)return undefined;fail('UNAUTHORIZED','F05 requires one original node receipt');}
    return found[0]!;
  }
  function originalArguments(value:Graph,nodeId:string,toolName:string) {
    const record=operation(value,nodeId,toolName)!,intent=ports.getApplication().runtime.loadCheckpoint(record.localTaskId,'host-tool-intent') as {arguments?:unknown};
    if(!plain(intent?.arguments))fail('UNAUTHORIZED','F05 original node arguments unavailable');return intent.arguments;
  }
  function selected(value:Graph,nodeId:string):unknown {
    const record=operation(value,nodeId,'decision.choose_candidate')!,args=originalArguments(value,nodeId,'decision.choose_candidate');
    let context;try{context=JSON.parse(String(args.context));}catch{fail('UNAUTHORIZED','F05 original selection context unavailable');}
    if(!plain(context)||context.workflowId!==workflowId||context.nodeId!==nodeId||!isDeepStrictEqual(context.input,value.input)
      ||!Array.isArray(context.candidateValues)||!plain(record.result)||typeof record.result.selectedId!=='string')
      fail('UNAUTHORIZED','F05 original selection differs from its graph');
    const selectedId=record.result.selectedId;
    const matches=context.candidateValues.filter(item=>plain(item)&&item.id===selectedId);
    if(matches.length!==1||!plain(matches[0])||matches[0].abstain===true)fail('UNSUPPORTED_CAPABILITY','F05 original model preserved uncertainty');
    return matches[0].value;
  }
  function decision(value:Graph):{action:'answer'|'expand'|'unknown';query?:string} {
    const choice=selected(value,'F05_N03'),request=input(value);
    if(!plain(choice)||!['answer','expand','unknown'].includes(String(choice.action))
      ||Object.keys(choice).some(key=>!['action','query'].includes(key)))fail('UNAUTHORIZED','F05 gap judgment is invalid');
    if(choice.action==='expand'&&(typeof choice.query!=='string'||choice.query===request.query||!request.configuration.publicQueries.includes(choice.query)))
      fail('UNSUPPORTED_CAPABILITY','F05 expansion is not a new explicitly configured query');
    if(choice.action!=='expand'&&choice.query!==undefined)fail('UNAUTHORIZED','F05 unused expansion query is invalid');
    return choice as {action:'answer'|'expand'|'unknown';query?:string};
  }
  function evidence(value:Graph):F05SourceEvidence {
    const original=operation(value,'F05_N02','workflow.host.f05_n02')!,recall=original.result;
    if(!plain(recall)||!Array.isArray(recall.facts)||!Array.isArray(recall.sources)||!plain(recall.knowledge))fail('UNAUTHORIZED','F05 original recall evidence unavailable');
    const app=ports.getApplication(),parent=app.runtime.loadCheckpoint(original.localTaskId,'coding-repair:parent') as {taskId:string};
    const proof=readWorkflowBusinessToolSource(app,{parentTaskId:parent.taskId,sessionId:value.sessionId,deadline:value.deadline},
      recall.knowledge as unknown as Parameters<typeof readWorkflowBusinessToolSource>[2],'knowledge.search');
    const request=input(value),sources=f05KnowledgeEvidence(readProjection(proof),'initial',request.configuration.sourceId,request.limit);
    if(proof.sourceHost.taskId!==original.localTaskId||!isDeepStrictEqual(recall.sources,sources)
      ||!isDeepStrictEqual(proof.request.arguments,{sourceId:request.configuration.sourceId,configRevision:request.configuration.configRevision,query:request.query,limit:request.limit})
      ||recall.facts.length>request.limit||recall.facts.some(fact=>!plain(fact)||!plain(fact.ref)||fact.ref.id!==request.factId))
      fail('UNAUTHORIZED','F05 recall is not its original filtered source read');
    const expanded=operation(value,'F05_N06','workflow.host.f05_n06',true);
    if(expanded){
      const result=expanded.result as {knowledge:Parameters<typeof readWorkflowBusinessToolSource>[2];sources:unknown};
      const expandedProof=readWorkflowBusinessToolSource(app,{parentTaskId:parent.taskId,sessionId:value.sessionId,deadline:value.deadline},result.knowledge,'knowledge.search');
      const extra=f05KnowledgeEvidence(readProjection(expandedProof),'expanded',request.configuration.sourceId,request.limit),choice=decision(value);
      if(expandedProof.sourceHost.taskId!==expanded.localTaskId||choice.action!=='expand'||!isDeepStrictEqual(result.sources,extra)
        ||!isDeepStrictEqual(expandedProof.request.arguments,{sourceId:request.configuration.sourceId,configRevision:request.configuration.configRevision,query:choice.query,limit:request.limit}))
        fail('UNAUTHORIZED','F05 expansion is not its original projected query');
      sources.push(...extra);
    }
    return {facts:structuredClone(recall.facts) as FactVersion[],sources};
  }
  function readProjection(proof:WorkflowBusinessToolSourceProof):unknown {
    const policy=ports.knowledgeToolExport,saved=ports.getApplication().runtime.loadCheckpoint(proof.receipt.taskId,'f05:knowledge-projection') as
      {policyVersion?:string;resultDigest?:string;projection?:unknown}|undefined;
    if(!saved||saved.policyVersion!==policy.exportPolicyVersion||saved.resultDigest!==toolArgumentsDigest(proof.receipt.result)
      ||policy.accepts({taskId:proof.receipt.taskId,proposalId:proof.request.commandId,arguments:structuredClone(proof.request.arguments),
        phase:'final',projection:structuredClone(saved.projection)})!==true)fail('UNAUTHORIZED','F05 original knowledge export is unavailable');
    return saved.projection;
  }
  async function projectKnowledge(result:WorkflowBusinessToolReceipt,scope:Scope):Promise<unknown> {
    const app=ports.getApplication(),policy=ports.knowledgeToolExport,read=app.readHostToolTask(result.taskId);
    const proposal={kind:'tool_proposal' as const,proposalId:read.commandId,toolName:result.toolName,toolVersion:result.toolVersion,
      arguments:structuredClone(result.arguments),verification:'unverified' as const};
    const check=(phase:'preflight'|'final',projection?:unknown)=>{
      current(scope);const original=app.readHostToolTask(result.taskId);
      if(original.task.state!=='succeeded'||original.task.cancelRequested||original.confirmed?.runId!==result.runId
        ||!isDeepStrictEqual(original.confirmed.result,result.result)||policy.accepts({taskId:result.taskId,proposalId:proposal.proposalId,
          arguments:structuredClone(result.arguments),phase,projection,signal:scope.signal})!==true)fail('UNAUTHORIZED','F05 original knowledge projection was revoked');
    };
    check('preflight');await ports.prepareCompetitionToolExport({phase:'projection',taskId:result.taskId,runId:result.runId,proposal,deadline:scope.deadline,signal:scope.signal});
    check('preflight');const projection=await policy.project({taskId:result.taskId,proposalId:proposal.proposalId,result:structuredClone(result.result),signal:scope.signal});
    check('final',projection);app.runtime.saveCheckpointOnce(result.taskId,'f05:knowledge-projection',
      {policyVersion:policy.exportPolicyVersion,resultDigest:toolArgumentsDigest(result.result),projection:structuredClone(projection)});
    return projection;
  }
  function reader(configuration:F05SourceConfiguration) {
    return {readCurrentFact:ports.readCurrentFact,assertCurrent:current,
      assertCitationCurrent:(source:KnowledgeSource,scope:Scope)=>ports.assertCitationCurrent({source,configuration},scope),
      readCitation:(source:KnowledgeSource,scope:Scope)=>ports.readCitation({source,configuration},scope)};
  }
  async function verifySources(value:Graph,scope:Scope) {const result=evidence(value);await assertF05Sources(result,reader(input(value).configuration),scope);return result;}
  function candidate(value:Graph) {return bindF05Answer(selected(value,'F05_N04'),evidence(value));}
  function review(value:Graph,args:unknown):Review {
    validateToolValue(reviewSchema,args);const result=args as Review,answer=candidate(value);
    const chosen=selected(value,'F05_N05');
    if(!plain(chosen)||!isDeepStrictEqual(chosen.arguments,result))fail('UNAUTHORIZED','F05 support verdict is not the original model selection');
    if(decision(value).action==='unknown'&&result.verdict!=='unknown')fail('UNAUTHORIZED','F05 unresolved source judgment cannot become supported');
    if(result.verdict==='supported'&&(!answer.claims.length||!isDeepStrictEqual(result.claimIds,answer.claims.map(item=>item.id))))
      fail('UNAUTHORIZED','F05 support verdict does not cover the original claims');
    if(result.verdict==='unknown'&&!result.unresolved.length)fail('UNAUTHORIZED','F05 unknown verdict must identify unresolved support');
    return result;
  }
  let bridgeApplication:RuntimeApplication|undefined,bridge:ReturnType<typeof createWorkflowBusinessToolBridge>|undefined;
  function knowledgeBridge(){
    const app=ports.getApplication();if(app!==bridgeApplication){bridgeApplication=app;bridge=createWorkflowBusinessToolBridge({application:app,
      resolveTool:request=>['F05_N02','F05_N06'].some(node=>'f05.original-knowledge-search.'+node===request.actionKey)?{
        workflowId,nodeId:request.actionKey.slice(-7),hostToolName:'workflow.host.'+request.actionKey.slice(-7).toLowerCase(),
        toolName:'knowledge.search',toolVersion:'1.0.0',arguments:request.input}:undefined,
      assertCurrent:scope=>{current({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal});},now:()=>new Date()});}return bridge!;
  }
  function hostScope(nodeId:string,kind:'host'|'guard',args:unknown,context:ToolContext){
    const host=assertOwnedWorkflowHostScope({runtime:ports.getApplication().runtime,context,workflowId,nodeId,
      hostToolName:'workflow.'+kind+'.'+nodeId.toLowerCase(),proposalArguments:args,
      assertCurrent:scope=>current({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal})});
    const scope={taskId:host.parentTaskId,deadline:host.deadline,signal:host.signal},runtime=ports.getApplication().runtime;
    const saved=runtime.loadCheckpoint(host.parentTaskId,'f05:session-id');
    if(saved!==undefined&&saved!==host.sessionId)fail('REVISION_CONFLICT','Original F05 session changed');
    runtime.saveCheckpoint(host.parentTaskId,'f05:session-id',host.sessionId);return {host,scope,binding:graph(scope,host.sessionId)};
  }
  function expectedPredecessors(value:Graph,nodeId:string):Record<string,unknown> {
    const results:Record<string,unknown>={};
    for(const dependency of getOwnedWorkflowTemplate(workflowId)!.nodes.find(node=>node.id===nodeId)!.dependencies){
      const id=dependency.nodeId;
      if(id==='F05_N01')results[id]=value.input;
      else if(['F05_N03','F05_N04'].includes(id))results[id]=selected(value,id);
      else {const record=operation(value,id,'workflow.host.'+id.toLowerCase(),!dependency.required);
        results[id]=record?.result??null;}
    }
    return results;
  }
  // Receipt authorization precedes the generic driver's save. Add only its actual
  // original confirmed run to the immutable public binding for this read check.
  function exportBinding(request:Pick<Parameters<Worker['authorizeExport']>[0],'taskId'|'deadline'|'signal'|'proposal'|'localTaskId'|'value'>):Graph {
    const app=ports.getApplication(),proposal=request.proposal;
    if(!proposal||!request.localTaskId||!plain(request.value))fail('UNAUTHORIZED','F05 export lacks its original receipt');
    const original=app.runtime.loadCheckpoint(request.taskId,'owned-workflow:operation:'+proposal.operationId) as
      {taskId?:string;workflowId?:string;sessionId?:string;localTaskId?:string;proposal?:unknown}|undefined;
    if(original?.taskId!==request.taskId||original.workflowId!==workflowId||!original.sessionId||original.localTaskId!==request.localTaskId
      ||!isDeepStrictEqual(original.proposal,proposal))fail('UNAUTHORIZED','F05 export operation changed');
    const value=graph(request,original.sessionId),readback=app.readHostToolTask(request.localTaskId);
    const execution=app.runtime.readToolExecutions(request.localTaskId).find(item=>item.evidenceId===readback.confirmed?.runId);
    if(readback.commandId!==proposal.operationId||readback.toolName!==proposal.toolName||readback.toolVersion!==proposal.toolVersion
      ||readback.task.state!=='succeeded'||!readback.confirmed?.evidenceRefs.includes(readback.confirmed.runId)
      ||!isDeepStrictEqual(readback.confirmed.result,request.value.result)||!execution||execution.state!=='confirmed'
      ||execution.policyDecision!=='allow'||!execution.executionStarted||!app.runtime.matchesToolExecutionInput(execution,{arguments:proposal.arguments,scopeRef:execution.evidenceId}))
      fail('UNAUTHORIZED','F05 export is not its confirmed original tool result');
    const item={nodeId:proposal.nodeId,operationId:proposal.operationId,toolName:proposal.toolName,toolVersion:proposal.toolVersion,
      localTaskId:request.localTaskId,result:readback.confirmed.result,readback};
    const prior=value.confirmedOperations.find(record=>record.operationId===proposal.operationId);
    if(prior&&!isDeepStrictEqual(prior,item))fail('REVISION_CONFLICT','F05 current receipt differs from its saved readback');
    return {...value,confirmedOperations:prior?value.confirmedOperations:[...value.confirmedOperations,item]};
  }
  const tools:RegisteredTool[]=[];
  const guardSchema=object({workflowId:{const:workflowId},nodeId:text,input:{type:'object'},predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}});
  for(const nodeId of ['F05_N06','F05_N04'])tools.push(createOwnedWorkflowAdapter({nodeId,kind:'guard',sideEffect:'read',requiredScopes:['knowledge:read','memory:read'],
    inputSchema:guardSchema,outputSchema:empty,async execute(args,context){
      const {scope,binding}=hostScope(nodeId,'guard',args,context),choice=decision(binding);await verifySources(binding,scope);
      if(nodeId==='F05_N04'&&choice.action==='expand'&&!operation(binding,'F05_N06','workflow.host.f05_n06',true))
        fail('UNSUPPORTED_CAPABILITY','F05 answer is waiting for its original expanded evidence');
      return {state:nodeId==='F05_N06'&&choice.action!=='expand'?'skipped':'selected'};
    }}));
  for(const nodeId of ['F05_N02','F05_N05','F05_N06','F05_N07'])tools.push(createOwnedWorkflowAdapter({nodeId,kind:'host',sideEffect:'read',requiredScopes:['knowledge:read','memory:read'],
    inputSchema:nodeId==='F05_N05'?reviewSchema:empty,outputSchema:{type:'object'},async execute(args,context){
      const {host,scope,binding}=hostScope(nodeId,'host',args,context),request=input(binding);
      if(nodeId==='F05_N02'||nodeId==='F05_N06') {
        const choice=nodeId==='F05_N06'?decision(binding):undefined;
        if(choice&&choice.action!=='expand')fail('UNAUTHORIZED','F05 expansion was not selected');
        const page=nodeId==='F05_N02'?await ports.memory.listCurrent({factId:request.factId,limit:request.limit,at:new Date().toISOString(),deadline:scope.deadline,signal:scope.signal}):{facts:[],nextCursor:undefined};current(scope);
        if(!Array.isArray(page.facts)||page.facts.length>request.limit||page.facts.some(fact=>fact.ref.id!==request.factId))
          fail('UNAUTHORIZED','F05 Memory recall differs from its original filter');
        const result=await knowledgeBridge().invoke({actionKey:'f05.original-knowledge-search.'+nodeId,input:{sourceId:request.configuration.sourceId,
          configRevision:request.configuration.configRevision,query:choice?.query??request.query,limit:request.limit}},context);current(scope);
        const projection=await projectKnowledge(result,scope);
        const sources=f05KnowledgeEvidence(projection,nodeId==='F05_N02'?'initial':'expanded',request.configuration.sourceId,request.limit),captured={facts:structuredClone(page.facts),sources};
        await assertF05Sources(captured,reader(request.configuration),scope);
        return {...captured,memoryMeaning:'versioned_fact_summaries_not_original_quotes',knowledge:{taskId:result.taskId,runId:result.runId,
          scopeRef:result.scopeRef,toolVersion:result.toolVersion,arguments:result.arguments},truncated:page.nextCursor!==undefined||(projection as {truncated:boolean}).truncated};
      }
      const sources=await verifySources(binding,scope),answer=candidate(binding);
      if(nodeId==='F05_N05')return {...review(binding,args),candidateDigest:toolArgumentsDigest(answer),sourceDigest:toolArgumentsDigest(sources),
        verification:'source_versions_checked_model_support_advisory'};
      const original=operation(binding,'F05_N05','workflow.host.f05_n05')!,judgment=original.result as Review&{candidateDigest:string;sourceDigest:string};
      review(binding,originalArguments(binding,'F05_N05','workflow.host.f05_n05'));
      if(judgment.candidateDigest!==toolArgumentsDigest(answer)||judgment.sourceDigest!==toolArgumentsDigest(sources))fail('REVISION_CONFLICT','F05 checked answer or original sources changed');
      const result={state:judgment.verdict,answer:judgment.verdict==='supported'?answer.answer:'当前原始来源不足以支持回答，以下问题仍未解决。',
        citations:judgment.verdict==='supported'?answer.claims.flatMap(claim=>claim.citations.map(citation=>({claimId:claim.id,...citation,
          source:sources.sources.find(item=>item.id===citation.sourceId)!.source}))):[],
        unresolved:[...new Set([...answer.unresolved,...judgment.unresolved])],verification:'source_versions_checked_model_support_advisory',
        candidateDigest:judgment.candidateDigest,sourceDigest:judgment.sourceDigest};
      const key='f05:sourced-answer:'+host.sessionId,saved=ports.getApplication().runtime.loadCheckpoint(scope.taskId,key);
      const publication={operationId:host.operationId,localTaskId:context.taskId,runId:context.runId,result};
      if(saved!==undefined&&!isDeepStrictEqual(saved,publication))fail('REVISION_CONFLICT','Original F05 answer publication changed');
      ports.getApplication().runtime.saveCheckpoint(scope.taskId,key,publication);return result;
    }}));
  const requiredTools=[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),
    {name:'knowledge.search',version:'1.0.0'},{name:'decision.choose_candidate',version:'1.0.0'}];
  const worker:Worker={workflowId,toolName:'workflow.memory.answer',toolVersion:'1.0.0',configurationVersion:'f05-original-sources-v1',
    requestSchema,inputSchema:object({...requestSchema.properties,configuration:object({sourceId:text,configRevision:{type:'integer',minimum:1},
      memoryNamespace:text,publicQueries:{type:'array',items:text}}),answerContract:{type:'object'}}),resultSchema:{type:'object',additionalProperties:false,
      required:['state','answer','citations','unresolved','verification','candidateDigest','sourceDigest'],properties:{state:{enum:['supported','unknown']},answer:{...text,maxLength:8192},
        citations:{type:'array'},unresolved:{type:'array'},verification:text,candidateDigest:text,sourceDigest:text}},
    requiredTools,publicEnumPaths:[],sideEffect:'read',assertCurrent:current,
    available:scope=>{try{current(scope);return true;}catch{return false;}},
    async resolveInput(args,scope){validateToolValue(requestSchema,args);current(scope);const configuration=structuredClone(ports.sourceConfiguration()!);
      if(!configuration.publicQueries.includes(String(args.query)))fail('UNAUTHORIZED','F05 query is outside its explicit public configuration');
      ports.getApplication().runtime.saveCheckpoint(scope.taskId,configurationKey,configuration);
      return {...args,configuration,answerContract:f05AnswerCandidateSchema()};},
    assertFrontier:async request=>{
      current(request);const binding=graph(request,request.state.sessionId),proposal=request.proposal;
      if(proposal.toolName==='decision.choose_candidate') {
        let context;try{context=JSON.parse(String(proposal.arguments.context));}catch{return false;}
        if(!plain(context)||context.workflowId!==workflowId||context.nodeId!==proposal.nodeId||!isDeepStrictEqual(context.input,request.input)
          ||!isDeepStrictEqual(context.predecessors,expectedPredecessors(binding,proposal.nodeId))
          ||!Array.isArray(context.candidateValues)||!Array.isArray(proposal.arguments.candidates)
          ||!isDeepStrictEqual(context.candidateValues.map(item=>plain(item)?item.id:null),proposal.arguments.candidates.map(item=>plain(item)?item.id:null)))return false;
        for(const choice of context.candidateValues){
          if(!plain(choice)||choice.branches!==undefined)return false;if(choice.abstain===true)continue;
          if(proposal.nodeId==='F05_N04')bindF05Answer(choice.value,evidence(binding));
          else if(proposal.nodeId==='F05_N03'){
            if(!plain(choice.value)||!['answer','expand','unknown'].includes(String(choice.value.action)))return false;
          }else if(proposal.nodeId==='F05_N05'){
            if(!plain(choice.value))return false;validateToolValue(reviewSchema,choice.value.arguments);
          }else if(!['F05_N02','F05_N06','F05_N07'].includes(proposal.nodeId))return false;
        }
      }else if(!tools.some(tool=>tool.descriptor.name===proposal.toolName
        &&tool.descriptor.name.endsWith('.'+proposal.nodeId.toLowerCase())))return false;
      if(proposal.toolName.startsWith('workflow.guard.')&&(proposal.arguments.workflowId!==workflowId||proposal.arguments.nodeId!==proposal.nodeId
        ||!isDeepStrictEqual(proposal.arguments.input,request.input)
        ||!isDeepStrictEqual(proposal.arguments.predecessorOutputs,expectedPredecessors(binding,proposal.nodeId))))return false;
      if(proposal.nodeId!=='F05_N02')await verifySources(binding,request);
      return true;
    },
    async authorizeExport(request){
      const check=async()=>{
        current(request);if(request.stage==='initial'){
          const value=request.value as Input;
          if(!value||!isDeepStrictEqual(value.configuration,ports.sourceConfiguration())||!isDeepStrictEqual(value.answerContract,f05AnswerCandidateSchema()))
            fail('REVISION_CONFLICT','F05 initial source export changed');return;
        }
        const value=request.stage==='receipt'?exportBinding(request):graph(request,String(ports.getApplication().runtime.loadCheckpoint(request.taskId,'f05:session-id')));
        if(request.stage==='receipt')ports.getApplication().runtime.saveCheckpoint(request.taskId,'f05:last-export-operation',request.proposal!.operationId);
        if(operation(value,'F05_N02','workflow.host.f05_n02',true))await verifySources(value,request);
        if(request.stage==='completion'&&!isDeepStrictEqual(request.value,operation(value,'F05_N07','workflow.host.f05_n07')!.result))
          fail('UNAUTHORIZED','F05 final answer export differs from its original receipt');
      };
      await check();const allowed=await ports.authorizeExport({...request,workflowId});await check();return allowed===true;
    },
    async verifyCompletion(request){
      const binding=graph(request,request.state.sessionId);current(request);
      for(const id of ['F05_N01','F05_N02','F05_N03','F05_N04','F05_N05','F05_N07'])
        if(request.state.result?.nodes[id]?.state!=='completed')fail('UNAUTHORIZED','F05 original graph has not completed every required node');
      const sources=await verifySources(binding,request),answer=candidate(binding),last=operation(binding,'F05_N07','workflow.host.f05_n07')!;
      const result=last.result as {candidateDigest?:string;sourceDigest?:string;state?:string};
      if(result.candidateDigest!==toolArgumentsDigest(answer)||result.sourceDigest!==toolArgumentsDigest(sources)
        ||!['supported','unknown'].includes(String(result.state)))fail('REVISION_CONFLICT','F05 final source-backed answer changed');
      return {result:last.result,resultSummary:result.state==='supported'?'Original citations read back; model support remains advisory':'Original source support remains unknown'};
    }};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:null};
}
