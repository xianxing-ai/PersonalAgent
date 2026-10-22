import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import * as mailModule from '@personal-agent/mail';
import * as calendarModule from '@personal-agent/calendar';
import {attachExactExports} from './developer-deployment-config.js';
import {connectorResultProjectionSchema} from './connector-result-projection.js';

const MAIL_ACCOUNT='desktop-qq-inbox';
const MAIL_TOOLS=new Set(['mail.inbox','mail.accounts','mail.mark_seen','mail.save_draft','mail.reconcile_send']);
const CALENDAR_TOOLS=new Set(['calendar.events','calendar.create','calendar.update','calendar.cancel']);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=()=>{throw new ProtocolError('UNAUTHORIZED','连接器配置或本次任务许可已失效');};

/** Main-only adapters. Local inbox consent is not reused for writes or cloud export. */
export function createConnectorConversationTools({mail,calendar,localInbox,getApplication,resolveConversation,confirmExport,question,onReadTask,
  createMailProvider=options=>new mailModule.QQMailProvider(options),
  createCalendarProvider=options=>new calendarModule.CalDavProvider(options),now=Date.now}={}) {
  const execution=new AsyncLocalStorage(),bindings=new Map(),prepared=new Map(),providers=new Map(),controllers=new Map(),secrets=new Set(),tools=[],disposers=[];
  let closed=false;
  const family=name=>name.startsWith('mail.')?'mail':'calendar';
  const bindingKey=(taskId,kind)=>JSON.stringify([taskId,kind]);
  const configuration=kind=>kind==='mail'?mail?.current():calendar?.binding();
  const identity=kind=>{const value=configuration(kind);return value?digest(value):undefined;};
  const resource=kind=>digest({kind,configuration:identity(kind)});
  const preparationKey=scope=>JSON.stringify([scope.taskId,scope.proposalId??scope.proposal?.proposalId]);
  const questionReady=()=>['prepare','prepareExport','currentRequirement','authorizeExport','readResourceGeneration','rotateResourceGeneration']
    .every(name=>typeof question?.[name]==='function');
  const taskScope=scope=>{
    if(closed||scope.signal?.aborted||!(Date.parse(scope.deadline)>now()))return false;
    try {const task=getApplication().runtime.getTask(scope.taskId);
      return !task.cancelRequested&&Boolean(resolveConversation(scope.taskId));}catch{return false;}
  };
  const current=scope=>{
    const kind=scope.kind??family(scope.toolName??scope.proposal?.toolName??'');
    const binding=bindings.get(bindingKey(scope.taskId,kind));
    return taskScope(scope)&&binding&&binding.identity===identity(binding.kind)
      &&binding.conversationId===resolveConversation(scope.taskId)
      &&(!question||binding.resourceGeneration===question.readResourceGeneration(binding.resource));
  };
  const assertCurrent=scope=>{if(!current(scope))denied();
    if(question&&scope.questionExecution===true)question.currentRequirement(scope,scope.kind+'-session');};
  const available=(name,scope)=>taskScope(scope)&&Boolean(identity(family(name)))
    &&getApplication().runtime.getTask(scope.taskId).state==='running'&&(question?questionReady():typeof confirmExport==='function');
  const proxy=kind=>new Proxy({providerKind:kind==='mail'?'qq':'caldav',verification:'conditional'}, {get(target,key){
    if(key in target)return target[key];
    if(kind==='calendar'&&key==='writes')return Object.freeze(Object.fromEntries(
      ['createEvent','updateEvent','cancelEvent'].map(method=>[method,(...args)=>{
        const scope=execution.getStore();if(!scope||scope.kind!=='calendar')denied();assertCurrent(scope);
        const writes=scope.provider.writes;
        if(typeof writes?.[method]!=='function')throw new ProtocolError('UNSUPPORTED_CAPABILITY','当前提供者不支持此日历写操作');
        return writes[method](...args);
      }])));
    return (...args)=>{const scope=execution.getStore();if(!scope||scope.kind!==kind)denied();assertCurrent(scope);
      if(typeof scope.provider[key]!=='function')throw new ProtocolError('UNSUPPORTED_CAPABILITY','当前提供者不支持此连接器操作');
      return scope.provider[key](...args);};
  }});
  const host={register(tool){
    if(!MAIL_TOOLS.has(tool.descriptor.name)&&!CALENDAR_TOOLS.has(tool.descriptor.name))return ()=>{};
    tools.push({...tool,execute:async(input,context)=>{
      // Original batch tasks retain their stricter local-session/UID/classifier checks.
      if(tool.descriptor.name==='mail.inbox'&&!resolveConversation(context.taskId)&&localInbox)return localInbox.execute(input,context);
      const kind=family(tool.descriptor.name);
      if(question){
        const entry=[...prepared.values()].find(value=>value.scope.taskId===context.taskId&&value.scope.runId===context.runId);
        if(!entry||entry.scope.toolName!==tool.descriptor.name||entry.argumentsDigest!==digest(input))denied();
        context={...entry.scope,...context};
      }
      context={...context,kind,...(question?{questionExecution:true}:{})};assertCurrent(context);
      if(!context.authorizationRef||!tool.descriptor.requiredScopes.every(scope=>context.scopes?.includes(scope)))denied();
      const selected=bindings.get(bindingKey(context.taskId,kind));
      if(kind==='mail'&&input?.account!==undefined&&input.account!==MAIL_ACCOUNT)denied();
      if(tool.descriptor.name==='mail.inbox'&&onReadTask!==undefined) {
        if(typeof context.runId!=='string'||!context.runId)denied();
        // Synchronous trusted binding only: no headers, arguments or credentials.
        // A failed binding must prevent even construction of a provider connection.
        try {
          const result=onReadTask(Object.freeze({taskId:context.taskId,runId:context.runId}));
          if(result!==undefined){void Promise.resolve(result).catch(()=>{});denied();}
        }catch{denied();}
        assertCurrent(context);
      }
      const controller=new AbortController(),signal=AbortSignal.any([context.signal,controller.signal]);controllers.set(controller,kind);
      // Each execution owns its connection: cancelling one task must not close another's socket.
      let provider,timer,onAbort,disposal,timedOut=false;
      const dispose=()=>disposal??=(Promise.resolve().then(()=>provider?.dispose?.()).catch(()=>{}));
      const activeContext={...context,signal};
      try {
        const interrupted=new Promise((_,reject)=>{
          onAbort=()=>{void dispose();
            reject(new ProtocolError(context.signal.aborted?'CANCELLED':'TIMEOUT','连接器操作已停止，写入结果须在原任务核实'));};
          signal.addEventListener('abort',onAbort,{once:true});
          timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(1,Math.min(2_147_483_647,Date.parse(context.deadline)-now())));
          if(signal.aborted)onAbort();
        });
        const operation=(async()=>{
        if(!provider){
          const binding=configuration(kind);assertCurrent(activeContext);
          if(kind==='mail'){
            secrets.add(binding.authCode);provider=createMailProvider({user:binding.user,authCode:binding.authCode});
          }else{
            const authorization=await calendar.readAuthorization(binding);assertCurrent(activeContext);
            secrets.add(authorization);
            if(authorization.startsWith('Basic '))secrets.add(Buffer.from(authorization.slice(6),'base64').toString('utf8').split(':').slice(1).join(':'));
            provider=createCalendarProvider({calendarUrl:binding.calendarUrl,calendarName:binding.calendarName,authorization,allowLoopbackHttp:true,
              fetchImpl:(url,init)=>{const active=execution.getStore();if(!active)denied();assertCurrent(active);
                return fetch(url,{...init,signal:AbortSignal.any([init.signal,active.signal].filter(Boolean))});}});
          }
          providers.set(controller,{kind,provider,dispose});assertCurrent(activeContext);
        }
        const scope={...context,signal,kind,provider};assertCurrent(scope);
        const result=await execution.run(scope,()=>tool.execute(input,{...context,signal}));assertCurrent(scope);return result;
        })();
        return await Promise.race([operation,interrupted]);
      }catch(error){
        if(signal.aborted)throw new ProtocolError(!context.signal.aborted&&(timedOut||now()>=Date.parse(context.deadline))?'TIMEOUT':'CANCELLED',
          '连接器操作已停止，已发生的写入须在原任务核实');
        if(error instanceof ProtocolError)throw new ProtocolError(error.code,'连接器操作未完成；请按错误码核实原任务');
        throw new ProtocolError('EXTERNAL_FAILURE','连接器操作未完成；请核实原任务，勿重复未知写入');
      }finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);controllers.delete(controller);
        providers.delete(controller);void dispose();}
    }});return ()=>{};
  }};
  disposers.push(mailModule.register(host,{provider:proxy('mail'),accountRef:MAIL_ACCOUNT}));
  // The public account reference remains a host constant; URL/credentials are never model arguments.
  disposers.push(calendarModule.register(host,{provider:proxy('calendar'),accountRef:'desktop-calendar'}));
  const original={tools,competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,
    toolVersion:tool.descriptor.version,available:scope=>available(tool.descriptor.name,scope)}))};
  const exports=attachExactExports(original,{current,ready:available,assertCurrent,confirmExport,now,
    kindPrefix:'connector',policyBinding:'configured-account-v1',
    containsCredential:value=>[mail?.current()?.authCode,...secrets].some(secret=>secret&&value.includes(secret))});
  const originalPreparation=scope=>{
    const entry=prepared.get(preparationKey(scope));
    if(!entry||!current({...entry.scope,signal:scope.signal??entry.scope.signal}))denied();return entry;
  };
  const questionExports=tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
    exportPolicyVersion:'connector-question-bounded-v2',accepts:scope=>{
      try{const entry=originalPreparation(scope);
        if(entry.scope.toolName!==tool.descriptor.name||entry.argumentsDigest!==digest(scope.arguments))return false;
        if(scope.phase==='final'){
          if(!entry.resultDigest||entry.resultDigest!==digest(scope.projection))return false;
          question.currentRequirement({...entry.scope,signal:scope.signal??entry.scope.signal},entry.kind+'-export');
        }return true;
      }catch{return false;}
    },project:scope=>{
      const entry=originalPreparation(scope),text=JSON.stringify(scope.result);
      if(entry.scope.toolName!==tool.descriptor.name)denied();
      if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>512*1024
        ||[mail?.current()?.authCode,...secrets].some(secret=>secret&&text.includes(secret))
        ||/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]{16,})/u.test(text))denied();
      question.currentRequirement({...entry.scope,signal:scope.signal},entry.kind+'-session');
      question.authorizeExport({...entry.scope,signal:scope.signal},scope.result,entry.kind+'-export');
      entry.resultDigest=digest(scope.result);return structuredClone(scope.result);
    }}));
  return {...exports.host,...(question?{competitionToolExports:questionExports}:{}),async prepareExport(scope){
    if(!tools.some(tool=>tool.descriptor.name===scope.proposal?.toolName))return;
    if(scope.phase==='preflight'){
      const kind=family(scope.proposal.toolName),binding=identity(kind),conversationId=resolveConversation(scope.taskId);
      if(!binding||!conversationId||!available(scope.proposal.toolName,scope))denied();
      for(const [key,value]of bindings)if(Date.parse(value.deadline)<=now())bindings.delete(key);
      const key=bindingKey(scope.taskId,kind);
      if(bindings.size>=512&&!bindings.has(key))denied();
      const previous=bindings.get(key);
      if(previous&&(previous.identity!==binding||previous.conversationId!==conversationId||previous.kind!==kind))denied();
      const source=resource(kind),resourceGeneration=question?question.readResourceGeneration(source):undefined;
      bindings.set(key,{kind,identity:binding,conversationId,deadline:scope.deadline,...(question?{resource:source,resourceGeneration}:{})});
      if(question){
        if(!scope.runId)denied();
        for(const [id,entry]of prepared)if(Date.parse(entry.scope.deadline)<=now())prepared.delete(id);
        const tool=tools.find(item=>item.descriptor.name===scope.proposal.toolName&&item.descriptor.version===scope.proposal.toolVersion);
        if(!tool)denied();
        const exact={taskId:scope.taskId,proposalId:scope.proposal.proposalId,runId:scope.runId,toolName:tool.descriptor.name,
          toolVersion:tool.descriptor.version,deadline:scope.deadline,signal:scope.signal,kind};
        const entry={scope:exact,kind,argumentsDigest:digest(scope.proposal.arguments)},id=preparationKey(scope),prior=prepared.get(id);
        if(prior&&(prior.scope.runId!==exact.runId||prior.argumentsDigest!==entry.argumentsDigest))denied();
        prepared.set(id,entry);
        const ruleBindingDigest=digest({resource:source,resourceGeneration,toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
          projection:tool.descriptor.outputSchema});
        question.prepare(exact,{requirements:[{requirementId:kind+'-session',kind:'connector_session',scopes:tool.descriptor.requiredScopes,
          bindingDigest:digest({resource:source,resourceGeneration,taskId:scope.taskId,runId:scope.runId,argumentsDigest:entry.argumentsDigest,deadline:scope.deadline}),
          ruleBindingDigest,summary:kind==='mail'?'访问本任务所需的已配置邮箱范围；不允许其他任务或任意账号':'访问本任务所需的已配置日历范围；卡片不能替代账号配置'}],
          assertCurrent:()=>{try{return current(exact);}catch{return false;}}});
        question.prepareExport(exact,{requirementId:kind+'-export',projectionSchema:connectorResultProjectionSchema(tool.descriptor.outputSchema),summary:`将本次 ${tool.descriptor.name} 已声明字段的结果发送到本任务选定 AgentArts 模型；排除凭据与额外字段（最多 512 KiB）`,
          bindingDigest:digest({ruleBindingDigest,taskId:scope.taskId,runId:scope.runId,argumentsDigest:entry.argumentsDigest}),
          ruleBindingDigest:digest({ruleBindingDigest,kind:'export'})});
      }
    }
    if(!question)await exports.prepareExport(scope);else originalPreparation(scope);
  },async invalidate(kind,{rotate=true}={}){
    const resources=new Set([...bindings.values()].filter(binding=>!kind||binding.kind===kind).map(binding=>binding.resource).filter(Boolean));
    if(question)for(const family of kind?[kind]:['mail','calendar'])if(identity(family))resources.add(resource(family));
    for(const [key,binding]of bindings)if(!kind||binding.kind===kind)bindings.delete(key);
    for(const [key,entry]of prepared)if(!kind||entry.kind===kind)prepared.delete(key);
    exports.clear(kind?new Set(tools.filter(tool=>family(tool.descriptor.name)===kind).map(tool=>tool.descriptor.name)):undefined);
    for(const [controller,source]of controllers)if(!kind||source===kind)controller.abort();
    const pending=[];for(const [key,value]of providers)if(!kind||value.kind===kind){
      providers.delete(key);pending.push(value.dispose());
    }
    await Promise.all(pending);if(!kind)secrets.clear();
    if(question&&rotate)for(const id of resources){const previous=question.readResourceGeneration(id);question.rotateResourceGeneration(id,previous);}
  },async close(){closed=true;await this.invalidate(undefined,{rotate:false});for(const dispose of disposers.reverse())dispose();}};
}
