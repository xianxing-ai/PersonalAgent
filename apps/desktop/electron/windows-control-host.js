import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

const REQUEST_TOOL = 'computer.request_access';
const REQUEST_SCOPE = 'computer:desktop:request';
const VERSION = '1.0.0';
const RUN = /^[A-Za-z0-9_-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;
const controlName = name => /^computer\.desktop\.(?:observe|click|type|scroll|move|shortcut)$/.test(name);
const requestOutput = {type:'object',properties:{state:{const:'presence_confirmed'},expiresAt:{type:'string'},
  authorizationGranted:{const:false}},required:['state','expiresAt','authorizationGranted'],additionalProperties:false};
const fail = (code, message) => {throw new ProtocolError(code, message);};

/** Trusted Desktop lifecycle around the public Windows-MCP provider. Runtime remains
 * the only owner of tasks, authorization, execution records and unknown results. */
export function createDesktopWindowsControlHost({createControlHost, pythonExecutable,
  registerConfirmation, presenceHost, allowObservationExport = false, verifyTarget,
  onUpdate = () => {}, now = Date.now, providerOptions = {}} = {}) {
  let application, closed = false, waiting;
  const lifecycle = new AbortController();
  const leases = new Map();
  let state = {state:'unavailable',available:false,waitingConfirmation:false,
    reason:'Windows-MCP 尚未配置，或当前平台不可用。'};
  const publish = change => {state={...state,...change};onUpdate();};
  function active({signal, deadline}) {
    if(closed || signal?.aborted)fail('CANCELLED','电脑控制请求已取消');
    if(!Number.isFinite(Date.parse(deadline)) || now()>=Date.parse(deadline))fail('TIMEOUT','电脑控制请求已过期');
  }
  function hasPresence(taskId) {
    if(closed || typeof taskId!=='string' || (leases.get(taskId)??0)<=now())return false;
    if(presenceHost && presenceHost.isUserPresent(taskId)!==true)return false;
    if(application?.runtime.getTask){
      try{if(!['pending','running','waiting_approval'].includes(application.runtime.getTask(taskId).state))return false;}catch{return false;}
    }
    return true;
  }
  async function preparePresence(input) {
    active(input);
    if(!state.available || !RUN.test(input.taskId) || (typeof registerConfirmation!=='function' && typeof presenceHost?.requestPresence!=='function'))fail('UNSUPPORTED_CAPABILITY','本机确认快捷键尚不可用');
    if(hasPresence(input.taskId))return;
    if(presenceHost){
      publish({waitingConfirmation:true,state:'waiting_confirmation',taskId:input.taskId,
        reason:'请将本次授权的应用保持在前台，按 F9 确认当前任务；启用模型结果出口时，界面文字将提供给当前对话模型。每次写入仍需原任务授权。'});
      try{
        const pending={...input,signal:AbortSignal.any([input.signal,lifecycle.signal])};
        const receipt=await presenceHost.requestPresence(pending);active(pending);
        if(receipt?.taskId!==input.taskId || !presenceHost.isUserPresent(input.taskId))fail('UNAUTHORIZED','本机确认不属于当前任务');
        const expiresAt=Date.parse(receipt.expiresAt);
        if(!Number.isFinite(expiresAt)||expiresAt<=now())fail('UNAUTHORIZED','本机确认已过期');
        leases.set(input.taskId,Math.min(expiresAt,now()+30000,Date.parse(input.deadline)));
        publish({state:'ready',reason:'已收到当前任务的本机 F9 确认；每次写入仍由原任务授权。'});
      }finally{publish({waitingConfirmation:false});}
      return;
    }
    if(waiting)fail('REVISION_CONFLICT','另一个电脑控制请求正在等待本机确认');
    await new Promise((resolve,reject)=>{
      let timer,unregister,done=false;
      const finish=error=>{
        if(done)return;done=true;clearTimeout(timer);input.signal.removeEventListener('abort',abort);
        unregister?.();waiting=undefined;publish({waitingConfirmation:false});
        error?reject(error):resolve();
      };
      const abort=()=>finish(new ProtocolError('CANCELLED','电脑控制请求已取消'));
      waiting={taskId:input.taskId,cancel:abort};
      input.signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(new ProtocolError('TIMEOUT','本机确认已过期')),Math.min(300000,Math.max(1,Date.parse(input.deadline)-now())));
      try {
        unregister=registerConfirmation(()=>{
          try {
            active(input);
            for(const [key,expiry]of leases)if(expiry<=now())leases.delete(key);
            if(leases.size>=64 && !leases.has(input.taskId))fail('REVISION_CONFLICT','本机确认容量已满');
            leases.set(input.taskId,Math.min(now()+30000,Date.parse(input.deadline)));
            publish({state:'ready',reason:'已收到本机 F9 确认；每次写入仍由原任务授权。'});
            finish();
          }catch(error){finish(error);}
        });
        if(typeof unregister!=='function')fail('UNSUPPORTED_CAPABILITY','本机 F9 注册失败');
        publish({waitingConfirmation:true,state:'waiting_confirmation',taskId:input.taskId,
          reason:allowObservationExport
            ?'请将本次授权的应用保持在前台，按 F9 允许当前任务在30秒内观察和请求操作；窗口与界面文字将提供给当前对话模型。每次写入仍需原任务授权。'
            :'请将本次授权的应用保持在前台，按 F9 允许当前任务在30秒内请求电脑操作；每次写入仍需原任务授权。'});
        if(input.signal.aborted)abort();
      }catch(error){finish(error);}
    });
  }
  const attempts={async record(identity,execution){
    if(!application || !RUN.test(identity.taskId) || !RUN.test(identity.runId)
      || !controlName(identity.toolName) || identity.toolVersion!==VERSION
      || !SHA.test(identity.argumentsDigest) || !SHA.test(identity.observationDigest)
      || typeof identity.authorizationRef!=='string' || !identity.authorizationRef
      || !/^[a-f0-9-]{36}$/.test(identity.targetRef))fail('INVALID_ARGUMENT','电脑操作原始身份无效');
    if(!execution || !execution.arguments || typeof execution.arguments!=='object')fail('UNAUTHORIZED','缺少原始Runtime参数');
    active(execution);
    const task=application.runtime.getTask(identity.taskId);
    const record=application.runtime.readToolExecutions(identity.taskId).find(item=>item.evidenceId===identity.runId);
    if(task.state!=='running' || task.cancelRequested || !hasPresence(identity.taskId)
      || application.runtime.loadCheckpoint(identity.taskId,'application-deadline')!==execution.deadline
      || execution.arguments.targetRef!==identity.targetRef || toolArgumentsDigest(execution.arguments)!==identity.argumentsDigest
      || !record || record.taskId!==identity.taskId || record.toolName!==identity.toolName || record.toolVersion!==identity.toolVersion
      || record.policyDecision!=='allow' || record.executionStarted!==true || record.state!=='started'
      || !application.runtime.matchesToolExecutionInput(record,{arguments:execution.arguments,scopeRef:identity.authorizationRef})) {
      fail('UNAUTHORIZED','电脑操作不匹配原Runtime授权执行');
    }
    const saved={taskId:identity.taskId,runId:identity.runId,toolName:identity.toolName,toolVersion:identity.toolVersion,
      authorizationRef:identity.authorizationRef,argumentsDigest:identity.argumentsDigest,targetRef:identity.targetRef,observationDigest:identity.observationDigest};
    if(!application.runtime.saveCheckpointOnce(identity.taskId,'windows-desktop-attempt:'+identity.runId,saved)) {
      fail('RESULT_UNKNOWN','此原始电脑操作已记录；请在原任务核实，不会重新执行');
    }
  }};
  // providerOptions is an explicit test seam; production supplies only the public factory.
  const provider=typeof createControlHost==='function'?createControlHost({...providerOptions,
    ...(pythonExecutable?{pythonExecutable}:{}), attempts,
    authorizePresence:async({taskId,signal,deadline})=>{
      try{active({signal,deadline});return hasPresence(taskId);}catch{return false;}
    },...(verifyTarget?{verifyTarget}:{})}):undefined;
  const requestTool={descriptor:{name:REQUEST_TOOL,version:VERSION,
    inputSchema:{type:'object',properties:{},required:[],additionalProperties:false},outputSchema:requestOutput,
    sideEffect:'read',requiredScopes:[REQUEST_SCOPE],requiresPresence:false,idempotencySupport:false,recoverySupport:false},
    async execute(input,context){
      validateToolValue(requestTool.descriptor.inputSchema,input);
      if(!context.authorizationRef || !context.scopes.includes(REQUEST_SCOPE))fail('UNAUTHORIZED','需要原任务的请求权限');
      await preparePresence(context);
      return {state:'presence_confirmed',expiresAt:new Date(leases.get(context.taskId)).toISOString(),authorizationGranted:false};
    }};
  const tools=()=>state.available&&!closed?[requestTool,...(provider?.tools??[])]:[];
  return {
    bind(value){
      if(application && application!==value)fail('REVISION_CONFLICT','电脑控制已经绑定Runtime');application=value;
      let beforeSequence;
      do {
        const page=application.runtime.listTasks({states:['waiting_reconciliation'],limit:100,...(beforeSequence===undefined?{}:{beforeSequence})});
        if(page.items.some(task=>application.runtime.readToolExecutions(task.taskId).some(run=>controlName(run.toolName)&&run.executionStarted&&['started','unknown'].includes(run.state)))) {
          provider?.block();publish({state:'blocked',available:false,reason:'原电脑操作结果未知；请先在原任务核实，本次不会重新执行。'});break;
        }
        beforeSequence=page.nextBeforeSequence;
      }while(beforeSequence!==undefined);
    },
    async start(context){
      if(!provider || closed || state.state==='blocked' || (typeof registerConfirmation!=='function' && typeof presenceHost?.requestPresence!=='function'))return state;
      try{
        await provider.start(context);
        publish({state:'ready',available:provider.tools.length>0,reason:'Windows-MCP 已连接；请先请求当前任务的本机 F9 确认。'});
      }catch{publish({state:'unavailable',available:false,reason:'固定版本 Windows-MCP 不可用；未启用电脑控制。'});}
      return state;
    },
    get tools(){return tools();},
    get competitionToolAvailability(){return tools().map(tool=>({toolName:tool.descriptor.name,toolVersion:VERSION,
      available:async context=>!closed&&state.available&&provider?.health().state==='ready'
        && !context.signal?.aborted && now()<Date.parse(context.deadline)
        && (tool.descriptor.name===REQUEST_TOOL || allowObservationExport)}));},
    get competitionToolExports(){return tools().filter(tool=>tool.descriptor.name===REQUEST_TOOL||allowObservationExport).map(tool=>({
      toolName:tool.descriptor.name,toolVersion:VERSION,exportPolicyVersion:'windows-desktop-observed-v1',
      accepts:({taskId,signal})=>!closed&&!signal?.aborted&&state.available
        && (tool.descriptor.name===REQUEST_TOOL||hasPresence(taskId)),
      project:({taskId,result,signal})=>{
        if(closed||signal.aborted||!state.available||(tool.descriptor.name!==REQUEST_TOOL&&!hasPresence(taskId)))fail('UNAUTHORIZED','本机观察结果出口许可已过期');
        validateToolValue(tool.descriptor.outputSchema,result);
        return structuredClone(result);
      }}));},
    preparePresence,hasPresence,
    invalidatePresence(taskId){leases.delete(taskId);if(waiting?.taskId===taskId)waiting.cancel();},
    snapshot:()=>{
      const health=provider?.health()??{state:'unavailable'};
      const providerAvailable=state.available&&health.state==='ready'&&!closed;
      return {...state,provider:health,providerAvailable,available:providerAvailable&&allowObservationExport,
        observationExportAllowed:allowObservationExport,
        ...(providerAvailable&&!allowObservationExport?{state:'observation_export_disabled',unavailableReason:'observation_export_not_authorized',
          reason:'Windows-MCP 已连接，但尚未明确允许当前对话模型接收界面文字，电脑观察与操作工具不可用。'}:{}),
        ...(health.state==='blocked'?{state:'blocked',unavailableReason:'original_result_unknown',reason:'原电脑操作结果未知；请先在原任务核实，不会重新执行。'}:{}),
        presenceTasks:[...leases].filter(([taskId])=>hasPresence(taskId)).map(([taskId,expiry])=>({taskId,expiresAt:new Date(expiry).toISOString()}))};
    },
    async close(){closed=true;lifecycle.abort();waiting?.cancel();leases.clear();publish({state:'disposed',available:false});await provider?.dispose();},
  };
}
