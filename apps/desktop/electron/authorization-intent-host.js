import {createHash,randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

export const AUTHORIZATION_INTENT_TOOL='desktop.authorization.intent';
export const AUTHORIZATION_INTENT_ACTIONS=Object.freeze([
  'memory.save','memory.erase','memory.withdraw','memory.consume','experience.activate',
  'skill.install','skill.enable','skill.uninstall','skill.run','reference.catalog','reference.source',
  'knowledge.session','knowledge.configure','knowledge.read','knowledge.catalog','workflow.enable','workflow.delete','facts.erase','feeds.classify',
  'remoteMcp.configure','knowledge.pair','voice.capture','developer.export','harness.export',
]);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=()=>{throw new ProtocolError('UNAUTHORIZED','原授权操作已失效');};

/** Compatibility adapter for existing trusted callbacks without a business task.
 * Its Runtime task records a decision only; never an executed save/delete/install. */
export function createDesktopAuthorizationIntentHost({getApplication,question,openConversation,now=Date.now}) {
  const pending=new Map();let closed=false;
  const descriptor={name:AUTHORIZATION_INTENT_TOOL,version:'1.0.0',sideEffect:'read',requiredScopes:['desktop:authorization'],
    idempotencySupport:false,recoverySupport:false,requiresPresence:false,
    inputSchema:{type:'object',additionalProperties:false,required:['action','payloadDigest','scopeDigest'],properties:{
      action:{enum:[...AUTHORIZATION_INTENT_ACTIONS]},payloadDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},scopeDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}}},
    outputSchema:{type:'object',additionalProperties:false,required:['decisionRecorded'],properties:{decisionRecorded:{const:true}}}};
  function original(scope){
    const application=getApplication(),readback=application?.readHostToolTask(scope.taskId),entry=pending.get(readback?.commandId);
    // submitHostToolTask may enter its worker before returning the task to this adapter.
    // The persisted command ID, not an untrusted caller, binds that first observation.
    if(entry&&entry.taskId===undefined)entry.taskId=scope.taskId;
    if(closed||!entry||entry.application!==application||entry.taskId!==scope.taskId||entry.deadline!==scope.deadline
      ||entry.signal.aborted||scope.signal.aborted||now()>=Date.parse(entry.deadline)||!entry.current())denied();
    const saved=application.readAuthorizationQuestionInvocation(scope.taskId,scope.runId);
    if(!saved||saved.toolName!==AUTHORIZATION_INTENT_TOOL||digest(saved.arguments)!==digest(entry.arguments))denied();
    if(entry.operation)application.runtime.saveCheckpointOnce(scope.taskId,'desktop-authorization-operation',
      {ownerTaskId:entry.operation.taskId,operationDigest:entry.operation.digest,deadline:entry.deadline});
    return entry;
  }
  return {
    tool:{descriptor,async execute(input,context){
      const entry=original(context);
      if(digest(input)!==digest(entry.arguments)||entry.executed)denied();
      question.currentRequirement(context,'intent');entry.executed=true;
      return {decisionRecorded:true};
    }},
    prepareQuestion(scope){
      if(scope.toolName!==AUTHORIZATION_INTENT_TOOL)return;
      const entry=original(scope);
      question.prepare(scope,{requirements:[{requirementId:'intent',kind:'tool',scopes:[entry.action],
        bindingDigest:digest({taskId:scope.taskId,runId:scope.runId,argumentsDigest:scope.argumentsDigest,scopeDigest:entry.arguments.scopeDigest}),
        ruleBindingDigest:digest({action:entry.action,scopeDigest:entry.arguments.scopeDigest}),summary:entry.summary}],
        ...(entry.decisionDeadline?{decisionDeadline:entry.decisionDeadline}:{}),assertCurrent:()=>entry.current()});
      if(entry.parent)question.deriveHostIntent(entry.parent,scope,{operationDigest:entry.operation.digest,assertCurrent:()=>entry.current()});
    },
    async request({action,payload,scope,summary,deadline=new Date(now()+180000).toISOString(),signal=new AbortController().signal,isCurrent,operation}){
      if(closed||!AUTHORIZATION_INTENT_ACTIONS.includes(action)||typeof isCurrent!=='function'||!isCurrent()
        ||signal.aborted||!Number.isFinite(Date.parse(deadline))||now()>=Date.parse(deadline)||typeof summary!=='string'||summary.length>512)return false;
      const application=getApplication();if(!application?.submitHostToolTask)return false;
      const payloadDigest=digest(payload),scopeDigest=digest(scope),args={action,payloadDigest,scopeDigest};
      if(operation&&(!['developer.export','harness.export'].includes(action)||typeof operation.taskId!=='string'
        ||!/^[a-f0-9]{64}$/u.test(operation.digest)))return false;
      const operationKey=operation?'authorization-export-decision:'+digest([action,scopeDigest,operation.digest]):undefined;
      const parent=operationKey?application.runtime.loadCheckpoint(operation.taskId,operationKey):undefined;
      const commandId='desktop-authorization-'+randomUUID();
      const current=()=>getApplication()===application&&!signal.aborted&&now()<Date.parse(deadline)
        &&isCurrent()&&digest(payload)===payloadDigest&&digest(scope)===scopeDigest;
      const entry={application,action,arguments:args,summary,deadline,signal,current,executed:false,taskId:undefined,operation,parent};
      if(action==='harness.export')entry.decisionDeadline=new Date(Math.min(Date.parse(deadline),now()+180000)).toISOString();
      pending.set(commandId,entry);
      try{
        openConversation();
        const prepared=application.submitHostToolTask({commandId,toolName:descriptor.name,toolVersion:descriptor.version,arguments:args,deadline});
        entry.taskId=prepared.task.taskId;
        const abort=()=>{try{application.runtime.requestCancel(entry.taskId,'原授权操作已取消');}catch{}};
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        try{await application.waitForHostToolTask(entry.taskId);}finally{signal.removeEventListener('abort',abort);}
        const result=application.readHostToolTask(entry.taskId);
        const allowed=current()&&entry.executed&&result.task.state==='succeeded'&&result.confirmed?.result?.decisionRecorded===true;
        if(allowed&&operationKey)application.runtime.saveCheckpoint(operation.taskId,operationKey,
          {taskId:entry.taskId,runId:'host-tool-'+entry.taskId,deadline,signal:undefined});
        return allowed;
      }catch{return false;}finally{pending.delete(commandId);}
    },
    close(){closed=true;pending.clear();},
  };
}
