import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import {parseF20DocumentCandidate} from '@personal-agent/contracts/f20-candidate';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import {CODING_DECISION_CHECKPOINT} from './coding-decision-tool.js';
import type {RuntimeCodingDecisionReceipt} from './coding-decision-tool.js';
import type {RuntimeF20Input} from './owned-workflow-worker-capability.js';
import type {RuntimeOwnedWorkflowDriverState} from './owned-workflow-driver.js';
import {assertF20CandidateSelection} from './f20-candidate-frontier.js';

export const F20_COMMAND_TOOL='workspace.run_allowed_command';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const denied=():never=>{throw new ProtocolError('UNAUTHORIZED','Original F20 trial binding is unavailable or changed');};

type F20Graph=RuntimeOwnedWorkflowDriverState<RuntimeF20Input>;

/** Only the selected draft can enter the original trial. Reviewed drafts remain execution evidence. */
export function readF20DraftSelection(application:RuntimeApplication,taskId:string,graph:F20Graph,readOnlyRecovery=false) {
  const runtime=application.runtime,node=graph.result?.nodes.F20_N02;
  if(node?.state!=='completed')return denied();
  const choices=Object.values(graph.confirmedOperations??{}).filter(item=>item.nodeId==='F20_N02'&&item.toolName==='decision.choose_candidate');
  let selected:{candidateId:string;candidate:ReturnType<typeof parseF20DocumentCandidate>}|undefined;
  const evidenceRefs:string[]=[];
  for(const choice of choices){
    const original=runtime.loadCheckpoint(taskId,'owned-workflow:operation:'+choice.operationId) as
      {taskId?:string;sessionId?:string;workflowId?:string;localTaskId?:string;
        proposal?:{nodeId?:string;operationId?:string;toolName?:string;toolVersion?:string;arguments?:Record<string,unknown>}}|undefined;
    const parent=runtime.loadCheckpoint(choice.localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const observed=application.readHostToolTask(choice.localTaskId),proposal=original?.proposal;
    if(original?.taskId!==taskId||original.sessionId!==graph.sessionId||original.workflowId!=='F20'||original.localTaskId!==choice.localTaskId
      ||proposal?.nodeId!=='F20_N02'||proposal.operationId!==choice.operationId||proposal.toolName!==choice.toolName||proposal.toolVersion!=='1.0.0'
      ||parent?.taskId!==taskId||parent.operationId!==choice.operationId
      ||observed.commandId!==choice.operationId||observed.toolName!==proposal.toolName||observed.toolVersion!==proposal.toolVersion
      ||observed.task.state!=='succeeded'||!observed.confirmed?.evidenceRefs.length
      ||observed.confirmed.evidenceRefs.some(ref=>!node.evidenceRefs?.includes(ref))
      ||!isDeepStrictEqual(observed.confirmed.result,choice.result)||!plain(choice.result)||typeof choice.result.selectedId!=='string'
      ||typeof proposal.arguments?.context!=='string')return denied();
    let context:unknown;try{context=JSON.parse(proposal.arguments.context);}catch{return denied();}
    if(!plain(context)||context.workflowId!=='F20'||context.nodeId!=='F20_N02'||!Array.isArray(context.candidateValues))return denied();
    const candidateId=choice.result.selectedId,values=context.candidateValues;
    evidenceRefs.push(...observed.confirmed.evidenceRefs);
    if(candidateId==='owned-review'){
      const intent=runtime.loadCheckpoint(taskId,'owned-workflow:intent:'+choice.operationId) as
        {taskId?:string;sessionId?:string;workflowId?:string;proposal?:unknown}|undefined;
      const sentinel=values.filter(value=>plain(value)&&value.id===candidateId);
      if(intent?.taskId!==taskId||intent.sessionId!==graph.sessionId||intent.workflowId!=='F20'
        ||!isDeepStrictEqual(intent.proposal,proposal)||sentinel.length!==1||sentinel[0].abstain!==true||sentinel[0].value!==null)return denied();
      continue;
    }
    if(selected)return denied();
    assertF20CandidateSelection({runtime,parentTaskId:taskId,operationId:choice.operationId,candidateValues:values,selectedId:candidateId,
      ...(readOnlyRecovery?{readOnlyRecovery:true}:{})});
    const candidate=parseF20DocumentCandidate(values.find(value=>plain(value)&&value.id===candidateId)?.value);
    if(!isDeepStrictEqual(node.value,candidate))return denied();
    selected={candidateId,candidate};
  }
  if(!selected)return denied();
  return {...selected,choices,evidenceRefs};
}

/** Original pending proposal and confirmed HostBridge reads only. No checkpoint enumeration or authority grant. */
export function readRuntimeF20Binding(application:RuntimeApplication,scope:{taskId:string;deadline:string;signal:AbortSignal}) {
  return readBinding(application,scope);
}
function readBinding(application:RuntimeApplication,scope:{taskId:string;deadline:string;signal:AbortSignal},recovery=false) {
  const runtime=application.runtime,task=runtime.getTask(scope.taskId);
  const loop=runtime.loadCheckpoint(scope.taskId,'competition-loop') as {pending?:{proposalId?:string;toolName?:string;toolVersion?:string};pendingRevision?:number}|undefined;
  if(loop?.pending?.toolName!=='workflow.image.execute'||loop.pending.toolVersion!=='1.0.0'||typeof loop.pending.proposalId!=='string')return undefined;
  const key='owned-workflow:f20:'+hash(loop.pending.proposalId);
  const bound=runtime.loadCheckpoint(scope.taskId,key+':binding') as {version?:number;taskId?:string;deadline?:string;revision?:number;bindingId?:string;proposalDigest?:string;inputRef?:string;input?:RuntimeF20Input}|undefined;
  const state=runtime.loadCheckpoint(scope.taskId,key+':graph') as RuntimeOwnedWorkflowDriverState<RuntimeF20Input>|undefined;
  if(scope.signal.aborted||(recovery?task.state!=='waiting_reconciliation':task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state)
    ||Date.now()>=Date.parse(scope.deadline))||!Number.isFinite(Date.parse(scope.deadline))||runtime.loadCheckpoint(scope.taskId,'application-deadline')!==scope.deadline
    ||bound?.version!==1||bound.taskId!==scope.taskId||bound.deadline!==scope.deadline||bound.revision!==loop.pendingRevision
    ||bound.proposalDigest!==hash(loop.pending)||!bound.input||!state||state.bindingId!==bound.bindingId||!isDeepStrictEqual(state.input,bound.input))denied();
  const input=bound!.input!,graph=state!;
  const sourceReads=[];
  for(const record of Object.values(graph.confirmedOperations??{})){
    if(record.toolName!=='workspace.read_text')continue;
    const original=runtime.loadCheckpoint(scope.taskId,'owned-workflow:operation:'+record.operationId) as {taskId?:string;sessionId?:string;workflowId?:string;localTaskId?:string;proposal?:{arguments?:unknown}}|undefined;
    const parent=runtime.loadCheckpoint(record.localTaskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
    const observed=application.readHostToolTask(record.localTaskId),value=observed.confirmed?.result;
    if(original?.taskId!==scope.taskId||original.sessionId!==graph.sessionId||original.workflowId!=='F20'||original.localTaskId!==record.localTaskId
      ||parent?.taskId!==scope.taskId||parent.operationId!==record.operationId||observed.commandId!==record.operationId
      ||observed.toolName!=='workspace.read_text'||observed.task.state!=='succeeded'||!observed.confirmed?.evidenceRefs.length
      ||!isDeepStrictEqual(value,record.result)||!plain(value)||typeof value.path!=='string'||typeof value.content!=='string'
      ||![input.schemaFile,input.codeFile].includes(value.path)||!plain(original.proposal?.arguments)||original.proposal.arguments.path!==value.path)denied();
    sourceReads.push(observed);
  }
  const contents=new Map<string,string>();
  for(const read of sourceReads){const value=read.confirmed!.result as {path:string;content:string};
    if(contents.has(value.path)&&contents.get(value.path)!==value.content)denied();contents.set(value.path,value.content);}
  const sourceDigest=contents.has(input.schemaFile)&&contents.has(input.codeFile)?hash({sourceVersion:input.sourceVersion,
    schemaFile:input.schemaFile,codeFile:input.codeFile,schemaSha256:sha(contents.get(input.schemaFile)!),codeSha256:sha(contents.get(input.codeFile)!)}):undefined;
  return structuredClone({input,inputRef:bound!.inputRef!,state:graph,sourceReads,sourceDigest});
}

/** Active N03 ToolGateway invocation only; H1 identities and model assertions cannot satisfy it. */
export function readRuntimeF20TrialBinding(application:RuntimeApplication,context:ToolContext) {
  return readTrialBinding(application,context);
}
/** Historical facts only. This cannot create an execution ToolContext or reopen the trial. */
export function readRuntimeF20RecoveryBinding(application:RuntimeApplication,taskId:string) {
  const runId='host-tool-'+taskId;
  const deadline=(application.runtime.loadCheckpoint(taskId,'application-tool-invocation:'+runId) as {deadline?:string}|undefined)?.deadline;
  if(typeof deadline!=='string')return undefined;
  return readTrialBinding(application,{taskId,runId,authorizationRef:runId,scopes:[],deadline,signal:new AbortController().signal},true);
}
function readTrialBinding(application:RuntimeApplication,context:ToolContext,recovery=false) {
  const runtime=application.runtime;
  const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
  if(!parent?.taskId||!parent.operationId)return undefined;
  const saved=readBinding(application,{taskId:parent.taskId,deadline:context.deadline,signal:context.signal},recovery);
  if(!saved)return undefined;
  const operation=runtime.loadCheckpoint(parent.taskId,'owned-workflow:operation:'+parent.operationId) as {taskId?:string;sessionId?:string;workflowId?:string;localTaskId?:string;proposal?:{nodeId?:string;toolName?:string;arguments?:unknown}}|undefined;
  const linked=runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId) as
    {localTaskId?:string;request?:{toolName?:string;arguments?:unknown};mappedRequest?:{toolName?:string;arguments?:unknown}}|undefined;
  const invocation=runtime.loadCheckpoint(context.taskId,'application-tool-invocation:'+context.authorizationRef) as {toolName?:string;arguments?:unknown;deadline?:string}|undefined;
  const execution=runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId);
  if(!saved.sourceDigest||context.runId!=='host-tool-'+context.taskId||context.authorizationRef!==context.runId
    ||operation?.taskId!==parent.taskId||operation.workflowId!=='F20'||operation.sessionId!==saved.state.sessionId||operation.localTaskId!==context.taskId
    ||operation.proposal?.nodeId!=='F20_N03'||operation.proposal.toolName!==F20_COMMAND_TOOL||linked?.localTaskId!==context.taskId
    ||linked.request?.toolName!==F20_COMMAND_TOOL||!isDeepStrictEqual(linked.request.arguments,{recipeId:saved.input.recipeId})
    ||!isDeepStrictEqual(linked.request.arguments,operation.proposal.arguments)||invocation?.toolName!=='coding.repair.trial'
    ||linked.mappedRequest?.toolName!=='coding.repair.trial'||invocation.deadline!==context.deadline
    ||!isDeepStrictEqual(invocation.arguments,linked.mappedRequest.arguments)
    ||(recovery?runtime.getTask(context.taskId).state!=='waiting_reconciliation'
      ||saved.state.waiting?.localTaskId!==context.taskId||saved.state.waiting.operationId!==parent.operationId
      :runtime.getTask(context.taskId).state!=='running'||runtime.getTask(context.taskId).cancelRequested)
    ||execution?.state!==(recovery?'unknown':'started')||execution.policyDecision!=='allow'||!execution.executionStarted
    ||!plain(invocation.arguments)||!runtime.matchesToolExecutionInput(execution,{arguments:invocation.arguments,scopeRef:context.authorizationRef}))denied();
  const {candidateId,candidate}=readF20DraftSelection(application,parent.taskId,saved.state,recovery);
  const samplePath=saved.input.codeFile+'.f20-sample.ts';
  const args={candidateId,recipeIds:[saved.input.recipeId],patches:[{path:samplePath,expectedSha256:null,edits:[],createText:candidate.sampleSnippet}]};
  if(!isDeepStrictEqual(args,invocation!.arguments))denied();
  return {...saved,ownerTaskId:parent.taskId,candidateId,candidate,samplePath};
}

/** Choose only an operation already fixed by the case. Its execution still goes through the graph and Policy. */
export function selectBoundF20Operation(application:RuntimeApplication,context:ToolContext,originalContext:string):string|undefined {
  const runtime=application.runtime,parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId:string;operationId:string}|undefined;
  if(!parent)return undefined;
  const saved=readRuntimeF20Binding(application,{taskId:parent.taskId,deadline:context.deadline,signal:context.signal});
  if(!saved)return undefined;
  const proposal=saved.state.result?.proposals.find(item=>item.operationId===parent.operationId);
  if(!proposal||!['F20_N01','F20_N03'].includes(proposal.nodeId))return undefined;
  if(proposal.kind!=='tool_proposal'||proposal.toolName!=='decision.choose_candidate'
    ||proposal.arguments.context!==originalContext||saved.state.result?.nodes[proposal.nodeId]?.state!=='waiting_receipt'
    ||!saved.sourceDigest)denied();
  const selection=JSON.parse(originalContext) as {candidateValues:{id:string;value:unknown;abstain?:boolean}[]};
  const expected=proposal.nodeId==='F20_N01'
    ?{toolName:'workspace.read_text',toolVersion:'1.0.0',arguments:{path:saved.input.schemaFile}}
    :{toolName:F20_COMMAND_TOOL,toolVersion:'1.0.0',arguments:{recipeId:saved.input.recipeId}};
  const selected=selection.candidateValues.find(candidate=>!candidate.abstain&&isDeepStrictEqual(candidate.value,expected));
  if(!selected)throw new ProtocolError('UNSUPPORTED_CAPABILITY','F20 did not propose the exact configured operation');
  return selected.id;
}

/** Local model review sees independently read original sources, never cloud-supplied source replacements. */
export function f20ReviewContext(application:RuntimeApplication,context:ToolContext,originalContext:string):string {
  const runtime=application.runtime,parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId?:string;operationId?:string}|undefined;
  if(!parent?.taskId||!parent.operationId)return originalContext;
  const saved=readRuntimeF20Binding(application,{taskId:parent.taskId,deadline:context.deadline,signal:context.signal});
  if(!saved)return originalContext;
  const op=runtime.loadCheckpoint(parent.taskId,'owned-workflow:operation:'+parent.operationId) as {localTaskId?:string;proposal?:{nodeId?:string;toolName?:string;arguments?:{context?:string}}}|undefined;
  if(!op?.proposal||!['F20_N02','F20_N04'].includes(String(op.proposal.nodeId)))return originalContext;
  if(op.localTaskId!==context.taskId||op.proposal.toolName!=='decision.choose_candidate'||op.proposal.arguments?.context!==originalContext||!saved.sourceDigest)denied();
  if(op.proposal.nodeId==='F20_N02')return JSON.stringify({instruction:'Choose a document draft only when supported by both original local sources. Otherwise abstain. No isolated sample has been checked yet and no publication is authorized.',
    untrustedCandidateContext:originalContext,input:saved.input,sourceDigest:saved.sourceDigest,originalSources:saved.sourceReads.map(read=>read.confirmed!.result)});
  const trials=Object.values(saved.state.confirmedOperations??{}).filter(item=>item.nodeId==='F20_N03'&&item.toolName===F20_COMMAND_TOOL);
  if(trials.length!==1)denied();
  const trial=application.readHostToolTask(trials[0]!.localTaskId);
  if(trial.task.state!=='succeeded'||!trial.confirmed?.evidenceRefs.length||!isDeepStrictEqual(trial.confirmed.result,trials[0]!.result))denied();
  const {candidate}=readF20DraftSelection(application,parent.taskId,saved.state);
  const review=JSON.parse(originalContext) as {candidateValues?:{id:string;value:unknown;abstain?:boolean}[]};
  if(!Array.isArray(review.candidateValues)||!review.candidateValues.some(value=>value.abstain!==true&&isDeepStrictEqual(value.value,candidate))
    ||review.candidateValues.some(value=>value.abstain!==true&&!isDeepStrictEqual(value.value,candidate)))denied();
  return JSON.stringify({instruction:'Review documentation against the original contract and implementation. Select only a candidate fully supported by both sources and the exact isolated TypeScript trial. Unsupported claims must be labelled proposed/unverified. Otherwise select the review/abstain candidate. This is a semantic review, never permission to publish.',
    untrustedCandidateContext:originalContext,input:saved.input,sourceDigest:saved.sourceDigest,originalCandidate:candidate,
    originalSources:saved.sourceReads.map(read=>read.confirmed!.result),originalTrial:trial.confirmed!.result});
}

/** Build a second opinion from the original cloud prompt and previously exported case results. */
export function buildOwnedWorkflowTeacherContext(application:RuntimeApplication,context:ToolContext,originalContext:string):
  {ownerTaskId:string;reviewContext:string}|undefined {
  const runtime=application.runtime;
  const parent=runtime.loadCheckpoint(context.taskId,'coding-repair:parent') as {taskId:string;operationId:string}|undefined;
  if(!parent)return undefined;
  const owner=runtime.getTask(parent.taskId);
  const operation=runtime.loadCheckpoint(parent.taskId,'coding-repair:host:'+parent.operationId) as
    {localTaskId:string;request:{toolName:string;deadline:string;arguments?:Record<string,unknown>}}|undefined;
  if(owner.cancelRequested||owner.state!=='running'||operation?.localTaskId!==context.taskId
    ||operation.request.toolName!=='decision.choose_candidate'||operation.request.deadline!==context.deadline
    ||operation.request.arguments?.context!==originalContext)return undefined;
  const original=JSON.parse(originalContext) as {workflowId:string;nodeId:string;
    candidateValues:{id:string;value:unknown;abstain?:boolean}[]};
  if(original.workflowId==='F15'&&runtime.loadCheckpoint(parent.taskId,'coding-repair:worker-capability'))
    return {ownerTaskId:parent.taskId,reviewContext:originalContext};
  if(original.workflowId!=='F20'||!['F20_N02','F20_N04'].includes(original.nodeId))return undefined;
  const saved=readRuntimeF20Binding(application,{taskId:parent.taskId,deadline:context.deadline,signal:context.signal});
  const confirmed=Object.values(saved?.state.confirmedOperations??{});
  const read=confirmed.find(item=>item.nodeId==='F20_N01'&&item.toolName==='workspace.read_text');
  const exported=read?.exportedResult;
  if(!saved?.sourceDigest||!plain(exported)||!Array.isArray(exported.originalSources))return denied();
  const sources=exported.originalSources.map((source:unknown)=>{
    if(!plain(source)||!saved.sourceReads.some(item=>isDeepStrictEqual(item.confirmed?.result,source)))return denied();
    return {path:source.path,content:source.content};
  });
  const candidates=original.candidateValues.filter(candidate=>!candidate.abstain)
    .map(({id,value})=>({id,...parseF20DocumentCandidate(value)}));
  const check=confirmed.find(item=>item.nodeId==='F20_N03'&&item.toolName===F20_COMMAND_TOOL)?.exportedResult;
  if(original.nodeId==='F20_N04'&&(!plain(check)||check.recipeId!==saved.input.recipeId||check.exitCode!==0))denied();
  return {ownerTaskId:parent.taskId,reviewContext:JSON.stringify({
    question:original.nodeId==='F20_N02'
      ?'Which draft accurately describes both sources and has an example suitable for isolated TypeScript checking?'
      :'Which previously selected draft is fully supported by the original sources and the confirmed isolated TypeScript check?',
    sources,candidates,...(original.nodeId==='F20_N04'?{typeScriptCheck:{recipeId:saved.input.recipeId,exitCode:0}}:{}),
  })};
}

export function verifyF20ReviewCompletion(application:RuntimeApplication,scope:{taskId:string;deadline:string;signal:AbortSignal}) {
  const saved=readRuntimeF20Binding(application,scope);if(!saved)denied();
  const records=Object.values(saved!.state.confirmedOperations??{}).filter(item=>item.nodeId==='F20_N04'&&item.toolName==='decision.choose_candidate');
  if(records.length!==1)denied();
  const record=records[0]!,readback=application.readHostToolTask(record.localTaskId);
  const operation=application.runtime.loadCheckpoint(scope.taskId,'owned-workflow:operation:'+record.operationId) as {proposal?:{arguments?:{context?:string}}}|undefined;
  const runId='host-tool-'+record.localTaskId,original=operation?.proposal?.arguments?.context;
  const receipt=application.runtime.loadCheckpoint(record.localTaskId,CODING_DECISION_CHECKPOINT+runId) as RuntimeCodingDecisionReceipt|undefined;
  if(readback.task.state!=='succeeded'||!readback.confirmed?.evidenceRefs.length||!isDeepStrictEqual(readback.confirmed.result,record.result)
    ||!plain(record.result)||typeof record.result.selectedId!=='string'||typeof original!=='string'||receipt?.disposition!=='selected'
    ||receipt.selectedId!==record.result.selectedId||receipt.taskId!==record.localTaskId||receipt.runId!==runId
    ||receipt.argumentsDigest!==toolArgumentsDigest(operation!.proposal!.arguments!))denied();
  const context=f20ReviewContext(application,{taskId:record.localTaskId,runId,authorizationRef:runId,scopes:[],deadline:scope.deadline,signal:scope.signal},original!);
  if(receipt!.contextDigest!==sha(context))denied();
  if(receipt!.teacher){
    const proof=application.runtime.loadCheckpoint(record.localTaskId,'owned-workflow-teacher:v1:'+runId+':result');
    const {selectedId,requestId,executionModel}=receipt!.teacher;
    if(!plain(proof)||proof.ownerTaskId!==scope.taskId||proof.runId!==runId||proof.argumentsDigest!==receipt!.argumentsDigest
      ||proof.deadline!==scope.deadline||proof.selectedId!==selectedId||selectedId!==receipt!.selectedId
      ||proof.requestId!==requestId||!isDeepStrictEqual(proof.executionModel,executionModel))denied();
  }
  const values=JSON.parse(original!).candidateValues;
  assertF20CandidateSelection({runtime:application.runtime,parentTaskId:scope.taskId,operationId:record.operationId,
    candidateValues:values,selectedId:(record.result as {selectedId:string}).selectedId});
  return true;
}
