import {createHash} from 'node:crypto';
import {createRuntimeProactiveImageAdapter} from '@personal-agent/runtime/application';

const KEY='desktop-proactive-workflow-v1';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=value=>typeof value==='string'&&!!value.trim();

/** Desktop binds trusted configuration and user commands. The original Runtime owns its worker. */
export function createDesktopProactiveWorkflowApplication({application,readConfiguration,notificationHost,
  context,bindings,localDeviceAvailable,resolveUserConversation,onUpdate=()=>{},createAdapter=createRuntimeProactiveImageAdapter}) {
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
    const host=application.createProactiveWorkflowHost({taskId,sessionId:binding.sessionId,taskDeadline:binding.taskDeadline,
      contractRef:binding.contractRef,advancePort:adapter.advancePort,verifyAdvance:adapter.verifyAdvance,sign:adapter.sign,
      pureAdvance:{kind:'signed_frontier_no_effects'},localDeviceAvailable,
      ...(resolveUserConversation?{resolveUserConversation:id=>resolveUserConversation(id===binding.taskId?binding.sourceTaskId:id)}:{}),
      ...(notificationHost?{notificationHost}:{}),...(contextPorts?{context:contextPorts}:{}),...(bindings?{bindings}:{}),
      verifyControlCommand:command=>controls.get(command.commandId)===digest(command),
      resumeWorker:()=>application.resumeProactiveTask(taskId)});
    sessions.set(taskId,{binding,host});host.subscribe(publish);return sessions.get(taskId);
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
    snapshot() {
      let configured=false;try{configuration();configured=true;}catch{}
      return {state:configured?'configured_not_verified':'unavailable',sessions:[...sessions.values()].map(({binding,host})=>({
        taskId:binding.taskId,sourceTaskId:binding.sourceTaskId,sessionId:binding.sessionId,contractRef:binding.contractRef,
        taskDeadline:binding.taskDeadline,controlRevision:host.binding.controlRevision,
        taskState:application.runtime.getTask(binding.taskId).state})),
        missing:['business_source_adapters','local_decision_and_teacher_tools'].filter(value=>!bindings?.length||value==='business_source_adapters')};
    },
    async start(input,request) {
      if(!input||Object.keys(input).some(key=>!['sourceTaskId','commandId','taskDeadline'].includes(key))
        ||![input.sourceTaskId,input.commandId,input.taskDeadline].every(text))throw Error('持续工作流需要原指令、命令标识和期限');
      const source=application.runtime.getTask(input.sourceTaskId);
      if(!text(source.goal)||!text(source.conversationId)||application.runtime.loadCheckpoint(source.taskId,'private-copy-erasure')
        ||application.runtime.loadCheckpoint(source.taskId,'private-copy-erasure-binding'))throw Error('原用户指令不可用');
      const configured=configuration(),ctx=lifetime({taskDeadline:input.taskDeadline},request);
      const identity={taskId:source.taskId,sessionId:'proactive-'+digest(input.commandId).slice(0,32),controlRevision:0,
        taskDeadline:input.taskDeadline,requestId:'describe-'+digest(input.commandId).slice(0,32),...ctx};
      const description=await createAdapter(configured.adapter).describe(identity);
      const contract=description.contracts.find(value=>value.id===configured.contractRef);
      if(!contract)throw Error('镜像没有发布当前持续工作流契约');
      const task=application.runtime.submitTask({goal:source.goal,conversationId:source.conversationId,
        idempotencyKey:'desktop-proactive-'+digest(input.commandId)});
      const binding={version:1,taskId:task.taskId,sessionId:identity.sessionId,sourceTaskId:source.taskId,
        taskDeadline:input.taskDeadline,contractRef:contract.id,contractVersion:contract.version,imageBinding:imageBinding(configured)};
      application.runtime.saveCheckpointOnce(task.taskId,KEY,binding);
      if(digest(application.runtime.loadCheckpoint(task.taskId,KEY))!==digest(binding))throw Error('原命令已绑定其他参数');
      const session=await bind(task.taskId,ctx);
      session.host.ingestUserInstruction({sourceTaskId:source.taskId},ctx);
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
    async instruction(taskId,sourceTaskId,request) {const session=await bind(taskId,request);
      return session.host.ingestUserInstruction({sourceTaskId},lifetime(session.binding,request));},
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
      const page=application.runtime.listTasks({limit:100,...input});
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
        const page=application.runtime.listTasks({...(resolveUserConversation?{}:{conversationId}),limit:100,
          ...(beforeSequence===undefined?{}:{beforeSequence}),...(snapshotSequence===undefined?{}:{snapshotSequence})});
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
