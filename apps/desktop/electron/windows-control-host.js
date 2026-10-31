import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {computerControlFailure} from './computer-control-errors.js';

const REQUEST_TOOL = 'computer.request_access';
const REQUEST_SCOPE = 'computer:desktop:request';
const VERSION = '1.0.0';
const RUN = /^[A-Za-z0-9_-]{1,128}$/;
const runRef=value=>typeof value==='string'&&RUN.test(value);
const SHA = /^[a-f0-9]{64}$/;
const controlName = name => /^computer\.desktop\.[a-z_]+$/.test(name);
const requestOutput = {type:'object',properties:{state:{enum:['presence_confirmed','policy_allowed']},expiresAt:{type:'string'},
  authorizationGranted:{const:false}},required:['state','expiresAt','authorizationGranted'],additionalProperties:false};
const fail = (code, message) => {throw new ProtocolError(code, message);};

/** Trusted Desktop lifecycle around the public native/compatibility provider. Runtime remains
 * the only owner of tasks, authorization, execution records and unknown results. */
export function createDesktopWindowsControlHost({createControlHost, pythonExecutable,
  registerConfirmation, presenceHost, allowObservationExport = false, isFullAccess = () => false, verifyTarget,
  onUpdate = () => {}, now = Date.now, providerOptions = {},readObservationExportPreference,readPolicyBinding,readTaskBinding} = {}) {
  let application, closed = false, waiting,enabled=true;
  // Opaque navigation anchors only. Runtime records/checkpoints remain the source of truth.
  let recovery,lastAttempt,lastRecoveryScan;
  let exportChoice=allowObservationExport;
  const lifecycle = new AbortController();
  const leases = new Map();
  const leaseSources = new Map();
  // Process-local renewal eligibility is rooted in a successful original request_access run.
  // It is not a Policy grant, target extension or permission for a new task.
  const policyPresenceSeeds = new Map();
  const fullAccess=()=>{try{return typeof isFullAccess==='function'&&isFullAccess()===true;}catch{return false;}};
  const observationExportAllowed=()=>{
    let choice;try{choice=readObservationExportPreference?.();}catch{return false;}
    return enabled&&(choice===false?false:choice===true||exportChoice===true||fullAccess());
  };
  let state = {state:'unavailable',available:false,waitingConfirmation:false,
    reason:'电脑组件尚未准备，或当前设备不可用。'};
  const publish = change => {state={...state,...change};onUpdate();};
  function active({signal, deadline}) {
    if(closed || signal?.aborted)fail('CANCELLED','电脑控制请求已取消');
    if(!Number.isFinite(Date.parse(deadline)) || now()>=Date.parse(deadline))fail('TIMEOUT','电脑控制请求已过期');
  }
  const policyBinding=()=>{try{const value=readPolicyBinding?.();return typeof value==='string'&&value.length>0&&value.length<=2048?value:undefined;}catch{return;}};
  const taskBinding=taskId=>{
    try {
      const value=typeof readTaskBinding==='function'?readTaskBinding(taskId)
        :typeof application?.readToolConversation==='function'?application.readToolConversation(taskId)
          :application?.runtime.getTask(taskId).conversationId;
      return typeof value==='string'&&value.length>0?value:undefined;
    }catch{return;}
  };
  function revokePolicyPresence(taskId){policyPresenceSeeds.delete(taskId);leases.delete(taskId);leaseSources.delete(taskId);}
  function policySeed(context) {
    if(!application?.runtime||!fullAccess()||!runRef(context.taskId)||!runRef(context.runId)
      ||!context.authorizationRef||!context.scopes?.includes(REQUEST_SCOPE))return;
    const binding=policyBinding(),conversation=taskBinding(context.taskId);if(!binding||!conversation)return;
    const runtime=application.runtime,task=runtime.getTask(context.taskId);
    const run=runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId);
    if(task.taskId!==context.taskId||task.state!=='running'||task.cancelRequested
      ||runtime.loadCheckpoint(context.taskId,'application-deadline')!==context.deadline
      ||run?.taskId!==context.taskId||run.toolName!==REQUEST_TOOL||run.toolVersion!==VERSION
      ||run.policyDecision!=='allow'||run.executionStarted!==true||!['started','confirmed'].includes(run.state)
      ||!SHA.test(run.inputDigest)||!runtime.matchesToolExecutionInput(run,{arguments:{},scopeRef:context.authorizationRef}))return;
    return {taskId:context.taskId,requestRunId:context.runId,authorizationRef:context.authorizationRef,
      inputDigest:run.inputDigest,deadline:context.deadline,policyBinding:binding,conversationBinding:conversation};
  }
  function assertPolicySeed(seed,context,confirmed=true) {
    active(context);
    if(!seed||context.taskId!==seed.taskId||context.deadline!==seed.deadline||!fullAccess()
      ||policyBinding()!==seed.policyBinding||taskBinding(seed.taskId)!==seed.conversationBinding
      ||leaseSources.get(seed.taskId)!=='full-access-policy'||!state.available||state.state==='blocked'
      ||provider?.health().state!=='ready')fail('UNAUTHORIZED','本次完全访问续期不匹配原任务、会话或策略版本');
    const runtime=application.runtime,task=runtime.getTask(seed.taskId);
    const run=runtime.readToolExecutions(seed.taskId).find(item=>item.evidenceId===seed.requestRunId);
    if(task.taskId!==seed.taskId||task.state!=='running'||task.cancelRequested
      ||runtime.loadCheckpoint(seed.taskId,'application-deadline')!==seed.deadline
      ||run?.taskId!==seed.taskId||run.toolName!==REQUEST_TOOL||run.toolVersion!==VERSION
      ||run.inputDigest!==seed.inputDigest||run.policyDecision!=='allow'||run.executionStarted!==true
      ||!(run.state==='confirmed'||!confirmed&&run.state==='started')
      ||!runtime.matchesToolExecutionInput(run,{arguments:{},scopeRef:seed.authorizationRef}))
      fail('UNAUTHORIZED','原电脑访问请求尚未确认或已经失效');
  }
  async function refreshPolicyPresence(context) {
    const seed=policyPresenceSeeds.get(context?.taskId);
    try {
      assertPolicySeed(seed,context);
      let expiresAt=Math.min(now()+30000,Date.parse(seed.deadline));
      if(presenceHost) {
        // requestPresence issues a fresh policy receipt; preparePresence may return the old near-expiry lease.
        const receipt=await presenceHost.requestPresence({...context,signal:AbortSignal.any([context.signal,lifecycle.signal])});
        assertPolicySeed(seed,context);
        const expiry=Date.parse(receipt?.expiresAt);
        if(receipt?.taskId!==seed.taskId||receipt.source!=='full-access-policy'||!Number.isFinite(expiry)||expiry<=now()
          ||presenceHost.isUserPresent(seed.taskId)!==true)fail('UNAUTHORIZED','新的本机策略回执未获确认');
        expiresAt=Math.min(expiresAt,expiry);
      }
      assertPolicySeed(seed,context);
      leases.set(seed.taskId,expiresAt);leaseSources.set(seed.taskId,'full-access-policy');
      publish({state:'ready',waitingConfirmation:false,reason:'当前完全访问策略已核对原任务；每个工具仍需原参数授权与目标校验。'});
      return {taskId:seed.taskId,source:'full-access-policy',expiresAt:new Date(expiresAt).toISOString()};
    }catch(error){if(context?.taskId&&(seed||leaseSources.get(context.taskId)==='full-access-policy'))revokePolicyPresence(context.taskId);throw error;}
  }
  async function prepareToolPresence(context) {
    active(context);
    // Only an original confirmed request_access can renew policy presence. A valid
    // browser/F9 receipt needs no renewal and must not be rejected for lacking that seed.
    if(policyPresenceSeeds.has(context.taskId))return refreshPolicyPresence(context);
    const task=application?.runtime.getTask(context.taskId);
    if(!task||task.state!=='running'||task.cancelRequested
      ||application.runtime.loadCheckpoint(context.taskId,'application-deadline')!==context.deadline
      ||!state.available||provider?.health().state!=='ready'||!hasPresence(context.taskId))
      fail('UNAUTHORIZED','本机访问凭证缺失或已过期，请先调用 computer.request_access 并按当前任务完成本机确认');
    return {taskId:context.taskId,source:leaseSources.get(context.taskId),expiresAt:new Date(leases.get(context.taskId)).toISOString()};
  }
  function recoveryFromRun(task,run,includeStarted=false) {
    if(!task||!runRef(task.taskId)||!run||run.taskId!==task.taskId||!runRef(run.evidenceId)
      ||!controlName(run.toolName)||run.toolName==='computer.desktop.suggest_control'||run.toolVersion!==VERSION||run.policyDecision!=='allow'||run.executionStarted!==true
      ||!SHA.test(run.inputDigest)
      ||!(run.state==='unknown'||run.state==='started'&&(includeStarted||task.state==='waiting_reconciliation')))return;
    return {taskId:task.taskId,runId:run.evidenceId,inputDigest:run.inputDigest};
  }
  function readRecovery(reference,includeStarted) {
    if(!reference||!application?.runtime)return;
    try {
      const task=application.runtime.getTask(reference.taskId);
      const run=application.runtime.readToolExecutions(reference.taskId).find(item=>item.evidenceId===reference.runId);
      if(run?.inputDigest!==reference.inputDigest)return;
      return recoveryFromRun(task,run,includeStarted);
    }catch{return;}
  }
  function scanRecovery(includeStarted=false,force=false) {
    const runtime=application?.runtime;if(!runtime)return;
    let beforeSequence,scanKey;
    do {
      const page=runtime.listTasks({limit:100,...(beforeSequence===undefined?{}:{beforeSequence})});
      if(!page||!Array.isArray(page.items))return;
      if(beforeSequence===undefined&&Number.isSafeInteger(page.snapshotSequence)) {
        scanKey=JSON.stringify([page.snapshotSequence,includeStarted]);
        if(!force&&scanKey===lastRecoveryScan)return;
      }
      for(const listed of page.items) {
        if(!runRef(listed?.taskId))continue;
        const task=runtime.getTask(listed.taskId);
        // No active-task/state filter: a settled or restarted original unknown still owns its identity.
        const found=runtime.readToolExecutions(listed.taskId).map(run=>recoveryFromRun(task,run,includeStarted)).find(Boolean);
        if(found)return found;
      }
      const next=page.nextBeforeSequence;
      if(next!==undefined&&(!Number.isSafeInteger(next)||next<0||beforeSequence!==undefined&&next>=beforeSequence))return;
      beforeSequence=next;
    }while(beforeSequence!==undefined);
    lastRecoveryScan=scanKey;
  }
  function currentRecovery(includeStarted=false,discover=false) {
    recovery=readRecovery(recovery,includeStarted)??readRecovery(lastAttempt,includeStarted);
    if(!recovery&&discover)try{recovery=scanRecovery(includeStarted);}catch{/* Never guess a task from a UI request or provider error. */}
    return recovery;
  }
  function hasPresence(taskId) {
    if(closed || !enabled || typeof taskId!=='string')return false;
    const seed=policyPresenceSeeds.get(taskId);
    if(leaseSources.get(taskId)==='full-access-policy'&&(!fullAccess()
      ||seed&&(policyBinding()!==seed.policyBinding||taskBinding(taskId)!==seed.conversationBinding))){
      revokePolicyPresence(taskId);return false;
    }
    if((leases.get(taskId)??0)<=now())return false;
    if(presenceHost && presenceHost.isUserPresent(taskId)!==true)return false;
    if(application?.runtime.getTask){
      try{if(!['pending','running','waiting_approval'].includes(application.runtime.getTask(taskId).state))return false;}catch{return false;}
    }
    return true;
  }
  async function preparePresence(input) {
    active(input);
    const policy=fullAccess();
    if(!state.available || !RUN.test(input.taskId) || (!policy&&typeof registerConfirmation!=='function' && typeof presenceHost?.requestPresence!=='function'))fail('UNSUPPORTED_CAPABILITY','本机确认快捷键尚不可用');
    if(hasPresence(input.taskId)&&(!policy||leaseSources.get(input.taskId)==='full-access-policy'))return;
    if(presenceHost){
      publish({waitingConfirmation:!policy,state:policy?'checking_policy':'waiting_confirmation',taskId:input.taskId,
        reason:policy?'正在核对当前完全访问策略与原任务。'
          :'请将本次授权的应用保持在前台，按 F9 确认当前任务；启用模型结果出口时，界面文字将提供给当前对话模型。每次写入仍需原任务授权。'});
      try{
        const pending={...input,signal:AbortSignal.any([input.signal,lifecycle.signal])};
        const receipt=await presenceHost.requestPresence(pending);active(pending);
        if(receipt?.taskId!==input.taskId || !presenceHost.isUserPresent(input.taskId))fail('UNAUTHORIZED','本机确认不属于当前任务');
        if(!['full-access-policy','native-gesture'].includes(receipt.source)
          ||receipt.source==='full-access-policy'&&!fullAccess())fail('UNAUTHORIZED','电脑访问来源或当前策略已变化');
        const expiresAt=Date.parse(receipt.expiresAt);
        if(!Number.isFinite(expiresAt)||expiresAt<=now())fail('UNAUTHORIZED','本机确认已过期');
        leases.set(input.taskId,Math.min(expiresAt,now()+30000,Date.parse(input.deadline)));
        leaseSources.set(input.taskId,receipt.source);
        publish({state:'ready',reason:receipt.source==='full-access-policy'?'当前完全访问策略已允许此任务；工具仍校验原任务、目标与期限。'
          :'已收到当前任务的本机 F9 确认；每次写入仍由原任务授权。'});
      }finally{publish({waitingConfirmation:false});}
      return;
    }
    if(policy){
      active(input);if(!fullAccess())fail('UNAUTHORIZED','当前完全访问策略已变化');
      leases.set(input.taskId,Math.min(now()+30000,Date.parse(input.deadline)));leaseSources.set(input.taskId,'full-access-policy');
      publish({state:'ready',waitingConfirmation:false,taskId:input.taskId,reason:'当前完全访问策略已允许此任务；工具仍校验原任务、目标与期限。'});
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
            leaseSources.set(input.taskId,'native-gesture');
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
      || (execution.arguments.targetRef??execution.arguments.windowRef)!==identity.targetRef || toolArgumentsDigest(execution.arguments)!==identity.argumentsDigest
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
    lastAttempt={taskId:identity.taskId,runId:identity.runId,inputDigest:record.inputDigest};
  }};
  // providerOptions is an explicit test seam; production supplies only the public factory.
  const provider=typeof createControlHost==='function'?createControlHost({...providerOptions,
    ...(pythonExecutable?{pythonExecutable}:{}), attempts,
    authorizePresence:async({taskId,signal,deadline})=>{
      try{active({signal,deadline});return hasPresence(taskId);}catch{return false;}
    },...(verifyTarget?{verifyTarget}:{})}):undefined;
  const requestTool={descriptor:{name:REQUEST_TOOL,version:VERSION,
    inputSchema:{type:'object',description:'为原任务取得本机访问凭证。state=policy_allowed 或 presence_confirmed 表示这一步成功，应继续列出或观察目标；authorizationGranted=false 只说明本机凭证不能签发后续工具权限，后续各工具仍由原 Runtime/Policy 授权。不要因此循环重复本工具。只在凭证过期或明确要求重新确认时再次请求。',properties:{},required:[],additionalProperties:false},outputSchema:requestOutput,
    sideEffect:'read',requiredScopes:[REQUEST_SCOPE],requiresPresence:false,idempotencySupport:false,recoverySupport:false},
    async execute(input,context){
      validateToolValue(requestTool.descriptor.inputSchema,input);
      if(!context.authorizationRef || !context.scopes.includes(REQUEST_SCOPE))fail('UNAUTHORIZED','需要原任务的请求权限');
      const seed=policySeed(context);policyPresenceSeeds.delete(context.taskId);
      await preparePresence(context);
      if(seed&&leaseSources.get(context.taskId)==='full-access-policy') {
        try{assertPolicySeed(seed,context,false);policyPresenceSeeds.set(context.taskId,seed);}
        catch(error){revokePolicyPresence(context.taskId);throw error;}
      }
      return {state:leaseSources.get(context.taskId)==='full-access-policy'?'policy_allowed':'presence_confirmed',
        expiresAt:new Date(leases.get(context.taskId)).toISOString(),authorizationGranted:false};
    }};
  const tools=()=>!closed&&state.state!=='blocked'&&provider?.tools?.length?[requestTool,...provider.tools]:[];
  async function readScreenshot(name,input) {
    active(input);
    if(!enabled||!state.available||state.state==='blocked'||!hasPresence(input.taskId))fail('UNAUTHORIZED','原任务的截图读取许可已失效');
    if(typeof provider?.[name]!=='function')fail('UNSUPPORTED_CAPABILITY','当前电脑组件没有可信截图读取端口');
    const result=await provider[name](input);active(input);
    if(!state.available||state.state==='blocked'||!hasPresence(input.taskId)||result?.taskId!==input.taskId||result?.artifactId!==input.artifactId)
      fail('UNAUTHORIZED','截图读取期间原任务范围已变化');
    return result;
  }
  return {
    bind(value){
      if(application && application!==value)fail('REVISION_CONFLICT','电脑控制已经绑定Runtime');application=value;
      recovery=scanRecovery(false,true);
      if(recovery){provider?.block();publish({state:'blocked',available:false,reason:'原电脑操作结果未知；请先在原任务核实，本次不会重新执行。'});}
    },
    async start(context){
      if(!provider || closed || !enabled || state.state==='blocked' || (!fullAccess()&&typeof registerConfirmation!=='function' && typeof presenceHost?.requestPresence!=='function'))return state;
      try{
        await provider.start(context);
        publish({state:'ready',available:provider.tools.length>0,failure:undefined,reason:fullAccess()?'电脑组件已就绪；当前完全访问允许任务操作，仍校验目标和期限。'
          :'电脑组件已就绪；请在本机确认本次任务后操作。'});
      }catch(error){const failure=computerControlFailure(error,'component_start');
        publish({state:'unavailable',available:false,failure,reason:`${failure.message}（${failure.code}，${failure.stage}）；请准备组件后重试。`});}
      return state;
    },
    configure(input){
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['enabled','allowObservationExport'].includes(key))
        ||typeof input.enabled!=='boolean'||typeof input.allowObservationExport!=='boolean')fail('INVALID_ARGUMENT','电脑设置格式无效');
      enabled=input.enabled;exportChoice=input.allowObservationExport;
      if(!enabled){leases.clear();leaseSources.clear();policyPresenceSeeds.clear();waiting?.cancel();}
      publish({});return this.snapshot();
    },
    async stop(){
      leases.clear();leaseSources.clear();policyPresenceSeeds.clear();waiting?.cancel();
      try{if(typeof provider?.stop==='function')await provider.stop();else provider?.block();}
      catch(error){provider?.block();const failure=computerControlFailure(error,'input_stop');
        publish({state:'blocked',available:false,waitingConfirmation:false,failure,reason:`${failure.message}（${failure.code}，${failure.stage}）；停止未确认，禁止新的电脑操作。`});throw error;}
      const blocked=provider?.health().state==='blocked';
      publish({state:blocked?'blocked':'stopped',available:false,waitingConfirmation:false,reason:blocked?'原电脑操作结果未知，请先在原对话核实。':'电脑输入已停止；准备组件后可开始新任务。'});
      return this.snapshot();
    },
    get tools(){return tools();},
    get competitionToolAvailability(){return [requestTool,...(provider?.tools??[])].map(tool=>({toolName:tool.descriptor.name,toolVersion:VERSION,
      publicEnumPaths:['/button','/direction','/type','/caret_position','/operation'],
      ...(tool.descriptor.name===REQUEST_TOOL?{publicDescription:'Checks current-task computer access. Successful policy_allowed or presence_confirmed means continue the original task with the next tool. authorizationGranted:false only means later tools need their own Runtime/Policy checks; it does not mean this access step failed. Request access again only after expiry, revocation, or an explicit missing-access error.'}
        :tool.descriptor.name==='computer.desktop.suggest_control'?{publicDescription:'Optional local Laya suggestion for choosing an observed control for a simple operation. Pass the current targetRef and operation after observing; it never performs an action or grants permission. The suggestion is valid only for that observation. Review or unavailable means use the original observation or observe again.'}:{}),
      available:async context=>!closed&&enabled&&state.available&&provider?.health().state==='ready'
        && !context.signal?.aborted && now()<Date.parse(context.deadline)
        && (tool.descriptor.name===REQUEST_TOOL || observationExportAllowed())}));},
    // Composition captures these ports once. Keep every original provider policy
    // registered and recheck current settings inside its callbacks.
    get competitionToolExports(){return [requestTool,...(provider?.tools??[])].map(tool=>({
      toolName:tool.descriptor.name,toolVersion:VERSION,exportPolicyVersion:'windows-desktop-observed-v1',
      accepts:({taskId,signal})=>!closed&&!signal?.aborted&&state.available
        && (tool.descriptor.name===REQUEST_TOOL||observationExportAllowed()&&hasPresence(taskId)),
      project:({taskId,result,signal})=>{
        if(closed||signal.aborted||!state.available||(tool.descriptor.name!==REQUEST_TOOL&&(!observationExportAllowed()||!hasPresence(taskId))))fail('UNAUTHORIZED','本机观察结果出口许可已过期');
        validateToolValue(tool.descriptor.outputSchema,result);
        return structuredClone(result);
      }}));},
    preparePresence,refreshPolicyPresence,prepareToolPresence,hasPresence,
    readScreenshotArtifact:input=>readScreenshot('readScreenshotArtifact',input),
    readScreenshotArtifactMetadata:input=>readScreenshot('readScreenshotArtifactMetadata',input),
    activeTasks:()=>provider?.activeTasks?.()??[],
    invalidatePresence(taskId){revokePolicyPresence(taskId);if(waiting?.taskId===taskId)waiting.cancel();},
    snapshot:()=>{
      const health=provider?.health()??{state:'unavailable'};
      const reference=currentRecovery(state.state==='blocked'||health.state==='blocked',state.state==='blocked'||health.state==='blocked');
      const providerAvailable=state.available&&health.state==='ready'&&!closed;
      const exportAllowed=observationExportAllowed();
      return {...state,enabled,provider:health,providerAvailable,available:enabled&&providerAvailable&&exportAllowed,
        activeTaskId:state.waitingConfirmation?state.taskId:provider?.activeTasks?.()[0],
        ...(reference?{recoveryTaskId:reference.taskId,recoveryRunId:reference.runId}:{}),
        observationExportAllowed:exportAllowed,
        ...(providerAvailable&&fullAccess()?{waitingConfirmation:false,
          reason:'当前完全访问允许电脑访问；工具仍校验目标、原任务与期限。'}:{}),
        ...(providerAvailable&&!exportAllowed?{state:'observation_export_disabled',unavailableReason:'observation_export_not_authorized',
          reason:'电脑组件已连接；允许当前任务的模型接收目标窗口观察后，才能执行电脑操作。'}:{}),
        ...(health.state==='blocked'?{state:'blocked',unavailableReason:'original_result_unknown',reason:'原电脑操作结果未知；请先在原任务核实，不会重新执行。'}:{}),
        presenceTasks:[...leases].filter(([taskId])=>hasPresence(taskId)).map(([taskId,expiry])=>({taskId,expiresAt:new Date(expiry).toISOString(),source:leaseSources.get(taskId)}))};
    },
    async close(){closed=true;lifecycle.abort();waiting?.cancel();leases.clear();leaseSources.clear();policyPresenceSeeds.clear();publish({state:'disposed',available:false});await provider?.dispose();},
  };
}
