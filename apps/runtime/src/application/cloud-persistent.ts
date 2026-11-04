import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {parseCloudPersistentCommand,parseCloudPersistentReply} from '@personal-agent/contracts/cloud-persistent';
import type {CloudPersistentCommand,CloudPersistentOwner,CloudPersistentReply} from '@personal-agent/contracts/cloud-persistent';
import {proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import type {RuntimeApplication} from './runtime-application.js';
import {createRuntimeProactiveImageAdapter} from './proactive-image-adapter.js';
import type {RuntimeProactiveImageAdapterOptions} from './proactive-image-adapter.js';
import {readPersistedRuntimeProactiveWorkflow} from './proactive-workflow-application.js';
import type {RuntimeProactiveWorkflowHost,RuntimeProactiveWorkflowHostOptions} from './proactive-workflow-application.js';
import {createRuntimeProactiveMaintenancePump} from './proactive-maintenance.js';
import type {ProactiveMaintenanceBinding} from './proactive-maintenance.js';

const KEY='cloud-persistent-session-v1',OWNER='cloud-persistent-owner-v1';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const fail=(code:string,message:string):never=>{throw new ProtocolError(code,message);};
interface Binding extends ProactiveMaintenanceBinding {
  version:1;owner:CloudPersistentOwner;submitCommandId:string;originTaskId:string;originRuntimeId:string;goalDigest:string;
}
export interface CloudPersistentFeedBinding extends ProactiveMaintenanceBinding {goalDigest:string;}
export interface CloudPersistentFeedHost {
  bindWorkflow(workflow:{snapshot():{state:string};readBinding(taskId:string):CloudPersistentFeedBinding;
    acquireMaintenance(taskId:string,context:{signal:AbortSignal;deadline:string}):
    Promise<{binding:CloudPersistentFeedBinding;host:RuntimeProactiveWorkflowHost}>}):void;
  snapshot(binding:CloudPersistentFeedBinding):NonNullable<CloudPersistentReply['sources']>;
  configure(binding:CloudPersistentFeedBinding,input:NonNullable<CloudPersistentCommand['source']>,commandId:string):void;
  approvalTaskIds(binding:CloudPersistentFeedBinding):readonly string[];
  assertReadCurrent(binding:CloudPersistentFeedBinding,taskId:string):void;
  restrict(binding:CloudPersistentFeedBinding,action?:'pause'|'cancel'):void;
  maintain(binding:CloudPersistentFeedBinding,context:{signal:AbortSignal;deadline:string}):Promise<{state:string}>;
}
export interface CloudPersistentRuntimeOptions {
  owner:CloudPersistentOwner;
  image:RuntimeProactiveImageAdapterOptions;
  /** Trusted deployment qualification record; not an SSH heartbeat or a model assertion. */
  qualificationEvidenceRef:string;
  /** Holds the exclusive process/data-directory ownership; checked again after asynchronous preparation. */
  assertCurrent():void;
  bindings?:RuntimeProactiveWorkflowHostOptions['bindings'];
  context?:RuntimeProactiveWorkflowHostOptions['context'];
  feeds?:CloudPersistentFeedHost;
  now?:()=>number;
}

/** A composition of the original Runtime, never a replica of a Desktop session or its grants. */
export function createCloudPersistentRuntimeHost(application:RuntimeApplication,options:CloudPersistentRuntimeOptions):{
  handle(value:unknown,signal:AbortSignal):Promise<CloudPersistentReply>;tick():Promise<unknown>;owner:CloudPersistentOwner;
} {
  const runtime=application.runtime,now=options.now??Date.now,owner=structuredClone(options.owner);
  const hosts=new Map<string,RuntimeProactiveWorkflowHost>(),controls=new Map<string,string>();
  const preparing=new Map<string,Promise<{host:RuntimeProactiveWorkflowHost}>>();
  const assertOwner=()=>{
    if(!options.qualificationEvidenceRef||typeof options.assertCurrent!=='function')fail('UNSUPPORTED_CAPABILITY','Cloud host qualification is unavailable');
    const result:unknown=options.assertCurrent();
    if(result!==undefined){void Promise.resolve(result).catch(()=>{});fail('UNAUTHORIZED','Cloud owner check must be synchronous');}
    if(digest(options.owner)!==digest(owner))fail('REVISION_CONFLICT','Cloud owner configuration changed');
  };
  assertOwner();
  const existingRegistry=runtime.findTaskByIdempotencyKey(OWNER);
  if(!existingRegistry&&runtime.listTasks({limit:1}).items.length)fail('REVISION_CONFLICT','A new cloud owner cannot adopt an existing device or copied task database');
  const registry=existingRegistry??runtime.submitTask({goal:'Cloud Runtime owner metadata',conversationId:'cloud-runtime-registry',idempotencyKey:OWNER});
  runtime.saveCheckpointOnce(registry.taskId,OWNER,owner);
  if(digest(runtime.loadCheckpoint(registry.taskId,OWNER))!==digest(owner))fail('REVISION_CONFLICT','This Runtime directory belongs to another fixed cloud owner');
  const sourceKey=(id:string)=>'cloud-source:'+hash(owner.runtimeId+':'+id);
  const taskKey=(id:string)=>'cloud-session:'+hash(owner.runtimeId+':'+id);
  function readBinding(taskId:string,sessionId?:string):Binding {
    assertOwner();
    const binding=runtime.loadCheckpoint(taskId,KEY) as Binding|undefined;
    if(!binding||binding.version!==1||binding.taskId!==taskId||digest(binding.owner)!==digest(owner)
      ||sessionId!==undefined&&binding.sessionId!==sessionId)fail('UNAUTHORIZED','Original cloud session binding differs');
    return structuredClone(binding!);
  }
  const sourceCurrent=(binding:Binding)=>{
    const source=runtime.getTask(binding.sourceTaskId);
    if(!source.goal||hash(source.goal)!==binding.goalDigest||source.cancelRequested||runtime.loadCheckpoint(source.taskId,'private-copy-erasure')!==undefined
      ||runtime.loadCheckpoint(source.taskId,'private-copy-erasure-binding')!==undefined)fail('UNAUTHORIZED','Original cloud user instruction is unavailable');
    return source;
  };
  const image=()=>createRuntimeProactiveImageAdapter({...options.image,assertDeploymentBinding:()=>{assertOwner();options.image.assertDeploymentBinding?.();}});
  function bind(taskId:string) {
    const binding=readBinding(taskId);
    const existing=hosts.get(taskId);if(existing)return {host:existing};
    const adapter=image();
    const host=application.createProactiveWorkflowHost({taskId,sessionId:binding.sessionId,taskDeadline:binding.taskDeadline,
      contractRef:owner.contractRef,advancePort:adapter.advancePort,verifyAdvance:adapter.verifyAdvance,sign:adapter.sign,
      pureAdvance:{kind:'signed_frontier_no_effects'},localDeviceAvailable:()=>false,coreExecutionLocation:'cloud_persistent',
      cloudPersistentHost:{ref:'cloud-runtime:'+owner.runtimeId,available:()=>{try{assertOwner();return true;}catch{return false;}},assertCurrent:assertOwner},
      ...(options.context?{context:options.context}:{}),...(options.bindings?{bindings:options.bindings}:{}),
      verifyControlCommand:command=>controls.get(command.commandId)===digest(command),
      resumeWorker:()=>application.resumeProactiveTask(taskId)});
    hosts.set(taskId,host);return {host};
  }
  function prepare(taskId:string,context:{signal:AbortSignal;deadline:string}):Promise<{host:RuntimeProactiveWorkflowHost}> {
    const pending=preparing.get(taskId);if(pending)return pending;
    const run=(async()=>{
      const binding=readBinding(taskId);sourceCurrent(binding);const session=bind(taskId);
      // This original source event is idempotent and local. Persist it before the first network await,
      // so a failed describe or restart cannot leave a target with a silently lost user instruction.
      const state=session.host.inspect().application.state,event=state.entries['user-instruction:'+binding.sourceTaskId];
      if(event===undefined)session.host.ingestUserInstruction({sourceTaskId:binding.sourceTaskId},context);
      else if(event.event.entityRef!==binding.sourceTaskId||event.event.payloadDigest!==binding.goalDigest
        ||!state.responsibilities['instruction:'+binding.sourceTaskId])fail('REVISION_CONFLICT','Original cloud instruction admission changed');
      const descriptionKey='cloud-contract-description-v1',expected={ownerDigest:digest(owner)};
      const saved=runtime.loadCheckpoint(taskId,descriptionKey);
      if(saved!==undefined&&digest(saved)!==digest(expected))fail('REVISION_CONFLICT','Original cloud contract observation changed');
      if(saved===undefined){
        const description=await image().describe({...context,taskId,sessionId:binding.sessionId,taskDeadline:binding.taskDeadline,
          controlRevision:0,requestId:'describe-'+hash(binding.sessionId).slice(0,32)});
        assertOwner();sourceCurrent(binding);
        if(!description.contracts.some(contract=>contract.id===owner.contractRef&&contract.version===owner.contractVersion))
          fail('UNSUPPORTED_CAPABILITY','Fixed cloud responsibility contract is unavailable');
        runtime.saveCheckpointOnce(taskId,descriptionKey,expected);
      }
      return session;
    })().finally(()=>preparing.delete(taskId));preparing.set(taskId,run);return run;
  }
  function readback(command:CloudPersistentCommand):CloudPersistentReply {
    const taskId=command.target?.taskId??runtime.findTaskByIdempotencyKey(taskKey(command.originCommandId!))?.taskId;
    if(!taskId)fail('NOT_FOUND','Original cloud submission has no task receipt; it must not be resubmitted');
    const binding=readBinding(taskId!,command.target?.sessionId),task=runtime.getTask(taskId!);
    const state=readPersistedRuntimeProactiveWorkflow(runtime,binding.taskId,binding.sessionId);
    const approvals=[binding.taskId,...(options.feeds?.approvalTaskIds(binding)??[])].flatMap(approvalTaskId=>
      runtime.listApprovals({taskId:approvalTaskId,limit:50}).items).flatMap(value=>{
      const invocation=runtime.loadCheckpoint(value.taskId,value.taskId===binding.taskId?'application-tool-invocation:'+value.approvalId:'host-tool-intent') as {arguments?:Record<string,unknown>}|undefined;
      if(!invocation?.arguments||toolArgumentsDigest(invocation.arguments)!==value.argumentsDigest)return [];
      return [{approvalId:value.approvalId,revision:value.revision,action:value.action,arguments:invocation.arguments,
        ...(value.taskId===binding.taskId?{}:{taskId:value.taskId}),argumentsDigest:value.argumentsDigest,expiresAt:value.expiresAt,state:value.state}];}).slice(0,50);
    return parseCloudPersistentReply({version:1,commandId:command.commandId,owner,target:{taskId:binding.taskId,sessionId:binding.sessionId},
      task:{state:task.state,revision:task.revision,cancelRequested:task.cancelRequested===true},
      controlRevision:state?.application.state.binding.controlRevision??0,approvals,evidenceRefs:task.evidenceRefs.slice(-100),
      ...(options.feeds?{sources:options.feeds.snapshot(binding)}:{})});
  }
  async function handle(value:unknown,signal:AbortSignal):Promise<CloudPersistentReply> {
    const command=parseCloudPersistentCommand(value);assertOwner();
    if(digest(command.owner)!==digest(owner))fail('REVISION_CONFLICT','Command targets another fixed cloud owner');
    if(signal.aborted)fail('CANCELLED','Cloud command was cancelled');
    if(now()>=Date.parse(command.deadline))fail('TIMEOUT','Cloud command expired');
    if(command.operation==='readback')return readback(command);
    const commandKey='cloud-command:'+hash(command.commandId),commandDigest=digest(command);
    const prior=runtime.loadCheckpoint(registry.taskId,commandKey) as {digest:string;reply?:CloudPersistentReply}|undefined;
    if(prior){if(prior.digest!==commandDigest)fail('REVISION_CONFLICT','Original cloud command changed');
      if(prior.reply)return parseCloudPersistentReply(prior.reply);return fail('RESULT_UNKNOWN','Original cloud command requires readback, not another execution');}
    runtime.saveCheckpointOnce(registry.taskId,commandKey,{digest:commandDigest});
    try {
    const context={signal,deadline:command.deadline};
    if(command.operation==='submit') {
      const input=command.submit!;
      if(hash(input.goal)!==input.goalDigest||Date.parse(input.taskDeadline)<Date.parse(command.deadline)||now()>=Date.parse(input.taskDeadline))
        fail('INVALID_ARGUMENT','Original public goal or task deadline differs');
      const conversationId='cloud-user:'+hash([owner.runtimeId,input.originRuntimeId,input.originTaskId].join(':'));
      const source=runtime.submitTask({goal:input.goal,conversationId,idempotencyKey:sourceKey(command.commandId)});
      const task=runtime.submitTask({goal:input.goal,conversationId,idempotencyKey:taskKey(command.commandId)});
      const binding:Binding={version:1,owner,submitCommandId:command.commandId,taskId:task.taskId,sessionId:'cloud-'+hash(command.commandId).slice(0,32),
        sourceTaskId:source.taskId,taskDeadline:input.taskDeadline,imageBinding:digest(owner),originTaskId:input.originTaskId,originRuntimeId:input.originRuntimeId,goalDigest:input.goalDigest};
      runtime.saveCheckpointOnce(task.taskId,KEY,binding);
      await prepare(task.taskId,context);assertOwner();application.startProactiveTask(task.taskId);
      command.target={taskId:task.taskId,sessionId:binding.sessionId};
    } else {
      const target=command.target!,binding=readBinding(target.taskId,target.sessionId);
      if(Date.parse(command.deadline)>Date.parse(binding.taskDeadline))fail('INVALID_ARGUMENT','Cloud command cannot extend the original task');
      assertOwner();
      if(command.operation==='approval') {
        const input=command.approval!,original=runtime.getApproval(input.approvalId);
        if(input.decision==='allow_once')sourceCurrent(binding);
        const approvalTaskId=input.taskId??binding.taskId;
        if(approvalTaskId!==binding.taskId&&!options.feeds?.approvalTaskIds(binding).includes(approvalTaskId))
          fail('UNAUTHORIZED','Approval child is not owned by the original cloud session');
        if(original.taskId!==approvalTaskId||original.argumentsDigest!==input.argumentsDigest||original.expiresAt!==input.expiresAt)
          fail('UNAUTHORIZED','Approval must match the original cloud task, arguments and expiry');
        if(input.decision==='allow_once'&&approvalTaskId!==binding.taskId)options.feeds!.assertReadCurrent(binding,approvalTaskId);
        runtime.respondApproval(input.approvalId,input.decision,input.expectedRevision);
        if(input.decision==='allow_once'){
          if(approvalTaskId!==binding.taskId)application.resumeHostToolTask(approvalTaskId);
          else {bind(binding.taskId);application.resumeProactiveTask(binding.taskId);}
        }
      } else if(command.operation==='source') {
        if(!options.feeds)fail('UNSUPPORTED_CAPABILITY','Cloud source host is unavailable');
        if(command.source!.action==='track')sourceCurrent(binding);
        options.feeds!.configure(binding,command.source!,command.commandId);
      } else {
        const input=command.control!;
        if(!['pause','cancel'].includes(input.action))sourceCurrent(binding);
        const {host}=bind(binding.taskId);
        if(host.binding.controlRevision!==input.expectedControlRevision)fail('REVISION_CONFLICT','Original cloud control revision changed');
        if(input.action==='pause'||input.action==='cancel')options.feeds?.restrict(binding,input.action);
        const source=runtime.submitTask({goal:'User cloud control: '+input.action,
          conversationId:runtime.getTask(binding.sourceTaskId).conversationId!,idempotencyKey:'cloud-control-source:'+hash(command.commandId)});
        const control={commandId:command.commandId,sourceTaskId:source.taskId,...input};controls.set(command.commandId,digest(control));
        try{await host.control(control,context);}finally{controls.delete(command.commandId);}
        if(input.action==='resume'||input.action==='return')application.resumeProactiveTask(binding.taskId);
      }
    }
    assertOwner();const reply=readback(command);
    runtime.saveCheckpoint(registry.taskId,commandKey,{digest:commandDigest,reply});return reply;
    }catch{ return fail('RESULT_UNKNOWN','Original cloud command was admitted; read back its original session before any further action'); }
  }
  const workflow={snapshot:()=>({state:'configured_not_verified'}),readBinding,
    acquireMaintenance:async(taskId:string,context:{signal:AbortSignal;deadline:string})=>({...await prepare(taskId,context),binding:readBinding(taskId)}),
    maintenancePage(input:{beforeSequence?:number;snapshotSequence?:number}) {
      assertOwner();const page=runtime.listTaskCheckpointPage({limit:100,...input},[KEY]);
      return {...page,items:page.items.map(task=>{const binding=readBinding(task.taskId);let withheld=false;
        try{sourceCurrent(binding);}catch{withheld=true;}
        return {binding,state:task.state,cancelRequested:task.cancelRequested===true,conversationId:task.conversationId,withheld};})};
    }};
  const maintenance=createRuntimeProactiveMaintenancePump({getApplication:()=>application,getWorkflow:()=>workflow,
    resolveUserConversation:taskId=>runtime.getTask(taskId).conversationId,
    ...(options.feeds?{recoverSources:(taskId:string,context:{signal:AbortSignal;deadline:string})=>options.feeds!.maintain(readBinding(taskId),context)}:{}),now});
  options.feeds?.bindWorkflow(workflow);
  return {handle,tick:()=>{assertOwner();return maintenance.tick();},owner:structuredClone(owner)};
}
