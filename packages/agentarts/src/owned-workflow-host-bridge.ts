import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {OwnedWorkflowAdvanceRequest,WorkflowProposal,WorkflowReceipt,WorkflowReceiptVerifier,
  WorkflowRevisionIdentity,WorkflowRevisionMigration,WorkflowControlCommand} from './owned-workflows.js';
import {parseWorkflowSelectionResult,workflowShadowSelectedPlan,workflowShadowSelectionDigest,createWorkflowShadowCheckpointPort,
  createWorkflowShadowHistory,verifyWorkflowShadowBranches,evaluateWorkflowShadowPolicy,constrainWorkflowShadowPolicy} from './workflow-shadow-policy.js';
import type {WorkflowShadowPolicyConfig,WorkflowShadowResourceSnapshot,WorkflowShadowBranchReceipt,
  WorkflowShadowReceiptVerifier,WorkflowShadowEvaluationReceipt,WorkflowShadowTaskContext} from './workflow-shadow-policy.js';

const canonical=(value:unknown):string=>{
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+canonical(record[key])).join(',')+'}';
};
const hash=(value:unknown):string=>createHash('sha256').update(canonical(value)).digest('hex');
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const invalid=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
function signer(secret:string) {
  if(typeof secret!=='string'||Buffer.byteLength(secret)<32) invalid('Invalid trusted workflow receipt key');
  return (value:unknown)=>createHmac('sha256',secret).update(canonical(value)).digest('base64url');
}
function authentic(proof:unknown,sign:(value:unknown)=>string):proof is Record<string,unknown> {
  if(!plain(proof)||typeof proof.signature!=='string') return false;
  const {signature,...body}=proof;
  const expected=Buffer.from(sign(body),'base64url'),actual=Buffer.from(signature,'base64url');
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}

/** Signature checks provenance of an existing local result. It is never a Policy grant. */
export function createOwnedWorkflowReceiptVerifier(options:{secret:string}):WorkflowReceiptVerifier {
  const sign=signer(options.secret);
  return {
    async verify(receipt,expected,request) {
      const proof=receipt.proof;
      if(!authentic(proof,sign)||proof.proofVersion!=='1.0.0'||proof.kind!=='tool_receipt'
        ||expected.kind!=='tool_proposal'||proof.taskId!==request.taskId||proof.sessionId!==request.sessionId
        ||proof.workflowId!==request.workflowId&&`owned-${proof.workflowId}`!==request.workflowId
        ||proof.originControlRevision!==expected.originControlRevision||proof.nodeId!==expected.nodeId
        ||proof.operationId!==expected.operationId||proof.proposalId!==expected.proposalId
        ||proof.proposalDigest!==hash(expected)
        ||proof.inputDigest!==expected.inputDigest||proof.toolName!==expected.toolName||proof.toolVersion!==expected.toolVersion
        ||proof.argumentsDigest!==hash(expected.arguments)||proof.state!==receipt.state
        ||proof.resultDigest!==hash(receipt.result)||proof.evidenceDigest!==hash(receipt.evidenceRefs)
        ||!(proof.shadowDigest===undefined&&receipt.shadowEvaluation===undefined
          ||proof.shadowDigest===hash(receipt.shadowEvaluation??null))
        ||typeof proof.localTaskId!=='string'||proof.runId!==`host-tool-${proof.localTaskId}`) return false;
      return receipt.state!=='confirmed'||receipt.evidenceRefs.includes(proof.runId as string);
    },
    async verifyMigration(migration,previous,next) {
      const proof=migration.proof;
      return authentic(proof,sign)&&proof.proofVersion==='1.0.0'&&proof.kind==='revision_migration'
        &&proof.previousDigest===hash(previous)&&proof.nextDigest===hash(next)
        &&proof.invalidatedDigest===hash(migration.invalidatedNodeIds);
    },
    async verifyControl(command,request) {
      const proof=command.proof;
      return authentic(proof,sign)&&proof.proofVersion==='1.0.0'&&proof.kind==='host_control'
        &&proof.taskId===request.taskId&&proof.sessionId===request.sessionId&&proof.workflowId===request.workflowId
        &&proof.controlRevision===request.controlRevision&&proof.checkpointDigest===hash(request.checkpoint)
        &&proof.commandDigest===hash({commandId:command.commandId,action:command.action,...(command.reason===undefined?{}:{reason:command.reason})});
    },
    async verifyShadowEvaluation(evaluation,request) {
      const {proof,...body}=evaluation;
      return authentic(proof,sign)&&proof.proofVersion==='1.0.0'&&proof.kind==='shadow_policy'
        &&proof.evaluationDigest===hash(body)&&evaluation.context.taskId===request.taskId
        &&evaluation.context.sessionId===request.sessionId&&evaluation.context.controlRevision===request.controlRevision
        &&evaluation.context.taskDeadline===(request.taskDeadline??request.deadline);
    },
  };
}

/** Structural projection of the existing RuntimeApplication public host-tool API, not a new executor. */
export interface WorkflowHostTaskPort {
  submitHostToolTask(request:{commandId:string;toolName:string;toolVersion:string;arguments:Record<string,unknown>;deadline:string}):{
    commandId:string;toolName:string;toolVersion:string;task:{taskId:string;state:string}};
  readHostToolTask(taskId:string):{commandId:string;toolName:string;toolVersion:string;task:{taskId:string;state:string;error?:unknown;evidenceRefs?:readonly string[]};
    confirmed?:{runId:string;result:unknown;evidenceRefs:string[]}};
}
export interface WorkflowCheckpointPort {
  read(taskId:string,key:string):unknown;
  /** Must be backed by existing TaskRuntime.saveCheckpointOnce, not an in-memory map in production. */
  writeOnce(taskId:string,key:string,value:unknown):boolean;
}
interface HostBinding {proposal:Extract<WorkflowProposal,{kind:'tool_proposal'}>;localTaskId:string;
  taskId:string;sessionId:string;workflowId:string;controlRevision:number;taskDeadline?:string}
export type WorkflowHostAdvanceContext=Pick<OwnedWorkflowAdvanceRequest,'taskId'|'sessionId'|'workflowId'|'controlRevision'|'deadline'|'taskDeadline'>&{signal?:AbortSignal};
export interface WorkflowShadowHostSnapshot {
  advancedEnabled:boolean;resources:WorkflowShadowResourceSnapshot;
  /** Only current trusted user intent can make delivery wait for both branches. Omission is ordinary. */
  comparisonRequested?:boolean;
  isolation?:{namespace:string;snapshotDigest:string};observedBranches?:readonly WorkflowShadowBranchReceipt[];
  /** Actual trusted active selection binding for a separately isolated branch, never caller JSON. */
  admissionDecisionRef?:string;
}
export interface WorkflowShadowHostPolicy {
  policyConfig:WorkflowShadowPolicyConfig;
  /** Reads current trusted user settings and actual resource observations. Missing data must not become true. */
  readSnapshot(request:WorkflowHostAdvanceContext):WorkflowShadowHostSnapshot|Promise<WorkflowShadowHostSnapshot>;
  /** Verifies trusted actual Runtime/Evidence branch receipts; this bridge additionally binds full context. */
  verifyReceipt:WorkflowShadowReceiptVerifier;
  /** Existing TaskRuntime history anchor chosen by trusted composition; defaults to the original task. */
  historyTaskId?:string;
}

/** Host-only bridge; never expose its receipt key or signing methods in an end-user HTTP route. */
export class OwnedWorkflowHostBridge {
  private readonly sign:(value:unknown)=>string;
  constructor(private readonly options:{host:WorkflowHostTaskPort;checkpoints:WorkflowCheckpointPort;receiptSecret:string;
    /** Existing local control/TaskRuntime source must reject stale, cancelled or terminal work. */
    assertActive:(taskId:string,controlRevision:number)=>void;
    /** Host verifies this task is actually bound to separate roots, credentials and state. A namespace string is insufficient. */
    assertIsolation?:(taskId:string,isolation:{namespace:string;snapshotDigest:string})=>void;
    shadow?:WorkflowShadowHostPolicy;
    /** Independent trusted adapter attests that this failed read has no external effect to replay. Default denies. */
    canRetryReadFailure?:(proposal:Extract<WorkflowProposal,{kind:'tool_proposal'}>,readback:ReturnType<WorkflowHostTaskPort['readHostToolTask']>)=>boolean}) {
    this.sign=signer(options.receiptSecret);
  }
  submit(request:Pick<OwnedWorkflowAdvanceRequest,'taskId'|'sessionId'|'workflowId'|'controlRevision'|'deadline'>,
    proposal:WorkflowProposal):{localTaskId:string;state:string} {
    return this.submitOperation(request,proposal,false);
  }
  private submitOperation(request:WorkflowHostAdvanceContext,proposal:WorkflowProposal,shadowAdmitted:boolean):{localTaskId:string;state:string} {
    if(proposal.kind!=='tool_proposal') throw new ProtocolError('UNSUPPORTED_CAPABILITY','Host operation needs its actual public adapter');
    const key='owned-workflow:operation:'+proposal.operationId;
    const saved=this.options.checkpoints.read(request.taskId,key);
    if(saved!==undefined) {
      const binding=saved as HostBinding;
      if(hash(binding.proposal)!==hash(proposal)||binding.taskId!==request.taskId
        ||binding.sessionId!==request.sessionId||binding.workflowId!==request.workflowId) invalid('Original operation binding changed');
      const readback=this.options.host.readHostToolTask(binding.localTaskId);
      return {localTaskId:binding.localTaskId,state:readback.task.state};
    }
    if(proposal.isolation) {
      if(!this.options.assertIsolation) throw new ProtocolError('UNSUPPORTED_CAPABILITY','Isolated execution host is not configured');
      this.options.assertIsolation(request.taskId,proposal.isolation);
    }
    // A durable binding permits readback only. Neither a new revision nor an old submit intent
    // is permission to submit old parameters for the first time.
    this.options.assertActive(request.taskId,request.controlRevision);
    if(proposal.isolation&&this.options.shadow&&!shadowAdmitted)
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Isolated work requires current trusted shadow admission through submitWithShadow');
    if(proposal.originControlRevision!==request.controlRevision) {
      throw new ProtocolError('REVISION_CONFLICT','Old unbound operation requires original host reconciliation; it cannot first submit in a new revision');
    }
    const intentKey='owned-workflow:intent:'+proposal.operationId;
    const proposedIntent={taskId:request.taskId,sessionId:request.sessionId,workflowId:request.workflowId,
      proposal:structuredClone(proposal),deadline:request.deadline,taskDeadline:request.taskDeadline??request.deadline};
    this.options.checkpoints.writeOnce(request.taskId,intentKey,proposedIntent);
    const intent=this.options.checkpoints.read(request.taskId,intentKey) as typeof proposedIntent;
    if(!intent||intent.taskId!==request.taskId||intent.sessionId!==request.sessionId||intent.workflowId!==request.workflowId
      ||hash(intent.proposal)!==hash(proposal)) invalid('Original host submit intent changed');
    const local=this.options.host.submitHostToolTask({commandId:proposal.operationId,toolName:proposal.toolName,
      toolVersion:proposal.toolVersion,arguments:structuredClone(proposal.arguments),deadline:intent.deadline});
    const binding:HostBinding={proposal:structuredClone(proposal),localTaskId:local.task.taskId,taskId:request.taskId,
      sessionId:request.sessionId,workflowId:request.workflowId,controlRevision:request.controlRevision,taskDeadline:intent.taskDeadline};
    if(!this.options.checkpoints.writeOnce(request.taskId,key,binding)) {
      // commandId is stable in the original Runtime, so a concurrent/restarted submit cannot create a second execution.
      const persisted=this.options.checkpoints.read(request.taskId,key) as HostBinding;
      if(hash(persisted)!==hash(binding)) throw new ProtocolError('REVISION_CONFLICT','Concurrent host operation binding changed');
    }
    return {localTaskId:binding.localTaskId,state:local.task.state};
  }
  private shadowContext(request:WorkflowHostAdvanceContext):WorkflowShadowTaskContext {
    const context={taskId:request.taskId,sessionId:request.sessionId,controlRevision:request.controlRevision,taskDeadline:request.taskDeadline??request.deadline};
    if(request.signal?.aborted)throw new ProtocolError('CANCELLED','Shadow invocation cancelled');
    if(!Number.isFinite(Date.parse(context.taskDeadline))||!Number.isFinite(Date.parse(request.deadline))
      ||Math.min(Date.parse(context.taskDeadline),Date.parse(request.deadline))<=Date.now())
      throw new ProtocolError('TIMEOUT','Original shadow task deadline expired');
    this.options.assertActive(request.taskId,request.controlRevision);return context;
  }
  private async shadowSnapshot(request:WorkflowHostAdvanceContext):Promise<WorkflowShadowHostSnapshot> {
    this.shadowContext(request);
    const snapshot=structuredClone(await this.options.shadow!.readSnapshot(request));this.shadowContext(request);
    if(!snapshot||typeof snapshot.advancedEnabled!=='boolean'||!snapshot.resources
      ||snapshot.comparisonRequested!==undefined&&typeof snapshot.comparisonRequested!=='boolean'
      ||[snapshot.resources.mainPriorityAvailable,snapshot.resources.shadowAllowed,snapshot.resources.taskValueEligible].some(value=>typeof value!=='boolean')
      ||snapshot.resources.reason!==undefined&&typeof snapshot.resources.reason!=='string')invalid('Actual trusted shadow settings/resources required');
    if(snapshot.isolation) {
      if(!this.options.assertIsolation||typeof snapshot.isolation.namespace!=='string'||!snapshot.isolation.namespace
        ||!/^[a-f0-9]{64}$/u.test(snapshot.isolation.snapshotDigest))
        throw new ProtocolError('UNSUPPORTED_CAPABILITY','Actual isolated host binding unavailable');
      this.options.assertIsolation(request.taskId,snapshot.isolation);
    }
    return snapshot;
  }
  /** Readback wins over new admission. Current resource denial only stops an unsubmitted isolated operation. */
  async submitWithShadow(request:WorkflowHostAdvanceContext,proposal:WorkflowProposal):Promise<{localTaskId:string;state:string}> {
    if(this.options.checkpoints.read(request.taskId,'owned-workflow:operation:'+proposal.operationId)!==undefined)
      return this.submitOperation(request,proposal,false);
    this.shadowContext(request);
    if(!proposal.isolation)return this.submitOperation(request,proposal,false);
    if(!this.options.shadow)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Trusted shadow settings/resources port unavailable');
    const snapshot=await this.shadowSnapshot(request),context=this.shadowContext(request);
    if(!snapshot.advancedEnabled||!snapshot.resources.taskValueEligible)
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Current trusted settings or task value do not admit isolated work');
    if(!snapshot.resources.mainPriorityAvailable||!snapshot.resources.shadowAllowed)
      throw new ProtocolError('RATE_LIMITED','Main task or current resources have priority; no isolated operation submitted');
    // Re-read the original selection and latest policy before every NEW operation. An old run
    // evaluation is not a lease to keep starting work after comparison completes or resources change.
    const refreshed=snapshot.admissionDecisionRef?await this.refreshShadowReceipt(request,snapshot.admissionDecisionRef):undefined;
    const admission=refreshed?.shadowEvaluation;this.shadowContext(request);
    if(admission?.policy.action==='defer')throw new ProtocolError('RATE_LIMITED','Current trusted shadow policy deferred this new operation');
    if(!admission||hash(admission.context)!==hash(context)||admission.policy.action!=='run'
      ||hash(admission.isolation)!==hash(proposal.isolation))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original same-decision isolated shadow admission unavailable');
    return this.submitOperation(request,proposal,true);
  }
  /** Actual receipt polling entry point. It keeps the original ToolGateway result and operation intact. */
  async readReceiptWithShadow(request:WorkflowHostAdvanceContext,proposal:WorkflowProposal):Promise<WorkflowReceipt|undefined> {
    const receipt=this.readReceipt(request,proposal);
    if(!receipt||receipt.state!=='confirmed'||proposal.kind!=='tool_proposal'||!plain(receipt.result)
      ||!Object.hasOwn(receipt.result,'metadata')||!Array.isArray(proposal.arguments.candidates))return receipt;
    const ids=proposal.arguments.candidates.map(value=>plain(value)?value.id:undefined);
    if(ids.some(value=>typeof value!=='string'))invalid('Original decision candidate binding unavailable');
    const selection=parseWorkflowSelectionResult(receipt.result,ids as string[]);
    const intent=workflowShadowSelectedPlan(request.taskId,proposal.operationId,selection);if(!intent)return receipt;
    const plan={...intent,mode:'ordinary' as 'ordinary'|'compare'};let comparisonRequested=false;
    const context=this.shadowContext(request),selectionDigest=workflowShadowSelectionDigest(selection);
    const original=this.options.checkpoints.read(request.taskId,'owned-workflow:operation:'+proposal.operationId) as HostBinding|undefined;
    if(!original?.taskDeadline||original.taskDeadline!==context.taskDeadline)
      throw new ProtocolError('REVISION_CONFLICT','Shadow selection cannot change its original TaskRuntime deadline');
    let isolation:WorkflowShadowEvaluationReceipt['isolation']=null;
    let policy:WorkflowShadowEvaluationReceipt['policy']={action:'defer',reason:'trusted_shadow_policy_host_unavailable',mayDeliverMain:false,
      samplingRate:0,sampled:false,comparison:{status:'unknown',reason:'missing_counterfactual'},historySamples:0,provenance:'experience_statistics_not_training'};
    if(this.options.shadow) {
      const configured=this.options.shadow,snapshot=await this.shadowSnapshot(request);isolation=snapshot.isolation??null;
      comparisonRequested=snapshot.comparisonRequested===true;plan.mode=comparisonRequested?'compare':'ordinary';
      const verifyHistorical=async(value:WorkflowShadowBranchReceipt)=>{
        const p=value.proof;
        return plain(p)&&p.taskId===value.taskKey&&typeof p.sessionId==='string'&&!!p.sessionId
          &&Number.isSafeInteger(p.controlRevision)&&(p.controlRevision as number)>=0&&typeof p.taskDeadline==='string'
          &&Number.isFinite(Date.parse(p.taskDeadline))&&await configured.verifyReceipt(structuredClone(value));
      };
      const historyTaskId=configured.historyTaskId??request.taskId;
      const history=createWorkflowShadowHistory({checkpoints:createWorkflowShadowCheckpointPort({
        loadCheckpoint:key=>{this.shadowContext(request);return this.options.checkpoints.read(historyTaskId,key);},
        saveCheckpointOnce:(key,value)=>{this.shadowContext(request);return this.options.checkpoints.writeOnce(historyTaskId,key,value);}}),verifyReceipt:verifyHistorical});
      const observed=await verifyWorkflowShadowBranches(snapshot.observedBranches??[],async value=>{
        const p=value.proof;
        return await verifyHistorical(value)&&plain(p)&&Object.entries(context).every(([key,value])=>p[key]===value);
      });
      this.shadowContext(request);
      const main=observed.branches.find(value=>value.branch==='main'),shadow=observed.branches.find(value=>value.branch==='shadow');
      policy=constrainWorkflowShadowPolicy(evaluateWorkflowShadowPolicy({plan,resources:snapshot.resources,
        history:await history.read(plan.taskClass),observedBranches:observed},configured.policyConfig),plan,
        {advancedEnabled:snapshot.advancedEnabled,isolation});
      // Validate current plan/candidate/context before any durable history append.
      if(main&&shadow&&plan.tier==='isolated'&&policy.comparison.status==='comparable')await history.record(main,shadow);
      this.shadowContext(request);
    }
    const body={version:1 as const,nodeId:proposal.nodeId,decisionRef:proposal.operationId,selectionDigest,context,plan,policy,isolation,
      comparisonRequested,
      authority:'advisory_no_tool_grant' as const,actualExecutionVerified:false as const};
    const proofBody={proofVersion:'1.0.0',kind:'shadow_policy',evaluationDigest:hash(body)};
    const evaluation:WorkflowShadowEvaluationReceipt={...body,proof:{...proofBody,signature:this.sign(proofBody)}};
    const key='owned-workflow:shadow-evaluation:'+proposal.operationId+':'+hash(evaluation);
    this.options.checkpoints.writeOnce(request.taskId,key,evaluation);
    if(hash(this.options.checkpoints.read(request.taskId,key))!==hash(evaluation))
      throw new ProtocolError('REVISION_CONFLICT','Original shadow evaluation checkpoint changed');
    const {signature:ignored,...originalProof}=receipt.proof as Record<string,unknown>;
    const signed={...originalProof,shadowDigest:hash(evaluation)};
    return {...receipt,shadowEvaluation:evaluation,proof:{...signed,signature:this.sign(signed)}};
  }
  /** Re-evaluate completed selection after main/shadow Evidence or resources change; no model/tool rerun. */
  async refreshShadowReceipt(request:WorkflowHostAdvanceContext,decisionRef:string):Promise<WorkflowReceipt|undefined> {
    const binding=this.options.checkpoints.read(request.taskId,'owned-workflow:operation:'+decisionRef) as HostBinding|undefined;
    if(!binding||binding.proposal.operationId!==decisionRef||binding.taskId!==request.taskId||binding.sessionId!==request.sessionId
      ||binding.controlRevision!==request.controlRevision)throw new ProtocolError('REVISION_CONFLICT','Original current selection binding unavailable');
    return this.readReceiptWithShadow(request,binding.proposal);
  }
  readReceipt(request:Pick<OwnedWorkflowAdvanceRequest,'taskId'|'sessionId'|'workflowId'|'controlRevision'>,
    proposal:WorkflowProposal):WorkflowReceipt|undefined {
    if(proposal.kind!=='tool_proposal') throw new ProtocolError('UNSUPPORTED_CAPABILITY','No generic host-operation success signer');
    const saved=this.options.checkpoints.read(request.taskId,'owned-workflow:operation:'+proposal.operationId) as HostBinding|undefined;
    if(!saved||hash(saved.proposal)!==hash(proposal)||saved.taskId!==request.taskId
      ||saved.sessionId!==request.sessionId||saved.workflowId!==request.workflowId) invalid('Original host tool binding not found');
    const binding=saved!;
    const readback=this.options.host.readHostToolTask(binding.localTaskId);
    if(readback.commandId!==proposal.operationId||readback.toolName!==proposal.toolName||readback.toolVersion!==proposal.toolVersion) {
      invalid('Host readback does not match the original tool operation');
    }
    let state:WorkflowReceipt['state'],result:unknown,evidenceRefs:string[];
    if(readback.task.state==='succeeded'&&readback.confirmed) {
      if(readback.confirmed.runId!==`host-tool-${binding.localTaskId}`||!readback.confirmed.evidenceRefs.includes(readback.confirmed.runId)) {
        invalid('Host result has no matching actual execution evidence');
      }
      state='confirmed';result=structuredClone(readback.confirmed.result);evidenceRefs=[...readback.confirmed.evidenceRefs];
    } else if(readback.task.state==='waiting_reconciliation') {
      state='unknown';result={localState:readback.task.state,...(readback.task.error===undefined?{}:{error:structuredClone(readback.task.error)})};
      evidenceRefs=[...(readback.confirmed?.evidenceRefs??readback.task.evidenceRefs??[])];
    }
    else if(readback.task.state==='failed') {
      state='failed';evidenceRefs=[...(readback.confirmed?.evidenceRefs??readback.task.evidenceRefs??[])];
      result={localState:readback.task.state,failure:{...(readback.task.error===undefined?{}:{error:structuredClone(readback.task.error)}),
        retrySafe:proposal.effect==='read'&&!readback.confirmed&&this.options.canRetryReadFailure?.(proposal,readback)===true}};
    }
    else return undefined;
    const body={proofVersion:'1.0.0',kind:'tool_receipt',taskId:binding.taskId,sessionId:binding.sessionId,
      workflowId:binding.workflowId,originControlRevision:proposal.originControlRevision,nodeId:proposal.nodeId,
      proposalId:proposal.proposalId,operationId:proposal.operationId,inputDigest:proposal.inputDigest,proposalDigest:hash(proposal),
      toolName:proposal.toolName,toolVersion:proposal.toolVersion,argumentsDigest:hash(proposal.arguments),
      localTaskId:binding.localTaskId,runId:`host-tool-${binding.localTaskId}`,state,resultDigest:hash(result),evidenceDigest:hash(evidenceRefs)};
    return {nodeId:proposal.nodeId,proposalId:proposal.proposalId,operationId:proposal.operationId,inputDigest:proposal.inputDigest,
      state,result,evidenceRefs,proof:{...body,signature:this.sign(body)}};
  }
  /** Host-only fixed projection after its separate export permission. Local execution facts remain unchanged. */
  projectReceiptResult(request:Pick<OwnedWorkflowAdvanceRequest,'taskId'|'sessionId'|'workflowId'|'controlRevision'>,
    proposal:WorkflowProposal,receipt:WorkflowReceipt,projection:unknown,
    authorization:{policyVersion:string;schemaDigest:string;leaseRef:string;stage:string}):WorkflowReceipt {
    this.options.assertActive(request.taskId,request.controlRevision);
    const original=this.readReceipt(request,proposal);
    if(!original||hash(original)!==hash(receipt)||!plain(original.proof)||original.state!=='confirmed'
      ||!authentic(original.proof,this.sign)||typeof authorization?.policyVersion!=='string'||!authorization.policyVersion
      ||!/^\w[\w:.-]*$/u.test(authorization.stage)||!authorization.leaseRef||!/^[a-f0-9]{64}$/u.test(authorization.schemaDigest))
      invalid('Projection requires the exact original confirmed receipt');
    const confirmed=original!;
    const {signature:ignored,...body}=confirmed.proof as Record<string,unknown>;
    const projected=structuredClone(projection),proof={...body,resultDigest:hash(projected),
      originalResultDigest:hash(confirmed.result),projection:'host-authorized-fixed-fields-v1'};
    const key='owned-workflow:projection:'+proposal.operationId,
      audit={originalReceiptDigest:hash(confirmed),originalResultDigest:hash(confirmed.result),projectedResultDigest:hash(projected),...authorization};
    this.options.checkpoints.writeOnce(request.taskId,key,audit);
    if(hash(this.options.checkpoints.read(request.taskId,key))!==hash(audit))
      invalid('Original receipt projection audit cannot change');
    return {...confirmed,result:projected,proof:{...proof,signature:this.sign(proof)}};
  }
  migration(previous:WorkflowRevisionIdentity,next:WorkflowRevisionIdentity,invalidatedNodeIds:readonly string[]):WorkflowRevisionMigration {
    this.options.assertActive(next.taskId,next.controlRevision);
    if(previous.taskId!==next.taskId||previous.sessionId!==next.sessionId||previous.workflowId!==next.workflowId
      ||previous.templateDigest!==next.templateDigest||next.controlRevision<=previous.controlRevision) invalid('Invalid host revision migration');
    const body={proofVersion:'1.0.0',kind:'revision_migration',previousDigest:hash(previous),nextDigest:hash(next),invalidatedDigest:hash(invalidatedNodeIds)};
    return {invalidatedNodeIds:[...invalidatedNodeIds],proof:{...body,signature:this.sign(body)}};
  }
  /** Trusted local control only. Signing a resume is not a user/Policy permission grant. */
  control(request:Pick<OwnedWorkflowAdvanceRequest,'taskId'|'sessionId'|'workflowId'|'controlRevision'|'checkpoint'>,
    command:Omit<WorkflowControlCommand,'proof'>):WorkflowControlCommand {
    this.options.assertActive(request.taskId,request.controlRevision);
    if(!request.checkpoint)invalid('Workflow control requires its original checkpoint');
    const body={proofVersion:'1.0.0',kind:'host_control',taskId:request.taskId,sessionId:request.sessionId,
      workflowId:request.workflowId,controlRevision:request.controlRevision,checkpointDigest:hash(request.checkpoint),commandDigest:hash(command)};
    return {...structuredClone(command),proof:{...body,signature:this.sign(body)}};
  }
}
