import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ToolContext} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {workflowShadowReleaseDigest} from '@personal-agent/agentarts';
import type {WorkflowShadowAcceptanceConfig,WorkflowShadowConfigurationOperation,WorkflowShadowConfigurationSnapshot,
  WorkflowShadowConfigurationWrite} from '@personal-agent/agentarts';
import {TaskRuntime} from '../index.js';

type ConfigurationAction='read'|'readOperation'|'write'|'initialize';
type ConfigurationValue=string|WorkflowShadowConfigurationWrite|readonly WorkflowShadowConfigurationSnapshot[];
export interface RuntimeWorkflowShadowAuthorizationOptions {
  runtime:TaskRuntime;
  /** Trusted Desktop host namespace and original graph driver checkpoint; never model supplied. */
  hostUserNamespace:string;driverCheckpointKey:string;requiredScopes:readonly string[];now:()=>Date;
  /** Current independently authorized acceptance, the same revision used by release service. */
  readAcceptance:()=>WorkflowShadowAcceptanceConfig|undefined;
  /** Read the original promotion from the same durable host ledger; absent means rollback is unavailable. */
  readPromotion?:(operationId:string,context:ToolContext)=>Promise<WorkflowShadowConfigurationOperation>;
}
export interface RuntimeWorkflowShadowOriginalIntent {
  parentTaskId:string;sessionId:string;controlRevision:number;hostTaskId:string;hostOperationId:string;
  toolName:string;toolVersion:string;runId:string;argumentsDigest:string;deadline:string;
}
interface Binding {identity:RuntimeWorkflowShadowOriginalIntent;args:Record<string,unknown>}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const allowedTool=(name:unknown)=>name==='workflow.host.f23_n04'||name==='workflow.host.f23_n05';
const deny=():never=>{throw new ProtocolError('UNAUTHORIZED','Original F23 host authorization unavailable');};

/** Resolve only the original live HostBridge/Runtime/Policy execution. No model-selected
 * task, operation, arguments or proof grants authority, and no secrets leave this host. */
export function createRuntimeWorkflowShadowAuthorization(options:RuntimeWorkflowShadowAuthorizationOptions):{
  resolveOriginal(context:ToolContext):RuntimeWorkflowShadowOriginalIntent;
  authorize(context:ToolContext,action:ConfigurationAction,value:ConfigurationValue):Promise<boolean>;
  assertCommitCurrent(context:ToolContext,request:WorkflowShadowConfigurationWrite,authorities:{acceptance:WorkflowShadowAcceptanceConfig;
    promotion?:WorkflowShadowConfigurationOperation}):void;
  commitGuard:{runtime:TaskRuntime;assertCurrent:(context:ToolContext,request:WorkflowShadowConfigurationWrite,
    authorities:{acceptance:WorkflowShadowAcceptanceConfig;promotion?:WorkflowShadowConfigurationOperation})=>void};
} {
  if(!(options?.runtime instanceof TaskRuntime)||!text(options.hostUserNamespace)||!text(options.driverCheckpointKey)
    ||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length||!options.requiredScopes.every(text)
    ||typeof options.now!=='function'||typeof options.readAcceptance!=='function')
    throw new ProtocolError('INVALID_ARGUMENT','Original F23 Runtime authorization sources required');
  const runtime=options.runtime,scopes=[...options.requiredScopes];
  function original(context:ToolContext):Binding {
    try {
      if(!context||!text(context.taskId)||!text(context.runId)||!text(context.authorizationRef)
        ||context.runId!==`host-tool-${context.taskId}`||context.authorizationRef!==context.runId
        ||!(context.signal instanceof AbortSignal)||context.signal.aborted||!Number.isFinite(Date.parse(context.deadline))
        ||!scopes.every(scope=>context.scopes?.includes(scope)))return deny();
      const now=options.now();if(!(now instanceof Date)||!Number.isFinite(now.getTime())||Date.parse(context.deadline)<=now.getTime())return deny();
      const task=runtime.getTask(context.taskId),host=runtime.loadCheckpoint(context.taskId,'host-tool-intent');
      const parentBinding=runtime.loadCheckpoint(context.taskId,'coding-repair:parent');
      if(task.state!=='running'||task.cancelRequested||task.conversationId!==`host-tool:${options.hostUserNamespace}`
        ||!plain(host)||host.namespace!==options.hostUserNamespace||!allowedTool(host.toolName)||host.toolVersion!=='1.0.0'
        ||!plain(host.arguments)||!text(host.commandId)||host.deadline!==context.deadline
        ||!plain(parentBinding)||!text(parentBinding.taskId)||parentBinding.operationId!==host.commandId)return deny();
      const args=host.arguments,argumentsDigest=toolArgumentsDigest(args);
      if(host.argumentsDigest!==argumentsDigest||context.argumentsDigest!==argumentsDigest)return deny();
      const parentId=parentBinding.taskId,parent=runtime.getTask(parentId);
      if(parent.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(parent.state))return deny();
      const issued=runtime.loadCheckpoint(parentId,'coding-repair:host:'+host.commandId);
      const bridge=runtime.loadCheckpoint(parentId,'owned-workflow:intent:'+host.commandId);
      const state=runtime.loadCheckpoint(parentId,options.driverCheckpointKey);
      const driver=runtime.loadCheckpoint(parentId,options.driverCheckpointKey+':driver-binding');
      if(!plain(issued)||issued.localTaskId!==context.taskId||!plain(issued.request)
        ||issued.request.commandId!==host.commandId||issued.request.toolName!==host.toolName||issued.request.toolVersion!==host.toolVersion
        ||issued.request.deadline!==host.deadline||!isDeepStrictEqual(issued.request.arguments,args)
        ||!plain(bridge)||bridge.taskId!==parentId||bridge.workflowId!=='F23'||!text(bridge.sessionId)
        ||bridge.deadline!==context.deadline||bridge.taskDeadline!==context.deadline||!plain(bridge.proposal)
        ||bridge.proposal.operationId!==host.commandId||bridge.proposal.kind!=='tool_proposal'
        ||bridge.proposal.nodeId!==(host.toolName==='workflow.host.f23_n04'?'F23_N04':'F23_N05')
        ||bridge.proposal.toolName!==host.toolName||bridge.proposal.toolVersion!==host.toolVersion
        ||!isDeepStrictEqual(bridge.proposal.arguments,args)
        ||!plain(state)||state.sessionId!==bridge.sessionId||!Number.isSafeInteger(state.controlRevision)
        ||state.controlRevision!==bridge.proposal.originControlRevision||!plain(state.result)||state.result.state!=='awaiting_host'
        ||!Array.isArray(state.result.proposals)||!state.result.proposals.some(proposal=>isDeepStrictEqual(proposal,bridge.proposal))
        ||!plain(driver)||driver.taskId!==parentId||driver.workflowId!=='F23'||driver.sessionId!==bridge.sessionId
        ||driver.deadline!==context.deadline)return deny();
      const record=runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId);
      const grant=runtime.policy.get(context.authorizationRef);
      if(!record||record.taskId!==context.taskId||record.toolName!==host.toolName||record.toolVersion!==host.toolVersion
        ||record.state!=='started'||record.policyDecision!=='allow'||record.executionStarted!==true||!runtime.isToolExecutionActive(record)
        ||!runtime.matchesToolExecutionInput(record,{arguments:args,scopeRef:context.authorizationRef})
        ||!grant||grant.taskId!==context.taskId||grant.toolName!==host.toolName||grant.argumentsDigest!==argumentsDigest
        ||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now.getTime()
        ||!scopes.every(scope=>grant.scopes.includes(scope)))return deny();
      return {identity:{parentTaskId:parentId,sessionId:bridge.sessionId,controlRevision:state.controlRevision as number,
        hostTaskId:context.taskId,hostOperationId:host.commandId,toolName:host.toolName as string,toolVersion:'1.0.0',
        runId:context.runId,argumentsDigest,deadline:context.deadline},args:structuredClone(args)};
    } catch {return deny();}
  }
  function matchesWrite(first:Binding,write:WorkflowShadowConfigurationWrite,acceptance:WorkflowShadowAcceptanceConfig|undefined,
    promotion?:WorkflowShadowConfigurationOperation):boolean {
    const {args,identity}=first;
    if(identity.toolName!=='workflow.host.f23_n04'||!plain(write)||!['promote','rollback'].includes(String(args.action))
      ||write.action!==args.action||write.operationId!==args.operationId||write.configurationId!==args.configurationId
      ||!plain(write.expected)||!plain(write.next)||!acceptance||acceptance.configurationId!==args.configurationId)return false;
    const {requestDigest:_,...body}=write;
    if(write.requestDigest!==workflowShadowReleaseDigest(body))return false;
    if(write.action==='promote') {
      if(!plain(args.candidateParameters)||!plain(args.main)||!plain(args.shadow)||!plain(args.testEvidence)
        ||write.expected.revision!==acceptance.baseline.revision
        ||write.expected.version!==acceptance.baseline.version||write.expected.parametersDigest!==acceptance.baseline.parametersDigest
        ||write.next.version!==acceptance.candidate.version||write.next.parametersDigest!==acceptance.candidate.parametersDigest
        ||!isDeepStrictEqual(write.next.parameters,args.candidateParameters)
        ||write.sourceDigest!==workflowShadowReleaseDigest({acceptance,main:args.main,shadow:args.shadow,testEvidence:args.testEvidence}))return false;
    } else {
      if(!text(args.promotionOperationId)||write.promotionOperationId!==args.promotionOperationId||!promotion
        ||promotion.state!=='applied'||promotion.request.operationId!==args.promotionOperationId
        ||promotion.request.action!=='promote'||promotion.request.configurationId!==args.configurationId
        ||!isDeepStrictEqual(write.expected,promotion.after))return false;
      const {revision:_,...previous}=promotion.before;
      if(!isDeepStrictEqual(write.next,previous)||write.sourceDigest!==workflowShadowReleaseDigest({promotionOperationId:args.promotionOperationId,
        requestDigest:promotion.requestDigest,before:promotion.before,after:promotion.after}))return false;
    }
    return true;
  }
  async function authorize(context:ToolContext,action:ConfigurationAction,value:ConfigurationValue):Promise<boolean> {
    const first=original(context),{args,identity}=first;
    if(action==='initialize')return false;
    if(!text(args.configurationId)||!text(args.operationId))return false;
    if(action==='read')return typeof value==='string'&&value===args.configurationId;
    if(action==='readOperation')return typeof value==='string'&&(value===args.operationId
      ||identity.toolName==='workflow.host.f23_n04'&&args.action==='rollback'&&value===args.promotionOperationId);
    if(!plain(value))return false;
    const write=value as unknown as WorkflowShadowConfigurationWrite;
    let acceptance:WorkflowShadowAcceptanceConfig|undefined,promotion:WorkflowShadowConfigurationOperation|undefined;
    try {
      acceptance=options.readAcceptance();
      if(write.action==='rollback'&&text(args.promotionOperationId)&&options.readPromotion)
        promotion=await options.readPromotion(args.promotionOperationId,context);
    } catch {return false;}
    if(!matchesWrite(first,write,acceptance,promotion))return false;
    // Re-read the same live grant, original intent and active execution after every await.
    const last=original(context);return isDeepStrictEqual(first,last);
  }
  function assertCommitCurrent(context:ToolContext,request:WorkflowShadowConfigurationWrite,
    authorities:{acceptance:WorkflowShadowAcceptanceConfig;promotion?:WorkflowShadowConfigurationOperation}):void {
    const first=original(context);let serviceAcceptance:WorkflowShadowAcceptanceConfig|undefined;
    try {serviceAcceptance=options.readAcceptance();}catch{return deny();}
    const now=options.now().getTime(),acceptance=authorities.acceptance;
    if(!Number.isFinite(now)||!Number.isFinite(Date.parse(acceptance.validFrom))||!Number.isFinite(Date.parse(acceptance.expiresAt))
      ||Date.parse(acceptance.validFrom)>now||now>=Date.parse(acceptance.expiresAt)||!isDeepStrictEqual(serviceAcceptance,acceptance)
      ||!matchesWrite(first,request,acceptance,authorities.promotion))return deny();
    if(request.action==='promote')for(const item of [first.args.main,first.args.shadow,first.args.testEvidence]) {
      if(!plain(item)||typeof item.observedAt!=='string'||typeof item.expiresAt!=='string'
        ||!Number.isFinite(Date.parse(item.observedAt))||!Number.isFinite(Date.parse(item.expiresAt))
        ||Date.parse(item.observedAt)>now||now>=Date.parse(item.expiresAt))return deny();
    }
    original(context);
  }
  return {resolveOriginal:context=>original(context).identity,authorize,assertCommitCurrent,
    commitGuard:Object.freeze({runtime,assertCurrent:assertCommitCurrent})};
}
