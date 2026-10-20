import {randomUUID} from 'node:crypto';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {parseCodingRepairInput,parseCodingRepairPatch,parseCodingRepairCheckReadback} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairInput,CodingRepairPatch,CodingRepairCheckReadback} from '@personal-agent/contracts/coding-repair';
import {parseHarnessCandidateTrial,parseHarnessCandidateBinding,harnessCandidateArtifactDigest,harnessCandidateRecipeFingerprint} from '@personal-agent/contracts/harness-candidates';
import type {HarnessCandidateContext,HarnessCandidateTrial,HarnessCandidateComparison} from '@personal-agent/contracts/harness-candidates';
import type {IsolatedCodingRepairHost} from './isolated-repair.js';
import {codingRepairPackageGraphDigest} from './repair-verification.js';

export const HARNESS_TRIAL_TOOL='coding.repair.trial';
export interface HarnessTrialToolOptions {
  host:IsolatedCodingRepairHost;
  /** Trusted original user-work binding; never taken from model arguments. */
  readBinding:(context:ToolContext,candidateId:string)=>Promise<HarnessCandidateContext>;
  /** Optional proven composition inputs; model claims are not accepted. */
  readParentArtifactDigests?:(context:ToolContext,candidateId:string)=>Promise<readonly string[]>;
  /** Original Runtime checkpoint ports, bound to task/run/input, not a second task store. */
  readSession:(context:ToolContext)=>Promise<CodingRepairInput|undefined>;
  saveSession:(context:ToolContext,input:CodingRepairInput)=>Promise<void>;
  now?:()=>number;
}
const scopes=['workspace:read','workspace:write','workspace:apply','workspace:execute'];
const withoutContent=<T extends {content?:string}>(file:T):Omit<T,'content'>=>{const {content:_content,...metadata}=file;return metadata;};
const metadata=(readback:CodingRepairCheckReadback,runId:string):CodingRepairCheckReadback=>({
  ...readback,snapshot:{...readback.snapshot,files:readback.snapshot.files.map(withoutContent)},
  verification:readback.verification.map(receipt=>({...receipt,files:receipt.files.map(withoutContent),evidenceRefs:[runId],
    diagnostics:receipt.diagnostics.map(()=>({source:'command',message:'Original verification returned diagnostics; inspect its trusted local record'}))}))});
/** One original Gateway invocation, one isolated candidate. No cloud call, scheduling or publish. */
export function createHarnessCandidateTrialTool(inputOptions:HarnessTrialToolOptions):RegisteredTool {
  const options={...inputOptions};
  const active=new Set<string>(),now=options.now??Date.now;
  const descriptor:RegisteredTool['descriptor']={name:HARNESS_TRIAL_TOOL,version:'1.0.0',
    inputSchema:{type:'object',additionalProperties:false,required:['candidateId','patches','recipeIds'],properties:{
      candidateId:{type:'string',minLength:1,maxLength:256,pattern:'^[A-Za-z0-9@][A-Za-z0-9_.:/@-]*$'},
      patches:{type:'array',items:{type:'object'}},recipeIds:{type:'array',minItems:1,uniqueItems:true,items:{type:'string',minLength:1}}}},
    outputSchema:{},sideEffect:'local_write',requiredScopes:scopes,idempotencySupport:false,recoverySupport:false,requiresPresence:false};
  function check(context:ToolContext):void {
    if(scopes.some(scope=>!context.scopes.includes(scope)))throw new ProtocolError('SCOPE_DENIED','Trial requires original approved coding scopes');
    if(context.signal.aborted)throw new ProtocolError('CANCELLED','Original trial cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||now()>=Date.parse(context.deadline))throw new ProtocolError('TIMEOUT','Original trial deadline expired');
  }
  return {descriptor,async execute(value,context):Promise<HarnessCandidateTrial> {
    validateToolValue(descriptor.inputSchema,value);check(context);
    const input=structuredClone(value) as {candidateId:string;patches:CodingRepairPatch[];recipeIds:string[]};
    input.patches=input.patches.map(parseCodingRepairPatch);
    if(new Set(input.patches.map(p=>p.path)).size!==input.patches.length)throw new ProtocolError('INVALID_ARGUMENT','Combine exact edits per candidate path');
    const key=JSON.stringify([context.taskId,context.runId]);
    if(active.has(key))throw new ProtocolError('RESULT_UNKNOWN','Original trial is already active');
    active.add(key);
    try {
      if(await options.readSession(context))throw new ProtocolError('RESULT_UNKNOWN','Read back the original trial session; do not replay candidate patches');
      const expected=structuredClone(await options.readBinding(context,input.candidateId));check(context);
      const parentArtifactDigests=[...await options.readParentArtifactDigests?.(context,input.candidateId)??[]];check(context);
      if(parentArtifactDigests.length===1)throw new ProtocolError('INVALID_ARGUMENT','A composition requires multiple proven parent artifacts');
      parseHarnessCandidateBinding({...expected.binding,trialTaskId:context.taskId,candidateId:input.candidateId,
        artifactId:'preflight',sessionId:'preflight',artifactDigest:harnessCandidateArtifactDigest(expected.baseline),parentArtifactDigests});
      if(expected.binding.baselineSnapshotId!==expected.baseline.snapshotId
        ||expected.binding.recipeFingerprint!==harnessCandidateRecipeFingerprint(expected.recipes))
        throw new ProtocolError('REVISION_CONFLICT','Original trusted trial binding is inconsistent');
      const recipes=new Set(expected.recipes.map(r=>r.recipeId));
      if(input.recipeIds.some(id=>!recipes.has(id))||expected.recipes.some(r=>r.required&&!input.recipeIds.includes(r.recipeId)))
        throw new ProtocolError('INVALID_ARGUMENT','Candidate must execute its original required verification recipes');
      const started=parseCodingRepairInput(await options.host.start({mode:'isolated',allowedPaths:input.patches.map(p=>p.path)},context));
      if(started.session.taskId!==context.taskId||started.session.workspaceId!==expected.binding.workspaceId
        ||started.session.mode!=='isolated'||started.initialSnapshot.snapshotId!==expected.baseline.snapshotId
        ||harnessCandidateArtifactDigest(started.initialSnapshot)!==harnessCandidateArtifactDigest(expected.baseline)
        ||harnessCandidateRecipeFingerprint(started.recipes)!==expected.binding.recipeFingerprint)
        throw new ProtocolError('REVISION_CONFLICT','Original candidate baseline or recipe binding changed');
      await options.saveSession(context,structuredClone(started));check(context);
      const readback=await options.host.check(started.session.sessionId,input.patches,input.recipeIds,context);check(context);
      const current=await options.readBinding(context,input.candidateId);check(context);
      const parents=[...await options.readParentArtifactDigests?.(context,input.candidateId)??[]];check(context);
      if(JSON.stringify(current)!==JSON.stringify(expected)||JSON.stringify(parents)!==JSON.stringify(parentArtifactDigests))
        throw new ProtocolError('REVISION_CONFLICT','Original trial context changed during verification');
      // These are references to this invocation, accepted only after Runtime confirms its result.
      const checkReadback=metadata(readback,context.runId);
      return parseHarnessCandidateTrial({binding:{...expected.binding,candidateId:input.candidateId,artifactId:randomUUID(),
        trialTaskId:context.taskId,sessionId:started.session.sessionId,artifactDigest:harnessCandidateArtifactDigest(checkReadback.snapshot),parentArtifactDigests},
        session:started.session,checkReadback});
    }finally{active.delete(key);}
  }};
}

export const HARNESS_PREPARE_ADOPTION_TOOL='coding.repair.prepare_adoption';
export interface HarnessAdoptionToolOptions extends HarnessTrialToolOptions {
  /** Reads the selected original confirmed Runtime result AND its exact original invocation patches. */
  readSelection:(context:ToolContext,trialRunId:string)=>Promise<{
    trial:HarnessCandidateTrial;comparison:HarnessCandidateComparison;patches:readonly CodingRepairPatch[];
  }>;
}
/** Prepare only. Runtime must confirm this invocation before the original F15 publish can read its Evidence. */
export function createHarnessCandidateAdoptionTool(inputOptions:HarnessAdoptionToolOptions):RegisteredTool {
  const options={...inputOptions},active=new Set<string>(),now=options.now??Date.now;
  const descriptor:RegisteredTool['descriptor']={name:HARNESS_PREPARE_ADOPTION_TOOL,version:'1.0.0',
    inputSchema:{type:'object',additionalProperties:false,required:['trialRunId'],properties:{trialRunId:{type:'string',minLength:1,maxLength:256}}},
    outputSchema:{},sideEffect:'local_write',requiredScopes:scopes,idempotencySupport:false,recoverySupport:false,requiresPresence:false};
  function check(context:ToolContext):void {
    if(scopes.some(scope=>!context.scopes.includes(scope)))throw new ProtocolError('SCOPE_DENIED','Adoption requires original coding scopes');
    if(context.signal.aborted)throw new ProtocolError('CANCELLED','Original adoption cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||now()>=Date.parse(context.deadline))throw new ProtocolError('TIMEOUT','Original adoption deadline expired');
  }
  return {descriptor,async execute(value,context):Promise<CodingRepairCheckReadback> {
    validateToolValue(descriptor.inputSchema,value);check(context);
    const {trialRunId}=value as {trialRunId:string},key=JSON.stringify([context.taskId,context.runId]);
    if(active.has(key))throw new ProtocolError('RESULT_UNKNOWN','Original adoption is already active');active.add(key);
    try {
      if(await options.readSession(context))throw new ProtocolError('RESULT_UNKNOWN','Read back the original adoption session instead of replaying patches');
      const selected=structuredClone(await options.readSelection(context,trialRunId));check(context);
      const trial=parseHarnessCandidateTrial(selected.trial),recommended=selected.comparison.recommendation;
      if(selected.comparison.state!=='selected'||!recommended||recommended.trialRunId!==trialRunId||recommended.candidateId!==trial.binding.candidateId
        ||recommended.artifactId!==trial.binding.artifactId||recommended.artifactDigest!==trial.binding.artifactDigest
        ||trial.session.mode!=='isolated'||trial.binding.taskId!==context.taskId||trial.binding.executionKind!=='real_host'
        ||trial.binding.trialTaskId!==trial.session.taskId||trial.binding.sessionId!==trial.session.sessionId
        ||trial.checkReadback.sessionId!==trial.session.sessionId
        ||trial.checkReadback.verification.some(r=>!r.evidenceRefs.includes(trialRunId))
        ||harnessCandidateArtifactDigest(trial.checkReadback.snapshot)!==trial.binding.artifactDigest)
        throw new ProtocolError('UNAUTHORIZED','Original confirmed selected candidate is unavailable');
      const expected=structuredClone(await options.readBinding(context,trial.binding.candidateId));check(context);
      if(Object.entries(expected.binding).some(([name,v])=>trial.binding[name as keyof typeof trial.binding]!==v)
        ||expected.binding.recipeFingerprint!==harnessCandidateRecipeFingerprint(expected.recipes)
        ||expected.recipes.some(recipe=>recipe.required&&!trial.checkReadback.verification.some(receipt=>receipt.recipeId===recipe.recipeId
          &&receipt.status==='VALID'&&receipt.exitCode===0&&receipt.inputSnapshotId===trial.checkReadback.snapshot.snapshotId
          &&receipt.sessionId===trial.session.sessionId&&receipt.evidenceRefs.includes(trialRunId)
          &&receipt.packageGraphDigest===codingRepairPackageGraphDigest(trial.checkReadback.snapshot)
          &&JSON.stringify([...receipt.packageIds].sort())===JSON.stringify([...recipe.packageIds].sort())
          &&harnessCandidateArtifactDigest({...trial.checkReadback.snapshot,files:receipt.files})===trial.binding.artifactDigest)))
        throw new ProtocolError('REVISION_CONFLICT','Selected candidate input or configuration changed');
      const patches=selected.patches.map(parseCodingRepairPatch);
      if(new Set(patches.map(p=>p.path)).size!==patches.length)throw new ProtocolError('INVALID_ARGUMENT','Duplicate adoption patch paths');
      const started=parseCodingRepairInput(await options.host.start({mode:'main',allowedPaths:patches.map(p=>p.path)},context));
      if(started.session.taskId!==context.taskId||started.session.mode!=='main'||started.session.workspaceId!==expected.binding.workspaceId
        ||started.initialSnapshot.snapshotId!==expected.binding.baselineSnapshotId
        ||harnessCandidateArtifactDigest(started.initialSnapshot)!==harnessCandidateArtifactDigest(expected.baseline)
        ||harnessCandidateRecipeFingerprint(started.recipes)!==expected.binding.recipeFingerprint)
        throw new ProtocolError('REVISION_CONFLICT','Original adoption baseline or recipes changed');
      await options.saveSession(context,structuredClone(started));check(context);
      const checked=parseCodingRepairCheckReadback(await options.host.check(started.session.sessionId,patches,expected.recipes.map(r=>r.recipeId),context));check(context);
      if(harnessCandidateArtifactDigest(checked.snapshot)!==trial.binding.artifactDigest
        ||JSON.stringify(await options.readBinding(context,trial.binding.candidateId))!==JSON.stringify(expected)
        ||JSON.stringify(await options.readSelection(context,trialRunId))!==JSON.stringify(selected))
        throw new ProtocolError('REVISION_CONFLICT','Selected artifact changed during fresh adoption verification');
      check(context);return metadata(checked,context.runId);
    }finally{active.delete(key);}
  }};
}
