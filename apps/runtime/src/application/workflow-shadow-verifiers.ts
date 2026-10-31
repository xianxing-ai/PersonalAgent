import {createHmac,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import {workflowShadowReleaseDigest} from '@personal-agent/agentarts';
import type {WorkflowShadowBranchReceipt,WorkflowShadowReleaseBranch} from '@personal-agent/agentarts';
import type {TaskRuntime} from '../index.js';

export interface RuntimeWorkflowShadowBranchVerifierOptions {
  runtime:Pick<TaskRuntime,'getTask'|'loadCheckpoint'|'readToolExecutions'|'readEvidence'>;
  /** Existing host receipt key; this verifier never signs or records external input. */
  receiptSecret:string;
  /** Trusted original graph-driver checkpoint name, never supplied by a model or receipt. */
  driverCheckpointKey:string;
  /** Independent trusted evaluator must bind scores and conditions to the original
   * real result and evidence. Signature validity alone cannot establish this. */
  verifyBranchObservation:(branch:WorkflowShadowReleaseBranch)=>Promise<boolean>;
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>object(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const contextKeys=['taskId','sessionId','controlRevision','taskDeadline'] as const;
const receiptKeys=['receiptId','taskKey','taskClass','decisionRef','branch','candidateId','baselineSha256','conditionsDigest',
  'workspaceRef','resultSha256','qualityMetricId','qualityScore','wallMs','modelCalls','evidenceRefs','configurationId','version',
  'parametersDigest','observedAt','expiresAt','proof'] as const;
const proofKeys=[...contextKeys,'kind','receiptDigest','isolationDigest','signature'] as const;
// Same canonical JSON as the existing host signer, without creating a signing API.
function canonical(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const item=value as Record<string,unknown>;
  return '{'+Object.keys(item).sort().map(key=>JSON.stringify(key)+':'+canonical(item[key])).join(',')+'}';
}

/** Verify the existing v1 host signature over the complete F23 body, then bind a pair
 * to the original Runtime task/driver checkpoint. A valid signature is not Policy,
 * a test Evidence verifier, or proof of AgentArts/platform execution. */
export function createRuntimeWorkflowShadowBranchVerifiers(options:RuntimeWorkflowShadowBranchVerifierOptions) {
  if(!options?.runtime||typeof options.runtime.getTask!=='function'||typeof options.runtime.loadCheckpoint!=='function'
    ||typeof options.runtime.readToolExecutions!=='function'||typeof options.runtime.readEvidence!=='function'
    ||typeof options.receiptSecret!=='string'||Buffer.byteLength(options.receiptSecret)<32||!text(options.driverCheckpointKey)
    ||typeof options.verifyBranchObservation!=='function')
    throw new ProtocolError('INVALID_ARGUMENT','Original Runtime binding and receipt key required');
  const verifyBranch=async(input:WorkflowShadowBranchReceipt):Promise<boolean>=>{
    try {
      if(!exact(input,receiptKeys)||!exact(input.proof,proofKeys))return false;
      const proof=input.proof;
      if(!text(proof.taskId)||proof.taskId!==input.taskKey||!text(proof.sessionId)
        ||!Number.isSafeInteger(proof.controlRevision)||(proof.controlRevision as number)<0
        ||!text(proof.taskDeadline)||!Number.isFinite(Date.parse(proof.taskDeadline))
        ||proof.kind!=='branch_result'||typeof proof.signature!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(proof.signature)
        ||input.branch==='shadow'&&(typeof proof.isolationDigest!=='string'||!/^[a-f0-9]{64}$/u.test(proof.isolationDigest)))return false;
      const {proof:_,...body}=input;
      if(proof.receiptDigest!==workflowShadowReleaseDigest(body))return false;
      const {signature,...signed}=proof;
      const expected=createHmac('sha256',options.receiptSecret).update('workflow-shadow:branch_result:v1\n'+canonical(signed)).digest();
      const actual=Buffer.from(signature as string,'base64url');
      if(actual.length!==expected.length||!timingSafeEqual(expected,actual)||!Array.isArray(input.evidenceRefs)||!input.evidenceRefs.length)return false;
      const records=structuredClone(options.runtime.readToolExecutions(input.taskKey)),evidence=structuredClone(options.runtime.readEvidence(input.taskKey));
      if(!input.evidenceRefs.every(id=>text(id)&&records.some(record=>record.evidenceId===id&&record.state==='confirmed'
          &&record.executionStarted&&record.policyDecision==='allow'
          &&evidence.some(item=>item.evidenceId===id&&item.kind==='execution'&&item.sourceRef===record.toolName))))return false;
      if(await options.verifyBranchObservation(structuredClone(input) as unknown as WorkflowShadowReleaseBranch)!==true)return false;
      const currentRecords=options.runtime.readToolExecutions(input.taskKey),currentEvidence=options.runtime.readEvidence(input.taskKey);
      return input.evidenceRefs.every(id=>isDeepStrictEqual(records.find(record=>record.evidenceId===id),currentRecords.find(record=>record.evidenceId===id))
        &&isDeepStrictEqual(evidence.find(item=>item.evidenceId===id),currentEvidence.find(item=>item.evidenceId===id)));
    } catch {return false;}
  };
  const verifyComparable=async(main:WorkflowShadowReleaseBranch,shadow:WorkflowShadowReleaseBranch,context:ToolContext):Promise<boolean>=>{
    try {
      if(context.signal.aborted||Date.parse(context.deadline)<=Date.now()||!await verifyBranch(main)||!await verifyBranch(shadow))return false;
      const a=main.proof as Record<string,unknown>,b=shadow.proof as Record<string,unknown>;
      if(contextKeys.some(key=>a[key]!==b[key])||a.taskId!==main.taskKey||main.taskKey!==shadow.taskKey)return false;
      const parent=options.runtime.loadCheckpoint(context.taskId,'coding-repair:parent');
      if(!object(parent)||parent.taskId!==a.taskId||!text(parent.operationId))return false;
      const host=options.runtime.loadCheckpoint(parent.taskId as string,'coding-repair:host:'+parent.operationId);
      if(!object(host)||host.localTaskId!==context.taskId||!object(host.request)||host.request.toolName!=='workflow.host.f23_n04'
        ||!object(host.request.arguments)||!isDeepStrictEqual(host.request.arguments.main,main)
        ||!isDeepStrictEqual(host.request.arguments.shadow,shadow))return false;
      const task=options.runtime.getTask(parent.taskId as string);
      if(task.cancelRequested||['succeeded','failed','cancelled'].includes(task.state))return false;
      const state=options.runtime.loadCheckpoint(parent.taskId as string,options.driverCheckpointKey);
      const binding=options.runtime.loadCheckpoint(parent.taskId as string,options.driverCheckpointKey+':driver-binding');
      return object(state)&&object(binding)&&binding.taskId===a.taskId&&binding.workflowId==='F23'
        &&state.sessionId===a.sessionId&&binding.sessionId===a.sessionId&&state.controlRevision===a.controlRevision
        &&binding.deadline===a.taskDeadline&&Date.parse(a.taskDeadline as string)>Date.now()
        &&!context.signal.aborted&&Date.parse(context.deadline)>Date.now();
    } catch {return false;}
  };
  return {verifyBranch,verifyComparable};
}
