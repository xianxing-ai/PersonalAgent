import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {AgentToolPort} from '@personal-agent/agents';
import {ModelGateway,UnavailableModelProvider} from '@personal-agent/models';
import type {ModelPort,ModelRequest} from '@personal-agent/models';
import {createCiFixWorkflow,createCiRunDiscoveryWorkflow} from '@personal-agent/coding-tools';
import type {CiFixOptions} from '@personal-agent/coding-tools';
import {createCodeReviewWorkflow,createIssueTriageWorkflow} from '@personal-agent/cognition';
import type {CodeReviewReport,CodeReviewRule,IssueTriageOptions} from '@personal-agent/cognition';
import type {WorkerContext} from '../index.js';
import type {RuntimeApplication} from './runtime-application.js';
import type {CoordinationToolProposalResult} from '@personal-agent/coordination';
import {parseCoordinationContinuation} from '@personal-agent/coordination';
import type {CoordinationWorkerCapabilityPort} from './coordination.js';

export const DEVELOPER_WORKFLOW_REQUEST='developer-workflow:request';
export const DEVELOPER_WORKFLOW_RESULT='developer-workflow:result';
export const DEVELOPER_WORKFLOW_KINDS=['ci_list','ci_fix','code_review','issue_list','issue_triage'] as const;
export type DeveloperWorkflowKind=typeof DEVELOPER_WORKFLOW_KINDS[number];
export interface DeveloperWorkflowRequest {
  kind:DeveloperWorkflowKind;repo:string;number?:number;runId?:string;page?:number;perPage?:number;
  publish?:boolean;writeLabel?:boolean;repairBug?:boolean;
}
export interface RuntimeDeveloperWorkflowScope {taskId:string;deadline:string;signal:AbortSignal;}
/** Trusted composition only. None of these ports or rules comes from a tool argument. */
export interface RuntimeDeveloperWorkflowsOptions {
  bindingId:string;
  repositories:readonly string[];
  model?:ModelPort;
  reviewRules?:readonly CodeReviewRule[];
  ciFix?:Omit<CiFixOptions,'repository'|'runId'|'model'|'tools'|'authorizationRefFor'|'confirmedReplayReady'|'maxSteps'|'maxTokens'>;
  issueTriage?:Pick<IssueTriageOptions,'labels'|'minConfidence'>;
  failedRunForIssue?:(repo:string,number:number)=>string|undefined;
  maxSteps:number;maxTokens:number;
  available:(kind:DeveloperWorkflowKind,scope:RuntimeDeveloperWorkflowScope)=>boolean|Promise<boolean>;
  assertCurrent:(scope:RuntimeDeveloperWorkflowScope)=>void;
  /** Exact model payload egress, including source snippets, logs and issue/diff content. */
  authorizeModelRequest?:(request:ModelRequest,scope:RuntimeDeveloperWorkflowScope)=>void|Promise<void>;
  /** The parent model receives only this explicitly approved projection. */
  projectResult?:(result:unknown,scope:RuntimeDeveloperWorkflowScope)=>unknown|Promise<unknown>;
}
interface BoundRequest {version:1;bindingId:string;taskId:string;deadline:string;proposalRevision:number;request:DeveloperWorkflowRequest;proposalDigest:string;}
export const developerWorkflowToolName=(kind:DeveloperWorkflowKind)=>`developer.${kind}`;
export const isDeveloperWorkflowTool=(name:string)=>DEVELOPER_WORKFLOW_KINDS.some(kind=>developerWorkflowToolName(kind)===name);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const repoSchema={type:'string',minLength:3,maxLength:201};
export function developerWorkflowInputSchema(kind:DeveloperWorkflowKind):Record<string,unknown> {
  const properties:Record<string,unknown>={repo:repoSchema},required=['repo'];
  if(kind==='ci_list'||kind==='issue_list')Object.assign(properties,{page:{type:'integer',minimum:1,maximum:10000},perPage:{type:'integer',minimum:1,maximum:30}});
  if(kind==='ci_fix'){properties.runId={type:'string',minLength:1,maxLength:32};required.push('runId');}
  if(kind==='code_review'||kind==='issue_triage'){properties.number={type:'integer',minimum:1};required.push('number');}
  if(kind==='code_review')properties.publish={type:'boolean'};
  if(kind==='issue_triage')Object.assign(properties,{writeLabel:{type:'boolean'},repairBug:{type:'boolean'}});
  return {type:'object',properties,required,additionalProperties:false};
}
export function developerWorkflowConfigured(options:RuntimeDeveloperWorkflowsOptions,kind:DeveloperWorkflowKind):boolean {
  if(!options.projectResult || !options.repositories.length)return false;
  if(kind==='ci_list'||kind==='issue_list')return true;
  if(!options.model||!options.authorizeModelRequest)return false;
  if(kind==='code_review')return !!options.reviewRules?.length;
  if(kind==='ci_fix')return !!options.ciFix?.gitTools&&!!options.ciFix.headBranch&&!!options.ciFix.baseBranch&&!!options.ciFix.sourcePaths.length;
  return true;
}
export function developerWorkflowRequiredTools(options:RuntimeDeveloperWorkflowsOptions,kind:DeveloperWorkflowKind):string[] {
  if(kind==='ci_list')return ['github.actions.run.list'];
  if(kind==='issue_list')return ['github.issue.list'];
  if(kind==='code_review')return ['github.pr.get','github.pr.diff'];
  if(kind==='issue_triage')return ['github.issue.get'];
  return ['github.actions.run.list','github.actions.job.list','github.actions.log.read','workspace.read_text',
    'workspace.apply_text_patch','workspace.run_allowed_command',...Object.values(options.ciFix?.gitTools??{})];
}
/** Worker capabilities execute inside the original child, like the existing native Skill port. */
export function createRuntimeDeveloperWorkflowWorker(application:RuntimeApplication,
  options:RuntimeDeveloperWorkflowsOptions,getTools:(taskId:string)=>AgentToolPort|undefined):CoordinationWorkerCapabilityPort {
  if(!options.bindingId.trim()||!options.repositories.length||!Number.isSafeInteger(options.maxSteps)||options.maxSteps<1
    ||!Number.isSafeInteger(options.maxTokens)||options.maxTokens<1||typeof options.available!=='function'||typeof options.assertCurrent!=='function')
    throw new ProtocolError('INVALID_ARGUMENT','Trusted developer workflow configuration is invalid');
  const key=(proposal:CoordinationToolProposalResult)=>'developer-workflow:'+hash(proposal.proposalId);
  return {accepts:proposal=>proposal.toolVersion==='1.0.0'&&isDeveloperWorkflowTool(proposal.toolName),
    dispatch:async(proposal,context)=>{
      const kind=DEVELOPER_WORKFLOW_KINDS.find(kind=>developerWorkflowToolName(kind)===proposal.toolName)!;
      validateToolValue(developerWorkflowInputSchema(kind),proposal.arguments);
      const request={...proposal.arguments,kind} as unknown as DeveloperWorkflowRequest;
      if(!options.repositories.includes(request.repo))throw new ProtocolError('SCOPE_DENIED','Repository is outside the trusted developer scope');
      const scope={taskId:context.taskId,deadline:context.deadline,signal:context.signal};
      options.assertCurrent({...scope});
      if(!developerWorkflowConfigured(options,kind)||!await options.available(kind,{...scope}))
        throw new ProtocolError('UNSUPPORTED_CAPABILITY','Developer workflow configuration or export permission is unavailable');
      const namespace=key(proposal),bindingKey=namespace+':binding';
      const bound:BoundRequest={version:1,bindingId:options.bindingId,taskId:context.taskId,deadline:context.deadline,proposalRevision:context.revision,
        request:structuredClone(request),proposalDigest:hash(proposal)};
      const previous=application.runtime.loadCheckpoint(context.taskId,bindingKey);
      if(previous!==undefined&&!isDeepStrictEqual(previous,bound))throw new ProtocolError('REVISION_CONFLICT','Original developer workflow changed');
      application.runtime.saveCheckpointOnce(context.taskId,bindingKey,bound);
      context.saveCheckpoint('developer-workflow:active',{bindingId:options.bindingId,proposalDigest:hash(proposal)});
      const tools=getTools(context.taskId);if(!tools)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original developer tool scope unavailable');
      if(developerWorkflowRequiredTools(options,kind).some(name=>!tools.list().some(tool=>tool.name===name)))
        throw new ProtocolError('UNSUPPORTED_CAPABILITY','Required developer tool is outside the original child scope');
      const worker={...context,loadCheckpoint:(key:string)=>context.loadCheckpoint(namespace+':'+key),
        saveCheckpoint:(key:string,value:unknown)=>context.saveCheckpoint(namespace+':'+key,value)};
      const outcome=await runRuntimeDeveloperWorkflow(application,request,worker,tools,options);
      if(outcome.state!=='confirmed')return {...outcome,selection:bound};
      let projected:unknown;
      try{projected=await options.projectResult!(structuredClone(outcome.result),{...scope});
        projected=parseCoordinationContinuation({proposalId:proposal.proposalId,state:'confirmed',result:projected}).result;
        if(context.signal.aborted||application.runtime.getTask(context.taskId).cancelRequested)throw new ProtocolError('CANCELLED','Developer result export cancelled');
        if(Date.now()>=Date.parse(context.deadline))throw new ProtocolError('TIMEOUT','Developer result export expired');
        options.assertCurrent({...scope});}
      catch{context.saveCheckpoint('competition-export-withheld',{withheld:true});
        if(application.runtime.getTask(context.taskId).state==='running')application.runtime.transitionTask(context.taskId,'waiting_reconciliation');
        throw new ProtocolError('UNAUTHORIZED','Confirmed developer result export denied');}
      const receipt={...bound,resultDigest:hash(projected)};
      context.saveCheckpoint(namespace+':receipt',{selection:receipt,result:structuredClone(projected)});
      return {...outcome,result:projected,selection:receipt};
    },assertReceiptAllowed:(proposal,selection,result,context)=>{
      options.assertCurrent(context);
      const saved=context.loadCheckpoint(key(proposal)+':receipt') as {selection:BoundRequest&{resultDigest:string};result:unknown}|undefined;
      if(!saved||saved.selection.bindingId!==options.bindingId||saved.selection.proposalDigest!==hash(proposal)
        ||saved.selection.taskId!==context.taskId||saved.selection.deadline!==context.deadline||saved.selection.proposalRevision!==context.revision
        ||saved.selection.resultDigest!==hash(result)||!isDeepStrictEqual(saved.selection,selection)||!isDeepStrictEqual(saved.result,result))
        throw new ProtocolError('UNAUTHORIZED','Original developer result receipt is unavailable');
    }};
}
/** Runs inside the original child worker. Every nested tool still uses Runtime/Policy/ToolGateway. */
async function runRuntimeDeveloperWorkflow(application:RuntimeApplication,request:DeveloperWorkflowRequest,
  worker:WorkerContext,tools:AgentToolPort,options:RuntimeDeveloperWorkflowsOptions):Promise<{state:'pending'|'unknown'|'confirmed';result:unknown;evidenceRefs:readonly string[]}> {
  if(!options.repositories.includes(request.repo))
    throw new ProtocolError('REVISION_CONFLICT','Original developer configuration is unavailable');
  const scope={taskId:worker.taskId,deadline:worker.deadline,signal:worker.signal};
  if(!developerWorkflowConfigured(options,request.kind)||!await options.available(request.kind,{...scope}))
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','Developer workflow configuration is unavailable');
  const replay=(runId:string)=>{
    const record=application.runtime.readToolExecutions(worker.taskId).find(item=>item.evidenceId===runId);
    return !!record&&record.state==='confirmed'&&record.executionStarted&&record.policyDecision==='allow'
      &&application.runtime.loadCheckpoint(worker.taskId,`tool-result-${runId}`)!==undefined;
  };
  const authorizationRefFor=()=>worker.taskId;
  const model=options.model?new ModelGateway({deployment:options.model.deployment,complete:async input=>{
    if(!options.authorizeModelRequest)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Exact developer model egress permission unavailable');
    const payload={...input,messages:structuredClone(input.messages),tools:structuredClone(input.tools)};
    await options.authorizeModelRequest({...payload,messages:structuredClone(payload.messages),tools:structuredClone(payload.tools)},{...scope});
    options.assertCurrent({...scope});
    if(worker.signal.aborted)throw new ProtocolError('CANCELLED','Developer workflow cancelled');
    const result=await options.model!.complete(payload);options.assertCurrent({...scope});return result;
  }}):undefined;
  const runFix=async(repo:string,runId?:string,issue?:NonNullable<CiFixOptions['issue']>,goal?:string,body?:string)=>{
    if(!options.ciFix||!model)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Trusted CI workspace and model required');
    return createCiFixWorkflow({...options.ciFix,repository:repo,...(runId?{runId}:{}),...(issue?{issue}:{}),
      ...(goal?{repairGoal:goal}:{}),...(body?{pullRequestBody:body}:{}),model,tools,authorizationRefFor,
      confirmedReplayReady:replay,maxSteps:options.maxSteps,maxTokens:options.maxTokens}).run(worker);
  };
  let result:unknown=worker.loadCheckpoint(DEVELOPER_WORKFLOW_RESULT);
  try {
    if(result===undefined || ['pending','unknown','waiting_approval','waiting_reconciliation'].includes(
      String((result as {state?:string;status?:string}).state??(result as {status?:string}).status))) {
      if(request.kind==='ci_list')result=await createCiRunDiscoveryWorkflow({tools,authorizationRefFor,maxSteps:options.maxSteps,
        confirmedReplayReady:replay}).listFailedRuns(worker,{repo:request.repo,...(request.page?{page:request.page}:{}),...(request.perPage?{perPage:request.perPage}:{})});
      else if(request.kind==='ci_fix')result=await runFix(request.repo,request.runId);
      else if(request.kind==='code_review') {
        const workflow=createCodeReviewWorkflow({model:model!,tools,maxTokens:Math.min(options.maxTokens,32000)});
        const access={runId:`${worker.taskId}:review`,authorizationRef:worker.taskId,confirmedReplayReady:replay};
        let report=worker.loadCheckpoint('developer-code-review-report') as CodeReviewReport|undefined;
        if(!report){const prepared=await workflow.prepare({repo:request.repo,number:request.number!,rules:options.reviewRules!},worker,access);
          if(prepared.state==='prepared'){report=prepared.report;worker.saveCheckpoint('developer-code-review-report',report);}else result=prepared;}
        if(report){result={state:'prepared',report,evidenceRefs:report.evidenceRefs};
          if(request.publish){const evidence=[...report.evidenceRefs];for(let index=0;index<report.findings.length;index++){
            const published=await workflow.publish(report,index,worker,{...access,runId:`${worker.taskId}:review:publish:${index}`});
            if('evidenceRefs' in published)evidence.push(...published.evidenceRefs);
            result={...published,report,evidenceRefs:[...new Set(evidence)]};if(published.state!=='confirmed')break;
          }}}
      } else {
        const triage=createIssueTriageWorkflow({...options.issueTriage,model:model??new UnavailableModelProvider('developer','unconfigured'),tools,authorizationRefFor,
          maxSteps:options.maxSteps,maxTokens:options.maxTokens,confirmedReplayReady:replay,
          confirmedRepairReplayReady:()=>{
            const receipt=application.runtime.loadCheckpoint(worker.taskId,'developer-confirmed-replay-receipt') as
              {runId:string;toolName:string;toolVersion:string;arguments:Record<string,unknown>}|undefined;
            if(!receipt?.runId.startsWith(`${worker.taskId}:ci-fix:`))return false;
            const records=application.runtime.readToolExecutions(worker.taskId).filter(record=>record.evidenceId.startsWith(`${worker.taskId}:ci-fix:`));
            const original=records.find(record=>record.evidenceId===receipt.runId);
            return !!original&&original.toolName===receipt.toolName&&original.toolVersion===receipt.toolVersion
              &&application.runtime.matchesToolExecutionInput(original,{arguments:receipt.arguments,scopeRef:receipt.runId})
              &&records.every(record=>replay(record.evidenceId));
          },
          ...(options.ciFix&&model?{repair:{repairIssue:async(_context,input)=>{
            const runId=options.failedRunForIssue?.(input.repo,input.number);
            if(!runId&&!options.ciFix?.expectedHeadSha)return {state:'unsupported',resultSummary:'No trusted issue repair source revision',evidenceRefs:[]};
            const outcome=await runFix(input.repo,runId,{url:input.issueUrl,number:input.number,repository:input.repo,fingerprint:input.issueFingerprint},input.goal,input.pullRequestBody);
            return {state:outcome.status,resultSummary:outcome.reason,evidenceRefs:outcome.evidenceRefs};
          }}}:{})});
        result=request.kind==='issue_list'?await triage.listIssues(worker,{repo:request.repo,...(request.page?{page:request.page}:{}),...(request.perPage?{perPage:request.perPage}:{})})
          :await triage.triageIssue(worker,{repo:request.repo,number:request.number!,...(request.writeLabel!==undefined?{writeLabel:request.writeLabel}:{}),
            ...(request.repairBug!==undefined?{repairBug:request.repairBug}:{}),...(request.repairBug?{repairGoal:options.ciFix?.repairGoal
              ??'Repair the bound issue within the trusted source paths and required verification recipe; preserve unrelated behavior.'}:{})});
      }
      worker.saveCheckpoint(DEVELOPER_WORKFLOW_RESULT,result);
    }
    const outcome=result as {state?:string;status?:string;reason?:string;evidenceRefs?:readonly string[]},state=outcome.state??outcome.status;
    if(state==='pending'||state==='waiting_approval'||state==='unknown'||state==='waiting_reconciliation') {
      if(application.runtime.getTask(worker.taskId).state==='running')application.runtime.transitionTask(worker.taskId,
        state==='pending'||state==='waiting_approval'?'waiting_approval':'waiting_reconciliation');
    }else if(['unsupported','verification_failed','stale'].includes(state??''))throw new ProtocolError('EXTERNAL_FAILURE','Developer workflow did not complete');
    return {state:state==='pending'||state==='waiting_approval'?'pending':state==='unknown'||state==='waiting_reconciliation'?'unknown':'confirmed',result,evidenceRefs:outcome.evidenceRefs??[]};
  }catch(error){const task=application.runtime.getTask(worker.taskId);
    if(task.state==='waiting_approval'||task.state==='waiting_reconciliation')return {state:task.state==='waiting_approval'?'pending':'unknown',result:null,evidenceRefs:task.evidenceRefs};
    throw error;}
}
