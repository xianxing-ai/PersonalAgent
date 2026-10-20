import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import {parseCodingRepairInput,parseCodingRepairPatch,parseCodingRepairCheckReadback,parseCodingRepairPublishRequest,parseCodingRepairPublishReadback} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairInput,CodingRepairPatch} from '@personal-agent/contracts/coding-repair';
import {parseHarnessCandidateTrial,harnessCandidateArtifactDigest,harnessCandidateRecipeFingerprint} from '@personal-agent/contracts/harness-candidates';
import type {HarnessCandidateContext,HarnessCandidateTrial} from '@personal-agent/contracts/harness-candidates';
import {compareHarnessCandidates,codingVerificationCurrent} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeHarnessCandidateOptions} from './harness-candidates.js';

export interface RuntimeHarnessCandidateScope {
  ownerTaskId:string;actualTaskId:string;parentTaskId:string;scopeRef:string;
  configurationRef:string;inputDigest:string;deadline:string;workspaceRef:string;
}
export interface RuntimeHarnessCandidateBindingsOptions {
  /** Always verifies the current caller. source additionally checks historical executor plan/marker membership. */
  resolveHarnessScope(context:ToolContext,source?:{actualTaskId:string;runId:string;scopeRef:string}):RuntimeHarnessCandidateScope|undefined;
  readConfiguration(scope:RuntimeHarnessCandidateScope,context:ToolContext):HarnessCandidateContext|Promise<HarnessCandidateContext>;
  now?:()=>number;
}
/** Native task.reconcile caller must first validate user permission and original owner/plan membership. */
export interface RuntimeHarnessCandidateRecoveryRequest {
  ownerTaskId:string;actualTaskId:string;trialRunId:string;expectedRevision:number;configurationRef:string;
}
/** Host-only historical lookup. H1 still checks original owner/plan and the experience current-authority fence. */
export interface RuntimeHarnessCandidateProvenanceRequest {ownerTaskId:string;actualTaskId:string;runId:string}
export interface RuntimeHarnessCandidateCompletionRequest extends RuntimeHarnessCandidateProvenanceRequest {publicationRunId:string}
export interface RuntimeHarnessCandidateAdoptionOrigin {
  version:1;ownerTaskId:string;
  adoption:{taskId:string;runId:string};trial:{taskId:string;runId:string};comparison:{taskId:string;runId:string};
  inputDigest:string;configurationRef:string;workspaceRef:string;workspaceId:string;baselineSnapshotId:string;
  candidateId:string;artifactId:string;artifactDigest:string;
  adoptionInputDigest:string;trialInputDigest:string;comparisonInputDigest:string;
  trialResultDigest:string;comparisonResultDigest:string;
}
interface Operation {
  version:1;scope:RuntimeHarnessCandidateScope;runId:string;toolName:string;toolVersion:string;
  arguments:Record<string,unknown>;argumentsDigest:string;deadline:string;
}
type OperationRecord=Omit<Operation,'arguments'>;
interface SavedSession {operation:OperationRecord;input:CodingRepairInput}
const locator=({arguments:_arguments,...record}:Operation):OperationRecord=>record;
const trialTool='coding.repair.trial',compareTool='harness.candidates.compare',adoptTool='coding.repair.prepare_adoption',recoverTool='coding.repair.reconcile_trial';
const tools=[trialTool,compareTool,adoptTool,recoverTool];
const freezeKey='harness-candidates:configuration';
const operationKey=(runId:string)=>'harness-candidates:operation:'+runId;
const sessionKey=(runId:string)=>'harness-candidates:session:'+runId;
const adoptionOriginKey=(runId:string)=>'harness-candidates:adoption-origin:'+runId;
function denied(message:string):never {throw new ProtocolError('UNAUTHORIZED',message);}
function conflict(message:string):never {throw new ProtocolError('REVISION_CONFLICT',message);}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function assertPatchUnion(parents:readonly {patches:readonly CodingRepairPatch[]}[],patches:readonly CodingRepairPatch[]):void {
  const union=new Map<string,CodingRepairPatch>();
  for(const parent of parents)for(const patch of parent.patches) {
    const prior=union.get(patch.path);
    if(prior&&!isDeepStrictEqual(prior,patch))throw new ProtocolError('UNSUPPORTED_CAPABILITY','Overlapping parent edits require a separately verified composition plan');
    union.set(patch.path,patch);
  }
  const sorted=(items:readonly CodingRepairPatch[])=>[...items].sort((a,b)=>a.path.localeCompare(b.path));
  if(!isDeepStrictEqual(sorted([...union.values()]),sorted(patches)))denied('Combination must use the exact observed parent patch union');
}

/** Adapts original Runtime checkpoints and execution records; no new store, loop, or execution authority. */
export function createRuntimeHarnessCandidateBindings(application:Pick<RuntimeApplication,'runtime'>,
  options:RuntimeHarnessCandidateBindingsOptions) {
  const now=options.now??Date.now;
  function once(taskId:string,key:string,value:unknown):void {
    const runtime=application.runtime;
    runtime.saveCheckpointOnce(taskId,key,value);
    if(!isDeepStrictEqual(runtime.loadCheckpoint(taskId,key),value))conflict('Original harness checkpoint differs');
  }
  function current(context:ToolContext):RuntimeHarnessCandidateScope {
    const runtime=application.runtime;
    const task=runtime.getTask(context.taskId);
    if(context.signal.aborted||task.cancelRequested)throw new ProtocolError('CANCELLED','Original harness caller cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||now()>=Date.parse(context.deadline))throw new ProtocolError('TIMEOUT','Original harness deadline expired');
    const scope=options.resolveHarnessScope(context);
    if(!scope||scope.actualTaskId!==context.taskId||scope.scopeRef!==context.authorizationRef||scope.deadline!==context.deadline
      ||task.state!=='running'||runtime.loadCheckpoint(context.taskId,'application-deadline')!==context.deadline)
      denied('Original harness execution scope unavailable');
    return structuredClone(scope!);
  }
  function invocation(scope:RuntimeHarnessCandidateScope,runId:string):Operation {
    const runtime=application.runtime;
    const original=runtime.loadCheckpoint(scope.actualTaskId,'application-tool-invocation:'+scope.scopeRef);
    const record=runtime.readToolExecutions(scope.actualTaskId).find(r=>r.evidenceId===runId);
    if(!plain(original)||!plain(original.arguments)||typeof original.toolName!=='string'||!tools.includes(original.toolName)
      ||original.toolVersion!=='1.0.0'||original.deadline!==scope.deadline
      ||original.argumentsDigest!==toolArgumentsDigest(original.arguments)||!record||record.taskId!==scope.actualTaskId
      ||record.toolName!==original.toolName||record.toolVersion!==original.toolVersion||!record.executionStarted||record.policyDecision!=='allow'
      ||!runtime.matchesToolExecutionInput(record,{arguments:original.arguments,scopeRef:scope.scopeRef}))
      denied('Original harness invocation does not match its Gateway execution');
    return {version:1,scope:structuredClone(scope),runId,toolName:original.toolName as string,toolVersion:'1.0.0',
      arguments:structuredClone(original.arguments as Record<string,unknown>),argumentsDigest:original.argumentsDigest as string,deadline:scope.deadline};
  }
  function own(context:ToolContext,allowed=tools):Operation {
    const runtime=application.runtime;
    const scope=current(context),op=invocation(scope,context.runId);
    const record=runtime.readToolExecutions(context.taskId).find(r=>r.evidenceId===context.runId);
    if(record?.state!=='started'||!allowed.includes(op.toolName))denied('Harness port requires its original active Gateway operation');
    once(scope.ownerTaskId,operationKey(context.runId),locator(op));
    return op;
  }
  function frozen(scope:RuntimeHarnessCandidateScope):HarnessCandidateContext {
    const runtime=application.runtime;
    const saved=runtime.loadCheckpoint(scope.ownerTaskId,freezeKey) as {configurationRef?:string;workspaceRef?:string;context?:HarnessCandidateContext}|undefined;
    if(!saved?.context||saved.configurationRef!==scope.configurationRef||saved.context.binding.taskId!==scope.ownerTaskId
      ||saved.context.binding.inputDigest!==scope.inputDigest||saved.workspaceRef!==scope.workspaceRef
      ||saved.context.binding.configurationDigest!==scope.configurationRef)
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original harness configuration is not bound');
    return structuredClone(saved.context);
  }
  async function readBinding(context:ToolContext,candidateId:string):Promise<HarnessCandidateContext> {
    const op=own(context,[trialTool,adoptTool]);
    if(op.toolName===trialTool&&op.arguments.candidateId!==candidateId)denied('Candidate differs from the original invocation');
    const configuration=structuredClone(await options.readConfiguration(op.scope,context));
    if(!isDeepStrictEqual(current(context),op.scope))conflict('Harness configuration changed during acquisition');
    if(configuration.binding.taskId!==op.scope.ownerTaskId||configuration.binding.inputDigest!==op.scope.inputDigest
      ||configuration.binding.configurationDigest!==op.scope.configurationRef)
      denied('Harness configuration belongs to another input or workspace');
    compareHarnessCandidates(configuration,[]); // Existing parser and fixed comparison prerequisites, no execution.
    once(op.scope.ownerTaskId,freezeKey,{configurationRef:op.scope.configurationRef,workspaceRef:op.scope.workspaceRef,context:configuration});
    return frozen(op.scope);
  }
  function source(context:ToolContext,runId:string,requireConfirmed=true):Operation {
    const runtime=application.runtime;
    const caller=current(context);
    const saved=runtime.loadCheckpoint(caller.ownerTaskId,operationKey(runId)) as OperationRecord|undefined;
    if(!saved||saved.version!==1||saved.runId!==runId)denied('Original harness run is not indexed by this owner');
    const op=saved!;
    const scope=options.resolveHarnessScope(context,{actualTaskId:op.scope.actualTaskId,runId,scopeRef:op.scope.scopeRef});
    if(!scope||!isDeepStrictEqual(scope,op.scope)||scope.ownerTaskId!==caller.ownerTaskId
      ||scope.configurationRef!==caller.configurationRef||scope.inputDigest!==caller.inputDigest
      ||scope.workspaceRef!==caller.workspaceRef||scope.deadline!==caller.deadline
      ||!isDeepStrictEqual(locator(invocation(scope,runId)),op))denied('Original harness source scope or input changed');
    const record=runtime.readToolExecutions(scope.actualTaskId).find(r=>r.evidenceId===runId)!;
    if(requireConfirmed&&(record.state!=='confirmed'||!runtime.readEvidence(scope.actualTaskId).some(e=>e.evidenceId===runId
      &&e.kind==='execution'&&e.sourceRef===op.toolName)))denied('Original confirmed harness Evidence unavailable');
    return invocation(scope,runId);
  }
  function readTrial(context:ToolContext,runId:string,ancestors:ReadonlySet<string>=new Set()):{operation:Operation;trial:HarnessCandidateTrial;patches:CodingRepairPatch[]} {
    const runtime=application.runtime;
    if(ancestors.has(runId))conflict('Original trial ancestry contains a cycle');
    const op=source(context,runId);
    if(op.toolName!==trialTool)denied('Original run is not a candidate trial');
    const cached=runtime.loadCheckpoint(op.scope.actualTaskId,'tool-result-'+runId);
    if(!plain(cached)||!Object.hasOwn(cached,'result'))denied('Original trial result unavailable');
    const trial=parseHarnessCandidateTrial(cached.result),configuration=frozen(current(context));
    const saved=runtime.loadCheckpoint(op.scope.ownerTaskId,sessionKey(runId)) as SavedSession|undefined;
    if(!saved||!isDeepStrictEqual(saved.operation,locator(op))
      ||!isDeepStrictEqual(parseCodingRepairInput(saved.input).session,trial.session))
      denied('Candidate result does not belong to the original saved session');
    if(trial.binding.taskId!==op.scope.ownerTaskId||trial.binding.trialTaskId!==op.scope.actualTaskId||trial.session.taskId!==op.scope.actualTaskId
      ||trial.session.mode!=='isolated'||trial.binding.sessionId!==trial.session.sessionId||trial.checkReadback.sessionId!==trial.session.sessionId
      ||trial.binding.candidateId!==op.arguments.candidateId||Object.entries(configuration.binding).some(([key,value])=>trial.binding[key as keyof typeof trial.binding]!==value)
      ||trial.binding.artifactDigest!==harnessCandidateArtifactDigest(trial.checkReadback.snapshot)
      ||trial.checkReadback.verification.some(r=>!r.evidenceRefs.includes(runId))||!Array.isArray(op.arguments.patches))
      denied('Original candidate artifact or invocation differs');
    const patches=(op.arguments.patches as unknown[]).map(parseCodingRepairPatch),refs=op.arguments.parentTrialRunIds??[];
    if(!Array.isArray(refs)||refs.some(id=>typeof id!=='string')||new Set(refs).size!==refs.length||refs.length===1)
      denied('Invalid original candidate parent references');
    const parents=(refs as string[]).map(id=>readTrial(context,id,new Set([...ancestors,runId])));
    if(!isDeepStrictEqual(trial.binding.parentArtifactDigests,parents.map(p=>p.trial.binding.artifactDigest)))
      denied('Candidate parent artifacts differ from the original invocation');
    if(parents.length)assertPatchUnion(parents,patches);
    return {operation:op,trial,patches};
  }
  async function readSession(context:ToolContext):Promise<CodingRepairInput|undefined> {
    const runtime=application.runtime;
    const op=own(context,[trialTool,adoptTool]);
    const stored=runtime.loadCheckpoint(op.scope.ownerTaskId,sessionKey(context.runId)) as SavedSession|undefined;
    if(stored===undefined)return;
    if(!isDeepStrictEqual(stored.operation,locator(op)))conflict('Original harness session input changed');
    return parseCodingRepairInput(stored.input);
  }
  async function saveSession(context:ToolContext,input:CodingRepairInput):Promise<void> {
    const op=own(context,[trialTool,adoptTool]),parsed=parseCodingRepairInput(input),configuration=frozen(op.scope);
    if(parsed.session.taskId!==context.taskId||parsed.session.workspaceId!==configuration.binding.workspaceId
      ||parsed.session.mode!==(op.toolName===trialTool?'isolated':'main')
      ||parsed.session.baselineSnapshotId!==configuration.binding.baselineSnapshotId
      ||parsed.initialSnapshot.files.some(f=>f.content!==undefined)
      ||harnessCandidateRecipeFingerprint(parsed.recipes)!==configuration.binding.recipeFingerprint
      ||harnessCandidateArtifactDigest(parsed.initialSnapshot)!==harnessCandidateArtifactDigest(configuration.baseline))
      denied('Session is not bound to the original harness operation');
    // Full run/input/scope/session in one atomic save-once row; no mutable run-to-session map.
    once(op.scope.ownerTaskId,sessionKey(context.runId),{operation:locator(op),input:parsed});
  }
  async function readOriginalSession(context:ToolContext,trialRunId:string):Promise<CodingRepairInput|undefined> {
    const runtime=application.runtime;
    own(context,[recoverTool]);
    const op=source(context,trialRunId,false);
    if(![trialTool,adoptTool].includes(op.toolName)||op.scope.actualTaskId!==context.taskId)
      denied('Only the original executor can reconcile its session');
    const saved=runtime.loadCheckpoint(op.scope.ownerTaskId,sessionKey(trialRunId)) as SavedSession|undefined;
    if(!saved)return;
    if(!isDeepStrictEqual(saved.operation,locator(op)))conflict('Original recovery session binding changed');
    return parseCodingRepairInput(saved.input);
  }
  /** Host-only metadata lookup for the original waiting task. Never exposed as a model tool or grant. */
  function readOriginalSessionForRecovery(input:RuntimeHarnessCandidateRecoveryRequest):CodingRepairInput|undefined {
    const runtime=application.runtime,task=runtime.getTask(input.actualTaskId);
    if(!Number.isSafeInteger(input.expectedRevision)||task.revision!==input.expectedRevision)
      conflict('Original recovery task revision changed');
    if(task.state!=='waiting_reconciliation')conflict('Original task is not waiting for reconciliation');
    const saved=runtime.loadCheckpoint(input.ownerTaskId,sessionKey(input.trialRunId)) as SavedSession|undefined;
    if(!saved)return;
    const {operation:op}=saved;
    if(op.version!==1||op.runId!==input.trialRunId||op.scope.ownerTaskId!==input.ownerTaskId
      ||op.scope.actualTaskId!==input.actualTaskId||op.scope.configurationRef!==input.configurationRef
      ||![trialTool,adoptTool].includes(op.toolName)
      ||!isDeepStrictEqual(runtime.loadCheckpoint(input.ownerTaskId,operationKey(input.trialRunId)),op)
      ||!isDeepStrictEqual(locator(invocation(op.scope,input.trialRunId)),op)
      ||!runtime.readEvidence(input.actualTaskId).some(e=>e.evidenceId===input.trialRunId&&e.kind==='execution'&&e.sourceRef===op.toolName))
      denied('Original native recovery execution binding differs');
    const original=parseCodingRepairInput(saved.input),configuration=frozen(op.scope);
    if(original.session.taskId!==input.actualTaskId||original.session.workspaceId!==configuration.binding.workspaceId
      ||original.session.mode!==(op.toolName===trialTool?'isolated':'main')
      ||original.session.baselineSnapshotId!==configuration.binding.baselineSnapshotId
      ||harnessCandidateArtifactDigest(original.initialSnapshot)!==harnessCandidateArtifactDigest(configuration.baseline)
      ||harnessCandidateRecipeFingerprint(original.recipes)!==configuration.binding.recipeFingerprint
      ||original.initialSnapshot.files.some(f=>f.content!==undefined))denied('Original native recovery session differs');
    if(runtime.getTask(input.actualTaskId).revision!==input.expectedRevision)conflict('Recovery task changed during metadata readback');
    return original;
  }
  function provenanceOperation(input:RuntimeHarnessCandidateProvenanceRequest,completionOwner?:string):{operation:Operation;executionInputDigest:string;result:unknown} {
    const runtime=application.runtime,task=runtime.getTask(input.actualTaskId),owner=runtime.getTask(input.ownerTaskId);
    const settled=(value:typeof task)=>value.state==='succeeded'||value.taskId===completionOwner&&value.state==='running';
    if(!settled(task)||task.cancelRequested||!settled(owner)||owner.cancelRequested)
      denied('Experience metadata requires original succeeded tasks');
    const saved=runtime.loadCheckpoint(input.ownerTaskId,operationKey(input.runId)) as OperationRecord|undefined;
    if(!saved||saved.version!==1||saved.runId!==input.runId||saved.scope.actualTaskId!==input.actualTaskId
      ||saved.scope.ownerTaskId!==input.ownerTaskId||![trialTool,compareTool,adoptTool].includes(saved.toolName))
      denied('Original provenance operation unavailable');
    const op=invocation(saved.scope,input.runId);
    const record=runtime.readToolExecutions(input.actualTaskId).find(r=>r.evidenceId===input.runId)!;
    const cached=runtime.loadCheckpoint(input.actualTaskId,'tool-result-'+input.runId);
    if(!isDeepStrictEqual(locator(op),saved)||record.state!=='confirmed'
      ||!runtime.readEvidence(input.actualTaskId).some(e=>e.evidenceId===input.runId&&e.kind==='execution'&&e.sourceRef===op.toolName)
      ||!plain(cached)||!Object.hasOwn(cached,'result'))denied('Original confirmed provenance Evidence unavailable');
    frozen(op.scope);
    return {operation:op,executionInputDigest:record.inputDigest,result:structuredClone(cached.result)};
  }
  /** Read the single canonical {operation,input} row. No session, selection, or owner-session writes. */
  function sessionForProvenance(input:RuntimeHarnessCandidateProvenanceRequest,completionOwner?:string):CodingRepairInput|undefined {
    const runtime=application.runtime,{operation:op}=provenanceOperation(input,completionOwner);
    if(![trialTool,adoptTool].includes(op.toolName))denied('Provenance run has no repair session');
    const saved=runtime.loadCheckpoint(input.ownerTaskId,sessionKey(input.runId)) as SavedSession|undefined;
    if(!saved)return;
    if(!isDeepStrictEqual(saved.operation,locator(op)))denied('Canonical provenance session operation differs');
    const parsed=parseCodingRepairInput(saved.input),configuration=frozen(op.scope);
    if(parsed.session.taskId!==input.actualTaskId||parsed.session.workspaceId!==configuration.binding.workspaceId
      ||parsed.session.mode!==(op.toolName===trialTool?'isolated':'main')||parsed.session.baselineSnapshotId!==configuration.binding.baselineSnapshotId
      ||harnessCandidateArtifactDigest(parsed.initialSnapshot)!==harnessCandidateArtifactDigest(configuration.baseline)
      ||harnessCandidateRecipeFingerprint(parsed.recipes)!==configuration.binding.recipeFingerprint
      ||parsed.initialSnapshot.files.some(f=>f.content!==undefined))denied('Canonical provenance session metadata differs');
    return parsed;
  }
  function readOriginalSessionForProvenance(input:RuntimeHarnessCandidateProvenanceRequest):CodingRepairInput|undefined {
    return sessionForProvenance(input);
  }
  function adoptionOrigin(input:RuntimeHarnessCandidateProvenanceRequest,completionOwner?:string):RuntimeHarnessCandidateAdoptionOrigin|undefined {
    const runtime=application.runtime;
    const stored=runtime.loadCheckpoint(input.ownerTaskId,adoptionOriginKey(input.runId)) as RuntimeHarnessCandidateAdoptionOrigin|undefined;
    if(!stored)return;
    const adoption=provenanceOperation(input,completionOwner);
    if(stored.version!==1||stored.ownerTaskId!==input.ownerTaskId||input.actualTaskId!==input.ownerTaskId
      ||!isDeepStrictEqual(stored.adoption,{taskId:input.actualTaskId,runId:input.runId})||adoption.operation.toolName!==adoptTool)
      denied('Original adoption provenance owner differs');
    const trial=provenanceOperation({ownerTaskId:input.ownerTaskId,actualTaskId:stored.trial.taskId,runId:stored.trial.runId},completionOwner);
    const comparison=provenanceOperation({ownerTaskId:input.ownerTaskId,actualTaskId:stored.comparison.taskId,runId:stored.comparison.runId},completionOwner);
    const scope=adoption.operation.scope,configuration=frozen(scope);
    if(trial.operation.toolName!==trialTool||comparison.operation.toolName!==compareTool
      ||stored.inputDigest!==scope.inputDigest||stored.configurationRef!==scope.configurationRef||stored.workspaceRef!==scope.workspaceRef
      ||stored.workspaceId!==configuration.binding.workspaceId||stored.baselineSnapshotId!==configuration.binding.baselineSnapshotId
      ||[trial,comparison].some(source=>source.operation.scope.configurationRef!==scope.configurationRef
        ||source.operation.scope.inputDigest!==scope.inputDigest||source.operation.scope.workspaceRef!==scope.workspaceRef)
      ||stored.adoptionInputDigest!==adoption.executionInputDigest||stored.trialInputDigest!==trial.executionInputDigest
      ||stored.comparisonInputDigest!==comparison.executionInputDigest
      ||stored.trialResultDigest!==toolArgumentsDigest(trial.result)||stored.comparisonResultDigest!==toolArgumentsDigest(comparison.result)
      ||adoption.operation.arguments.trialRunId!==stored.trial.runId)denied('Original adoption provenance inputs differ');
    const candidate=parseHarnessCandidateTrial(trial.result),session=sessionForProvenance(input,completionOwner);
    const trialSession=sessionForProvenance({ownerTaskId:input.ownerTaskId,actualTaskId:stored.trial.taskId,runId:stored.trial.runId},completionOwner);
    if(!session||!trialSession||!isDeepStrictEqual(candidate.session,trialSession.session)||candidate.binding.candidateId!==stored.candidateId
      ||candidate.binding.artifactId!==stored.artifactId||candidate.binding.artifactDigest!==stored.artifactDigest
      ||!plain(comparison.result)||!plain(comparison.result.recommendation)||comparison.result.state!=='selected'
      ||comparison.result.recommendation.trialRunId!==stored.trial.runId||comparison.result.recommendation.candidateId!==stored.candidateId
      ||comparison.result.recommendation.artifactId!==stored.artifactId||comparison.result.recommendation.artifactDigest!==stored.artifactDigest
      ||!Array.isArray(comparison.operation.arguments.trialRunIds)||!comparison.operation.arguments.trialRunIds.includes(stored.trial.runId))
      denied('Original confirmed selection provenance differs');
    const adopted=parseCodingRepairCheckReadback(adoption.result);
    if(adopted.sessionId!==session.session.sessionId||harnessCandidateArtifactDigest(adopted.snapshot)!==stored.artifactDigest)
      denied('Original adoption result is not the saved main session artifact');
    return structuredClone(stored);
  }
  function readAdoptionOrigin(input:RuntimeHarnessCandidateProvenanceRequest):RuntimeHarnessCandidateAdoptionOrigin|undefined {
    return adoptionOrigin(input);
  }
  /** Current owner's confirmed publication may be reported; this is never a new tool/lease permission. */
  function readAdoptionOriginForCompletion(input:RuntimeHarnessCandidateCompletionRequest):{origin:RuntimeHarnessCandidateAdoptionOrigin;input:CodingRepairInput}|undefined {
    const runtime=application.runtime,owner=runtime.getTask(input.ownerTaskId);
    const deadline=runtime.loadCheckpoint(input.ownerTaskId,'application-deadline');
    if(input.actualTaskId!==input.ownerTaskId||owner.state!=='running'||owner.cancelRequested
      ||typeof deadline!=='string'||!Number.isFinite(Date.parse(deadline))||now()>=Date.parse(deadline))
      denied('Completion requires the original live running owner');
    const records=runtime.readToolExecutions(input.ownerTaskId),record=records.find(r=>r.evidenceId===input.publicationRunId);
    const invocation=runtime.loadCheckpoint(input.ownerTaskId,'application-tool-invocation:'+input.publicationRunId);
    const cached=runtime.loadCheckpoint(input.ownerTaskId,'tool-result-'+input.publicationRunId);
    if(!record||record.taskId!==input.ownerTaskId||record.toolName!=='coding.repair.publish'||record.toolVersion!=='1.0.0'
      ||record.state!=='confirmed'||!record.executionStarted||record.policyDecision!=='allow'
      ||records.at(-1)?.evidenceId!==input.publicationRunId||records.some(r=>r.state==='unknown'||r.state==='started')
      ||!plain(invocation)||invocation.toolName!==record.toolName||invocation.toolVersion!==record.toolVersion
      ||invocation.deadline!==deadline||!plain(invocation.arguments)||invocation.argumentsDigest!==toolArgumentsDigest(invocation.arguments)
      ||!runtime.matchesToolExecutionInput(record,{arguments:invocation.arguments,scopeRef:input.publicationRunId})
      ||!runtime.readEvidence(input.ownerTaskId).some(e=>e.evidenceId===input.publicationRunId&&e.kind==='execution'&&e.sourceRef===record.toolName)
      ||!plain(cached)||!Object.hasOwn(cached,'result'))denied('Original confirmed publication unavailable for completion');
    const loop=runtime.loadCheckpoint(input.ownerTaskId,'competition-loop');
    if(!plain(loop)||loop.pending!==undefined||!plain(loop.continuation)||loop.continuation.state!=='confirmed'
      ||typeof loop.continuation.proposalId!=='string'||!Array.isArray(loop.receipts))denied('Original publication continuation unavailable');
    const receipts=loop.receipts.filter(item=>plain(item)&&item.runId===input.publicationRunId);
    const receipt=receipts[0];
    if(receipts.length!==1||!plain(receipt)||!plain(receipt.proposal)||receipt.proposal.proposalId!==loop.continuation.proposalId
      ||receipt.proposal.toolName!==record.toolName||receipt.proposal.toolVersion!==record.toolVersion||receipt.proposal.verification==='mock'
      ||!isDeepStrictEqual(receipt.proposal.arguments,invocation.arguments)||!isDeepStrictEqual(receipt.continuation,loop.continuation)
      ||!isDeepStrictEqual(loop.continuation.result,cached.result))denied('Publication continuation differs from its original cache and proposal');
    const request=parseCodingRepairPublishRequest(invocation.arguments),published=parseCodingRepairPublishReadback(cached.result);
    const origin=adoptionOrigin(input,input.ownerTaskId),session=sessionForProvenance(input,input.ownerTaskId);
    if(!origin||!session)return;
    const scope=(runtime.loadCheckpoint(input.ownerTaskId,operationKey(input.runId)) as OperationRecord).scope;
    const adoption=provenanceOperation(input,input.ownerTaskId),checked=parseCodingRepairCheckReadback(adoption.result);
    if(scope.deadline!==deadline||published.state!=='published'||published.sessionId!==session.session.sessionId
      ||request.sessionId!==session.session.sessionId||request.baselineSnapshotId!==session.session.baselineSnapshotId
      ||request.snapshotId!==checked.snapshot.snapshotId||checked.sessionId!==session.session.sessionId
      ||harnessCandidateArtifactDigest(checked.snapshot)!==origin.artifactDigest||!published.evidenceRefs.includes(input.runId)
      ||!request.paths.length||published.files.length!==request.paths.length
      ||request.paths.some(path=>!published.files.some(file=>file.path===path))
      ||published.files.some(file=>file.beforeSha256!==(session.initialSnapshot.files.find(f=>f.path===file.path)?.sha256??null)
        ||file.afterSha256!==checked.snapshot.files.find(f=>f.path===file.path)?.sha256))
      denied('Publication is not the original freshly adopted CAS readback');
    const changed=[...new Set([...session.initialSnapshot.files,...checked.snapshot.files].map(f=>f.path))].filter(path=>
      session.initialSnapshot.files.find(f=>f.path===path)?.sha256!==checked.snapshot.files.find(f=>f.path===path)?.sha256);
    if(!isDeepStrictEqual([...changed].sort(),[...request.paths].sort())||session.recipes.filter(r=>r.required).some(recipe=>{
      const verified=[...checked.verification].reverse().find(r=>r.recipeId===recipe.recipeId);
      return !verified||verified.inputSnapshotId!==checked.snapshot.snapshotId||!request.verificationRunIds.includes(verified.runId)
        ||!verified.evidenceRefs.includes(input.runId)||!isDeepStrictEqual([...verified.packageIds].sort(),[...recipe.packageIds].sort())
        ||!codingVerificationCurrent(verified,checked.snapshot,session.session.sessionId);
    }))denied('Publication lacks fresh current required verification');
    return {origin,input:session};
  }
  async function readParentArtifactDigests(context:ToolContext,candidateId:string,parentRuns:readonly string[],patches:readonly CodingRepairPatch[]):Promise<readonly string[]> {
    const op=own(context,[trialTool]);
    if(op.arguments.candidateId!==candidateId||!isDeepStrictEqual(op.arguments.parentTrialRunIds??[],parentRuns)
      ||!isDeepStrictEqual(op.arguments.patches,patches)||parentRuns.length<2||new Set(parentRuns).size!==parentRuns.length)
      denied('Combination input differs from its original invocation');
    const visiting=new Set<string>(),visited=new Set<string>(),trials=new Map<string,ReturnType<typeof readTrial>>();
    const visit=(runId:string):void=>{
      if(runId===context.runId||visiting.has(runId))conflict('Combination ancestry contains a cycle');
      if(visited.has(runId))return;
      visiting.add(runId);const parent=readTrial(context,runId);trials.set(runId,parent);
      const ancestors=parent.operation.arguments.parentTrialRunIds??[];
      if(!Array.isArray(ancestors)||ancestors.some(r=>typeof r!=='string')||new Set(ancestors).size!==ancestors.length)denied('Invalid original parent references');
      for(const ancestor of ancestors)visit(ancestor);
      if(!isDeepStrictEqual(parent.trial.binding.parentArtifactDigests,ancestors.map(id=>trials.get(id)!.trial.binding.artifactDigest)))
        denied('Parent artifact ancestry differs from its confirmed input');
      visiting.delete(runId);visited.add(runId);
    };
    for(const runId of parentRuns)visit(runId);
    compareHarnessCandidates(frozen(op.scope),[...trials.values()].map(t=>t.trial));
    assertPatchUnion(parentRuns.map(runId=>trials.get(runId)!),patches);
    return parentRuns.map(id=>trials.get(id)!.trial.binding.artifactDigest);
  }
  const compare:RuntimeHarnessCandidateOptions={getBinding:context=>{
    const op=own(context,[compareTool]);return frozen(op.scope);
  },resolveTrialOrigin:(ownerTaskId,runId,context)=>{
    own(context,[compareTool]);const {operation:op}=readTrial(context,runId);
    if(op.scope.ownerTaskId!==ownerTaskId)denied('Trial owner differs from comparison owner');
    return {actualTaskId:op.scope.actualTaskId,arguments:structuredClone(op.arguments),scopeRef:op.scope.scopeRef};
  }};
  async function readSelection(context:ToolContext,trialRunId:string) {
    const runtime=application.runtime;
    const active=own(context,[adoptTool]),configuration=frozen(active.scope);
    if(context.taskId!==active.scope.ownerTaskId)denied('Main adoption must run in the original user-work owner');
    const latest=runtime.readToolExecutions(active.scope.ownerTaskId).filter(r=>r.toolName===compareTool).at(-1);
    if(!latest)denied('Original owner has no comparison');
    const original=source(context,latest!.evidenceId);
    const ids=original.arguments.trialRunIds;
    if(original.toolName!==compareTool||!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)
      denied('Original comparison input unavailable');
    const observed=(ids as string[]).map(id=>readTrial(context,id));
    const comparison=compareHarnessCandidates(configuration,observed.map(v=>v.trial));
    if(comparison.recommendation)comparison.recommendation.trialRunId=(ids as string[])[observed.findIndex(v=>v.trial.binding.candidateId===comparison.recommendation!.candidateId)]!;
    const cached=runtime.loadCheckpoint(original.scope.actualTaskId,'tool-result-'+original.runId);
    if(!plain(cached)||!isDeepStrictEqual(cached.result,{...comparison,evidenceRefs:ids})||comparison.state!=='selected'
      ||comparison.recommendation?.trialRunId!==trialRunId)denied('Latest confirmed comparison does not select this original trial');
    const selected=observed[(ids as string[]).indexOf(trialRunId)];
    if(!selected)denied('Selected trial is not in the original comparison');
    const executionInputDigest=(op:Operation)=>runtime.readToolExecutions(op.scope.actualTaskId).find(r=>r.evidenceId===op.runId)!.inputDigest;
    const trialCache=runtime.loadCheckpoint(selected.operation.scope.actualTaskId,'tool-result-'+trialRunId) as {result:unknown};
    const origin:RuntimeHarnessCandidateAdoptionOrigin={version:1,ownerTaskId:active.scope.ownerTaskId,
      adoption:{taskId:context.taskId,runId:context.runId},trial:{taskId:selected.operation.scope.actualTaskId,runId:trialRunId},
      comparison:{taskId:original.scope.actualTaskId,runId:original.runId},inputDigest:active.scope.inputDigest,
      configurationRef:active.scope.configurationRef,workspaceRef:active.scope.workspaceRef,workspaceId:configuration.binding.workspaceId,
      baselineSnapshotId:configuration.binding.baselineSnapshotId,candidateId:selected.trial.binding.candidateId,
      artifactId:selected.trial.binding.artifactId,artifactDigest:selected.trial.binding.artifactDigest,
      adoptionInputDigest:executionInputDigest(active),trialInputDigest:executionInputDigest(selected.operation),comparisonInputDigest:executionInputDigest(original),
      trialResultDigest:toolArgumentsDigest(trialCache.result),comparisonResultDigest:toolArgumentsDigest(cached.result)};
    once(active.scope.ownerTaskId,adoptionOriginKey(context.runId),origin);
    return {trial:structuredClone(selected!.trial),comparison,patches:structuredClone(selected!.patches)};
  }
  const trial={readBinding,readParentArtifactDigests,readSession,saveSession};
  return {trial,adoption:{...trial,readSelection},recovery:{readOriginalSession},compare,readOriginalSessionForRecovery,
    readOriginalSessionForProvenance,readAdoptionOrigin,readAdoptionOriginForCompletion};
}
