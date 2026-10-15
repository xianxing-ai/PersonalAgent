import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

export interface WorkflowShadowPlan {
  taskKey:string;taskClass:string;mode:'ordinary'|'compare';
  /** Identity comes from the already-completed selection receipt, not a new model call. */
  decision:{selectedCandidateId:string;shadowCandidateId?:string;shadowRequested:boolean;uncertain:boolean;decisionRef:string};
}
export interface WorkflowShadowResourceSnapshot {
  mainPriorityAvailable:boolean;shadowAllowed:boolean;taskValueEligible:boolean;reason?:string;
}
export interface WorkflowShadowPolicyConfig {
  sampling:{base:number;min:number;max:number;adjustmentRate:number;minimumVerifiedSamples:number};
  /** Trusted host units/weights, not prices invented by this component. */
  comparison:{qualityWeight:number;wallMsWeight:number;modelCallWeight:number};
}
export interface WorkflowShadowBranchReceipt {
  receiptId:string;taskKey:string;taskClass:string;decisionRef:string;branch:'main'|'shadow';
  candidateId:string;baselineSha256:string;conditionsDigest:string;workspaceRef:string;resultSha256:string;
  qualityMetricId:string;qualityScore:number;wallMs:number;modelCalls:number;evidenceRefs:readonly string[];proof:unknown;
}
export type WorkflowShadowReceiptVerifier=(receipt:WorkflowShadowBranchReceipt)=>Promise<boolean>;
declare const trustedHistory:unique symbol;
declare const trustedBranches:unique symbol;
export interface VerifiedShadowHistory {
  readonly [trustedHistory]:true;readonly taskClass:string;
  readonly pairs:readonly (readonly [WorkflowShadowBranchReceipt,WorkflowShadowBranchReceipt])[];
}
export interface VerifiedShadowObservations {
  readonly [trustedBranches]:true;readonly branches:readonly WorkflowShadowBranchReceipt[];
}
export interface WorkflowShadowHistoryCheckpoint {
  version:1;revision:number;taskClass:string;pairs:readonly (readonly [WorkflowShadowBranchReceipt,WorkflowShadowBranchReceipt])[];
}
/** Adapt existing signed Engine state or a transactional TaskRuntime checkpoint host.
 * compareAndSet MUST be atomic in that host; this module creates no storage or scheduler.
 */
export interface WorkflowShadowCheckpointPort {
  load(key:string):Promise<WorkflowShadowHistoryCheckpoint|undefined>;
  compareAndSet(key:string,expectedRevision:number|undefined,next:WorkflowShadowHistoryCheckpoint):Promise<boolean>;
}
/** Bind these two public methods to one existing trusted anchor task/Engine namespace. */
export interface WorkflowShadowAnchorCheckpointPort {
  loadCheckpoint(key:string):unknown|Promise<unknown>;
  saveCheckpointOnce(key:string,value:unknown):boolean|Promise<boolean>;
}
export type WorkflowShadowComparison={status:'unknown';reason:string}|{
  status:'comparable';qualityDelta:number;wallMsDelta:number;modelCallsDelta:number;benefit:number;recommendedBranch:'main'|'shadow';
};
export interface WorkflowShadowPolicyResult {
  action:'run'|'defer'|'skip'|'need_teacher';reason:string;mayDeliverMain:boolean;samplingRate:number;sampled:boolean;
  comparison:WorkflowShadowComparison;historySamples:number;provenance:'experience_statistics_not_training';
}
const histories=new WeakMap<object,{taskClass:string;pairs:readonly (readonly [WorkflowShadowBranchReceipt,WorkflowShadowBranchReceipt])[]}>();
const observations=new WeakMap<object,{branches:readonly WorkflowShadowBranchReceipt[]}>();
const bad=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const hash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validReceipt=(r:WorkflowShadowBranchReceipt):boolean=>!!r&&text(r.receiptId)&&text(r.taskKey)&&text(r.taskClass)&&text(r.decisionRef)
  &&['main','shadow'].includes(r.branch)&&text(r.candidateId)&&text(r.workspaceRef)&&text(r.qualityMetricId)
  &&[r.baselineSha256,r.conditionsDigest,r.resultSha256].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value))
  &&[r.qualityScore,r.wallMs,r.modelCalls].every(Number.isFinite)&&r.wallMs>=0&&Number.isSafeInteger(r.modelCalls)&&r.modelCalls>=0
  &&Array.isArray(r.evidenceRefs)&&r.evidenceRefs.length>0&&r.evidenceRefs.every(text);
function comparable(main:WorkflowShadowBranchReceipt|undefined,shadow:WorkflowShadowBranchReceipt|undefined):string|undefined {
  if(!main||!shadow)return 'missing_counterfactual';
  if(main.branch!=='main'||shadow.branch!=='shadow')return 'branch_roles_mismatch';
  if(main.taskKey!==shadow.taskKey||main.taskClass!==shadow.taskClass||main.decisionRef!==shadow.decisionRef)return 'different_task_or_decision';
  if(main.baselineSha256!==shadow.baselineSha256)return 'different_baseline';
  if(main.conditionsDigest!==shadow.conditionsDigest||main.qualityMetricId!==shadow.qualityMetricId)return 'different_comparison_conditions';
  if(main.workspaceRef===shadow.workspaceRef||main.receiptId===shadow.receiptId)return 'isolation_not_demonstrated';
  return undefined;
}
function validateConfig(config:WorkflowShadowPolicyConfig):void {
  const s=config?.sampling,c=config?.comparison;
  if(!s||!c||![s.base,s.min,s.max,s.adjustmentRate].every(value=>Number.isFinite(value)&&value>=0&&value<=1)
    ||s.min>s.base||s.base>s.max||!Number.isSafeInteger(s.minimumVerifiedSamples)||s.minimumVerifiedSamples<0
    ||![c.qualityWeight,c.wallMsWeight,c.modelCallWeight].every(value=>Number.isFinite(value)&&value>=0))bad('Explicit trusted sampling and comparison configuration required');
}
function compare(main:WorkflowShadowBranchReceipt|undefined,shadow:WorkflowShadowBranchReceipt|undefined,config:WorkflowShadowPolicyConfig):WorkflowShadowComparison {
  const reason=comparable(main,shadow);if(reason||!main||!shadow)return {status:'unknown',reason:reason??'missing_counterfactual'};
  const qualityDelta=shadow.qualityScore-main.qualityScore,wallMsDelta=shadow.wallMs-main.wallMs,modelCallsDelta=shadow.modelCalls-main.modelCalls;
  const w=config.comparison,benefit=qualityDelta*w.qualityWeight-wallMsDelta*w.wallMsWeight-modelCallsDelta*w.modelCallWeight;
  if(!Number.isFinite(benefit))bad('Comparison utility overflow');
  return {status:'comparable',qualityDelta,wallMsDelta,modelCallsDelta,benefit,recommendedBranch:benefit>0?'shadow':'main'};
}
async function checked(receipt:WorkflowShadowBranchReceipt,verify:WorkflowShadowReceiptVerifier):Promise<WorkflowShadowBranchReceipt> {
  const copy=structuredClone(receipt);if(!validReceipt(copy)||!await verify(structuredClone(copy)))
    throw new ProtocolError('UNAUTHORIZED','Branch result lacks trusted task-bound verification');
  return copy;
}
export async function verifyWorkflowShadowBranches(branches:readonly WorkflowShadowBranchReceipt[],verify:WorkflowShadowReceiptVerifier):Promise<VerifiedShadowObservations> {
  const verified=await Promise.all(branches.map(branch=>checked(branch,verify)));
  if(new Set(verified.map(branch=>branch.branch)).size!==verified.length)bad('Duplicate observed branch roles');
  const value={branches:structuredClone(verified)} as unknown as VerifiedShadowObservations;observations.set(value,{branches:verified});return value;
}
export function createWorkflowShadowCheckpointPort(anchor:WorkflowShadowAnchorCheckpointPort):WorkflowShadowCheckpointPort {
  if(!anchor?.loadCheckpoint||!anchor.saveCheckpointOnce)bad('Existing trusted anchor checkpoint methods required');
  async function load(key:string):Promise<WorkflowShadowHistoryCheckpoint|undefined> {
    let prior:WorkflowShadowHistoryCheckpoint|undefined;
    for(let revision=1;;revision++) {
      const raw=await anchor.loadCheckpoint(key+':revision:'+revision);if(raw===undefined)return prior;
      const envelope=raw as {state?:WorkflowShadowHistoryCheckpoint;previousDigest?:unknown};
      if(!envelope||envelope.state?.version!==1||envelope.state.revision!==revision
        ||envelope.previousDigest!==(prior?hash(prior):null))bad('Shadow history revision chain changed');
      prior=structuredClone(envelope.state);
    }
  }
  return {load,compareAndSet:async(key,expectedRevision,next)=>{
    const prior=await load(key);
    if(prior?.revision!==expectedRevision)return false;
    if(next.version!==1||next.revision!==(expectedRevision??0)+1)bad('Invalid next history revision');
    return anchor.saveCheckpointOnce(key+':revision:'+next.revision,{state:structuredClone(next),previousDigest:prior?hash(prior):null});
  }};
}
export function createWorkflowShadowHistory({checkpoints,verifyReceipt}:{checkpoints:WorkflowShadowCheckpointPort;verifyReceipt:WorkflowShadowReceiptVerifier}) {
  if(!checkpoints?.load||!checkpoints.compareAndSet||typeof verifyReceipt!=='function')bad('Trusted persistent checkpoint and receipt verifier required');
  const keyFor=(taskClass:string)=>{if(!text(taskClass))bad('Task class required');return 'workflow-shadow-history:v1:'+hash(taskClass);};
  async function load(taskClass:string):Promise<WorkflowShadowHistoryCheckpoint|undefined> {
    const state=await checkpoints.load(keyFor(taskClass));if(!state)return undefined;
    if(state.version!==1||state.taskClass!==taskClass||!Number.isSafeInteger(state.revision)||state.revision<1||!Array.isArray(state.pairs))bad('Invalid shadow history checkpoint');
    const pairs: [WorkflowShadowBranchReceipt,WorkflowShadowBranchReceipt][]=[];const seen=new Set<string>();
    for(const pair of state.pairs) {
      if(!Array.isArray(pair)||pair.length!==2)bad('Invalid historical branch pair');
      const main=await checked(pair[0]!,verifyReceipt),shadow=await checked(pair[1]!,verifyReceipt);
      if(comparable(main,shadow)||main.taskClass!==taskClass||[main,shadow].some(receipt=>seen.has(receipt.receiptId)))bad('Historical results are not unique and comparable');
      seen.add(main.receiptId);seen.add(shadow.receiptId);pairs.push([main,shadow]);
    }
    return {...state,pairs};
  }
  return {
    async read(taskClass:string):Promise<VerifiedShadowHistory> {
      const state=await load(taskClass),data={taskClass,pairs:state?.pairs??[]};
      const value=structuredClone(data) as unknown as VerifiedShadowHistory;histories.set(value,data);return value;
    },
    async record(mainInput:WorkflowShadowBranchReceipt,shadowInput:WorkflowShadowBranchReceipt):Promise<{recorded:boolean;reason:string}> {
      const main=await checked(mainInput,verifyReceipt),shadow=await checked(shadowInput,verifyReceipt),reason=comparable(main,shadow);
      if(reason)return {recorded:false,reason};
      const prior=await load(main.taskClass),pairs=prior?.pairs??[];
      const original=pairs.find(pair=>pair.some(receipt=>receipt.receiptId===main.receiptId||receipt.receiptId===shadow.receiptId));
      if(original) {
        if(hash(original)!==hash([main,shadow]))throw new ProtocolError('REVISION_CONFLICT','Historical receipt identity changed');
        return {recorded:false,reason:'duplicate_verified_pair'};
      }
      const next:WorkflowShadowHistoryCheckpoint={version:1,revision:(prior?.revision??0)+1,taskClass:main.taskClass,pairs:[...pairs,[main,shadow]]};
      if(!await checkpoints.compareAndSet(keyFor(main.taskClass),prior?.revision,next))
        throw new ProtocolError('REVISION_CONFLICT','Shadow history changed; reload existing checkpoint before recording');
      return {recorded:true,reason:'verified_comparable_pair_recorded'};
    },
  };
}
export function evaluateWorkflowShadowPolicy(input:{plan:WorkflowShadowPlan;resources:WorkflowShadowResourceSnapshot;
  history:VerifiedShadowHistory;observedBranches?:VerifiedShadowObservations},config:WorkflowShadowPolicyConfig):WorkflowShadowPolicyResult {
  validateConfig(config);const {plan,resources}=input,history=histories.get(input.history);
  if(!history||history.taskClass!==plan.taskClass)throw new ProtocolError('UNAUTHORIZED','Only receipt-verified checkpoint history may influence sampling');
  const observed=input.observedBranches?observations.get(input.observedBranches):undefined;
  if(input.observedBranches&&!observed)throw new ProtocolError('UNAUTHORIZED','Observed branch claims are not trusted receipts');
  const d=plan.decision;
  if(!text(plan.taskKey)||!text(plan.taskClass)||!['ordinary','compare'].includes(plan.mode)||!d||!text(d.selectedCandidateId)||!text(d.decisionRef)
    ||typeof d.shadowRequested!=='boolean'||typeof d.uncertain!=='boolean'||!resources
    ||[resources.mainPriorityAvailable,resources.shadowAllowed,resources.taskValueEligible].some(value=>typeof value!=='boolean'))bad('Bound plan and trusted resource/value snapshot required');
  const branches=observed?.branches??[];
  if(branches.some(branch=>branch.taskKey!==plan.taskKey||branch.taskClass!==plan.taskClass||branch.decisionRef!==d.decisionRef
    ||branch.candidateId!==(branch.branch==='main'?d.selectedCandidateId:d.shadowCandidateId)))
    throw new ProtocolError('REVISION_CONFLICT','Observation does not belong to this selected plan');
  const main=branches.find(branch=>branch.branch==='main'),shadow=branches.find(branch=>branch.branch==='shadow');
  const comparison=compare(main,shadow,config);let wins=0,losses=0;
  for(const [a,b] of history.pairs) {const gain=compare(a,b,config);if(gain.status==='comparable'){if(gain.benefit>0)wins++;else if(gain.benefit<0)losses++;}}
  const n=history.pairs.length,s=config.sampling;
  const rate=Math.max(s.min,Math.min(s.max,s.base+(n>=s.minimumVerifiedSamples&&n>0?s.adjustmentRate*(wins-losses)/n:0)));
  const bucket=createHash('sha256').update(JSON.stringify([plan.taskClass,plan.taskKey])).digest().readUInt32BE(0)/0x100000000;
  const sampled=bucket<rate,mayDeliverMain=!!main&&(plan.mode==='ordinary'||comparison.status==='comparable');
  const result=(action:WorkflowShadowPolicyResult['action'],reason:string):WorkflowShadowPolicyResult=>({action,reason,mayDeliverMain,samplingRate:rate,sampled,
    comparison,historySamples:n,provenance:'experience_statistics_not_training'});
  if(d.uncertain)return result('need_teacher','same_decision_marked_uncertain');
  if(!d.shadowRequested&&plan.mode==='ordinary')return result('skip','same_decision_did_not_request_shadow');
  if(!d.shadowRequested||!text(d.shadowCandidateId)||d.shadowCandidateId===d.selectedCandidateId)return result('need_teacher','same_decision_has_no_distinct_shadow_plan');
  if(shadow)return comparison.status==='comparable'?result('skip','both_verified_no_rerun_needed')
    :result(plan.mode==='compare'?'need_teacher':'skip','observations_not_comparable');
  if(!resources.taskValueEligible)return result('skip','trusted_host_task_value_ineligible');
  if(!resources.mainPriorityAvailable||!resources.shadowAllowed)return result('defer',resources.reason??'main_priority_or_resource_unavailable');
  if(plan.mode==='ordinary'&&!sampled)return result('skip','deterministic_experience_sampling');
  return result('run',plan.mode==='compare'?'explicit_comparison_requires_both':'sampled_shadow_with_main_priority');
}
