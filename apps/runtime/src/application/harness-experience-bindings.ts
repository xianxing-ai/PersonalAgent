import {ProtocolError} from '@personal-agent/contracts';
import {parseCodingRepairInput,parseCodingRepairPublishRequest,parseCodingRepairPublishReadback} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairInput} from '@personal-agent/contracts/coding-repair';
import type {TaskRuntime} from '../index.js';
import type {HarnessExperienceOrigin,HarnessExperienceRun} from './harness-experience.js';

/** Pure host readers supplied by the canonical MOD31 bindings. No second journal/envelope/patch copy. */
export interface HarnessExperienceCanonicalReaders {
  readOriginalSessionForProvenance(input:{ownerTaskId:string;actualTaskId:string;runId:string}):CodingRepairInput|undefined;
  /** Exact refs persisted by the original adoption.readSelection, never a "latest comparison" lookup. */
  readAdoptionOrigin(input:{ownerTaskId:string;actualTaskId:string;runId:string}):unknown;
}
const object=(value:unknown):Record<string,unknown>|undefined=>
  value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const runRef=(value:unknown):HarnessExperienceRun|undefined=>{
  const v=object(value);
  return v&&typeof v.taskId==='string'&&typeof v.runId==='string'?{taskId:v.taskId,runId:v.runId}:undefined;
};

/** Read-only adapter over original canonical journals. Membership and original execution still revalidated by H1/core. */
export function createHarnessExperienceBindings(runtime:TaskRuntime,canonical:HarnessExperienceCanonicalReaders) {
  if(typeof canonical?.readOriginalSessionForProvenance!=='function'||typeof canonical?.readAdoptionOrigin!=='function')
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','Canonical harness journal readers are required');
  const record=(run:HarnessExperienceRun)=>runtime.readToolExecutions(run.taskId).find(r=>r.evidenceId===run.runId);
  const readInvocation=(run:HarnessExperienceRun)=>{
    const executed=record(run);
    const saved=runtime.loadCheckpoint(run.taskId,`application-tool-invocation:${run.runId}`) as
      {toolName:string;toolVersion:string;arguments:Record<string,unknown>}|undefined;
    if(!executed||!saved||saved.toolName!==executed.toolName||saved.toolVersion!==executed.toolVersion
      ||!runtime.matchesToolExecutionInput(executed,{arguments:saved.arguments,scopeRef:run.runId}))return undefined;
    return {arguments:structuredClone(saved.arguments),scopeRef:run.runId};
  };
  const readMainInput=(run:HarnessExperienceRun):CodingRepairInput|undefined=>{
    const executed=record(run);
    if(executed?.toolName!=='coding.repair.prepare_adoption'||!readInvocation(run))return undefined;
    const original=canonical.readOriginalSessionForProvenance({ownerTaskId:run.taskId,actualTaskId:run.taskId,runId:run.runId});
    if(!original)return undefined;
    const parsed=parseCodingRepairInput(original);
    return parsed.session.mode==='main'&&parsed.session.taskId===run.taskId?parsed:undefined;
  };
  const readOrigin=(ownerTaskId:string,publicationRunId:string):HarnessExperienceOrigin|undefined=>{
    const publication={taskId:ownerTaskId,runId:publicationRunId},executed=record(publication),invocation=readInvocation(publication);
    if(executed?.toolName!=='coding.repair.publish'||executed.state!=='confirmed'||!invocation)return undefined;
    const request=parseCodingRepairPublishRequest(invocation.arguments);
    const cache=runtime.loadCheckpoint(ownerTaskId,`tool-result-${publicationRunId}`) as {result?:unknown}|undefined;
    if(!cache||cache.result===undefined)return undefined;
    const published=parseCodingRepairPublishReadback(cache.result);
    if(published.state!=='published'||published.sessionId!==request.sessionId)return undefined;
    // Resolve by the exact published session ID. Multiple matches are a conflict, not a reason to guess newest.
    const matches=runtime.readToolExecutions(ownerTaskId).filter(r=>r.toolName==='coding.repair.prepare_adoption'&&r.state==='confirmed')
      .map(r=>({taskId:ownerTaskId,runId:r.evidenceId})).filter(run=>readMainInput(run)?.session.sessionId===request.sessionId);
    if(matches.length!==1)return undefined;
    const adoption=matches[0]!;
    const selected=object(canonical.readAdoptionOrigin({ownerTaskId,actualTaskId:adoption.taskId,runId:adoption.runId}));
    const originalAdoption=runRef(selected?.adoption),trial=runRef(selected?.trial),comparison=runRef(selected?.comparison);
    if(selected?.version!==1||selected.ownerTaskId!==ownerTaskId||!originalAdoption||originalAdoption.taskId!==adoption.taskId
      ||originalAdoption.runId!==adoption.runId||!trial||!comparison)return undefined;
    const trialCache=runtime.loadCheckpoint(trial.taskId,`tool-result-${trial.runId}`) as {result?:{binding?:{candidateId?:unknown}}}|undefined;
    const candidateId=selected.candidateId;
    if(typeof candidateId!=='string'||!candidateId||candidateId!==trialCache?.result?.binding?.candidateId)return undefined;
    return {ownerTaskId,candidateId,trial,comparison,adoption,publication};
  };
  return Object.freeze({readInvocation,readMainInput,readOrigin,publishedOrigins(ownerTaskId:string):HarnessExperienceOrigin[] {
    return runtime.readToolExecutions(ownerTaskId).filter(r=>r.toolName==='coding.repair.publish'&&r.state==='confirmed')
      .map(r=>readOrigin(ownerTaskId,r.evidenceId)).filter((origin):origin is HarnessExperienceOrigin=>origin!==undefined);
  }});
}
