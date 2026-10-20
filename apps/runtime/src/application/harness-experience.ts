import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {parseCodingRepairInput,parseCodingRepairSession,parseCodingRepairCheckReadback,
  parseCodingRepairPublishReadback,parseCodingRepairPublishRequest,parseCodingRepairSnapshot} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairInput,CodingRepairSnapshot} from '@personal-agent/contracts/coding-repair';
import {createDeveloperExperienceApplication,assertDeveloperExperienceScope} from '@personal-agent/learning';
import type {DeveloperExperienceScope,DeveloperExperienceSource,DeveloperExperiencePorts,LearningContext,
  SqliteLearningHost,WorkflowVersion} from '@personal-agent/learning';
import type {TaskRuntime} from '../index.js';

export interface HarnessExperienceRun {readonly taskId:string;readonly runId:string}
/** Host-only references into the original journals, not a second trial DTO or a model proposal. */
export interface HarnessExperienceOrigin {
  readonly ownerTaskId:string;readonly candidateId:string;
  readonly trial:HarnessExperienceRun;readonly comparison:HarnessExperienceRun;
  readonly adoption:HarnessExperienceRun;readonly publication:HarnessExperienceRun;
}
export interface RuntimeHarnessExperienceOptions {
  readonly namespace:string;readonly learning:SqliteLearningHost;readonly runtime:TaskRuntime;
  /** H1 checks original owner and persisted plan/marker membership for every referenced actual task. */
  assertOrigin(origin:HarnessExperienceOrigin,context:LearningContext):void;
  /** Original invocation from the trusted Gateway/host journal; never caller/model reconstructed arguments. */
  readInvocation(run:HarnessExperienceRun):{arguments:Record<string,unknown>;scopeRef:string}|undefined;
  /** Original main F15 session checkpoint owned by the adoption tool; never an isolated session. */
  readMainInput(taskId:string):CodingRepairInput|undefined;
  /** Synchronous coherent current workspace/configuration/recipe/version fence, including actual source hashes. */
  readCurrent(ownerTaskId:string):{scope:DeveloperExperienceScope;snapshot:CodingRepairSnapshot}|undefined;
  confirmActivation(candidate:WorkflowVersion,context:LearningContext):Promise<boolean>;
}
const denied=(message:string):never=>{throw new ProtocolError('NOT_VALIDATED',message);};
const plain=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return denied('Original development receipt unavailable');
  return v as Record<string,unknown>;
};
const metadata=(snapshot:CodingRepairSnapshot)=>({
  files:snapshot.files.map(({path,sha256,packageId,kind})=>({path,sha256,packageId,kind})).sort((a,b)=>a.path.localeCompare(b.path)),
  packages:snapshot.packages.map(p=>({...p,dependencies:[...p.dependencies].sort()})).sort((a,b)=>a.id.localeCompare(b.id)),
});
/** Experience scope identity only; this does not replace the unique trial contract's artifact identity. */
export const harnessExperienceWorkspaceDigest=(snapshot:CodingRepairSnapshot):string=>createHash('sha256')
  .update('developer-experience-workspace:v1\0').update(JSON.stringify(metadata(parseCodingRepairSnapshot(snapshot)))).digest('hex');
const sourceKey=(digest:string)=>`harness-experience:source:${digest}`;
const sourceRef=(origin:HarnessExperienceOrigin,scope:DeveloperExperienceScope)=>{
  const digest=createHash('sha256').update(JSON.stringify({origin,scope})).digest('hex');
  return {digest,reference:`developer-experience:v1:${Buffer.from(origin.ownerTaskId).toString('base64url')}:${digest}`};
};
const active=(context:LearningContext)=>{
  if(context.signal.aborted)throw new ProtocolError('CANCELLED','Development experience cancelled');
  if(!Number.isFinite(Date.parse(context.deadline))||Date.now()>=Date.parse(context.deadline))
    throw new ProtocolError('TIMEOUT','Development experience deadline expired');
};

/** Confirmed local adoption -> existing learning lifecycle. No tools, permissions, execution loop or new store. */
export function createRuntimeHarnessExperienceApplication(options:RuntimeHarnessExperienceOptions) {
  const {runtime}=options;
  const original=(ref:HarnessExperienceRun,toolName:string)=>{
    const task=runtime.getTask(ref.taskId);
    const record=runtime.readToolExecutions(ref.taskId).find(r=>r.evidenceId===ref.runId);
    const invocation=options.readInvocation(ref);
    const result=runtime.loadCheckpoint(ref.taskId,`tool-result-${ref.runId}`) as {result?:unknown}|undefined;
    if(task.state!=='succeeded'||task.cancelRequested||!record||record.taskId!==ref.taskId
      ||record.toolName!==toolName||record.toolVersion!=='1.0.0'||record.state!=='confirmed'
      ||record.policyDecision!=='allow'||!record.executionStarted||!record.finishedAt
      ||!Number.isFinite(Date.parse(record.finishedAt))||Date.parse(record.finishedAt)>Date.now()
      ||!invocation||!runtime.matchesToolExecutionInput(record,invocation)||!result||!Object.hasOwn(result,'result')
      ||!runtime.readEvidence(ref.taskId).some(e=>e.evidenceId===ref.runId&&e.kind==='execution'&&e.sourceRef===toolName))
      return denied('Experience needs original succeeded tasks and exact confirmed Policy/ToolGateway records');
    return {value:result.result,arguments:invocation.arguments,finishedAt:Date.parse(record.finishedAt)};
  };
  const verify=(origin:HarnessExperienceOrigin,scope:DeveloperExperienceScope,context:LearningContext):DeveloperExperienceSource=>{
    active(context);options.assertOrigin(structuredClone(origin),context);assertDeveloperExperienceScope(scope);
    if(runtime.getTask(origin.ownerTaskId).state!=='succeeded'||origin.adoption.taskId!==origin.ownerTaskId
      ||origin.publication.taskId!==origin.ownerTaskId)return denied('Original user-work adoption owner differs');
    const trial=original(origin.trial,'coding.repair.trial');
    const comparison=original(origin.comparison,'harness.candidates.compare');
    const adoption=original(origin.adoption,'coding.repair.prepare_adoption');
    const publication=original(origin.publication,'coding.repair.publish');
    const trialValue=plain(trial.value),binding=plain(trialValue.binding);
    const session=parseCodingRepairSession(trialValue.session);
    const trialCheck=parseCodingRepairCheckReadback(trialValue.checkReadback);
    const compared=plain(comparison.value),recommended=plain(compared.recommendation);
    const checked=parseCodingRepairCheckReadback(adoption.value);
    const inputValue=options.readMainInput(origin.adoption.taskId);
    if(!inputValue)return denied('Original main F15 session checkpoint unavailable');
    const main=parseCodingRepairInput(inputValue),request=parseCodingRepairPublishRequest(publication.arguments);
    const published=parseCodingRepairPublishReadback(publication.value);
    if(binding.taskId!==origin.ownerTaskId||binding.trialTaskId!==origin.trial.taskId||binding.candidateId!==origin.candidateId
      ||binding.workspaceId!==scope.workspaceId||binding.configurationDigest!==scope.configurationDigest
      ||binding.workflowVersion!==scope.workflowVersion||binding.runtimeVersion!==scope.runtimeVersion
      ||binding.recipeFingerprint!==scope.recipeFingerprint||binding.executionKind!=='real_host'
      ||session.mode!=='isolated'||session.taskId!==origin.trial.taskId||binding.sessionId!==session.sessionId
      ||trialCheck.sessionId!==session.sessionId||trial.arguments.candidateId!==origin.candidateId
      ||compared.state!=='selected'||recommended.candidateId!==origin.candidateId||recommended.trialRunId!==origin.trial.runId
      ||recommended.artifactId!==binding.artifactId||recommended.artifactDigest!==binding.artifactDigest
      ||!Array.isArray(comparison.arguments.trialRunIds)||!comparison.arguments.trialRunIds.includes(origin.trial.runId)
      ||adoption.arguments.trialRunId!==origin.trial.runId||main.session.mode!=='main'
      ||main.session.taskId!==origin.ownerTaskId||main.session.workspaceId!==scope.workspaceId
      ||main.session.sessionId!==checked.sessionId||request.sessionId!==checked.sessionId
      ||request.baselineSnapshotId!==main.initialSnapshot.snapshotId||request.snapshotId!==checked.snapshot.snapshotId
      ||published.state!=='published'||published.sessionId!==checked.sessionId
      ||!isDeepStrictEqual(metadata(checked.snapshot),metadata(trialCheck.snapshot))
      ||trial.finishedAt>comparison.finishedAt||comparison.finishedAt>adoption.finishedAt||adoption.finishedAt>publication.finishedAt)
      return denied('Experience source is not the original selected, freshly adopted and published artifact');
    const recipes=main.recipes.filter(r=>r.required);
    if(!recipes.length||recipes.some(recipe=>!checked.verification.some(receipt=>
      receipt.recipeId===recipe.recipeId&&receipt.sessionId===checked.sessionId&&receipt.status==='VALID'&&receipt.exitCode===0
      &&receipt.inputSnapshotId===checked.snapshot.snapshotId&&receipt.evidenceRefs.includes(origin.adoption.runId)
      &&request.verificationRunIds.includes(receipt.runId)
      &&isDeepStrictEqual([...receipt.packageIds].sort(),[...recipe.packageIds].sort())
      &&receipt.files.every(file=>checked.snapshot.files.some(current=>current.path===file.path&&current.sha256===file.sha256)))))
      return denied('Original required recipes have no fresh successful verification');
    if(!request.paths.length||new Set(published.files.map(file=>file.path)).size!==request.paths.length
      ||published.files.length!==request.paths.length||request.paths.some(path=>!published.files.some(file=>file.path===path))
      ||published.files.some(file=>!checked.snapshot.files.some(current=>current.path===file.path&&current.sha256===file.afterSha256)
        ||file.beforeSha256!==(main.initialSnapshot.files.find(initial=>initial.path===file.path)?.sha256??null))
      ||!published.evidenceRefs.includes(origin.adoption.runId))return denied('Original CAS publication readback differs from the verified files');
    // No await follows this joint current-authority fence.
    const current=options.readCurrent(origin.ownerTaskId);
    active(context);options.assertOrigin(structuredClone(origin),context);
    if(!current||!isDeepStrictEqual(current.scope,scope)||scope.workspaceDigest!==harnessExperienceWorkspaceDigest(current.snapshot)
      ||!isDeepStrictEqual(metadata(parseCodingRepairSnapshot(current.snapshot)),metadata(checked.snapshot)))
      throw new ProtocolError('REVISION_CONFLICT','Development workspace or configuration changed');
    const identity=sourceRef(origin,scope);
    return {sourceRef:identity.reference,scope:structuredClone(scope),requiredRecipeIds:recipes.map(r=>r.recipeId),
      evidenceRefs:[origin.trial.runId,origin.comparison.runId,origin.adoption.runId,origin.publication.runId]};
  };
  const ports:DeveloperExperiencePorts={confirmActivation:options.confirmActivation,readConfirmedSource:(reference,context)=>{
    const match=/^developer-experience:v1:([A-Za-z0-9_-]{1,344}):([a-f0-9]{64})$/.exec(reference);
    if(!match)return undefined;
    const ownerTaskId=Buffer.from(match[1]!,'base64url').toString('utf8');
    const stored=runtime.loadCheckpoint(ownerTaskId,sourceKey(match[2]!)) as {origin:HarnessExperienceOrigin;scope:DeveloperExperienceScope}|undefined;
    if(!stored||stored.origin.ownerTaskId!==ownerTaskId||sourceRef(stored.origin,stored.scope).reference!==reference)return undefined;
    return verify(stored.origin,stored.scope,context);
  }};
  const learning=createDeveloperExperienceApplication({namespace:options.namespace,learning:options.learning,ports});
  return Object.freeze({...learning,
    /** Call after the original user-work has succeeded, never during an unconfirmed publish. */
    proposeFromConfirmed(origin:HarnessExperienceOrigin,request:LearningContext&{
      workflowId:string;expectedRevision:number|null;operationId:string;createdAt:string;
    }) {
      active(request);
      const current=options.readCurrent(origin.ownerTaskId);
      if(!current)return denied('Current development workspace unavailable');
      const source=verify(origin,current.scope,request),identity=sourceRef(origin,source.scope);
      const saved=runtime.loadCheckpoint(origin.ownerTaskId,sourceKey(identity.digest));
      const value={origin:structuredClone(origin),scope:structuredClone(source.scope)};
      if(saved!==undefined&&!isDeepStrictEqual(saved,value))throw new ProtocolError('REVISION_CONFLICT','Original experience source changed');
      if(saved===undefined)runtime.saveCheckpoint(origin.ownerTaskId,sourceKey(identity.digest),value);
      return learning.propose({...request,sourceRef:source.sourceRef});
    },
  });
}
