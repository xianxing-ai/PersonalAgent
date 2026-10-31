import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import {workflowShadowReleaseDigest} from '@personal-agent/agentarts';
import type {WorkflowShadowConfigurationOperation, WorkflowShadowConfigurationPort,
  WorkflowShadowConfigurationSnapshot, WorkflowShadowConfigurationWrite} from '@personal-agent/agentarts';
import {createRuntimeAtomicStatePort} from '../atomic-host-state.js';
import {readRuntimeWorkflowShadowAcceptanceCurrent} from './workflow-shadow-acceptance.js';
import type {WorkflowShadowAcceptanceConfig} from '@personal-agent/agentarts';
import {TaskRuntime} from '../index.js';

interface Ledger {
  format: 'workflow-shadow-configuration-v1';
  configurations: WorkflowShadowConfigurationSnapshot[];
  operations: Exclude<WorkflowShadowConfigurationOperation, {state:'not_started'}>[];
}

export interface RuntimeWorkflowShadowConfigurationOptions {
  /** A single durable CAS key is the authority for both configurations and operation receipts. */
  runtime: TaskRuntime;
  namespace: string;
  stateKey: string;
  requiredScopes: readonly string[];
  /** Resolve the original Runtime/ToolGateway authorization, including action and arguments.
   * Scopes alone or a model-supplied authorizationRef do not constitute authorization. */
  authorize: (context: ToolContext, action: 'read'|'readOperation'|'write'|'initialize',
    value: string|WorkflowShadowConfigurationWrite|readonly WorkflowShadowConfigurationSnapshot[])=>Promise<boolean>;
  /** Same Runtime SQLite acceptance record; never infer a policy from submitted data. */
  acceptanceBinding?:{namespace:string;stateKey:string;policyId:string};
  /** Must synchronously re-read original Policy, task/intent and the supplied durable acceptance. */
  commitGuard?:{runtime:TaskRuntime;assertCurrent:(context:ToolContext,request:WorkflowShadowConfigurationWrite,authorities:{acceptance:WorkflowShadowAcceptanceConfig;
    promotion?:WorkflowShadowConfigurationOperation})=>void};
  /** Separate trusted migration authorization; no release grant may initialize configuration. */
  initializeGuard?:{runtime:TaskRuntime;assertCurrent:(context:ToolContext,initial:readonly WorkflowShadowConfigurationSnapshot[])=>void};
}

const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
const same=(a:unknown,b:unknown)=>workflowShadowReleaseDigest(a)===workflowShadowReleaseDigest(b);
const fail=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
function snapshot(v:unknown):v is WorkflowShadowConfigurationSnapshot {
  return plain(v)&&exact(v,['configurationId','revision','version','parameters','parametersDigest'])
    &&text(v.configurationId)&&Number.isSafeInteger(v.revision)&&(v.revision as number)>0
    &&text(v.version)&&plain(v.parameters)&&sha(v.parametersDigest)&&workflowShadowReleaseDigest(v.parameters)===v.parametersDigest;
}
function validatedLedger(value:unknown):Ledger {
  if(!plain(value)||value.format!=='workflow-shadow-configuration-v1'||!Array.isArray(value.configurations)||!Array.isArray(value.operations)
    ||!value.configurations.every(snapshot)||new Set(value.configurations.map(v=>v.configurationId)).size!==value.configurations.length
    ||!value.operations.every(op=>plain(op)&&['applied','rejected'].includes(String(op.state))&&plain(op.request)
      &&text(op.request.operationId)&&sha(op.requestDigest)&&op.requestDigest===op.request.requestDigest)
    ||new Set(value.operations.map(op=>op.request.operationId)).size!==value.operations.length)
    throw new ProtocolError('PROTOCOL_MISMATCH','Invalid durable workflow configuration ledger');
  try {
    for(const op of value.operations) {
      validWrite(op.request as WorkflowShadowConfigurationWrite);
      if(op.state==='rejected') {
        if(!text(op.reason))throw new Error('invalid rejection');
      } else if(!snapshot(op.before)||!snapshot(op.after)||!same(op.before,op.request.expected)
        ||op.after.revision!==op.before.revision+1||!same(op.after,{...op.request.next,revision:op.after.revision})
        ||!Array.isArray(op.evidenceRefs)||!op.evidenceRefs.length||!op.evidenceRefs.every(text))
        throw new Error('invalid applied operation');
    }
  } catch {throw new ProtocolError('PROTOCOL_MISMATCH','Invalid durable workflow configuration operation');}
  return structuredClone(value) as unknown as Ledger;
}
function validWrite(request:WorkflowShadowConfigurationWrite):void {
  if(!plain(request)||!text(request.operationId)||!text(request.configurationId)||!['promote','rollback'].includes(request.action)
    ||!exact(request,['operationId','configurationId','action','requestDigest','expected','next','sourceDigest',
      ...(request.action==='rollback'?['promotionOperationId']:[])])
    ||!sha(request.requestDigest)||!sha(request.sourceDigest)||!snapshot(request.expected)||!plain(request.next)
    ||!exact(request.next,['configurationId','version','parameters','parametersDigest'])
    ||request.expected.configurationId!==request.configurationId||request.next.configurationId!==request.configurationId
    ||!text(request.next.version)||!plain(request.next.parameters)||!sha(request.next.parametersDigest)
    ||workflowShadowReleaseDigest(request.next.parameters)!==request.next.parametersDigest
    ||request.action==='rollback'&&(!text(request.promotionOperationId)||request.promotionOperationId===request.operationId)
    ||request.action==='promote'&&request.promotionOperationId!==undefined)
    fail('Invalid bound workflow configuration write');
  const {requestDigest:_,...body}=request;
  if(workflowShadowReleaseDigest(body)!==request.requestDigest)fail('Workflow configuration request digest mismatch');
}

/** Trusted host implementation, not a parallel scheduler or an authorization source.
 * The owner must make this same ledger the configuration consumer's authority before
 * injecting it into F23. Initialization is a separately authorized one-time migration,
 * not a replacement for reading current production configuration. */
export function createRuntimeWorkflowShadowConfigurationPort(options:RuntimeWorkflowShadowConfigurationOptions):
  WorkflowShadowConfigurationPort & {initialize(initial:readonly WorkflowShadowConfigurationSnapshot[],context:ToolContext):Promise<void>} {
  if(!options||!(options.runtime instanceof TaskRuntime)||typeof options.runtime.bindTrustedHostState!=='function'
    ||typeof options.runtime.compareAndSetTrustedHostStateGuarded!=='function'||!text(options.namespace)
    ||!text(options.stateKey)||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||!options.requiredScopes.every(text)||typeof options.authorize!=='function')
    fail('Durable atomic state and trusted authorization required');
  const atomic=createRuntimeAtomicStatePort(options.runtime,options.namespace);
  const active=(context:ToolContext)=>{
    if(!context?.authorizationRef||!options.requiredScopes.every(scope=>context.scopes?.includes(scope)))
      throw new ProtocolError('SCOPE_DENIED','Original workflow configuration authorization required');
    if(!(context.signal instanceof AbortSignal))fail('Workflow configuration cancellation signal required');
    if(context.signal.aborted)throw new ProtocolError('CANCELLED','Workflow configuration request cancelled');
    if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now())
      throw new ProtocolError('TIMEOUT','Workflow configuration request deadline expired');
  };
  const authorize=async(context:ToolContext,action:'read'|'readOperation'|'write'|'initialize',
    value:string|WorkflowShadowConfigurationWrite|readonly WorkflowShadowConfigurationSnapshot[])=>{
    active(context);
    if(await options.authorize(context,action,structuredClone(value))!==true)
      throw new ProtocolError('SCOPE_DENIED','Workflow configuration authorization rejected');
    active(context);
  };
  const readLedger=()=>{
    const entry=atomic.read(options.stateKey);
    return entry?{revision:entry.revision,ledger:validatedLedger(entry.value)}:undefined;
  };
  const checkedGuard=(work:()=>unknown)=>{
    const result=work();
    if(result!==undefined){void Promise.resolve(result).catch(()=>undefined);throw new ProtocolError('UNAUTHORIZED','Configuration authorization must be synchronous');}
  };
  async function initialize(initial:readonly WorkflowShadowConfigurationSnapshot[],context:ToolContext) {
    if(!Array.isArray(initial)||!initial.length||!initial.every(snapshot)
      ||new Set(initial.map(v=>v.configurationId)).size!==initial.length)fail('Valid authoritative initial configurations required');
    await authorize(context,'initialize',initial);
    if(options.initializeGuard?.runtime!==options.runtime||typeof options.initializeGuard?.assertCurrent!=='function')
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Trusted configuration migration guard unavailable');
    const ledger:Ledger={format:'workflow-shadow-configuration-v1',configurations:structuredClone([...initial]),operations:[]};
    if(!options.runtime.compareAndSetTrustedHostStateGuarded(options.namespace,options.stateKey,undefined,ledger,()=>{
      active(context);checkedGuard(()=>options.initializeGuard!.assertCurrent(context,structuredClone(initial)));active(context);
    }))
      throw new ProtocolError('REVISION_CONFLICT','Workflow configuration ledger already initialized');
  }
  async function read(id:string,context:ToolContext) {
    if(!text(id))fail('Configuration identity required');
    await authorize(context,'read',id);
    const entry=readLedger();
    if(!entry)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Authoritative configuration host not initialized');
    return entry.ledger.configurations.find(value=>value.configurationId===id);
  }
  async function readOperation(id:string,context:ToolContext):Promise<WorkflowShadowConfigurationOperation> {
    if(!text(id))fail('Operation identity required');
    await authorize(context,'readOperation',id);
    const entry=readLedger();
    if(!entry)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Authoritative configuration host not initialized');
    return entry.ledger.operations.find(value=>value.request.operationId===id)??{state:'not_started'};
  }
  async function compareAndSet(input:WorkflowShadowConfigurationWrite,context:ToolContext):Promise<WorkflowShadowConfigurationOperation> {
    const request=structuredClone(input);validWrite(request);
    const acceptanceBinding=options.acceptanceBinding;
    if(!acceptanceBinding||!text(acceptanceBinding.namespace)||!text(acceptanceBinding.stateKey)||!text(acceptanceBinding.policyId)
      ||options.commitGuard?.runtime!==options.runtime||typeof options.commitGuard?.assertCurrent!=='function')
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Atomic release authorization and acceptance binding unavailable');
    for(;;) {
      await authorize(context,'write',request);
      const entry=readLedger();
      if(!entry)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Authoritative configuration host not initialized');
      const previous=entry.ledger.operations.find(op=>op.request.operationId===request.operationId);
      if(previous) {
        if(previous.requestDigest!==request.requestDigest||!same(previous.request,request))
          throw new ProtocolError('REVISION_CONFLICT','Workflow operation identity already bound');
        return previous;
      }
      const current=entry.ledger.configurations.find(value=>value.configurationId===request.configurationId);
      let reason:string|undefined;
      if(!current||!same(current,request.expected))reason='configuration_revision_changed';
      if(request.action==='rollback') {
        const promotion=entry.ledger.operations.find(op=>op.request.operationId===request.promotionOperationId);
        if(!promotion||promotion.state!=='applied'||promotion.request.action!=='promote'
          ||promotion.request.configurationId!==request.configurationId||!same(promotion.after,request.expected)
          ||!same({...request.next,revision:promotion.before.revision},promotion.before))reason='rollback_anchor_invalid';
      }
      let operation:Exclude<WorkflowShadowConfigurationOperation,{state:'not_started'|'unknown'}>;
      if(reason)operation={state:'rejected',requestDigest:request.requestDigest,request,reason};
      else {
        const before=current!;
        if(!Number.isSafeInteger(before.revision+1))throw new ProtocolError('REVISION_CONFLICT','Configuration revision exhausted');
        const after={...structuredClone(request.next),revision:before.revision+1};
        operation={state:'applied',requestDigest:request.requestDigest,request,before,after,
          evidenceRefs:[`runtime-host-state:${encodeURIComponent(options.namespace)}:${encodeURIComponent(options.stateKey)}:operation:${encodeURIComponent(request.operationId)}`]};
        entry.ledger.configurations=entry.ledger.configurations.map(value=>value.configurationId===request.configurationId?after:value);
      }
      entry.ledger.operations.push(operation);
      // A thrown or uncertain CAS is never retried here. Caller must reconcile by operation ID.
      active(context);
      if(options.runtime.compareAndSetTrustedHostStateGuarded(options.namespace,options.stateKey,entry.revision,entry.ledger,()=>{
        active(context);
        const acceptance=readRuntimeWorkflowShadowAcceptanceCurrent(options.runtime,acceptanceBinding.namespace,acceptanceBinding.stateKey,acceptanceBinding.policyId);
        if(!acceptance)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Durable acceptance unavailable');
        const latest=readLedger();
        const promotion=request.promotionOperationId?latest?.ledger.operations.find(op=>op.request.operationId===request.promotionOperationId):undefined;
        checkedGuard(()=>options.commitGuard!.assertCurrent(context,structuredClone(request),{acceptance,...(promotion?{promotion}:{})}));
        active(context);
      }))return structuredClone(operation);
      // Explicit false means no write occurred. Re-read and authorize again before another attempt.
    }
  }
  return {initialize,read,readOperation,compareAndSet};
}
