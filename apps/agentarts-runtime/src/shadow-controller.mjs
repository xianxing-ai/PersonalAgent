import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {createWorkflowShadowHistory,verifyWorkflowShadowBranches,evaluateWorkflowShadowPolicy} from '@personal-agent/agentarts';
import {replayFrozenWorkflowTrace} from './trace-replay.mjs';
export {workflowTraceDigest,replayFrozenWorkflowTrace} from './trace-replay.mjs';

const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=value=>typeof value==='string'&&!!value.trim();
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
  ?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(code,message)=>{throw new ProtocolError(code,message);};
function signer(secret) {
  if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw TypeError('Existing trusted receipt secret of at least 32 bytes required');
  return (kind,value)=>createHmac('sha256',secret).update('workflow-shadow:'+kind+':v1\n'+canonical(value)).digest('base64url');
}
function authenticated(value,kind,sign) {
  if(!object(value)||!exact(value.proof,['kind','signature'])||value.proof.kind!==kind||typeof value.proof.signature!=='string')return false;
  const {proof,...body}=value,expected=Buffer.from(sign(kind,body)),actual=Buffer.from(proof.signature);
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
const contextKeys=['taskId','sessionId','controlRevision','taskDeadline'];
function validContext(value) {return contextKeys.every(key=>Object.hasOwn(value,key))&&text(value.taskId)&&text(value.sessionId)
  &&Number.isSafeInteger(value.controlRevision)&&value.controlRevision>=0&&date(value.taskDeadline);}
const contextOf=value=>Object.fromEntries(contextKeys.map(key=>[key,value[key]]));
const receiptKeys=['receiptId','taskKey','taskClass','decisionRef','branch','candidateId','baselineSha256','conditionsDigest','workspaceRef','resultSha256','qualityMetricId','qualityScore','wallMs','modelCalls','evidenceRefs','proof'];
/** Host-only: call after trusted original Runtime/Evidence readback. A signature never grants tool scope. */
export function signWorkflowShadowBranchReceipt({receiptSecret,receipt,context}) {
  if(!validContext(context)||receipt?.taskKey!==context.taskId)fail('INVALID_ARGUMENT','Original branch task context required');
  const {proof:ignored,...body}=receipt;
  const signed={...contextOf(context),kind:'branch_result',receiptDigest:digest(body),isolationDigest:context.isolation?digest(context.isolation):null};
  return {...body,proof:{...signed,signature:signer(receiptSecret)('branch_result',signed)}};
}
export function signWorkflowShadowIsolationReceipt({receiptSecret,context,snapshotDigest,namespace}) {
  if(!validContext(context)||!text(namespace)||!/^[a-f0-9]{64}$/u.test(snapshotDigest))fail('INVALID_ARGUMENT','Trusted actual snapshot context required');
  const body={...contextOf(context),snapshotDigest,namespace};
  return {...body,proof:{kind:'isolation',signature:signer(receiptSecret)('isolation',body)}};
}
/** Host-only: use the original taskDeadline from the existing task checkpoint. */
export function signWorkflowShadowRequest({receiptSecret,value}) {
  if(!object(value)||Object.hasOwn(value,'proof'))fail('INVALID_ARGUMENT','Unsigned shadow request required');
  const body=structuredClone(value);return {...body,proof:{kind:'request',signature:signer(receiptSecret)('request',body)}};
}
export function verifyWorkflowShadowResponse({receiptSecret,response,request,currentContext,signal}) {
  if(signal?.aborted)fail('CANCELLED','Shadow policy response cancelled');
  if(!date(request?.taskDeadline)||Date.now()>=Date.parse(request.taskDeadline))fail('TIMEOUT','Original task deadline expired');
  if(currentContext&&contextKeys.some(key=>currentContext[key]!==request[key]))fail('REVISION_CONFLICT','Current host task context changed');
  const sign=signer(receiptSecret);
  const replay=request.operation==='replay';
  if(!authenticated(response,'response',sign)||response.shadowVersion!==1||response.operation!==(replay?'replay_result':'evaluation_result')
    ||response.requestDigest!==digest(request)||response.requestId!==request.requestId
    ||contextKeys.some(key=>response[key]!==request[key])||response.authority!==(replay?'data_only_no_tool_grant':'advisory_no_tool_grant'))
    fail('UNAUTHORIZED','Shadow response does not match the original signed request');
  return structuredClone(response.result);
}
export function createWorkflowShadowController({receiptSecret,policyConfig}) {
  const sign=signer(receiptSecret);
  if(!exact(policyConfig,['sampling','comparison'])
    ||!exact(policyConfig.sampling,['base','min','max','adjustmentRate','minimumVerifiedSamples'])
    ||!exact(policyConfig.comparison,['qualityWeight','wallMsWeight','modelCallWeight']))throw TypeError('Explicit trusted shadow policy configuration required');
  const config=structuredClone(policyConfig);
  const s=config.sampling,c=config.comparison;
  if(![s.base,s.min,s.max,s.adjustmentRate].every(value=>Number.isFinite(value)&&value>=0&&value<=1)
    ||s.min>s.base||s.base>s.max||!Number.isSafeInteger(s.minimumVerifiedSamples)||s.minimumVerifiedSamples<0
    ||![c.qualityWeight,c.wallMsWeight,c.modelCallWeight].every(value=>Number.isFinite(value)&&value>=0))throw TypeError('Invalid trusted shadow policy values');
  async function verifyBranch(receipt,current) {
    if(!exact(receipt,receiptKeys)||!exact(receipt.proof,[...contextKeys,'kind','receiptDigest','isolationDigest','signature']))return false;
    const {proof,...body}=receipt,{signature,...signed}=proof;
    if(!validContext(proof)||proof.kind!=='branch_result'||proof.taskId!==receipt.taskKey||proof.receiptDigest!==digest(body)||typeof signature!=='string')return false;
    const expected=Buffer.from(sign('branch_result',signed)),actual=Buffer.from(signature);
    return expected.length===actual.length&&timingSafeEqual(expected,actual)
      &&(receipt.branch!=='shadow'||typeof proof.isolationDigest==='string'&&/^[a-f0-9]{64}$/u.test(proof.isolationDigest))
      &&(!current||contextKeys.every(key=>proof[key]===current[key])
        &&(receipt.branch==='main'||current.plan.tier==='isolated'&&current.plan.isolation&&proof.isolationDigest===digest(current.plan.isolation)));
  }
  return async({value,deadline,signal,sessionId,requestId,taskId,controlRevision,taskDeadline})=>{
    value=structuredClone(value);
    const active=()=>{
      if(signal?.aborted)fail('CANCELLED','Shadow policy evaluation cancelled');
      if(!date(deadline)||!date(value?.taskDeadline)||Date.now()>=Math.min(Date.parse(deadline),Date.parse(value.taskDeadline)))
        fail('TIMEOUT','Original task or transport deadline expired');
    };
    if(value?.operation==='replay') {
      if(!exact(value,['shadowVersion','operation',...contextKeys,'requestId','snapshot','requestedActions','proof'])
        ||value.shadowVersion!==1||!validContext(value)||!text(value.requestId))fail('INVALID_ARGUMENT','Invalid signed trace replay envelope');
      if(!authenticated(value,'request',sign))fail('UNAUTHORIZED','Frozen trace host signature rejected');
      if(value.sessionId!==sessionId||value.requestId!==requestId||taskId!==undefined&&taskId!==value.taskId
        ||controlRevision!==undefined&&controlRevision!==value.controlRevision||taskDeadline!==undefined&&taskDeadline!==value.taskDeadline)
        fail('REVISION_CONFLICT','Replay changed original task/session/revision/deadline context');
      active();
      const effectiveDeadline=new Date(Math.min(Date.parse(deadline),Date.parse(value.taskDeadline))).toISOString();
      const result={...replayFrozenWorkflowTrace({snapshot:value.snapshot,requestedActions:value.requestedActions},{signal,deadline:effectiveDeadline}),
        originalTaskDeadline:value.taskDeadline,effectiveDeadline};
      active();
      const response={shadowVersion:1,operation:'replay_result',...contextOf(value),requestId:value.requestId,
        requestDigest:digest(value),authority:'data_only_no_tool_grant',result};
      return {...response,proof:{kind:'response',signature:sign('response',response)}};
    }
    if(!exact(value,['shadowVersion','operation',...contextKeys,'requestId','plan','resources','observedBranches','historySnapshot','proof'])
      ||value.shadowVersion!==1||value.operation!=='evaluate'||!validContext(value)||!text(value.requestId)
      ||!exact(value.plan,['taskKey','taskClass','mode','tier','isolation','decision'])||value.plan.taskKey!==value.taskId
      ||!['decision_shadow','trace_replay','isolated'].includes(value.plan.tier)
      ||!exact(value.plan.decision,['selectedCandidateId','shadowCandidateId','shadowRequested','uncertain','decisionRef','provenance'])
      ||!exact(value.resources,['mainPriorityAvailable','shadowAllowed','taskValueEligible'])||!Array.isArray(value.observedBranches))
      fail('INVALID_ARGUMENT','Invalid signed shadow policy envelope');
    if(!authenticated(value,'request',sign))fail('UNAUTHORIZED','Shadow host signature rejected');
    const provenance=value.plan.decision.provenance;
    if(!exact(provenance,['decidedBy','deepseekProposalRef','layaDecisionRef','layaQualified','uncertaintyResolved'])
      ||!['code','laya','deepseek','verified_experience'].includes(provenance.decidedBy)
      ||![provenance.deepseekProposalRef,provenance.layaDecisionRef].every(ref=>ref===null||text(ref))
      ||typeof provenance.layaQualified!=='boolean'||typeof provenance.uncertaintyResolved!=='boolean'
      ||provenance.decidedBy==='deepseek'&&!text(provenance.deepseekProposalRef)
      ||provenance.decidedBy==='laya'&&!text(provenance.layaDecisionRef)
      ||provenance.uncertaintyResolved&&provenance.decidedBy!=='deepseek')fail('INVALID_ARGUMENT','Actual same-decision provenance required');
    const isolation=value.plan.isolation;
    if(value.plan.tier==='isolated'&&isolation!==null) {
      if(!exact(isolation,[...contextKeys,'snapshotDigest','namespace','proof'])||!authenticated(isolation,'isolation',sign)
        ||contextKeys.some(key=>isolation[key]!==value[key])||!/^[a-f0-9]{64}$/u.test(isolation.snapshotDigest)||!text(isolation.namespace))
        fail('UNAUTHORIZED','Advanced isolated shadow requires current trusted snapshot/isolation receipt');
    } else if(value.plan.tier!=='isolated'&&isolation!==null)fail('INVALID_ARGUMENT','Non-isolated plans cannot claim isolation execution');
    if(value.sessionId!==sessionId||value.requestId!==requestId||taskId!==undefined&&taskId!==value.taskId
      ||controlRevision!==undefined&&controlRevision!==value.controlRevision||taskDeadline!==undefined&&taskDeadline!==value.taskDeadline)
      fail('REVISION_CONFLICT','Shadow request changed original task/session/revision/deadline context');
    active();
    const snapshot=value.historySnapshot;
    if(snapshot!==null&&(!exact(snapshot,['version','revision','taskClass','pairs'])||snapshot.taskClass!==value.plan.taskClass))
      fail('INVALID_ARGUMENT','Invalid existing history checkpoint snapshot');
    if(snapshot!==null) {
      if(!Array.isArray(snapshot.pairs))fail('INVALID_ARGUMENT','Invalid historical branch pairs');
      for(const pair of snapshot.pairs) {
        if(!Array.isArray(pair)||pair.length!==2)fail('INVALID_ARGUMENT','Invalid historical branch pair');
        const [main,shadow]=pair;
        if(!object(main?.proof)||!object(shadow?.proof)||contextKeys.some(key=>main.proof[key]!==shadow.proof[key])
          ||main.proof.taskId!==main.taskKey||shadow.proof.taskId!==shadow.taskKey||main.taskKey!==shadow.taskKey
          ||main.decisionRef!==shadow.decisionRef)
          fail('REVISION_CONFLICT','Historical comparison changed original task/session/revision/deadline decision context');
      }
    }
    const history=createWorkflowShadowHistory({checkpoints:{load:async()=>snapshot??undefined,
      compareAndSet:async()=>{fail('UNSUPPORTED_CAPABILITY','Image cannot write host history');}},verifyReceipt:receipt=>verifyBranch(receipt)});
    const verifiedHistory=await history.read(value.plan.taskClass);
    const observedBranches=await verifyWorkflowShadowBranches(value.observedBranches,receipt=>verifyBranch(receipt,value));
    active();
    const teacherResolved=provenance.decidedBy==='deepseek'&&text(provenance.deepseekProposalRef)&&provenance.uncertaintyResolved;
    const plan={...value.plan,decision:{...value.plan.decision,
      uncertain:(value.plan.decision.uncertain&&!teacherResolved)||(provenance.decidedBy==='laya'&&!provenance.layaQualified)}};
    const result=evaluateWorkflowShadowPolicy({plan,resources:value.resources,history:verifiedHistory,observedBranches},config);
    if(value.plan.tier==='isolated'&&result.action==='run'
      &&(!text(provenance.layaDecisionRef)||!text(provenance.deepseekProposalRef)
        ||!['deepseek','laya'].includes(provenance.decidedBy))) {
      result.action='need_teacher';result.reason='advanced_shadow_requires_same_decision_laya_and_teacher_participation';
    }
    if(value.plan.tier==='isolated'&&isolation===null&&result.action==='run') {
      result.action='defer';result.reason='trusted_isolation_snapshot_required';
    }
    if(value.plan.tier!=='isolated') {
      result.comparison={status:'unknown',reason:'no_isolated_counterfactual'};
      if(value.plan.mode==='compare')result.mayDeliverMain=false;
    }
    const output={...result,tier:value.plan.tier,actualExecutionVerified:false,authority:'advisory_no_tool_grant',
      decisionProvenance:structuredClone(provenance),originalTaskDeadline:value.taskDeadline,
      effectiveDeadline:new Date(Math.min(Date.parse(deadline),Date.parse(value.taskDeadline))).toISOString()};
    active();
    const response={shadowVersion:1,operation:'evaluation_result',...contextOf(value),requestId:value.requestId,
      requestDigest:digest(value),authority:'advisory_no_tool_grant',result:output};
    return {...response,proof:{kind:'response',signature:sign('response',response)}};
  };
}
