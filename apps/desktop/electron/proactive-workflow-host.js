import {createHash} from 'node:crypto';
import {createRuntimeProactiveImageAdapter} from '@personal-agent/runtime/application';
import {createUnavailableCloudPersistentHost} from './cloud-persistent-unavailable.js';

const KEY='desktop-proactive-workflow-v1';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=value=>typeof value==='string'&&!!value.trim();
const RESERVED_IDS=['__proto__','constructor','prototype'];
/** Same identity rule as Runtime lifecycleCommand: non-empty, <=256 chars, no prototype-reserved names. */
const responsibilityIdentity=value=>text(value)&&value.length<=256&&!RESERVED_IDS.includes(value);
/** Exactly {sourceId,responsibilityId}; plain object only; both identities follow the Runtime rule. */
function validSourceResponsibilityBinding(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const keys=Object.keys(value);
  return keys.length===2&&keys.every(key=>key==='sourceId'||key==='responsibilityId')
    &&responsibilityIdentity(value.sourceId)&&responsibilityIdentity(value.responsibilityId);
}

/** Desktop binds trusted configuration and user commands. The original Runtime owns its worker. */
export function createDesktopProactiveWorkflowApplication({application,readConfiguration,notificationHost,
  context,bindings,controller,cloudPersistentHost,localDeviceAvailable,resolveUserConversation,onSession=()=>{},
  readPersistedSession,responsibilityLifecycleAuthority,onUpdate=()=>{},createAdapter=createRuntimeProactiveImageAdapter,
  sourceResponsibilityBinding}) {
  // Only a per-task resolver is accepted: a plain object would apply one binding to every session and make the
  // Runtime filter out every other responsibility. The resolver runs once in start() and its result is persisted
  // into the original command binding; bind()/resume never re-evaluate it.
  if(sourceResponsibilityBinding!==undefined&&typeof sourceResponsibilityBinding!=='function')
    throw TypeError('sourceResponsibilityBinding must be a per-task resolver function');
  const sessions=new Map(),controls=new Map();
  const publish=()=>{try{onUpdate();}catch{}};
  function configuration() {
    const configured=readConfiguration();
    if(!configured||!text(configured.contractRef)||!configured.adapter)
      throw Error('持续工作流缺少受信镜像契约或签名配置');
    return configured;
  }
  function imageBinding(configuration) {
    const adapter=configuration.adapter,config=adapter.config;
    return digest({contractRef:configuration.contractRef,
      ...(config?{gatewayUrl:config.gatewayUrl,runtimeName:config.runtimeName,
        websocketUrl:config.websocketUrl,deploymentVersion:config.deploymentVersion}:{endpoint:adapter.endpoint}),
      invokeMode:adapter.invokeMode??config?.invokeMode??'published',workflowGoalInput:adapter.workflowGoalInput??config?.workflowGoalInput});
  }
  function lifetime(binding,request={}) {
    const requested=request.deadline??binding.taskDeadline;
    const deadline=Date.parse(requested)>Date.parse(binding.taskDeadline)?binding.taskDeadline:requested;
    const signal=request.signal??new AbortController().signal;
    if(signal.aborted||!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)<=Date.now()
      ||Date.parse(deadline)>Date.parse(binding.taskDeadline))throw Error('原持续工作流已取消或超过期限');
    return {deadline,signal};
  }
  async function bind(taskId,request) {
    const existing=sessions.get(taskId);if(existing){
      if(existing.binding.imageBinding!==undefined&&existing.binding.imageBinding!==imageBinding(configuration()))
        throw Error('原持续工作流镜像绑定已改变，请核实原会话');
      return existing;
    }
    const binding=application.runtime.loadCheckpoint(taskId,KEY);
    if(!binding||binding.version!==1||binding.taskId!==taskId)throw Error('原持续工作流绑定不存在');
    const configured=configuration();
    if(configured.contractRef!==binding.contractRef)throw Error('持续工作流契约已改变，请核实原会话');
    if(binding.imageBinding!==undefined&&binding.imageBinding!==imageBinding(configured))throw Error('原持续工作流镜像绑定已改变，请核实原会话');
    const adapter=createAdapter(configured.adapter),ctx=lifetime(binding,request);
    const description=await adapter.describe({...ctx,taskId,sessionId:binding.sessionId,taskDeadline:binding.taskDeadline,
      controlRevision:0,requestId:'describe-'+digest(binding).slice(0,32)});
    const contract=description.contracts.find(value=>value.id===binding.contractRef);
    if(!contract||contract.version!==binding.contractVersion)throw Error('镜像原契约版本不可用');
    const contextPorts=typeof context==='function'?context():context;
    const sourceBinding=binding.sourceResponsibilityBinding;
    if(sourceBinding!==undefined&&!validSourceResponsibilityBinding(sourceBinding))throw Error('持续工作流来源责任绑定格式无效');
    const host=application.createProactiveWorkflowHost({taskId,sessionId:binding.sessionId,taskDeadline:binding.taskDeadline,
      contractRef:binding.contractRef,advancePort:adapter.advancePort,verifyAdvance:adapter.verifyAdvance,sign:adapter.sign,
      pureAdvance:{kind:'signed_frontier_no_effects'},localDeviceAvailable,
      ...(sourceBinding?{sourceResponsibilityBinding:structuredClone(sourceBinding)}:{}),
      // Explicit unavailable until post-shutdown cloud Evidence exists (never invent available:true).
      cloudPersistentHost:createUnavailableCloudPersistentHost(),
      ...(resolveUserConversation?{resolveUserConversation:id=>resolveUserConversation(id===binding.taskId?binding.sourceTaskId:id)}:{}),
      ...(notificationHost?{notificationHost}:{}),...(contextPorts?{context:contextPorts}:{}),...(bindings?{bindings}:{}),
      ...(controller?{controller}:{}),
      ...(cloudPersistentHost?{cloudPersistentHost}:{}),
      verifyControlCommand:command=>controls.get(command.commandId)===digest(command),
      ...(responsibilityLifecycleAuthority?{
        verifyResponsibilityLifecycle:(command,source,scope)=>{
          assertResponsibilitySession({taskId,sessionId:binding.sessionId},source.taskId,scope);
          return responsibilityLifecycleAuthority()?.verify({taskId,sessionId:binding.sessionId},command,source,scope)===true;
        },
        assertResponsibilityLifecycleCurrent:(command,source,scope)=>{
          assertResponsibilitySession({taskId,sessionId:binding.sessionId},source.taskId,scope);
          const authority=responsibilityLifecycleAuthority();if(!authority)throw Error('原责任生命周期许可不可用');
          return authority.assertCurrent({taskId,sessionId:binding.sessionId},command,source,scope);
        },
      }:{}),
      resumeWorker:()=>application.resumeProactiveTask(taskId)});
    sessions.set(taskId,{binding,host});host.subscribe(publish);onSession(sessions.get(taskId));return sessions.get(taskId);
  }
  function assertResponsibilitySession(target,sourceTaskId,request,writable=true) {
    if(!target||Object.keys(target).sort().join(',')!=='sessionId,taskId'||!text(target.taskId)||!text(target.sessionId)||!text(sourceTaskId))
      throw Error('请选择原责任会话和原用户指令');
    const stored=application.runtime.loadCheckpoint(target.taskId,KEY);
    if(stored?.version!==1||stored.taskId!==target.taskId||stored.sessionId!==target.sessionId)throw Error('原责任会话已改变');
    if(stored.imageBinding!==imageBinding(configuration()))throw Error('原责任部署已改变');
    const task=application.runtime.getTask(target.taskId);
    if(writable&&(task.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(task.state)))throw Error('原责任会话已停止');
    const source=application.runtime.getTask(sourceTaskId),origin=application.runtime.getTask(stored.sourceTaskId);
    const conversation=resolveUserConversation?resolveUserConversation(sourceTaskId):source.conversationId;
    if(!text(conversation)||conversation!==(resolveUserConversation?resolveUserConversation(stored.sourceTaskId):origin.conversationId)
      ||!text(source.goal)||!text(origin.goal)||source.cancelRequested
      ||[sourceTaskId,stored.sourceTaskId].some(id=>application.runtime.loadCheckpoint(id,'private-copy-erasure')!==undefined
        ||application.runtime.loadCheckpoint(id,'private-copy-erasure-binding')!==undefined))throw Error('原责任来源不属于当前用户会话');
    if(Date.parse(request.deadline)>Date.parse(stored.taskDeadline))throw Error('责任操作不能延长原会话期限');
  }
  async function responsibilitySession(target,sourceTaskId,request,writable=false) {
    assertResponsibilitySession(target,sourceTaskId,request,writable);
    const session=await bind(target.taskId,request);
    assertResponsibilitySession(target,sourceTaskId,request,writable);
    if(session.binding.sessionId!==target.sessionId)throw Error('原责任会话已改变');return session;
  }
  function summary(session) {
    const {binding,host}=session,result=host.inspect().application.state.lastResult;
    const items=Object.values(result?.items??{}),returned=result?.returnSummary;
    return {taskId:binding.taskId,sessionId:binding.sessionId,taskDeadline:binding.taskDeadline,
      controlRevision:host.binding.controlRevision,taskState:application.runtime.getTask(binding.taskId).state,
      mode:result?.mode??'attended',items:items.length,
      waitingDevice:items.filter(item=>item.state==='waiting_device').length,
      waitingReconciliation:items.filter(item=>item.state==='waiting_reconciliation').length,
      ...(returned?{returnSummary:{done:returned.done.length,changed:returned.changed.length,
        pending:returned.pending.length,blocked:returned.blocked.length,replayedNotifications:0}}:{})};
  }
  return {
    /** Pure startup projection over the original Runtime's public persisted reader. No bind/describe. */
    readPersistedSessions() {
      if(typeof readPersistedSession!=='function')return [];
      const result=[];let beforeSequence,snapshotSequence;
      do {
        const page=application.runtime.listTaskCheckpointPage({limit:100,...(beforeSequence===undefined?{}:{beforeSequence}),
          ...(snapshotSequence===undefined?{}:{snapshotSequence})},[KEY]);
        snapshotSequence=page.snapshotSequence;beforeSequence=page.nextBeforeSequence;
        for(const task of page.items) {
          const binding=application.runtime.loadCheckpoint(task.taskId,KEY);
          if(binding?.version!==1||binding.taskId!==task.taskId||!binding.imageBinding)continue;
          try {
            if(binding.imageBinding!==imageBinding(configuration())||configuration().contractRef!==binding.contractRef)continue;
            const snapshot=readPersistedSession(task.taskId,binding.sessionId);
            if(!snapshot||snapshot.application.state.binding.taskDeadline!==binding.taskDeadline
              ||snapshot.application.state.contractRef!==binding.contractRef)continue;
            result.push({binding:structuredClone(binding),host:{taskId:task.taskId,sessionId:binding.sessionId,
              get binding(){return readPersistedSession(task.taskId,binding.sessionId)?.application.state.binding;},
              inspect(){const current=readPersistedSession(task.taskId,binding.sessionId);
                if(!current)throw Error('原持久持续工作流不可用');return current;}}});
          }catch{/* Missing original state cannot authorize startup. */}
        }
      }while(beforeSequence!==undefined);
      return result;
    },
    snapshot() {
      let configured=false;try{configuration();configured=true;}catch{}
      return {state:configured?'configured_not_verified':'unavailable',sessions:[...sessions.values()].map(({binding,host})=>({
        taskId:binding.taskId,sourceTaskId:binding.sourceTaskId,sessionId:binding.sessionId,contractRef:binding.contractRef,
        taskDeadline:binding.taskDeadline,controlRevision:host.binding.controlRevision,
        taskState:application.runtime.getTask(binding.taskId).state})),
        missing:['business_source_adapters','local_decision_and_teacher_tools'].filter(value=>!bindings?.length||value==='business_source_adapters')};
    },
    async start(input,request) {
      if(!input||Object.keys(input).some(key=>!['sourceTaskId','commandId','taskDeadline','sourceResponsibilityBinding'].includes(key))
        ||![input.sourceTaskId,input.commandId,input.taskDeadline].every(text))throw Error('持续工作流需要原指令、命令标识和期限');
      if(input.sourceResponsibilityBinding!==undefined&&!validSourceResponsibilityBinding(input.sourceResponsibilityBinding))
        throw Error('持续工作流来源责任绑定格式无效');
      const source=application.runtime.getTask(input.sourceTaskId);
      const conversationId=resolveUserConversation?resolveUserConversation(source.taskId):source.conversationId;
      if(!text(source.goal)||!text(source.conversationId)||application.runtime.loadCheckpoint(source.taskId,'private-copy-erasure')
        ||application.runtime.loadCheckpoint(source.taskId,'private-copy-erasure-binding')||!text(conversationId))throw Error('原用户指令不可用');
      const configured=configuration(),ctx=lifetime({taskDeadline:input.taskDeadline},request);
      const identity={taskId:source.taskId,sessionId:'proactive-'+digest(input.commandId).slice(0,32),controlRevision:0,
        taskDeadline:input.taskDeadline,requestId:'describe-'+digest(input.commandId).slice(0,32),...ctx};
      const description=await createAdapter(configured.adapter).describe(identity);
      const contract=description.contracts.find(value=>value.id===configured.contractRef);
      if(!contract)throw Error('镜像没有发布当前持续工作流契约');
      const task=application.runtime.submitTask({goal:source.goal,conversationId,
        idempotencyKey:'desktop-proactive-'+digest(input.commandId)});
      let sourceBinding=input.sourceResponsibilityBinding;
      if(sourceBinding===undefined&&sourceResponsibilityBinding){
        sourceBinding=sourceResponsibilityBinding({taskId:task.taskId,sourceTaskId:source.taskId});
        if(sourceBinding!==undefined&&!validSourceResponsibilityBinding(sourceBinding))throw Error('持续工作流来源责任绑定格式无效');
      }
      const binding={version:1,taskId:task.taskId,sessionId:identity.sessionId,sourceTaskId:source.taskId,
        taskDeadline:input.taskDeadline,contractRef:contract.id,contractVersion:contract.version,imageBinding:imageBinding(configured),
        ...(sourceBinding?{sourceResponsibilityBinding:{sourceId:sourceBinding.sourceId,responsibilityId:sourceBinding.responsibilityId}}:{})};
      application.runtime.saveCheckpointOnce(task.taskId,KEY,binding);
      if(digest(application.runtime.loadCheckpoint(task.taskId,KEY))!==digest(binding))throw Error('原命令已绑定其他参数');
      const session=await bind(task.taskId,ctx);
      session.host.ingestUserInstruction({sourceTaskId:source.taskId,
        ...(sourceBinding?{responsibilityId:sourceBinding.responsibilityId}:{})},ctx);
      application.startProactiveTask(task.taskId);publish();return {taskId:task.taskId,sessionId:binding.sessionId,accepted:true};
    },
    async resume(taskId,request) {const session=await bind(taskId,request);application.startProactiveTask(taskId);publish();return session.host.binding;},
    async control(input,request) {
      if(!input||Object.keys(input).some(key=>!['taskId','sourceTaskId','commandId','action','expectedControlRevision'].includes(key)))throw Error('持续工作流控制格式无效');
      const session=await bind(input.taskId,request),{taskId:_,...command}=input;
      controls.set(command.commandId,digest(command));
      try {const result=await session.host.control(command,lifetime(session.binding,request));
        if(['resume','enter_unattended','return'].includes(command.action)
          &&['created','waiting_approval'].includes(application.runtime.getTask(input.taskId).state))application.resumeProactiveTask(input.taskId);
        publish();return result;}
      finally{controls.delete(command.commandId);}
    },
    async instruction(taskId,sourceTaskId,request,responsibilityId) {
      if(responsibilityId!==undefined&&!responsibilityIdentity(responsibilityId))throw Error('持续工作流责任标识无效');
      const session=await bind(taskId,request);
      return session.host.ingestUserInstruction({sourceTaskId,...(responsibilityId!==undefined?{responsibilityId}:{})},lifetime(session.binding,request));},
    async readResponsibility(target,reference,sourceTaskId,request) {
      const session=await responsibilitySession(target,sourceTaskId,request);
      return {responsibility:session.host.readResponsibility(reference,request),lifecycle:session.host.readResponsibilityLifecycle(reference,request)};
    },
    async recordResponsibilityLifecycle(target,command,request) {
      const session=await responsibilitySession(target,command.sourceTaskId,request,true);
      const prior=session.host.readResponsibilityLifecycleOperation(command,request);
      if(prior.state==='recorded')return prior;
      const result=await session.host.recordResponsibilityLifecycle(command,request);publish();return result;
    },
    async readResponsibilityLifecycleOperation(target,command,request) {
      return (await responsibilitySession(target,command.sourceTaskId,request)).host.readResponsibilityLifecycleOperation(command,request);
    },
    async wake(taskId,scheduleId,request) {const session=await bind(taskId,request);
      return session.host.ingestWake(scheduleId,lifetime(session.binding,request));},
    async eventSink(taskId,request) {return (await bind(taskId,request)).host.eventSink;},
    read(taskId) {const session=sessions.get(taskId);if(!session)throw Error('原持续工作流尚未恢复');
      return {task:application.runtime.getTask(taskId),binding:session.host.binding};},
    /** Bounded conversation tool projection; never return signed checkpoints, source text or proposals. */
    async readSummary(taskId,request) {return summary(await bind(taskId,request));},
    /** Main-only maintenance access. Existing signed sessions and Runtime still own execution. */
    async acquireMaintenance(taskId,request) {return bind(taskId,request);},
    maintenancePage(input={}) {
      // Select through Runtime's existing checkpoint index before hydrating bodies.
      // A checkpoint is only a candidate: the original binding/privacy checks below remain required.
      const page=application.runtime.listTaskCheckpointPage({limit:100,...input},[KEY]);
      return {...page,items:page.items.flatMap(task=>{
        const binding=application.runtime.loadCheckpoint(task.taskId,KEY);
        if(binding?.version!==1||binding.taskId!==task.taskId)return [];
        const withheld=application.runtime.loadCheckpoint(binding.sourceTaskId,'private-copy-erasure')!==undefined
          ||application.runtime.loadCheckpoint(binding.sourceTaskId,'private-copy-erasure-binding')!==undefined;
        return [{binding:structuredClone(binding),state:task.state,cancelRequested:task.cancelRequested===true,
          conversationId:task.conversationId,withheld}];
      })};
    },
    conversationForTask(taskId) {
      const binding=application.runtime.loadCheckpoint(taskId,KEY);
      if(!binding||binding.version!==1||binding.taskId!==taskId)throw Error('原持续工作流绑定不存在');
      return resolveUserConversation?resolveUserConversation(binding.sourceTaskId):application.runtime.getTask(taskId).conversationId;
    },
    listConversation(conversationId) {
      const result=[];let beforeSequence,snapshotSequence,pages=0;
      do {
        const page=application.runtime.listTaskCheckpointPage({...(resolveUserConversation?{}:{conversationId}),limit:100,
          ...(beforeSequence===undefined?{}:{beforeSequence}),...(snapshotSequence===undefined?{}:{snapshotSequence})},[KEY]);
        snapshotSequence=page.snapshotSequence;
        for(const task of page.items) {
          const binding=application.runtime.loadCheckpoint(task.taskId,KEY);
          const belongs=binding?.version===1&&binding.taskId===task.taskId
            &&(!resolveUserConversation||resolveUserConversation(binding.sourceTaskId)===conversationId);
          if(belongs) result.push({taskId:task.taskId,
            taskState:task.state,taskDeadline:binding.taskDeadline});
          if(result.length===20)return {sessions:result,truncated:true};
        }
        beforeSequence=page.nextBeforeSequence;
        if(++pages===10&&beforeSequence!==undefined)return {sessions:result,truncated:true};
      }while(beforeSequence!==undefined);
      return {sessions:result,truncated:false};
    },
  };
}
