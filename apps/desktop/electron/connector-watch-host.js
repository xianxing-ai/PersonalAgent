import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {completeRuntimeConnectorWatchWake} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const VERSION='1.0.0',PREFIX='connector.watch.',READ_ORIGIN='desktop-connector-watch-origin';
const SETTINGS_ORIGIN='desktop-connector-watch-settings';
export const MAIL_WATCH_INTERVAL_MS=120_000,MAIL_WATCH_DURATION_MS=8*60*60_000;
const fail=code=>{throw new ProtocolError(code,'连接器持续订阅不可用');};
const object=properties=>({type:'object',additionalProperties:false,properties});
const query={...object({location:{type:'string',minLength:1,maxLength:200},locationQuery:{type:'string',minLength:1,maxLength:200},
  units:{type:'string',enum:['metric','imperial']}}),required:['location']};
const schemas={start:{...object({source:{type:'string',enum:['mail','weather']},query,
  intervalMs:{type:'integer',minimum:1000,maximum:2147483647},expiresAt:{type:'string',minLength:1}}),
  description:'启动连接器变化监测。intervalMs 可省略，默认每2分钟；expiresAt 可省略，默认本次8小时，由宿主计算，无需让用户手填毫秒或日期。邮件只读信头，新邮件或显著天气变化交由本地主对话 Laya 判断是否提醒用户；不会自动执行邮件或日历写入。天气必须提供用户指定地点 query.location。',
  required:['source']},list:{...object({}),description:'列出当前主对话已批准的连接器订阅及状态。'},
  stop:{...object({watchId:{type:'string',minLength:1,maxLength:100}}),description:'停止当前主对话指定的持续订阅并撤销未执行读取许可。',required:['watchId']}};

/** Original Scheduler wakes and exact confirmed approval bind each single-use
 * ToolGateway read. This adapter owns neither timer nor provider client. */
export function createDesktopConnectorWatchHost({getApplication,namespace,readSourceAuthorization,resolveUserConversation,
  isUserConversation=()=>false,question,startMailRead,readMailStatus,stopMailRead,observeTask,onUpdate=()=>{},now=Date.now}) {
  if(typeof getApplication!=='function'||typeof namespace!=='string'||!namespace
    ||typeof readSourceAuthorization!=='function'||typeof resolveUserConversation!=='function')fail('INVALID_ARGUMENT');
  let active,closed=false,lastError;
  const settingsRequests=new Map();
  const application=()=>{const value=getApplication();if(!value?.runtime)fail('UNSUPPORTED_CAPABILITY');return value;};
  const storage=()=>createRuntimeAtomicStatePort(application().runtime,'desktop-connector-watches');
  function read(){const saved=storage().read(namespace)??{revision:undefined,value:{version:1,watches:{}}};
    if(saved.value.version!==1||!saved.value.watches)fail('REVISION_CONFLICT');return saved;}
  function update(change){const saved=read(),value=structuredClone(saved.value);change(value);
    if(!storage().compareAndSet(namespace,saved.revision,value))fail('REVISION_CONFLICT');try{onUpdate();}catch{}}
  function source(kind,configurationRef){const current=readSourceAuthorization(kind);
    if(current?.available!==true||typeof current.configurationRef!=='string'||!current.configurationRef
      ||configurationRef!==undefined&&current.configurationRef!==configurationRef)fail('UNAUTHORIZED');return current;}
  function conversation(taskId){
    const ordinary=resolveUserConversation(taskId);if(ordinary)return ordinary;
    const runtime=application().runtime,binding=runtime.loadCheckpoint(taskId,SETTINGS_ORIGIN),
      intent=runtime.loadCheckpoint(taskId,'host-tool-intent');
    if(!binding||!isUserConversation(binding.conversationId)||!intent||intent.namespace!==namespace
      ||intent.commandId!==binding.commandId||intent.toolName!==PREFIX+binding.operation
      ||intent.argumentsDigest!==binding.argumentsDigest||toolArgumentsDigest(intent.arguments)!==binding.argumentsDigest
      ||runtime.getTask(taskId).conversationId!=='host-tool:'+namespace)return undefined;
    return binding.conversationId;
  }
  function scope(context){const app=application(),task=app.runtime.getTask(context.taskId);
    const owner=conversation(task.taskId),settings=settingsRequests.get(task.taskId);
    if(closed||!owner||settings&&!settings.isCurrent()||task.state!=='running'||task.cancelRequested||context.signal?.aborted||!context.authorizationRef
      ||!context.scopes?.includes('connectors:watch')||!(Date.parse(context.deadline)>now()))fail('UNAUTHORIZED');
    return {app,task,conversationId:owner};}
  const summary=watch=>({watchId:watch.id,source:watch.source,enabled:watch.enabled,mode:'poll-only',
    intervalMs:watch.input.intervalMs,expiresAt:watch.input.expiresAt,state:watch.state,
    nextCheckAt:watch.dueAt,...(watch.lastCheckedAt?{lastCheckedAt:watch.lastCheckedAt}:{}),
    ...(watch.errorCode?{errorCode:watch.errorCode}:{}),...(watch.pending?.taskId?{readTaskId:watch.pending.taskId}:{})});
  const scheduleConversation=watch=>'connector-watch:'+namespace+':'+watch.id;
  const commandId=watch=>'connector-watch-'+hash([watch.id,watch.sequence,'read']);
  function current(watch){
    if(closed)fail('UNAUTHORIZED');
    const app=application(),saved=read().value.watches[watch.id],task=app.runtime.getTask(watch.origin.taskId);
    source(watch.source,watch.configurationRef);
    if(!saved?.enabled||!same(saved.input,watch.input)||!same(saved.origin,watch.origin)
      ||hash(task.goal)!==watch.origin.goalDigest||task.cancelRequested||['failed','cancelled','cancelling'].includes(task.state)
      ||conversation(task.taskId)!==watch.conversationId||!(Date.parse(watch.input.expiresAt)>now())
      ||['private-copy-erasure','private-copy-erasure-binding'].some(key=>app.runtime.loadCheckpoint(task.taskId,key)!==undefined))fail('UNAUTHORIZED');
    const record=app.runtime.readToolExecutions(task.taskId).find(item=>item.evidenceId===watch.origin.runId);
    const result=app.runtime.loadCheckpoint(task.taskId,'tool-result-'+watch.origin.runId)?.result;
    if(record?.toolName!==PREFIX+'start'||record.toolVersion!==VERSION||record.state!=='confirmed'
      ||!Object.entries(watch.approvedInput??watch.input).every(([key,value])=>same(watch.input[key],value))
      ||record.policyDecision!=='allow'||record.executionStarted!==true||result?.watchId!==watch.id
      ||result.intervalMs!==watch.input.intervalMs||result.expiresAt!==watch.input.expiresAt
      ||!app.runtime.readEvidence(task.taskId).some(item=>item.evidenceId===watch.origin.runId&&item.kind==='execution'&&item.sourceRef===PREFIX+'start')
      ||!app.runtime.matchesToolExecutionInput(record,{arguments:watch.approvedInput??watch.input,scopeRef:watch.origin.authorizationRef}))fail('RESULT_UNKNOWN');
    return app;
  }
  async function retire(watch,state,code){
    update(value=>{const saved=value.watches[watch.id];saved.enabled=false;saved.state=state;if(code)saved.errorCode=code;});
    const app=application();app.runtime.reconcileSchedules(scheduleConversation(watch),[]);
    if(watch.pending?.taskId){app.runtime.policy.revoke('host-tool-'+watch.pending.taskId);
      const task=app.runtime.getTask(watch.pending.taskId);
      if(!['succeeded','failed','cancelled'].includes(task.state))app.runtime.requestCancel(task.taskId,'Connector watch stopped');}
    if(watch.pending?.kind==='mail'&&watch.pending.sessionId)
      await stopMailRead?.({watchId:watch.id,sessionId:watch.pending.sessionId});
  }
  function schedule(watch){
    const app=current(watch),id='connector-watch-'+hash([watch.id,watch.sequence]);
    app.runtime.createSchedule({scheduleId:id,conversationId:scheduleConversation(watch),goal:'唤醒已批准的连接器订阅',
      runAt:watch.dueAt,timeZone:'UTC',missedRunPolicy:'run_once',taskIdempotencyKey:id});return app.runtime.getSchedule(id);
  }
  function advance(watch){current(watch);update(value=>{const item=value.watches[watch.id];delete item.pending;delete item.errorCode;item.sequence++;
    item.lastCheckedAt=new Date(now()).toISOString();item.dueAt=new Date(now()+item.input.intervalMs).toISOString();item.state='monitoring';});}
  const binding=watch=>({version:1,source:'weather',watchId:watch.id,namespace,sequence:watch.sequence,origin:watch.origin,
    configurationRef:watch.configurationRef,queryDigest:toolArgumentsDigest(watch.input.query),readTool:watch.readTool});
  function bindRead(watch,task){const runtime=application().runtime,saved=runtime.loadCheckpoint(task.taskId,READ_ORIGIN),value=binding(watch);
    if(saved===undefined){if(!runtime.saveCheckpointOnceForCreatedTask(task.taskId,READ_ORIGIN,value,task.revision))fail('RESULT_UNKNOWN');}
    else if(!same(saved,value))fail('RESULT_UNKNOWN');}
  function finalizeRead(watch,task){
    const app=current(watch),runtime=app.runtime,preparation=runtime.loadCheckpoint(task.taskId,'host-tool-preparation');
    const descriptor=app.tools.list().find(tool=>tool.name===watch.readTool.name&&tool.version===watch.readTool.version);
    if(!descriptor||descriptor.sideEffect!=='read'||descriptor.requiresPresence
      ||task.conversationId!=='host-tool:'+namespace||preparation?.namespace!==namespace||preparation.commandId!==commandId(watch)
      ||preparation.toolName!==watch.readTool.name||preparation.toolVersion!==watch.readTool.version)fail('RESULT_UNKNOWN');
    validateToolValue(descriptor.inputSchema,watch.input.query);bindRead(watch,task);
    const intent=runtime.loadCheckpoint(task.taskId,'host-tool-intent');
    if(intent!==undefined){
      if(!same(intent,{...preparation,arguments:watch.input.query,argumentsDigest:toolArgumentsDigest(watch.input.query)}))fail('RESULT_UNKNOWN');
      if(task.state==='created'||task.state==='waiting_approval')app.finalizeHostToolTask({taskId:task.taskId,commandId:commandId(watch),
        expectedTaskRevision:task.revision,arguments:watch.input.query});
      return;
    }
    // Resume only a still-created task with no frozen intent or execution.
    if(task.state!=='created'||runtime.readToolExecutions(task.taskId).length||!(Date.parse(preparation.deadline)>now()))fail('RESULT_UNKNOWN');
    const authorizationRef='host-tool-'+task.taskId,argsDigest=toolArgumentsDigest(watch.input.query),grant=runtime.policy.get(authorizationRef);
    if(grant){if(grant.taskId!==task.taskId||grant.toolName!==descriptor.name||grant.argumentsDigest!==argsDigest
      ||grant.expiresAt!==preparation.deadline||grant.usesRemaining!==1||!same(grant.scopes,descriptor.requiredScopes))fail('UNAUTHORIZED');}
    else runtime.policy.grant({authorizationRef,taskId:task.taskId,toolName:descriptor.name,
      scopes:descriptor.requiredScopes,maxUses:1,argumentsDigest:argsDigest,expiresAt:preparation.deadline});
    app.finalizeHostToolTask({taskId:task.taskId,commandId:commandId(watch),expectedTaskRevision:task.revision,arguments:watch.input.query});
  }
  async function resumePending(watch){
    const app=current(watch);
    if(watch.pending.kind==='mail'){
      // Live-process tokens never restore a historical local mail session lease.
      if(!watch.pending.sessionId){await retire(watch,'needs_reauthorization','RESULT_UNKNOWN');return;}
      const status=readMailStatus?.({watchId:watch.id,sessionId:watch.pending.sessionId});
      if(status?.sessionId!==watch.pending.sessionId){await retire(watch,'needs_reauthorization','UNAUTHORIZED');return;}
      if(status.state==='complete')advance(watch);
      else if(['failed','cancelled','disabled','resync_required','unavailable','classification_unavailable'].includes(status.state))
        await retire(watch,status.state,status.errorCode??(status.state==='failed'?'EXTERNAL_FAILURE':'UNAVAILABLE'));
      else if(['waiting_reconciliation','waiting_approval','stop_unconfirmed'].includes(status.state))
        update(value=>{value.watches[watch.id].state=status.state;});
      return;
    }
    const task=app.runtime.getTask(watch.pending.taskId);finalizeRead(watch,task);
    const readback=app.readHostToolTask(task.taskId);
    if(readback.confirmed){current(watch);await observeTask?.(task.taskId);advance(watch);}
    else if(['failed','cancelled','waiting_reconciliation','waiting_approval'].includes(readback.task.state))
      update(value=>{value.watches[watch.id].state=readback.task.state;});
  }
  async function tickOne(watch){
    const app=current(watch),runtime=app.runtime;
    if(watch.pending){
      await resumePending(watch);
      // A crash after pending persistence may precede completion of the Scheduler
      // wake itself. Settle that same wake; never submit a replacement task.
      if(read().value.watches[watch.id]?.enabled){
        const wake=runtime.getSchedule('connector-watch-'+hash([watch.id,watch.sequence]));
        if(wake.status==='fired'&&wake.taskId)
          await completeRuntimeConnectorWatchWake({application:app,scheduleId:wake.scheduleId,deadline:watch.input.expiresAt});
      }
      return;
    }
    let wake=schedule(watch);
    if(wake.status==='pending'&&Date.parse(wake.runAt)>now())return;
    runtime.recoverMissedSchedules(scheduleConversation(watch));runtime.dispatchDueSchedules(scheduleConversation(watch));
    wake=runtime.getSchedule(wake.scheduleId);if(wake.status!=='fired'||!wake.taskId)return;
    if(watch.source==='mail'){
      current(watch);if(!startMailRead||!readMailStatus||!stopMailRead)fail('UNSUPPORTED_CAPABILITY');
      update(value=>{value.watches[watch.id].pending={kind:'mail',commandId:commandId(watch)};value.watches[watch.id].state='reading';});
      // Keep the exact approved watch input, but Core request deadlines require
      // canonical UTC milliseconds. Date.parse's instant is unchanged (never extended).
      const started=await startMailRead({watchId:watch.id,commandId:commandId(watch),
        expiresAt:new Date(Date.parse(watch.input.expiresAt)).toISOString()});
      if(!started){update(value=>{delete value.watches[watch.id].pending;value.watches[watch.id].state='waiting_source';});return;}
      if(typeof started.sessionId!=='string'||!started.sessionId)fail('RESULT_UNKNOWN');
      try{current(watch);update(value=>{value.watches[watch.id].pending.sessionId=started.sessionId;});}
      catch(error){await stopMailRead({watchId:watch.id,sessionId:started.sessionId});throw error;}
    }else{
      const id=commandId(watch);
      let task=runtime.findTaskByIdempotencyKey('host-tool:'+JSON.stringify([namespace,id]));
      if(!task)task=app.prepareHostToolTask({commandId:id,toolName:watch.readTool.name,toolVersion:watch.readTool.version,
        deadline:new Date(Math.min(Date.parse(watch.input.expiresAt),now()+60_000)).toISOString()});
      update(value=>{value.watches[watch.id].pending={kind:'weather',taskId:task.taskId};value.watches[watch.id].state='reading';});
      finalizeRead(watch,task);
    }
    await completeRuntimeConnectorWatchWake({application:app,
      scheduleId:wake.scheduleId,deadline:watch.input.expiresAt});
  }
  const tools=Object.entries(schemas).map(([operation,inputSchema])=>({descriptor:{name:PREFIX+operation,version:VERSION,
    inputSchema,outputSchema:{type:'object'},sideEffect:operation==='list'?'read':'local_write',requiredScopes:['connectors:watch'],
    requiresPresence:false,idempotencySupport:true,recoverySupport:false},
    async execute(input,context){
      const {app,task,conversationId}=scope(context);validateToolValue(inputSchema,input);
      if(operation==='list')return {watches:Object.values(read().value.watches).filter(watch=>watch.conversationId===conversationId).map(summary)};
      if(operation==='stop'){
        const watch=read().value.watches[input.watchId];if(!watch||watch.conversationId!==conversationId)fail('SCOPE_DENIED');
        await retire(watch,'stopped');return {watchId:watch.id,enabled:false};
      }
      if(!context.runId||(input.source==='weather')!==Boolean(input.query))fail('INVALID_ARGUMENT');
      const selected=source(input.source),id='watch-'+hash([context.taskId,context.runId]);let readTool;
      const previous=read().value.watches[id];
      const effective=previous?.input??{...input,intervalMs:input.intervalMs??MAIL_WATCH_INTERVAL_MS,
        expiresAt:input.expiresAt??new Date(now()+MAIL_WATCH_DURATION_MS).toISOString()};
      if(!(Date.parse(effective.expiresAt)>now()))fail('INVALID_ARGUMENT');
      if(input.source==='weather'){
        const descriptor=app.tools.list().find(tool=>tool.name==='weather.forecast');
        if(!descriptor||descriptor.sideEffect!=='read'||descriptor.requiresPresence)fail('UNSUPPORTED_CAPABILITY');validateToolValue(descriptor.inputSchema,input.query);
        readTool={name:descriptor.name,version:descriptor.version};
      }
      update(value=>{const previous=value.watches[id];
        if(previous&&!same(previous.approvedInput??previous.input,input))fail('REVISION_CONFLICT');
        if(input.source==='mail'&&Object.values(value.watches).some(item=>item.id!==id&&item.source==='mail'&&item.enabled))fail('REVISION_CONFLICT');
        value.watches[id]??={id,source:input.source,input:structuredClone(effective),approvedInput:structuredClone(input),conversationId,configurationRef:selected.configurationRef,
          origin:{taskId:context.taskId,runId:context.runId,goalDigest:hash(task.goal),authorizationRef:context.authorizationRef},
          ...(readTool?{readTool}:{}),enabled:true,state:'waiting_origin',sequence:0,dueAt:new Date(now()).toISOString()};});
      return summary(read().value.watches[id]);
    }}));
  return {tools,
    prepareAuthorization(context){
      const request=settingsRequests.get(context.taskId);
      if(!question||!request||context.toolName!==PREFIX+request.operation)return;
      question.prepare(context,{assertCurrent:()=>!closed&&request.isCurrent()});
    },
    /** Trusted settings click -> original Runtime task/Policy, never a direct tool execute. */
    requestFromSettings(operation,{conversationId,isCurrent=()=>true}={}) {
      if(closed||!['start','stop'].includes(operation)||!isUserConversation(conversationId)||!isCurrent())fail('UNAUTHORIZED');
      const app=application();
      // A newer settings intent supersedes only this host's opposite pending
      // settings requests. Preserve unknown writes and all ordinary user tasks.
      for(const [taskId,request]of settingsRequests)if(request.operation!==operation){
        const task=app.runtime.getTask(taskId);
        if(!['succeeded','failed','cancelled','waiting_reconciliation'].includes(task.state))
          app.runtime.requestCancel(taskId,'用户更改邮件监测设置');
      }
      const watches=Object.values(read().value.watches);
      // Settings control the one mail watch across main-conversation switches.
      // A locally retired watch can still have an unknown original Stop.
      const existing=watches.find(watch=>watch.source==='mail'&&watch.enabled)
        ??(operation==='stop'?watches.findLast(watch=>watch.source==='mail'):undefined);
      for(const [taskId,request]of settingsRequests){
        if(request.operation!==operation||(operation==='stop'
          ?request.watchId!==existing?.id:request.conversationId!==conversationId))continue;
        const result=app.readHostToolTask(taskId);
        if(!['succeeded','failed','cancelled'].includes(result.task.state))return {taskId,state:result.task.state};
      }
      if(operation==='stop'&&!existing?.enabled)return {state:'stopped',enabled:false};
      if(existing){
        if(operation==='start')try{current(existing);return summary(existing);}catch(error){
          // tick must retire stale authorization before a replacement is admitted.
          throw error;
        }
      }
      if(operation==='stop')conversationId=existing.conversationId;
      const input=operation==='start'?{source:'mail',intervalMs:MAIL_WATCH_INTERVAL_MS,
        expiresAt:new Date(now()+MAIL_WATCH_DURATION_MS).toISOString()}:{watchId:existing.id};
      const commandId='mail-monitor-'+randomUUID(),task=app.prepareHostToolTask({commandId,
        toolName:PREFIX+operation,toolVersion:VERSION,deadline:new Date(now()+5*60_000).toISOString()});
      app.runtime.saveCheckpointOnceForCreatedTask(task.taskId,SETTINGS_ORIGIN,
        {conversationId,commandId,operation,argumentsDigest:toolArgumentsDigest(input)},task.revision);
      settingsRequests.set(task.taskId,{conversationId,operation,isCurrent,...(operation==='stop'?{watchId:existing.id}:{})});
      const result=app.finalizeHostToolTask({taskId:task.taskId,commandId,expectedTaskRevision:task.revision,arguments:input});
      return {taskId:task.taskId,state:result.task.state};
    },
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:VERSION,
      publicEnumPaths:['/source','/query/units'],available:({taskId})=>{try{return Boolean(!closed&&resolveUserConversation(taskId));}catch{return false;}}})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:VERSION,exportPolicyVersion:'connector-watch-summary-v1',
      accepts:()=>!closed,project:({result})=>{if(closed)fail('UNAUTHORIZED');return structuredClone(result);}})),
    /** Attach the actual pre-existing native mail page, never fabricate its read lease. */
    bindMailRead(taskId,{watchId,sessionId}){
      const watch=read().value.watches[watchId],app=watch&&current(watch),runtime=app?.runtime;
      if(!runtime||watch.source!=='mail'||watch.pending?.kind!=='mail'||typeof sessionId!=='string'||!sessionId
        ||watch.pending.sessionId&&watch.pending.sessionId!==sessionId
        ||readMailStatus?.({watchId,sessionId})?.sessionId!==sessionId)fail('UNAUTHORIZED');
      const task=runtime.getTask(taskId),intent=runtime.loadCheckpoint(taskId,'host-tool-intent'),lease=runtime.loadCheckpoint(taskId,'mail-read-session');
      if(task.conversationId!=='host-tool:'+namespace||typeof lease!=='string'||!lease||intent?.namespace!==namespace
        ||intent.toolName!=='mail.inbox'||intent.arguments?.folder!=='INBOX'
        ||intent.argumentsDigest!==toolArgumentsDigest(intent.arguments)
        ||!(Date.parse(intent.deadline)<=Date.parse(watch.input.expiresAt)))fail('UNAUTHORIZED');
      const value={version:1,source:'mail',watchId,namespace,sequence:watch.sequence,origin:watch.origin,
        configurationRef:watch.configurationRef,readTool:{name:intent.toolName,version:intent.toolVersion},
        argumentsDigest:intent.argumentsDigest,commandId:intent.commandId,mailLease:lease};
      const saved=runtime.loadCheckpoint(taskId,READ_ORIGIN);
      if(saved!==undefined&&!same(saved,value))fail('REVISION_CONFLICT');
      runtime.saveCheckpointOnce(taskId,READ_ORIGIN,value);
    },
    /** Main-only lookup; origin/configuration never enter model tool output. */
    readOrigin(taskId){try{
      const runtime=application().runtime,saved=runtime.loadCheckpoint(taskId,READ_ORIGIN),watch=read().value.watches[saved?.watchId];
      if(!watch||saved.namespace!==namespace||!Number.isSafeInteger(saved.sequence)||saved.sequence<0||saved.sequence>watch.sequence||!same(saved.origin,watch.origin)
        ||saved.configurationRef!==watch.configurationRef||saved.source!==watch.source)return undefined;
      current(watch);
      if(watch.source==='weather'){
        const preparation=runtime.loadCheckpoint(taskId,'host-tool-preparation');
        if(saved.queryDigest!==toolArgumentsDigest(watch.input.query)||!same(saved.readTool,watch.readTool)
          ||preparation?.namespace!==namespace||preparation.toolName!==watch.readTool.name||preparation.toolVersion!==watch.readTool.version
          ||preparation.commandId!=='connector-watch-'+hash([watch.id,saved.sequence,'read']))return undefined;
      }else{
        const intent=runtime.loadCheckpoint(taskId,'host-tool-intent');
        if(runtime.loadCheckpoint(taskId,'mail-read-session')!==saved.mailLease||intent?.namespace!==namespace
          ||intent.toolName!=='mail.inbox'||intent.toolVersion!==saved.readTool.version||intent.commandId!==saved.commandId
          ||intent.argumentsDigest!==saved.argumentsDigest||toolArgumentsDigest(intent.arguments)!==saved.argumentsDigest)return undefined;
      }
      return {taskId:watch.origin.taskId,runId:watch.origin.runId,watchId:watch.id,conversationId:watch.conversationId,
        configurationRef:watch.configurationRef,expiresAt:watch.input.expiresAt,source:watch.source};
    }catch{return undefined;}},
    resolveUserConversation(taskId){try{return conversation(taskId)??this.readOrigin(taskId)?.conversationId;}catch{return undefined;}},
    tick(){if(active)return active;if(closed)return Promise.resolve();active=(async()=>{for(const watch of Object.values(read().value.watches)){
      if(closed)break;if(!watch.enabled)continue;
      try{await tickOne(watch);}catch(error){const code=error instanceof ProtocolError?error.code:'UNAVAILABLE';lastError=code;
        if(code==='UNAUTHORIZED')await retire(watch,Date.parse(watch.input.expiresAt)<=now()?'expired':'revoked',code);
        else update(value=>{value.watches[watch.id].errorCode=code;});}
    }})().finally(()=>{active=undefined;});return active;},
    snapshot(){return {available:!closed,watches:Object.values(read().value.watches).map(summary),...(lastError?{errorCode:lastError}:{})};},
    async close(){closed=true;await active;},
  };
}
