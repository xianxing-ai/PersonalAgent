import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from './workflow-adapters.js';
import {verifyWorkflowShadowBranches} from './workflow-shadow-policy.js';
import type {WorkflowShadowBranchReceipt,WorkflowShadowReceiptVerifier} from './workflow-shadow-policy.js';

export interface WorkflowShadowConfigurationSnapshot {
  configurationId:string;revision:number;version:string;parameters:Record<string,unknown>;parametersDigest:string;
}
export interface WorkflowShadowReleaseBranch extends WorkflowShadowBranchReceipt {
  configurationId:string;version:string;parametersDigest:string;observedAt:string;expiresAt:string;
}
export interface WorkflowShadowTestEvidence {
  evidenceId:string;configurationId:string;version:string;parametersDigest:string;policyId:string;policyRevision:number;
  baselineSha256:string;conditionsDigest:string;observedAt:string;expiresAt:string;
  checks:readonly {id:string;state:'passed'|'failed'|'unknown'}[];proof:unknown;
}
export interface WorkflowShadowAcceptanceConfig {
  policyId:string;revision:number;configurationId:string;taskClass:string;validFrom:string;expiresAt:string;
  baseline:{revision:number;version:string;parametersDigest:string;resultBaselineSha256:string};
  candidate:{version:string;parametersDigest:string};conditionsDigest:string;qualityMetricId:string;
  /** No score/time defaults. Units and cutoffs belong to the trusted acceptance owner. */
  metricRules:readonly {metric:'qualityScore'|'wallMs'|'modelCalls';bound:'min_delta'|'max_delta'|'min_shadow'|'max_shadow';value:number}[];
  requiredChecks:readonly string[];
}
export interface WorkflowShadowReleaseComparison {
  rules:readonly {metric:string;bound:string;threshold:number;main:number;shadow:number;delta:number;passed:boolean}[];
  checks:readonly {id:string;state:'passed'|'failed'|'unknown'|'missing'}[];
}
export interface WorkflowShadowConfigurationWrite {
  operationId:string;configurationId:string;action:'promote'|'rollback';requestDigest:string;
  expected:WorkflowShadowConfigurationSnapshot;next:Omit<WorkflowShadowConfigurationSnapshot,'revision'>;
  sourceDigest:string;
  /** Rollback requests bind the original promotion; they never overwrite a different current revision. */
  promotionOperationId?:string;
}
export type WorkflowShadowConfigurationOperation =
  | {state:'not_started'}
  | {state:'unknown';requestDigest:string;request:WorkflowShadowConfigurationWrite}
  | {state:'rejected';requestDigest:string;request:WorkflowShadowConfigurationWrite;reason:string}
  | {state:'applied';requestDigest:string;request:WorkflowShadowConfigurationWrite;
      before:WorkflowShadowConfigurationSnapshot;after:WorkflowShadowConfigurationSnapshot;evidenceRefs:readonly string[]};
/** Bridge to the existing trusted configuration host, not a new configuration store.
 * CAS MUST atomically persist the immutable operation request and update the full expected
 * revision/version/parameter digest. Duplicate operation IDs must never write twice.
 * readOperation must be authoritative and durable (including submitted unknown writes).
 * The implementation MUST enforce existing Runtime Policy/ToolGateway authorization.
 */
export interface WorkflowShadowConfigurationPort {
  read(configurationId:string,context:ToolContext):Promise<WorkflowShadowConfigurationSnapshot|undefined>;
  readOperation(operationId:string,context:ToolContext):Promise<WorkflowShadowConfigurationOperation>;
  compareAndSet(request:WorkflowShadowConfigurationWrite,context:ToolContext):Promise<WorkflowShadowConfigurationOperation>;
}
export type WorkflowShadowReleaseRequest =
  | {action:'promote';operationId:string;configurationId:string;main:WorkflowShadowReleaseBranch;
      shadow:WorkflowShadowReleaseBranch;testEvidence:WorkflowShadowTestEvidence;candidateParameters:Record<string,unknown>}
  | {action:'rollback';operationId:string;configurationId:string;promotionOperationId:string};
export interface WorkflowShadowReleaseReceipt {
  state:'unavailable'|'rejected'|'unknown'|'promoted'|'rolled_back'|'superseded';reason:string;operationId:string;
  promotionReady:boolean;rollbackPointActive:boolean;comparison?:WorkflowShadowReleaseComparison;
  before?:WorkflowShadowConfigurationSnapshot;readback?:WorkflowShadowConfigurationSnapshot;
  rollbackAnchor?:{promotionOperationId:string;before:WorkflowShadowConfigurationSnapshot;promoted:WorkflowShadowConfigurationSnapshot};
  readbackReceipt?:{operationId:string;requestDigest:string;revision:number;version:string;parametersDigest:string;evidenceRefs:readonly string[]};
}
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const fail=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
const canonical=(value:unknown):string=>{
  if(value===null||typeof value!=='object') {
    if(value===undefined||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint'
      ||typeof value==='number'&&!Number.isFinite(value))return fail('Release values must be finite JSON');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(!plain(value)||Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)fail('Release values must be plain JSON');
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+canonical(record[key])).join(',')+'}';
};
export const workflowShadowReleaseDigest=(value:unknown):string=>createHash('sha256').update(canonical(value)).digest('hex');
const same=(a:unknown,b:unknown)=>workflowShadowReleaseDigest(a)===workflowShadowReleaseDigest(b);
const fresh=(from:unknown,until:unknown,now:number)=>typeof from==='string'&&typeof until==='string'
  &&Number.isFinite(Date.parse(from))&&Number.isFinite(Date.parse(until))&&Date.parse(from)<=now&&now<Date.parse(until);
function snapshot(value:unknown):value is WorkflowShadowConfigurationSnapshot {
  if(!plain(value)||!text(value.configurationId)||!Number.isSafeInteger(value.revision)||(value.revision as number)<1
    ||!text(value.version)||!plain(value.parameters)||!sha(value.parametersDigest))return false;
  return workflowShadowReleaseDigest(value.parameters)===value.parametersDigest;
}
function configValid(c:WorkflowShadowAcceptanceConfig|undefined):c is WorkflowShadowAcceptanceConfig {
  return !!c&&text(c.policyId)&&Number.isSafeInteger(c.revision)&&c.revision>=1&&text(c.configurationId)&&text(c.taskClass)
    &&!!c.baseline&&Number.isSafeInteger(c.baseline.revision)&&c.baseline.revision>=1&&text(c.baseline.version)
    &&sha(c.baseline.parametersDigest)&&sha(c.baseline.resultBaselineSha256)&&!!c.candidate&&text(c.candidate.version)
    &&sha(c.candidate.parametersDigest)&&sha(c.conditionsDigest)&&text(c.qualityMetricId)
    &&Array.isArray(c.metricRules)&&c.metricRules.length>0&&c.metricRules.every(rule=>!!rule
      &&['qualityScore','wallMs','modelCalls'].includes(rule.metric)&&['min_delta','max_delta','min_shadow','max_shadow'].includes(rule.bound)&&Number.isFinite(rule.value))
    &&Array.isArray(c.requiredChecks)&&c.requiredChecks.length>0&&c.requiredChecks.every(text)
    &&new Set(c.requiredChecks).size===c.requiredChecks.length;
}
const requestBody=(request:WorkflowShadowConfigurationWrite)=>{const {requestDigest:_,...body}=request;return body;};
/** All success receipts below require configuration-host operation reconciliation plus current readback.
 * They are data/evidence receipts, never authorization grants or TaskRuntime terminal states. */
export function createWorkflowShadowReleaseService(options:{configurationPort?:WorkflowShadowConfigurationPort;
  acceptance?:WorkflowShadowAcceptanceConfig;verifyBranch?:WorkflowShadowReceiptVerifier;
  /** Existing trusted Runtime/receipt adapter must compare the full signed task/session/control
   * revision/original task deadline against each other AND its current authoritative binding.
   * Independent signature validity or equality of user-supplied opaque proof fields is insufficient. */
  verifyComparable?:(main:WorkflowShadowReleaseBranch,shadow:WorkflowShadowReleaseBranch,context:ToolContext)=>Promise<boolean>;
  verifyTestEvidence?:(evidence:WorkflowShadowTestEvidence)=>Promise<boolean>;requiredScopes:readonly string[]}) {
  const scopes=[...options.requiredScopes],acceptance=options.acceptance?structuredClone(options.acceptance):undefined;
  if(!scopes.length||!scopes.every(text))fail('Existing authorized configuration scopes required');
  const port=options.configurationPort;
  const active=(context:ToolContext)=>{
    if(!context?.authorizationRef||!scopes.every(scope=>context.scopes?.includes(scope)))throw new ProtocolError('SCOPE_DENIED','Release requires original Runtime authorization');
    if(!(context.signal instanceof AbortSignal))fail('Release cancellation signal required');
    if(context.signal.aborted)throw new ProtocolError('CANCELLED','Release cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now())throw new ProtocolError('TIMEOUT','Release deadline expired');
  };
  const call=async<T>(context:ToolContext,fn:()=>Promise<T>):Promise<T>=>{active(context);const value=await fn();active(context);return value;};
  const status=()=>({state:typeof port?.read==='function'&&typeof port?.readOperation==='function'&&typeof port?.compareAndSet==='function'&&configValid(acceptance)
      &&typeof options.verifyBranch==='function'&&typeof options.verifyComparable==='function'&&typeof options.verifyTestEvidence==='function'?'configured_not_verified':'unavailable',
    missingConfiguration:[...(!port?.read||!port.readOperation||!port.compareAndSet?['existing configuration CAS/readOperation port']:[]),
      ...(!configValid(acceptance)?['trusted acceptance configuration']:[]),...(!options.verifyBranch?['branch receipt verifier']:[]),
      ...(typeof options.verifyComparable!=='function'?['trusted full-context pair verifier']:[]),
      ...(!options.verifyTestEvidence?['test Evidence verifier']:[])]});
  async function evaluate(request:Extract<WorkflowShadowReleaseRequest,{action:'promote'}>,context:ToolContext) {
    active(context);
    if(status().state==='unavailable')return {ready:false,reason:'configuration_unavailable'};
    const c=acceptance!;const now=Date.now();
    if(!fresh(c.validFrom,c.expiresAt,now))return {ready:false,reason:'acceptance_expired_or_not_active'};
    const {main,shadow,testEvidence:e}=structuredClone(request);
    if(!main||!shadow||!e)return {ready:false,reason:'missing_branch_or_test_evidence'};
    // Reuse the public receipt verifier: a model/client trust label is never accepted.
    try {await call(context,()=>verifyWorkflowShadowBranches([main,shadow],options.verifyBranch!));}
    catch(error){if(context.signal.aborted||Date.parse(context.deadline)<=Date.now())throw error;return {ready:false,reason:'branch_receipt_unverified'};}
    let comparable=false;
    try {comparable=await call(context,()=>options.verifyComparable!(structuredClone(main),structuredClone(shadow),context));}
    catch(error){if(context.signal.aborted||Date.parse(context.deadline)<=Date.now())throw error;}
    if(comparable!==true)return {ready:false,reason:'branch_pair_context_unverified'};
    if(main.branch!=='main'||shadow.branch!=='shadow'||main.receiptId===shadow.receiptId||main.workspaceRef===shadow.workspaceRef
      ||main.taskKey!==shadow.taskKey||main.decisionRef!==shadow.decisionRef||main.taskClass!==c.taskClass||shadow.taskClass!==c.taskClass
      ||[main,shadow].some(branch=>branch.configurationId!==c.configurationId||branch.baselineSha256!==c.baseline.resultBaselineSha256
        ||branch.conditionsDigest!==c.conditionsDigest||branch.qualityMetricId!==c.qualityMetricId||!fresh(branch.observedAt,branch.expiresAt,now))
      ||main.version!==c.baseline.version||main.parametersDigest!==c.baseline.parametersDigest
      ||shadow.version!==c.candidate.version||shadow.parametersDigest!==c.candidate.parametersDigest
      ||request.configurationId!==c.configurationId||!plain(request.candidateParameters)
      ||workflowShadowReleaseDigest(request.candidateParameters)!==c.candidate.parametersDigest)
      return {ready:false,reason:'branches_not_fresh_same_baseline_and_conditions'};
    if(!text(e.evidenceId)||e.configurationId!==c.configurationId||e.version!==c.candidate.version
      ||e.parametersDigest!==c.candidate.parametersDigest||e.policyId!==c.policyId||e.policyRevision!==c.revision
      ||e.baselineSha256!==c.baseline.resultBaselineSha256||e.conditionsDigest!==c.conditionsDigest
      ||!fresh(e.observedAt,e.expiresAt,now)||!Array.isArray(e.checks)||!e.checks.every(check=>check&&text(check.id)&&['passed','failed','unknown'].includes(check.state))
      ||new Set(e.checks.map(check=>check.id)).size!==e.checks.length)return {ready:false,reason:'test_evidence_stale_or_unbound'};
    let verified=false;try{verified=await call(context,()=>options.verifyTestEvidence!(structuredClone(e)));}
    catch(error){if(context.signal.aborted||Date.parse(context.deadline)<=Date.now())throw error;}
    if(!verified)return {ready:false,reason:'test_evidence_unverified'};
    const comparison:WorkflowShadowReleaseComparison={rules:c.metricRules.map(rule=>{
      const a=main[rule.metric],b=shadow[rule.metric],delta=b-a,value=rule.bound.endsWith('delta')?delta:b;
      return {metric:rule.metric,bound:rule.bound,threshold:rule.value,main:a,shadow:b,delta,
        passed:Number.isFinite(value)&&(rule.bound.startsWith('min')?value>=rule.value:value<=rule.value)};
    }),checks:c.requiredChecks.map(id=>({id,state:e.checks.find(check=>check.id===id)?.state??'missing'}))};
    return {ready:comparison.rules.every(rule=>rule.passed)&&comparison.checks.every(check=>check.state==='passed'),
      reason:'trusted_acceptance_compared',comparison};
  }
  const base=(request:Pick<WorkflowShadowReleaseRequest,'operationId'|'configurationId'>,state:WorkflowShadowReleaseReceipt['state'],reason:string):WorkflowShadowReleaseReceipt=>
    ({state,reason,operationId:request.operationId,promotionReady:false,rollbackPointActive:false});
  async function current(id:string,context:ToolContext) {
    const value=await call(context,()=>port!.read(id,context));
    if(value!==undefined&&(!snapshot(value)||value.configurationId!==id))throw new ProtocolError('PROTOCOL_MISMATCH','Configuration readback identity or digest changed');
    return value;
  }
  function validateApplied(op:Extract<WorkflowShadowConfigurationOperation,{state:'applied'}>) {
    const r=op.request;
    if(!r||r.requestDigest!==op.requestDigest||workflowShadowReleaseDigest(requestBody(r))!==r.requestDigest
      ||!snapshot(op.before)||!snapshot(op.after)||!same(op.before,r.expected)||op.after.revision!==op.before.revision+1
      ||op.before.configurationId!==r.configurationId||op.after.configurationId!==r.configurationId
      ||!same({...r.next,revision:op.after.revision},op.after)||!Array.isArray(op.evidenceRefs)||!op.evidenceRefs.length||!op.evidenceRefs.every(text))
      throw new ProtocolError('PROTOCOL_MISMATCH','Configuration operation lacks bound before/after execution evidence');
  }
  async function finish(request:Pick<WorkflowShadowReleaseRequest,'operationId'|'configurationId'|'action'>,op:WorkflowShadowConfigurationOperation,digest:string,context:ToolContext):Promise<WorkflowShadowReleaseReceipt> {
    if(op.state==='not_started')return base(request,'unknown','original_operation_not_confirmed_no_retry');
    if(op.requestDigest!==digest)throw new ProtocolError('REVISION_CONFLICT','Release operation ID already binds different parameters');
    if(op.state==='unknown')return {...base(request,'unknown','original_write_requires_reconciliation'),before:structuredClone(op.request.expected)};
    if(op.state==='rejected')return {...base(request,'rejected',op.reason),before:structuredClone(op.request.expected)};
    validateApplied(op);
    if(op.request.operationId!==request.operationId||op.request.configurationId!==request.configurationId||op.request.action!==request.action)
      throw new ProtocolError('PROTOCOL_MISMATCH','Original release operation identity changed');
    const anchor=op.request.action==='promote'?{promotionOperationId:request.operationId,before:op.before,promoted:op.after}:undefined;
    let readback:WorkflowShadowConfigurationSnapshot|undefined;
    try {readback=await current(request.configurationId,context);}
    catch(error) {
      if(context.signal.aborted||Date.parse(context.deadline)<=Date.now())throw error;
      return {...base(request,'unknown','configuration_readback_unavailable_or_invalid'),before:structuredClone(op.before),
        ...(anchor?{rollbackAnchor:structuredClone(anchor)}:{})};
    }
    const result:WorkflowShadowReleaseReceipt={...base(request,'unknown','configuration_readback_mismatch'),before:structuredClone(op.before),
      ...(readback?{readback:structuredClone(readback)}:{}),...(anchor?{rollbackAnchor:structuredClone(anchor)}:{})};
    if(!readback||!same(readback,op.after)) {
      if(readback&&readback.revision>op.after.revision){result.state='superseded';result.reason='newer_configuration_preserved';}
      return result;
    }
    return {...result,state:request.action==='promote'?'promoted':'rolled_back',reason:'operation_and_current_version_read_back',
      promotionReady:request.action==='promote',rollbackPointActive:request.action==='promote',
      readbackReceipt:{operationId:request.operationId,requestDigest:digest,revision:readback.revision,version:readback.version,
        parametersDigest:readback.parametersDigest,evidenceRefs:[...op.evidenceRefs]}};
  }
  async function execute(input:WorkflowShadowReleaseRequest,context:ToolContext):Promise<WorkflowShadowReleaseReceipt> {
    active(context);const request=structuredClone(input);
    if(!request||!['promote','rollback'].includes(request.action)||!text(request.operationId)||!text(request.configurationId)
      ||request.action==='rollback'&&(!text(request.promotionOperationId)||request.promotionOperationId===request.operationId))fail('Bound release operation required');
    if(status().state==='unavailable')return base(request,'unavailable','configuration_unavailable');
    // All retries read the original operation first. No process-local ledger/store is created here.
    const original=await call(context,()=>port!.readOperation(request.operationId,context));
    let expected:WorkflowShadowConfigurationSnapshot,next:WorkflowShadowConfigurationWrite['next'],sourceDigest:string;
    let comparison:WorkflowShadowReleaseComparison|undefined;
    let rollbackAnchor:WorkflowShadowReleaseReceipt['rollbackAnchor'];
    if(request.action==='promote') {
      sourceDigest=workflowShadowReleaseDigest({acceptance,main:request.main,shadow:request.shadow,testEvidence:request.testEvidence});
      if(original.state!=='not_started') {
        if(original.state==='applied')validateApplied(original);
        const r=original.request;
        if(!r||r.sourceDigest!==sourceDigest||!same(r.next.parameters,request.candidateParameters)
          ||workflowShadowReleaseDigest(requestBody(r))!==original.requestDigest)throw new ProtocolError('REVISION_CONFLICT','Original promotion input changed');
        // Unknown/rejected operations are read-only; a caller cannot turn them into a new write.
        return finish(request,original,r.requestDigest,context);
      }
      const evaluation=await evaluate(request,context);comparison=evaluation.comparison;
      if(!evaluation.ready)return {...base(request,'rejected',evaluation.reason),...(comparison?{comparison}:{})};
      const before=await current(request.configurationId,context),c=acceptance!;
      if(!before)return base(request,'unavailable','original_configuration_missing');
      if(before.revision!==c.baseline.revision||before.version!==c.baseline.version||before.parametersDigest!==c.baseline.parametersDigest)
        return {...base(request,'rejected','baseline_revision_changed'),before};
      expected=before;next={configurationId:request.configurationId,version:c.candidate.version,
        parameters:structuredClone(request.candidateParameters),parametersDigest:c.candidate.parametersDigest};
      // Recheck the acceptance lease immediately before the CAS, after all asynchronous reads.
      if(!fresh(c.validFrom,c.expiresAt,Date.now())||[request.main,request.shadow,request.testEvidence].some(value=>!fresh(value.observedAt,value.expiresAt,Date.now())))
        return base(request,'rejected','acceptance_or_evidence_expired_before_write');
    } else {
      const promotion=await call(context,()=>port!.readOperation(request.promotionOperationId,context));
      if(promotion.state!=='applied')return base(request,'unknown','original_promotion_not_confirmed');
      validateApplied(promotion);
      if(promotion.request.action!=='promote'||promotion.request.operationId!==request.promotionOperationId||promotion.request.configurationId!==request.configurationId)
        throw new ProtocolError('REVISION_CONFLICT','Rollback anchor does not belong to this promotion');
      sourceDigest=workflowShadowReleaseDigest({promotionOperationId:request.promotionOperationId,requestDigest:promotion.requestDigest,before:promotion.before,after:promotion.after});
      rollbackAnchor={promotionOperationId:request.promotionOperationId,before:structuredClone(promotion.before),promoted:structuredClone(promotion.after)};
      expected=promotion.after;const {revision:_,...previous}=promotion.before;next=previous;
    }
    const body={operationId:request.operationId,configurationId:request.configurationId,action:request.action,expected,next,sourceDigest,
      ...(request.action==='rollback'?{promotionOperationId:request.promotionOperationId}:{})};
    const write:WorkflowShadowConfigurationWrite={...body,requestDigest:workflowShadowReleaseDigest(body)};
    if(original.state!=='not_started')return {...await finish(request,original,write.requestDigest,context),...(rollbackAnchor?{rollbackAnchor}:{})};
    // An unknown return or exception is reconciled through the SAME operation, never resubmitted.
    try {await call(context,()=>port!.compareAndSet(structuredClone(write),context));}
    catch(error){if(context.signal.aborted||Date.parse(context.deadline)<=Date.now())throw error;}
    let reconciled:WorkflowShadowConfigurationOperation;
    try {reconciled=await call(context,()=>port!.readOperation(request.operationId,context));}
    catch(error){if(context.signal.aborted||Date.parse(context.deadline)<=Date.now())throw error;return {...base(request,'unknown','operation_readback_unavailable'),before:expected,...(rollbackAnchor?{rollbackAnchor}:{})};}
    const result=await finish(request,reconciled,write.requestDigest,context);
    return {...result,...(comparison?{comparison}:{}),...(rollbackAnchor?{rollbackAnchor}:{})};
  }
  /** Read the immutable original operation. This path never calls compareAndSet or initiates rollback. */
  async function reconcile(input:{operationId:string;configurationId:string},context:ToolContext):Promise<WorkflowShadowReleaseReceipt> {
    active(context);
    if(!input||!text(input.operationId)||!text(input.configurationId))fail('Original release operation identity required');
    if(status().state==='unavailable')return base(input,'unavailable','configuration_unavailable');
    const original=await call(context,()=>port!.readOperation(input.operationId,context));
    if(original.state==='not_started')return base(input,'unknown','original_operation_not_confirmed_no_retry');
    const request=original.request;
    if(!request||request.operationId!==input.operationId||request.configurationId!==input.configurationId
      ||!['promote','rollback'].includes(request.action)||request.requestDigest!==original.requestDigest
      ||workflowShadowReleaseDigest(requestBody(request))!==original.requestDigest||!snapshot(request.expected))
      throw new ProtocolError('PROTOCOL_MISMATCH','Original release readback identity or request digest changed');
    return finish({operationId:input.operationId,configurationId:input.configurationId,action:request.action},original,original.requestDigest,context);
  }
  return {status,evaluate,execute,reconcile,read:async(configurationId:string,context:ToolContext)=>{
    active(context);return port?current(configurationId,context):undefined;
  },requiredScopes:[...scopes]};
}
export type WorkflowShadowReleaseService=ReturnType<typeof createWorkflowShadowReleaseService>;
/** Register the F23_N04 CAS write adapter with ToolGateway; receipt data cannot grant scopes. */
export function createWorkflowShadowReleaseAdapter(service:WorkflowShadowReleaseService,options:{sideEffect:'local_write'|'external_write'}) {
  if(!options||!['local_write','external_write'].includes(options.sideEffect))fail('Trusted configuration host must declare its actual write side effect');
  return createOwnedWorkflowAdapter({nodeId:'F23_N04',kind:'host',sideEffect:options.sideEffect,requiredScopes:[...service.requiredScopes],
    inputSchema:{type:'object',additionalProperties:false,required:['action','operationId','configurationId'],properties:{
      action:{type:'string',enum:['promote','rollback']},operationId:{type:'string',minLength:1},configurationId:{type:'string',minLength:1},
      promotionOperationId:{type:'string',minLength:1},main:{type:'object'},shadow:{type:'object'},testEvidence:{type:'object'},candidateParameters:{type:'object'}}},
    outputSchema:{type:'object',required:['state','reason','operationId','promotionReady','rollbackPointActive'],properties:{
      state:{type:'string',enum:['unavailable','rejected','unknown','promoted','rolled_back','superseded']},reason:{type:'string'},
      operationId:{type:'string'},promotionReady:{type:'boolean'},rollbackPointActive:{type:'boolean'}}},
    execute:(input,context)=>service.execute(input as WorkflowShadowReleaseRequest,context)});
}
/** F23_N05 is independent readback. Any rollback is a separately authorized N04 write. */
export function createWorkflowShadowReleaseReadbackAdapter(service:WorkflowShadowReleaseService) {
  return createOwnedWorkflowAdapter({nodeId:'F23_N05',kind:'host',sideEffect:'read',requiredScopes:[...service.requiredScopes],
    inputSchema:{type:'object',additionalProperties:false,required:['operationId','configurationId'],properties:{
      operationId:{type:'string',minLength:1},configurationId:{type:'string',minLength:1}}},
    outputSchema:{type:'object',required:['state','reason','operationId','promotionReady','rollbackPointActive'],properties:{
      state:{type:'string',enum:['unavailable','rejected','unknown','promoted','rolled_back','superseded']},reason:{type:'string'},
      operationId:{type:'string'},promotionReady:{type:'boolean'},rollbackPointActive:{type:'boolean'}}},
    execute:(input,context)=>service.reconcile(input as {operationId:string;configurationId:string},context)});
}
