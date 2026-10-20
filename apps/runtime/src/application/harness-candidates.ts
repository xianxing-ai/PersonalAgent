import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {parseHarnessCandidateTrial} from '@personal-agent/contracts/harness-candidates';
import type {HarnessCandidateContext} from '@personal-agent/contracts/harness-candidates';
import {compareHarnessCandidates} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';

export const HARNESS_CANDIDATE_COMPARE_TOOL='harness.candidates.compare';
export const HARNESS_CANDIDATE_TRIAL_TOOL='coding.repair.trial';
export interface RuntimeHarnessCandidateOptions {
  /** Trusted owner/executor binding. Missing or unverified H1 plan membership returns undefined. */
  getBinding(context:ToolContext):HarnessCandidateContext|undefined;
  /** Resolve only original owner or execution tasks validated against the persisted H1 plan/marker. */
  resolveTrialOrigin(ownerTaskId:string,runId:string,context:ToolContext):
    {actualTaskId:string;arguments:Record<string,unknown>;scopeRef:string}|undefined;
}
const denied=(message:string):never=>{throw new ProtocolError('UNAUTHORIZED',message);};
const schema={type:'object',additionalProperties:false,required:['trialRunIds'],properties:{trialRunIds:{type:'array',minItems:1,maxItems:16,
  uniqueItems:true,items:{type:'string',minLength:1,maxLength:256}}}};

/** Production RegisteredTool consumer; registration belongs to the original execution-worker catalog only. */
export function createRuntimeHarnessCandidateTools(application:Pick<RuntimeApplication,'runtime'>,
  options?:RuntimeHarnessCandidateOptions):RegisteredTool[] {
  if(!options)return [];
  const runtime=application.runtime;
  return [{descriptor:{name:HARNESS_CANDIDATE_COMPARE_TOOL,version:'1.0.0',inputSchema:schema,outputSchema:{},
    sideEffect:'read',requiredScopes:['workspace:read'],idempotencySupport:true,recoverySupport:false,requiresPresence:false},
    execute:async(value,context)=>{
      validateToolValue(schema,value);
      const active=()=>{
        const task=runtime.getTask(context.taskId);
        if(context.signal.aborted||task.cancelRequested)throw new ProtocolError('CANCELLED','Candidate comparison cancelled');
        if(!Number.isFinite(Date.parse(context.deadline))||Date.now()>=Date.parse(context.deadline))throw new ProtocolError('TIMEOUT','Candidate comparison deadline expired');
        if(task.state!=='running'||runtime.loadCheckpoint(context.taskId,'application-deadline')!==context.deadline
          ||!context.scopes.includes('workspace:read'))denied('Original candidate comparison scope changed');
      };
      active();
      const compareRun=runtime.readToolExecutions(context.taskId).find(r=>r.evidenceId===context.runId);
      if(!compareRun||compareRun.toolName!==HARNESS_CANDIDATE_COMPARE_TOOL||compareRun.toolVersion!=='1.0.0'
        ||compareRun.state!=='started'||!compareRun.executionStarted||compareRun.policyDecision!=='allow'
        ||!runtime.matchesToolExecutionInput(compareRun,{arguments:value as Record<string,unknown>,scopeRef:context.authorizationRef}))
        denied('Candidate comparison must enter the original Policy and ToolGateway');
      const binding=options.getBinding(context);
      if(!binding)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Trusted candidate comparison binding unavailable');
      const frozen=structuredClone(binding),key='harness-candidates:context';
      const prior=runtime.loadCheckpoint(context.taskId,key);
      if(prior!==undefined&&!isDeepStrictEqual(prior,frozen))throw new ProtocolError('REVISION_CONFLICT','Original candidate comparison binding changed');
      runtime.saveCheckpointOnce(context.taskId,key,frozen);
      if(!isDeepStrictEqual(runtime.loadCheckpoint(context.taskId,key),frozen))throw new ProtocolError('REVISION_CONFLICT','Candidate binding was claimed by another comparison');
      const {trialRunIds} = value as {trialRunIds:string[]};
      const trials=trialRunIds.map(runId=>{
        const origin=options.resolveTrialOrigin(frozen.binding.taskId,runId,context);
        if(!origin)denied('Candidate trial owner or executor is not verified');
        const actual=origin!,record=runtime.readToolExecutions(actual.actualTaskId).find(r=>r.evidenceId===runId);
        const saved=runtime.loadCheckpoint(actual.actualTaskId,'tool-result-'+runId) as {result?:unknown}|undefined;
        if(!record||record.taskId!==actual.actualTaskId||record.state!=='confirmed'||!record.executionStarted
          ||record.policyDecision!=='allow'||record.toolName!==HARNESS_CANDIDATE_TRIAL_TOOL||record.toolVersion!=='1.0.0'
          ||!runtime.matchesToolExecutionInput(record,{arguments:actual.arguments,scopeRef:actual.scopeRef})
          ||!runtime.readEvidence(actual.actualTaskId).some(e=>e.evidenceId===runId&&e.kind==='execution'&&e.sourceRef===HARNESS_CANDIDATE_TRIAL_TOOL)
          ||!saved||!Object.hasOwn(saved,'result'))denied('Original confirmed candidate trial Evidence unavailable');
        const trial=parseHarnessCandidateTrial(saved!.result);
        if(trial.binding.taskId!==frozen.binding.taskId||trial.binding.trialTaskId!==actual.actualTaskId
          ||trial.session.taskId!==actual.actualTaskId||trial.binding.candidateId!==actual.arguments.candidateId
          ||trial.checkReadback.verification.some(r=>!r.evidenceRefs.includes(runId)))denied('Candidate result differs from the original trial operation');
        return trial;
      });
      const result=compareHarnessCandidates(frozen,trials);
      if(result.recommendation)result.recommendation.trialRunId=trialRunIds[trials.findIndex(t=>t.binding.candidateId===result.recommendation!.candidateId)]!;
      active();
      if(!isDeepStrictEqual(options.getBinding(context),frozen)||!isDeepStrictEqual(runtime.loadCheckpoint(context.taskId,key),frozen))
        throw new ProtocolError('REVISION_CONFLICT','Candidate context changed during comparison');
      // This is a recommendation only. Isolated sessions still cannot publish the main workspace.
      return {...result,evidenceRefs:[...trialRunIds]};
    }}];
}
