import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import {parseCodingRepairInput,parseCodingRepairPublishRequest,parseCodingRepairPublishReadback} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairInput} from '@personal-agent/contracts/coding-repair';
import type {TaskRuntime} from '../index.js';
import type {HarnessExperienceOrigin,HarnessExperienceRun} from './harness-experience.js';

export const harnessRepairSessionKey=(runId:string)=>`harness-candidates:session:${runId}`;
export const harnessRepairSelectionKey=(runId:string)=>`harness-candidates:selection:${runId}`;
const ownerSessionKey=(sessionId:string)=>`harness-candidates:owner-session:${sessionId}`;
function denied():never {throw new ProtocolError('REVISION_CONFLICT','Original harness journal binding is unavailable or changed');}
interface Selection {
  version:1;ownerTaskId:string;adoption:HarnessExperienceRun;inputDigest:string;
  trial:HarnessExperienceRun;comparison:HarnessExperienceRun;
}
interface Session {
  version:1;ownerTaskId:string;run:HarnessExperienceRun;toolName:string;inputDigest:string;input:CodingRepairInput;
}

/** Existing Runtime checkpoints only. H1 resolves membership; these ports own exact run/session glue. */
export function createHarnessExperienceBindings(runtime:TaskRuntime) {
  const record=(run:HarnessExperienceRun)=>runtime.readToolExecutions(run.taskId).find(r=>r.evidenceId===run.runId);
  const readInvocation=(run:HarnessExperienceRun)=>{
    const executed=record(run);
    const saved=runtime.loadCheckpoint(run.taskId,`application-tool-invocation:${run.runId}`) as
      {toolName:string;toolVersion:string;arguments:Record<string,unknown>}|undefined;
    if(!executed||!saved||saved.toolName!==executed.toolName||saved.toolVersion!==executed.toolVersion
      ||!runtime.matchesToolExecutionInput(executed,{arguments:saved.arguments,scopeRef:run.runId}))return undefined;
    return {arguments:structuredClone(saved.arguments),scopeRef:run.runId};
  };
  const saveOnce=(taskId:string,key:string,value:unknown)=>{
    const before=runtime.loadCheckpoint(taskId,key);
    if(before!==undefined&&!isDeepStrictEqual(before,value))denied();
    if(before===undefined)runtime.saveCheckpointOnce(taskId,key,value);
    if(!isDeepStrictEqual(runtime.loadCheckpoint(taskId,key),value))denied();
  };
  const current=(context:ToolContext,toolName:string)=>{
    const run={taskId:context.taskId,runId:context.runId},executed=record(run);
    if(context.signal.aborted||context.authorizationRef!==context.runId||Date.now()>=Date.parse(context.deadline)
      ||!Number.isFinite(Date.parse(context.deadline))||!executed||executed.toolName!==toolName
      ||executed.toolVersion!=='1.0.0'||executed.state!=='started'||!executed.executionStarted||executed.policyDecision!=='allow'
      ||!readInvocation(run))return denied();
    return executed;
  };
  const readSession=(run:HarnessExperienceRun):Session|undefined=>{
    const saved=runtime.loadCheckpoint(run.taskId,harnessRepairSessionKey(run.runId)) as Session|undefined;
    const executed=record(run);
    if(!saved||saved.version!==1||!isDeepStrictEqual(saved.run,run)||!executed||saved.inputDigest!==executed.inputDigest
      ||saved.toolName!==executed.toolName||!readInvocation(run))return undefined;
    const input=parseCodingRepairInput(saved.input);
    if(input.session.taskId!==run.taskId)return undefined;
    return {...structuredClone(saved),input};
  };
  const readOrigin=(ownerTaskId:string,publicationRunId:string):HarnessExperienceOrigin|undefined=>{
    const publication={taskId:ownerTaskId,runId:publicationRunId},executed=record(publication),invocation=readInvocation(publication);
    if(!executed||executed.toolName!=='coding.repair.publish'||executed.state!=='confirmed'||!invocation)return undefined;
    const request=parseCodingRepairPublishRequest(invocation.arguments);
    const cache=runtime.loadCheckpoint(ownerTaskId,`tool-result-${publicationRunId}`) as {result?:unknown}|undefined;
    if(!cache||cache.result===undefined)return undefined;
    const readback=parseCodingRepairPublishReadback(cache.result);
    if(readback.state!=='published'||readback.sessionId!==request.sessionId)return undefined;
    const indexed=runtime.loadCheckpoint(ownerTaskId,ownerSessionKey(request.sessionId)) as
      {version:1;ownerTaskId:string;run:HarnessExperienceRun;inputDigest:string}|undefined;
    if(!indexed||indexed.version!==1||indexed.ownerTaskId!==ownerTaskId)return undefined;
    const session=readSession(indexed.run),adoption=session&&record(indexed.run);
    const selected=runtime.loadCheckpoint(indexed.run.taskId,harnessRepairSelectionKey(indexed.run.runId)) as Selection|undefined;
    if(!session||session.ownerTaskId!==ownerTaskId||session.input.session.mode!=='main'||session.input.session.sessionId!==request.sessionId
      ||session.inputDigest!==indexed.inputDigest||!selected||selected.version!==1||selected.ownerTaskId!==ownerTaskId
      ||!isDeepStrictEqual(selected.adoption,indexed.run)||selected.inputDigest!==adoption?.inputDigest)return undefined;
    const trial=runtime.loadCheckpoint(selected.trial.taskId,`tool-result-${selected.trial.runId}`) as {result?:{binding?:{candidateId?:unknown}}}|undefined;
    const candidateId=trial?.result?.binding?.candidateId;
    if(typeof candidateId!=='string'||!candidateId)return undefined;
    return {ownerTaskId,candidateId,trial:structuredClone(selected.trial),comparison:structuredClone(selected.comparison),
      adoption:structuredClone(indexed.run),publication};
  };
  return Object.freeze({readInvocation,
    /** Called inside the original trusted readSelection after H1 resolved the exact confirmed compare/trial.
     * Never infer "latest compare" from the owner history. */
    saveSelection(context:ToolContext,selected:{ownerTaskId:string;trial:HarnessExperienceRun;comparison:HarnessExperienceRun}) {
      const executed=current(context,'coding.repair.prepare_adoption');
      const invocation=readInvocation({taskId:context.taskId,runId:context.runId})!;
      const compared=record(selected.comparison),trial=record(selected.trial);
      if(selected.ownerTaskId!==context.taskId||invocation.arguments.trialRunId!==selected.trial.runId
        ||!compared||compared.toolName!=='harness.candidates.compare'||compared.state!=='confirmed'
        ||!trial||trial.toolName!=='coding.repair.trial'||trial.state!=='confirmed')denied();
      const value:Selection={version:1,ownerTaskId:selected.ownerTaskId,adoption:{taskId:context.taskId,runId:context.runId},
        inputDigest:executed.inputDigest,trial:structuredClone(selected.trial),comparison:structuredClone(selected.comparison)};
      saveOnce(context.taskId,harnessRepairSelectionKey(context.runId),value);
    },
    /** Called by the original trial/adoption saveSession option BEFORE applying patches. */
    saveSession(context:ToolContext,ownerTaskId:string,inputValue:CodingRepairInput) {
      const input=parseCodingRepairInput(inputValue),toolName=input.session.mode==='main'?'coding.repair.prepare_adoption':'coding.repair.trial';
      const executed=current(context,toolName),run={taskId:context.taskId,runId:context.runId};
      if(input.session.taskId!==context.taskId)denied();
      const value:Session={version:1,ownerTaskId,run,toolName,inputDigest:executed.inputDigest,input};
      if(input.session.mode==='main') {
        const selection=runtime.loadCheckpoint(context.taskId,harnessRepairSelectionKey(context.runId)) as Selection|undefined;
        if(ownerTaskId!==context.taskId||selection?.ownerTaskId!==ownerTaskId||selection.inputDigest!==executed.inputDigest)denied();
      }
      saveOnce(context.taskId,harnessRepairSessionKey(context.runId),value);
      saveOnce(ownerTaskId,ownerSessionKey(input.session.sessionId),{version:1,ownerTaskId,run,inputDigest:executed.inputDigest});
    },
    readSession(run:HarnessExperienceRun):CodingRepairInput|undefined {return readSession(run)?.input;},
    readMainInput(run:HarnessExperienceRun):CodingRepairInput|undefined {
      const saved=readSession(run);
      return saved?.toolName==='coding.repair.prepare_adoption'&&saved.ownerTaskId===run.taskId&&saved.input.session.mode==='main'?saved.input:undefined;
    },
    /** Call after owner settles; each publication resolves its actual adoption session and selected compare. */
    readOrigin,
    publishedOrigins(ownerTaskId:string):HarnessExperienceOrigin[] {
      return runtime.readToolExecutions(ownerTaskId).filter(r=>r.toolName==='coding.repair.publish'&&r.state==='confirmed')
        .map(r=>readOrigin(ownerTaskId,r.evidenceId)).filter((origin):origin is HarnessExperienceOrigin=>origin!==undefined);
    },
  });
}
