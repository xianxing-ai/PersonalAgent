import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {WorkflowShadowPlan,WorkflowShadowPolicyResult,WorkflowShadowResourceSnapshot} from './workflow-shadow-policy.js';

export interface OrdinarySamplingQuality {
  baselineSha256:string;qualityMetricId:string;qualityScore:number;wallMs:number;modelCalls:number;evidenceRefs:string[];
}
export interface OrdinaryCompetitionSamplingRecord {
  version:1;kind:'ordinary_competition_sampling';taskKey:string;taskClass:string;decisionRef:string;
  baselineSha256:string|null;isolation:{namespace:string;snapshotDigest:string}|null;
  resources:WorkflowShadowResourceSnapshot;mainQuality:OrdinarySamplingQuality|null;shadowQuality:OrdinarySamplingQuality|null;
  action:WorkflowShadowPolicyResult['action'];reason:string;sampled:boolean;samplingRate:number;historySamples:number;
  comparison:WorkflowShadowPolicyResult['comparison'];benefit:number|null;executed:false;actualExecutionVerified:false;
  admissionIsNotExecution:true;provenance:'experience_statistics_not_training';realEnvironmentAcceptance:'not_performed';
}
const bad=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const sha=/^[a-f0-9]{64}$/;
const canonical=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value as Record<string,unknown>).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
function quality(value:OrdinarySamplingQuality|null|undefined,label:string):OrdinarySamplingQuality|null {
  if(value==null)return null;
  if(!sha.test(value.baselineSha256??'')||!text(value.qualityMetricId)||!Number.isFinite(value.qualityScore)
    ||!Number.isFinite(value.wallMs)||value.wallMs<0||!Number.isSafeInteger(value.modelCalls)||value.modelCalls<0
    ||!Array.isArray(value.evidenceRefs)||value.evidenceRefs.length===0||value.evidenceRefs.some(item=>!text(item)))
    bad(label);
  return {baselineSha256:value.baselineSha256,qualityMetricId:value.qualityMetricId,qualityScore:value.qualityScore,
    wallMs:value.wallMs,modelCalls:value.modelCalls,evidenceRefs:[...value.evidenceRefs]};
}

/** Record one ordinary Competition sampling admission. `run` is not execution and a missing shadow stays unknown. */
export function admitOrdinaryCompetitionSampling(input:{
  plan:WorkflowShadowPlan;policy:WorkflowShadowPolicyResult;resources:WorkflowShadowResourceSnapshot;
  isolation?:{namespace:string;snapshotDigest:string}|null;main?:OrdinarySamplingQuality|null;shadow?:OrdinarySamplingQuality|null;
  specialSerialPair?:boolean;
}):OrdinaryCompetitionSamplingRecord {
  const {plan,policy,resources}=input??{};
  if(input?.specialSerialPair===true||plan?.mode!=='ordinary')bad('Special serial comparison is not an ordinary competition sampling record');
  if(!text(plan.taskKey)||!text(plan.taskClass)||plan.taskClass==='special-serial-pair'||!text(plan.decision?.decisionRef)
    ||!text(plan.decision.selectedCandidateId)||typeof plan.decision.shadowRequested!=='boolean'||typeof plan.decision.uncertain!=='boolean')
    bad('Ordinary competition task identity required');
  if(!resources||[resources.mainPriorityAvailable,resources.shadowAllowed,resources.taskValueEligible].some(value=>typeof value!=='boolean'))
    bad('Trusted resource snapshot required');
  if(!policy||!['run','defer','skip','need_teacher'].includes(policy.action)||!text(policy.reason)||typeof policy.mayDeliverMain!=='boolean'
    ||typeof policy.sampled!=='boolean'||!Number.isFinite(policy.samplingRate)||policy.samplingRate<0||policy.samplingRate>1
    ||!Number.isSafeInteger(policy.historySamples)||policy.historySamples<0||policy.provenance!=='experience_statistics_not_training'
    ||!policy.comparison||(policy.comparison.status!=='unknown'&&policy.comparison.status!=='comparable'))
    bad('Existing shadow policy result required');
  const main=quality(input.main,'Main quality snapshot is incomplete'),shadow=quality(input.shadow,'Shadow quality snapshot is incomplete');
  const isolation=input.isolation??null;
  if(isolation&&(!text(isolation.namespace)||!sha.test(isolation.snapshotDigest??'')))bad('Isolation snapshot digest required');
  if(policy.comparison.status==='comparable') {
    if(!main||!shadow||main.baselineSha256!==shadow.baselineSha256)bad('Comparable benefit requires both same-baseline qualities');
  } else if(policy.comparison.status!=='unknown') bad('Missing counterfactual must stay unknown');
  const benefit=policy.comparison.status==='comparable'?policy.comparison.benefit:null;
  if(benefit!==null&&!Number.isFinite(benefit))bad('Benefit is not a finite number');
  return {version:1,kind:'ordinary_competition_sampling',taskKey:plan.taskKey,taskClass:plan.taskClass,decisionRef:plan.decision.decisionRef,
    baselineSha256:main?.baselineSha256??shadow?.baselineSha256??null,isolation:isolation?{namespace:isolation.namespace,snapshotDigest:isolation.snapshotDigest}:null,
    resources:{mainPriorityAvailable:resources.mainPriorityAvailable,shadowAllowed:resources.shadowAllowed,taskValueEligible:resources.taskValueEligible,
      ...(resources.reason===undefined?{}:{reason:resources.reason})},
    mainQuality:main,shadowQuality:shadow,action:policy.action,reason:policy.reason,sampled:policy.sampled,samplingRate:policy.samplingRate,
    historySamples:policy.historySamples,comparison:structuredClone(policy.comparison),benefit,executed:false,actualExecutionVerified:false,
    admissionIsNotExecution:true,provenance:'experience_statistics_not_training',realEnvironmentAcceptance:'not_performed'};
}
export function ordinaryCompetitionSamplingKey(operationId:string,record:OrdinaryCompetitionSamplingRecord):string {
  if(!text(operationId))bad('Original decision operation id required');
  return 'owned-workflow:ordinary-sampling:'+operationId+':'+hash(record);
}
