import {createHash} from 'node:crypto';

const VERSION='1.0.0';
const PREFIX='proactive.workflow.';
const ACTIONS=['pause','resume','cancel','enter_unattended','return'];
const object=properties=>({type:'object',additionalProperties:false,properties});
const taskId={type:'string',minLength:1,maxLength:128};
const schemas={
  list:object({}),start:{...object({taskDeadline:{type:'string',minLength:1,maxLength:40}}),required:['taskDeadline']},
  read:{...object({taskId}),required:['taskId']},
  control:{...object({taskId,action:{type:'string',enum:ACTIONS},expectedControlRevision:{type:'integer',minimum:0}}),
    required:['taskId','action','expectedControlRevision']},
};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Public conversation surface over the existing host. Writes require the original ToolGateway Policy;
 * callers must not add them to automaticTools. Model input cannot choose a source, command identity,
 * contract, signer, capability, host port or frontier proposal.
 */
export function createDesktopProactiveConversationTools({getApplication,getHost,isConversationAllowed,resolveUserConversation}) {
  if(typeof getApplication!=='function'||typeof getHost!=='function'||typeof isConversationAllowed!=='function')
    throw Error('持续工作流需要受信对话与原宿主');
  function scope(context) {
    const application=getApplication(),host=getHost();
    if(!application?.runtime||!host||host.snapshot().state!=='configured_not_verified')throw Error('持续工作流宿主未配置');
    const deadline=context.deadline??application.runtime.loadCheckpoint(context.taskId,'application-deadline');
    if(context.signal?.aborted||!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)<=Date.now())throw Error('原工具请求已取消或过期');
    const source=application.runtime.getTask(context.taskId);
    const conversationId=resolveUserConversation?resolveUserConversation(source.taskId):source.conversationId;
    if(!isConversationAllowed(conversationId,source.taskId)||source.cancelRequested||source.state!=='running'
      ||application.runtime.loadCheckpoint(source.taskId,'private-copy-erasure')
      ||application.runtime.loadCheckpoint(source.taskId,'private-copy-erasure-binding'))throw Error('原对话指令不可用');
    return {application,host,source,conversationId};
  }
  function target(scope,id) {
    const conversationId=scope.host.conversationForTask?scope.host.conversationForTask(id):scope.application.runtime.getTask(id).conversationId;
    if(conversationId!==scope.conversationId)
      throw Error('持续工作流不属于当前对话');
  }
  const tools=Object.entries(schemas).map(([operation,inputSchema])=>({
    descriptor:{name:PREFIX+operation,version:VERSION,inputSchema,outputSchema:{type:'object'},
      sideEffect:['start','control'].includes(operation)?'local_write':'read',
      requiredScopes:[['start','control'].includes(operation)?'proactive:control':'proactive:read'],
      idempotencySupport:operation!=='start',recoverySupport:false,requiresPresence:false},
    async execute(input,context) {
      const current=scope(context),lifetime={signal:context.signal,deadline:context.deadline};
      if(operation==='list')return current.host.listConversation(current.conversationId);
      if(operation==='start') {
        const started=await current.host.start({sourceTaskId:context.taskId,
          commandId:'conversation-'+digest([context.taskId,context.runId]),taskDeadline:input.taskDeadline},lifetime);
        return {accepted:started.accepted,taskId:started.taskId,sessionId:started.sessionId};
      }
      target(current,input.taskId);
      if(operation==='control')await current.host.control({taskId:input.taskId,sourceTaskId:context.taskId,
        commandId:'conversation-'+digest([context.taskId,context.runId]),action:input.action,
        expectedControlRevision:input.expectedControlRevision},lifetime);
      return current.host.readSummary(input.taskId,lifetime);
    },
  }));
  return {tools,
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:VERSION,
      ...(tool.descriptor.name===PREFIX+'control'?{publicEnumPaths:['/action']}:{}),
      available:({taskId,deadline,signal})=>{try{scope({taskId,deadline,signal});return true;}catch{return false;}}})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:VERSION,
      exportPolicyVersion:'proactive-conversation-status-v1',accepts:()=>true,
      project:({result,taskId,signal})=>{
        scope({taskId,signal});
        if(!result||typeof result!=='object'||Buffer.byteLength(JSON.stringify(result),'utf8')>7500)
          throw Error('持续工作流结果不可用');
        return structuredClone(result);
      }})),
  };
}
