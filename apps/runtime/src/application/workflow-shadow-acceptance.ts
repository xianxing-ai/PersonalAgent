import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import {workflowShadowReleaseDigest} from '@personal-agent/agentarts';
import type {WorkflowShadowAcceptanceConfig} from '@personal-agent/agentarts';
import {createRuntimeAtomicStatePort} from '../atomic-host-state.js';
import type {TaskRuntime} from '../index.js';

export interface RuntimeWorkflowShadowAcceptanceOptions {
  runtime:Pick<TaskRuntime,'bindTrustedHostState'>;
  namespace:string;stateKey:string;requiredScopes:readonly string[];
  /** Original Policy/host authorization; caller-supplied scopes or model data are insufficient. */
  authorize:(context:ToolContext,action:'read'|'configure',value:string|WorkflowShadowAcceptanceConfig)=>Promise<boolean>;
}
interface Ledger {format:'workflow-shadow-acceptance-v1';versions:WorkflowShadowAcceptanceConfig[];
  operations:{operationId:string;digest:string;policyId:string;revision:number}[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
function valid(v:unknown):v is WorkflowShadowAcceptanceConfig {
  if(!object(v)||!exact(v,['policyId','revision','configurationId','taskClass','validFrom','expiresAt','baseline','candidate',
    'conditionsDigest','qualityMetricId','metricRules','requiredChecks'])||!text(v.policyId)||!text(v.configurationId)||!text(v.taskClass)
    ||!Number.isSafeInteger(v.revision)||(v.revision as number)<1||!text(v.validFrom)||!text(v.expiresAt)
    ||!Number.isFinite(Date.parse(v.validFrom))||!Number.isFinite(Date.parse(v.expiresAt))||Date.parse(v.validFrom)>=Date.parse(v.expiresAt)
    ||new Date(v.validFrom).toISOString()!==v.validFrom||new Date(v.expiresAt).toISOString()!==v.expiresAt
    ||!object(v.baseline)||!exact(v.baseline,['revision','version','parametersDigest','resultBaselineSha256'])
    ||!Number.isSafeInteger(v.baseline.revision)||(v.baseline.revision as number)<1||!text(v.baseline.version)
    ||!sha(v.baseline.parametersDigest)||!sha(v.baseline.resultBaselineSha256)||!object(v.candidate)
    ||!exact(v.candidate,['version','parametersDigest'])||!text(v.candidate.version)||!sha(v.candidate.parametersDigest)
    ||!sha(v.conditionsDigest)||!text(v.qualityMetricId)||!Array.isArray(v.metricRules)||!v.metricRules.length
    ||!v.metricRules.every(rule=>object(rule)&&exact(rule,['metric','bound','value'])
      &&['qualityScore','wallMs','modelCalls'].includes(String(rule.metric))
      &&['min_delta','max_delta','min_shadow','max_shadow'].includes(String(rule.bound))
      &&typeof rule.value==='number'&&Number.isFinite(rule.value))
    ||!Array.isArray(v.requiredChecks)||!v.requiredChecks.length||!v.requiredChecks.every(text)
    ||new Set(v.requiredChecks).size!==v.requiredChecks.length)return false;
  return new Set(v.metricRules.map(rule=>JSON.stringify([rule.metric,rule.bound]))).size===v.metricRules.length;
}
function parse(value:unknown):Ledger {
  if(!object(value)||value.format!=='workflow-shadow-acceptance-v1'||!Array.isArray(value.versions)
    ||!value.versions.every(valid)||!Array.isArray(value.operations)
    ||!value.operations.every(op=>object(op)&&text(op.operationId)&&sha(op.digest)&&text(op.policyId)
      &&Number.isSafeInteger(op.revision)&&(op.revision as number)>0)
    ||new Set(value.operations.map(op=>op.operationId)).size!==value.operations.length
    ||new Set(value.versions.map(v=>JSON.stringify([v.policyId,v.revision]))).size!==value.versions.length)
    throw new ProtocolError('PROTOCOL_MISMATCH','Invalid acceptance ledger');
  for(const op of value.operations) {
    const version=value.versions.find(v=>v.policyId===op.policyId&&v.revision===op.revision);
    if(!version||workflowShadowReleaseDigest({operationId:op.operationId,acceptance:version})!==op.digest)
      throw new ProtocolError('PROTOCOL_MISMATCH','Invalid acceptance operation binding');
  }
  return structuredClone(value) as unknown as Ledger;
}
/** Trusted Runtime composition only. Call inside the guarded host-state CAS transaction
 * to bind a release to the current durable acceptance revision in the same SQLite DB. */
export function readRuntimeWorkflowShadowAcceptanceCurrent(runtime:Pick<TaskRuntime,'bindTrustedHostState'>,
  namespace:string,stateKey:string,policyId:string):WorkflowShadowAcceptanceConfig|undefined {
  if(!text(namespace)||!text(stateKey)||!text(policyId))throw new ProtocolError('INVALID_ARGUMENT','Acceptance binding required');
  const entry=createRuntimeAtomicStatePort(runtime,namespace).read(stateKey);
  if(!entry)return undefined;
  return parse(entry.value).versions.filter(value=>value.policyId===policyId).sort((a,b)=>b.revision-a.revision)[0];
}
/** Store immutable user-authorized acceptance revisions in existing Runtime host state.
 * Configuration is not a test result and does not prove acceptance criteria passed. */
export function createRuntimeWorkflowShadowAcceptanceHost(options:RuntimeWorkflowShadowAcceptanceOptions) {
  if(!options?.runtime||typeof options.runtime.bindTrustedHostState!=='function'||!text(options.namespace)||!text(options.stateKey)
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length||!options.requiredScopes.every(text)
    ||typeof options.authorize!=='function')throw new ProtocolError('INVALID_ARGUMENT','Trusted acceptance host authorization required');
  const atomic=createRuntimeAtomicStatePort(options.runtime,options.namespace),scopes=[...options.requiredScopes];
  const active=(context:ToolContext)=>{
    if(!context?.authorizationRef||!scopes.every(scope=>context.scopes?.includes(scope)))
      throw new ProtocolError('SCOPE_DENIED','Acceptance authorization required');
    if(!(context.signal instanceof AbortSignal))throw new ProtocolError('INVALID_ARGUMENT','Cancellation signal required');
    if(context.signal.aborted)throw new ProtocolError('CANCELLED','Acceptance request cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now())throw new ProtocolError('TIMEOUT','Acceptance request expired');
  };
  const authorize=async(context:ToolContext,action:'read'|'configure',value:string|WorkflowShadowAcceptanceConfig)=>{
    active(context);if(await options.authorize(context,action,structuredClone(value))!==true)
      throw new ProtocolError('SCOPE_DENIED','Acceptance authorization rejected');active(context);
  };
  const readLedger=()=>{const entry=atomic.read(options.stateKey);return entry?{revision:entry.revision,ledger:parse(entry.value)}:undefined;};
  async function read(policyId:string,context:ToolContext,revision?:number):Promise<WorkflowShadowAcceptanceConfig|undefined> {
    if(!text(policyId)||revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))
      throw new ProtocolError('INVALID_ARGUMENT','Valid acceptance identity required');
    await authorize(context,'read',policyId);
    const versions=readLedger()?.ledger.versions.filter(item=>item.policyId===policyId)??[];
    return revision===undefined?versions.sort((a,b)=>b.revision-a.revision)[0]:versions.find(item=>item.revision===revision);
  }
  async function configure(operationId:string,input:WorkflowShadowAcceptanceConfig,context:ToolContext):Promise<WorkflowShadowAcceptanceConfig> {
    const acceptance=structuredClone(input);
    if(!text(operationId)||!valid(acceptance)||Date.parse(acceptance.expiresAt)<=Date.now())
      throw new ProtocolError('INVALID_ARGUMENT','Complete non-expired acceptance configuration required');
    const digest=workflowShadowReleaseDigest({operationId,acceptance});
    for(;;) {
      await authorize(context,'configure',acceptance);
      const entry=readLedger(),ledger=entry?.ledger??{format:'workflow-shadow-acceptance-v1' as const,versions:[],operations:[]};
      const previous=ledger.operations.find(op=>op.operationId===operationId);
      if(previous) {
        if(previous.digest!==digest)throw new ProtocolError('REVISION_CONFLICT','Acceptance operation identity changed');
        return structuredClone(ledger.versions.find(v=>v.policyId===previous.policyId&&v.revision===previous.revision)!);
      }
      const current=ledger.versions.filter(v=>v.policyId===acceptance.policyId).sort((a,b)=>b.revision-a.revision)[0];
      if(acceptance.revision!==(current?.revision??0)+1)
        throw new ProtocolError('REVISION_CONFLICT','Acceptance revision changed');
      ledger.versions.push(acceptance);ledger.operations.push({operationId,digest,policyId:acceptance.policyId,revision:acceptance.revision});
      active(context);
      if(Date.parse(acceptance.expiresAt)<=Date.now())throw new ProtocolError('TIMEOUT','Acceptance expired before write');
      if(atomic.compareAndSet(options.stateKey,entry?.revision,ledger)) {
        const saved=readLedger()?.ledger,original=saved?.operations.find(op=>op.operationId===operationId);
        const version=saved?.versions.find(v=>v.policyId===acceptance.policyId&&v.revision===acceptance.revision);
        if(!original||original.digest!==digest||!version||workflowShadowReleaseDigest(version)!==workflowShadowReleaseDigest(acceptance))
          throw new ProtocolError('RESULT_UNKNOWN','Acceptance commit readback unavailable or changed');
        return structuredClone(version);
      }
      // Only a definite CAS miss retries. Exceptions require readback of the same operation.
    }
  }
  async function readOperation(operationId:string,context:ToolContext):Promise<{digest:string;acceptance:WorkflowShadowAcceptanceConfig}|undefined> {
    if(!text(operationId))throw new ProtocolError('INVALID_ARGUMENT','Acceptance operation identity required');
    await authorize(context,'read',operationId);
    const ledger=readLedger()?.ledger,op=ledger?.operations.find(item=>item.operationId===operationId);
    if(!ledger||!op)return undefined;
    return {digest:op.digest,acceptance:structuredClone(ledger.versions.find(v=>v.policyId===op.policyId&&v.revision===op.revision)!)};
  }
  return {read,readOperation,configure};
}
