import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {ProtocolError,validateToolValue,type RegisteredTool,type ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {KnowledgeSource} from '@personal-agent/knowledge';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions,RuntimeConfiguredWorkflowBinding} from './configured-workflow-worker.js';
import type {CompetitionToolExport,PrepareCompetitionToolExport} from './coordination.js';
import {assertOwnedWorkflowHostScope,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';
import {createWorkflowBusinessToolBridge,readWorkflowBusinessToolSource,type WorkflowBusinessToolReceipt} from './workflow-business-tool-bridge.js';
import {createRuntimeF10SupportedClaimsHost,type F10BoundFinding,type F10ClaimReview} from './workflow-f10-supported-claims-host.js';
import {f05KnowledgeEvidence} from './f05-source-evidence.js';

type Worker=Omit<RuntimeConfiguredWorkflowOptions,'image'>;type Graph=RuntimeConfiguredWorkflowBinding;
type Scope={taskId:string;deadline:string;signal:AbortSignal};type HostScope=OwnedWorkflowHostScope;
type Source={sourceRef:string;revision:string;kind:'metadata_only'|'knowledge_excerpt';text:string;knowledge?:KnowledgeSource};
export interface F10WorkflowConfiguration {sourceId:string;configRevision:number;publicQueries:string[];reviewer:Record<string,unknown>;}
export interface F10WorkflowOptions {
  getApplication:()=>RuntimeApplication;sourceConfiguration:()=>F10WorkflowConfiguration|undefined;
  toolExports:readonly CompetitionToolExport[];prepareCompetitionToolExport:PrepareCompetitionToolExport;
  assertCitationCurrent:(source:KnowledgeSource,configuration:F10WorkflowConfiguration,scope:Scope)=>void;
  readCitation:(source:KnowledgeSource,configuration:F10WorkflowConfiguration,scope:Scope)=>Promise<string>;
  authorizeReview:(scope:HostScope,finding:F10BoundFinding,text:string)=>Promise<boolean>;
  reviewClaim:(scope:HostScope,finding:F10BoundFinding,text:string)=>Promise<'supported'|'contradicted'|'unknown'>;
  authorizeExport:(request:Parameters<Worker['authorizeExport']>[0]&{workflowId:'F10'})=>Promise<boolean>;
}
const workflowId='F10',configKey='f10:source-configuration',researchVersion='0.1.0-alpha.2';
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:4000},empty=object({});
const findingSchema=object({claimId:{...text,maxLength:256},claim:text,sourceRef:text,revision:text,quote:text});
const claimContract=object({arguments:empty,findings:{type:'array',minItems:1,maxItems:6,items:findingSchema}});
const summaryContract=object({recommendation:{...text,maxLength:2000},claimIds:{type:'array',maxItems:6,items:text}});
const requestSchema=object({queryA:{...text,maxLength:400},queryB:{...text,maxLength:400},knowledgeQuery:{...text,maxLength:400},limit:{type:'integer',minimum:1,maximum:3}});
type Input={queryA:string;queryB:string;knowledgeQuery:string;limit:number;configuration:F10WorkflowConfiguration;claimContract:unknown;summaryContract:unknown};
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}

export function createF10WorkflowWorkerPorts(options:F10WorkflowOptions){
  const app=()=>options.getApplication(),asScope=(scope:HostScope)=>({taskId:scope.parentTaskId,deadline:scope.deadline,signal:scope.signal});
  const checking=new Set<string>();
  function current(scope:Scope){const task=app().runtime.getTask(scope.taskId),parent=app().readDelegatedUserTaskParent(scope.taskId),configuration=options.sourceConfiguration();
    if(scope.signal.aborted||task.cancelRequested)fail('CANCELLED','F10 original task cancelled');
    if(!parent||parent.deadline!==scope.deadline||!['running','waiting_approval'].includes(task.state)
      ||app().runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline||Date.parse(scope.deadline)<=Date.now())fail('UNAUTHORIZED','F10 original user task unavailable');
    const saved=app().runtime.loadCheckpoint(scope.taskId,configKey);
    if(!configuration||typeof configuration.sourceId!=='string'||!configuration.sourceId||!Number.isSafeInteger(configuration.configRevision)||configuration.configRevision<1
      ||!Array.isArray(configuration.publicQueries)||!configuration.publicQueries.length||!plain(configuration.reviewer)
      ||saved!==undefined&&!isDeepStrictEqual(saved,configuration))fail('REVISION_CONFLICT','F10 original source or reviewer changed');
    const session=app().runtime.loadCheckpoint(scope.taskId,'f10:session');
    if(typeof session==='string'&&!checking.has(scope.taskId)){checking.add(scope.taskId);try{
      for(const source of sources(graph(scope,session),true))if(source.knowledge){const checked:unknown=options.assertCitationCurrent(source.knowledge,configuration,scope);
        if(checked!==undefined){void Promise.resolve(checked).catch(()=>{});fail('UNAUTHORIZED','F10 final source guard must be synchronous');}}
    }finally{checking.delete(scope.taskId);}}
  }
  function graph(scope:Scope,sessionId:string):Graph {current(scope);const value=app().readConfiguredWorkflowBinding({taskId:scope.taskId,workflowId,sessionId,signal:scope.signal});
    if(!value||value.deadline!==scope.deadline||!isDeepStrictEqual((value.input as Input).configuration,options.sourceConfiguration()))fail('UNAUTHORIZED','F10 original graph unavailable');return value;}
  function operation(value:Graph,nodeId:string,name='workflow.host.'+nodeId.toLowerCase(),optional=false){const found=value.confirmedOperations.filter(item=>item.nodeId===nodeId&&item.toolName===name);
    if(found.length!==1){if(optional&&!found.length)return;fail('UNAUTHORIZED','F10 requires one original node receipt');}return found[0]!;}
  function selected(value:Graph,nodeId:string){const record=operation(value,nodeId,'decision.choose_candidate')!,intent=app().runtime.loadCheckpoint(record.localTaskId,'host-tool-intent') as {arguments?:Record<string,unknown>};
    let context;try{context=JSON.parse(String(intent.arguments?.context));}catch{fail('UNAUTHORIZED','F10 original selection unavailable');}
    if(!plain(context)||context.workflowId!==workflowId||context.nodeId!==nodeId||!isDeepStrictEqual(context.input,value.input)
      ||!Array.isArray(context.candidateValues)||!plain(record.result))fail('UNAUTHORIZED','F10 original selection changed');
    const matches=context.candidateValues.filter(item=>plain(item)&&item.id===(record.result as {selectedId?:string}).selectedId);
    if(matches.length!==1||!plain(matches[0])||matches[0].abstain===true)fail('UNSUPPORTED_CAPABILITY','F10 selection preserved uncertainty');return matches[0].value;
  }
  function query(value:Graph,nodeId:string){const request=value.input as Input;return nodeId==='F10_N04'?{sourceId:request.configuration.sourceId,configRevision:request.configuration.configRevision,
    query:request.knowledgeQuery,limit:request.limit}:{query:nodeId==='F10_N02'?request.queryA:request.queryB,limit:request.limit};}
  const toolName=(nodeId:string)=>nodeId==='F10_N04'?'knowledge.search':'research.search';
  const policy=(name:string)=>{const found=options.toolExports.filter(item=>item.toolName===name&&item.toolVersion===(name==='research.search'?researchVersion:'1.0.0'));
    if(found.length!==1)fail('UNSUPPORTED_CAPABILITY','F10 original source export policy unavailable');return found[0]!;};
  function projected(receipt:WorkflowBusinessToolReceipt){const read=app().readHostToolTask(receipt.taskId),saved=app().runtime.loadCheckpoint(receipt.taskId,'f10:projection') as {policyVersion?:string;resultDigest?:string;value?:unknown};
    const exportPolicy=policy(receipt.toolName);
    if(!saved||saved.policyVersion!==exportPolicy.exportPolicyVersion||saved.resultDigest!==toolArgumentsDigest(receipt.result)
      ||exportPolicy.accepts({taskId:receipt.taskId,proposalId:read.commandId,arguments:receipt.arguments,phase:'final',projection:saved.value})!==true)
      fail('UNAUTHORIZED','F10 source projection was revoked');return saved.value;}
  function sourceList(projection:unknown,nodeId:string,request:Input):Source[]{
    if(nodeId==='F10_N04')return f05KnowledgeEvidence(projection,'initial',request.configuration.sourceId,request.limit).map((item,index)=>({sourceRef:nodeId+':'+index,
      revision:item.source.revision,kind:'knowledge_excerpt',text:item.excerpt,knowledge:item.source}));
    if(!plain(projection)||!Array.isArray(projection.results)||projection.results.length>request.limit||!plain(projection.cache))fail('UNAUTHORIZED','F10 original research projection unavailable');
    return projection.results.map((item,index)=>{if(!plain(item)||typeof item.citation!=='string'||!item.citation||item.citation.length>16000
      ||item.source!=='research')fail('UNAUTHORIZED','F10 research metadata unavailable');
      const metadata=JSON.stringify({kind:'metadata_only',...item,cache:projection.cache,...(projection.retrieval?{retrieval:projection.retrieval}:{})});
      return {sourceRef:nodeId+':'+index,revision:toolArgumentsDigest(metadata),kind:'metadata_only',text:metadata};});
  }
  function sources(value:Graph,partial=false):Source[]{const result:Source[]=[];
    for(const nodeId of ['F10_N02','F10_N03','F10_N04']){const record=operation(value,nodeId,undefined,partial);if(!record)continue;
      const data=record.result as {original:WorkflowBusinessToolReceipt;sources:Source[]},scope={parentTaskId:app().runtime.loadCheckpoint(record.localTaskId,'coding-repair:parent') as {taskId:string}};
      const proof=readWorkflowBusinessToolSource(app(),{parentTaskId:scope.parentTaskId.taskId,sessionId:value.sessionId,deadline:value.deadline},data.original,toolName(nodeId));
      if(proof.graph.nodeId!==nodeId||proof.sourceHost.taskId!==record.localTaskId||!isDeepStrictEqual(proof.request.arguments,query(value,nodeId)))fail('UNAUTHORIZED','F10 original search changed');
      const expected=sourceList(projected(proof.receipt),nodeId,value.input as Input);
      if(!isDeepStrictEqual(data.sources,expected))fail('REVISION_CONFLICT','F10 original projected citations changed');result.push(...expected);
    }return result;}
  function findings(value:Graph,candidate=selected(value,'F10_N05')):F10BoundFinding[]{validateToolValue(claimContract,candidate);
    const list=(candidate as {findings:F10BoundFinding[]}).findings,available=sources(value),ids=new Set<string>();
    for(const item of list){const source=available.find(source=>source.sourceRef===item.sourceRef);
      if(ids.has(item.claimId)||!source||source.revision!==item.revision||!source.text.includes(item.quote))fail('UNAUTHORIZED','F10 claim has no original quoted source');ids.add(item.claimId);}return structuredClone(list);}
  async function citation(scope:HostScope,sourceRef:string,revision:string){const value=graph(asScope(scope),scope.sessionId),source=sources(value).find(item=>item.sourceRef===sourceRef&&item.revision===revision);
    if(!source)fail('UNAUTHORIZED','F10 original citation unavailable');if(source.knowledge){const body=await options.readCitation(source.knowledge,(value.input as Input).configuration,asScope(scope));current(asScope(scope));
      if(!body.includes(source.text))fail('REVISION_CONFLICT','F10 original knowledge excerpt changed');}return {revision,text:source.text};}
  function expectedPredecessors(value:Graph,nodeId:string){const result:Record<string,unknown>={};
    for(const dependency of getOwnedWorkflowTemplate(workflowId)!.nodes.find(node=>node.id===nodeId)!.dependencies)
      result[dependency.nodeId]=dependency.nodeId==='F10_N01'?{states:{},outputs:{}}:operation(value,dependency.nodeId)!.result;return result;}
  let bridgeApp:RuntimeApplication|undefined,bridge:ReturnType<typeof createWorkflowBusinessToolBridge>|undefined;
  function originalBridge(){if(bridgeApp!==app()){bridgeApp=app();bridge=createWorkflowBusinessToolBridge({application:bridgeApp,now:()=>new Date(),assertCurrent:scope=>current(asScope(scope)),
    resolveTool:(request,scope)=>{const nodeId=request.actionKey.slice('f10.source.'.length);if(!['F10_N02','F10_N03','F10_N04'].includes(nodeId))return;
      const value=graph(asScope(scope),scope.sessionId),arguments_=query(value,nodeId);if(!isDeepStrictEqual(arguments_,request.input))return;
      return {workflowId,nodeId,hostToolName:'workflow.host.'+nodeId.toLowerCase(),toolName:toolName(nodeId),toolVersion:nodeId==='F10_N04'?'1.0.0':researchVersion,arguments:arguments_};}});}return bridge!;}
  async function project(receipt:WorkflowBusinessToolReceipt,scope:HostScope){const exportPolicy=policy(receipt.toolName),read=app().readHostToolTask(receipt.taskId),proposal={kind:'tool_proposal' as const,
    proposalId:read.commandId,toolName:receipt.toolName,toolVersion:receipt.toolVersion,arguments:receipt.arguments,verification:'unverified' as const};
    const check=(phase:'preflight'|'final',projection?:unknown)=>{current(asScope(scope));const original=app().readHostToolTask(receipt.taskId);
      if(original.task.state!=='succeeded'||original.task.cancelRequested||original.confirmed?.runId!==receipt.runId||!isDeepStrictEqual(original.confirmed.result,receipt.result)
        ||exportPolicy.accepts({taskId:receipt.taskId,proposalId:read.commandId,arguments:receipt.arguments,phase,projection,signal:scope.signal})!==true)fail('UNAUTHORIZED','F10 original export denied');};
    check('preflight');await options.prepareCompetitionToolExport({phase:'projection',taskId:receipt.taskId,runId:receipt.runId,proposal,deadline:scope.deadline,signal:scope.signal});
    check('preflight');const value=await exportPolicy.project({taskId:receipt.taskId,proposalId:read.commandId,result:structuredClone(receipt.result),signal:scope.signal});check('final',value);
    app().runtime.saveCheckpointOnce(receipt.taskId,'f10:projection',{policyVersion:exportPolicy.exportPolicyVersion,resultDigest:toolArgumentsDigest(receipt.result),value});return value;}
  const tools:RegisteredTool[]=[];
  for(const nodeId of ['F10_N02','F10_N03','F10_N04'])tools.push(createOwnedWorkflowAdapter({nodeId,kind:'host',sideEffect:'read',requiredScopes:[nodeId==='F10_N04'?'knowledge:read':'research:read'],inputSchema:empty,outputSchema:{type:'object'},
    async execute(args,context){const scope=assertOwnedWorkflowHostScope({runtime:app().runtime,context,workflowId,nodeId,hostToolName:'workflow.host.'+nodeId.toLowerCase(),proposalArguments:args,
      assertCurrent:scope=>current(asScope(scope))}),value=graph(asScope(scope),scope.sessionId),receipt=await originalBridge().invoke({actionKey:'f10.source.'+nodeId,input:query(value,nodeId)},context);
      const projection=await project(receipt,scope),result=sourceList(projection,nodeId,value.input as Input);current(asScope(scope));
      return {sources:result,coverage:nodeId==='F10_N04'?'projected_excerpt_only':'metadata_only',original:{taskId:receipt.taskId,runId:receipt.runId,scopeRef:receipt.scopeRef,toolVersion:receipt.toolVersion,arguments:receipt.arguments}};
    }}));
  const receiptExports=new Map<string,Parameters<Worker['authorizeExport']>[0]>();
  const review=createRuntimeF10SupportedClaimsHost({application:{get runtime(){return app().runtime;},readHostToolTask:id=>app().readHostToolTask(id)},requiredScopes:['research:read','knowledge:read'],now:()=>new Date(),
    assertCurrent:scope=>current(asScope(scope)),resolveBoundFindings:async scope=>findings(graph(asScope(scope),scope.sessionId)),readCitation:citation,
    authorizeReview:options.authorizeReview,reviewClaim:options.reviewClaim,authorizeExport:async(scope,result)=>{
      const original=receiptExports.get(scope.localTaskId);
      if(!original||!isDeepStrictEqual((original.value as {result?:unknown}).result,result))fail('UNAUTHORIZED','F10 exact review export unavailable');
      return options.authorizeExport({...original,workflowId});
    }});tools.push(...review.tools);
  const worker:Worker={workflowId,toolName:'workflow.research.compare',toolVersion:'1.0.0',configurationVersion:'f10-original-research-v1',requestSchema,
    inputSchema:object({...requestSchema.properties,configuration:{type:'object'},claimContract:{type:'object'},summaryContract:{type:'object'}}),
    resultSchema:object({summaryTableReady:{const:true},rows:{type:'array',items:{type:'object'}},recommendation:text,verification:{const:'model_advisory'},coverage:{type:'object'},reviewer:{type:'object'}}),
    sideEffect:'read',publicEnumPaths:[],requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),{name:'decision.choose_candidate',version:'1.0.0'}],assertCurrent:current,
    available:scope=>{try{current(scope);policy('research.search');policy('knowledge.search');return true;}catch{return false;}},
    async resolveInput(args,scope){validateToolValue(requestSchema,args);current(scope);const configuration=options.sourceConfiguration()!;
      if(args.queryA===args.queryB||!configuration.publicQueries.includes(String(args.knowledgeQuery)))fail('UNAUTHORIZED','F10 needs distinct research queries and its selected public knowledge query');
      app().runtime.saveCheckpointOnce(scope.taskId,configKey,configuration);return {...args,configuration,claimContract,summaryContract};},
    assertFrontier(request){current(request);app().runtime.saveCheckpointOnce(request.taskId,'f10:session',request.state.sessionId);const value=graph(request,request.state.sessionId),proposal=request.proposal;
      if(proposal.toolName==='decision.choose_candidate'){let parsed;try{parsed=JSON.parse(String(proposal.arguments.context));}catch{return false;}
        if(!plain(parsed)||parsed.workflowId!==workflowId||parsed.nodeId!==proposal.nodeId||!isDeepStrictEqual(parsed.input,value.input)
          ||!isDeepStrictEqual(parsed.predecessors,expectedPredecessors(value,proposal.nodeId))||!Array.isArray(parsed.candidateValues)||!Array.isArray(proposal.arguments.candidates)
          ||!isDeepStrictEqual(parsed.candidateValues.map(item=>plain(item)?item.id:null),proposal.arguments.candidates.map(item=>plain(item)?item.id:null)))return false;
        for(const item of parsed.candidateValues){if(!plain(item)||item.branches!==undefined)return false;if(item.abstain===true)continue;
          if(proposal.nodeId==='F10_N05')findings(value,item.value);else if(proposal.nodeId==='F10_N06'){validateToolValue(summaryContract,item.value);
            if(!isDeepStrictEqual((item.value as {claimIds:unknown}).claimIds,findings(value).map(item=>item.claimId)))return false;}
          else if(!isDeepStrictEqual(item.value,{arguments:{}}))return false;}return true;}
      return tools.some(tool=>tool.descriptor.name===proposal.toolName&&tool.descriptor.name.endsWith('.'+proposal.nodeId.toLowerCase()))&&isDeepStrictEqual(proposal.arguments,{});
    },
    async authorizeExport(request){current(request);if(request.stage==='receipt'){
      const proposal=request.proposal,read=request.localTaskId?app().readHostToolTask(request.localTaskId):undefined;
      if(!proposal||!read?.confirmed||read.task.state!=='succeeded'||read.commandId!==proposal.operationId||!isDeepStrictEqual((request.value as {result?:unknown}).result,read.confirmed.result))fail('UNAUTHORIZED','F10 original export receipt unavailable');
      if(proposal.toolName==='workflow.host.f10_n05'){receiptExports.set(request.localTaskId!,request);try{await review.authorizeReceipt!({context:{taskId:request.localTaskId!,runId:read.confirmed.runId,authorizationRef:read.confirmed.runId,
        deadline:request.deadline,signal:request.signal,scopes:['research:read','knowledge:read']},result:read.confirmed.result});}finally{receiptExports.delete(request.localTaskId!);}current(request);return true;}}
      const allowed=await options.authorizeExport({...request,workflowId});current(request);return allowed===true;},
    async verifyCompletion(request){const value=graph(request,request.state.sessionId);for(const node of getOwnedWorkflowTemplate(workflowId)!.nodes)
      if(request.state.result?.nodes[node.id]?.state!=='completed')fail('UNAUTHORIZED','F10 original required branches incomplete');
      const list=findings(value),reviewed=operation(value,'F10_N05')!.result as {correctionsApplied:F10ClaimReview[]},summary=selected(value,'F10_N06') as {recommendation:string;claimIds:string[]};
      validateToolValue(summaryContract,summary);if(!isDeepStrictEqual(summary.claimIds,list.map(item=>item.claimId))||reviewed.correctionsApplied.length!==list.length)fail('UNAUTHORIZED','F10 summary does not match original review');
      const originalSources=sources(value),rows=list.map((item,index)=>{const review=reviewed.correctionsApplied[index]!,source=originalSources.find(source=>source.sourceRef===item.sourceRef)!;
        const expected={claimId:item.claimId,claim:item.claim,sourceRef:item.sourceRef,revision:item.revision,quote:item.quote};
        if(review.claimId!==item.claimId||review.sourceRef!==item.sourceRef||review.revision!==item.revision
          ||review.findingDigest!==createHash('sha256').update(JSON.stringify(expected)).digest('hex'))fail('UNAUTHORIZED','F10 original review digest changed');
        return {...item,state:review.state,sourceKind:source.kind};});
      return {result:{summaryTableReady:true,rows,recommendation:summary.recommendation,verification:'model_advisory',coverage:{research:'metadata_only',knowledge:'projected_excerpt_only'},
        reviewer:(value.input as Input).configuration.reviewer},resultSummary:'Original search snapshots and quoted excerpts reviewed; conclusions remain model advisory'};
    }};
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:review.unavailable,
    assertReviewCurrent(scope:HostScope,finding:F10BoundFinding,sourceText:string){const value=graph(asScope(scope),scope.sessionId),original=findings(value).find(item=>item.claimId===finding.claimId),source=sources(value).find(item=>item.sourceRef===finding.sourceRef);
      if(!isDeepStrictEqual(original,finding)||source?.text!==sourceText)fail('UNAUTHORIZED','F10 exact original review request changed');return (value.input as Input).configuration;}};
}
