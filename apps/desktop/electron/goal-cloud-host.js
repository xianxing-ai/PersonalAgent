import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {GOAL_CREATE_TOOL,GOAL_REVISE_TOOL,GOAL_TOOL_VERSION} from '@personal-agent/goals/tool';

const CHECKPOINT='desktop-goal-cloud-scope-v1';
const CATALOG='competition-tool-catalog';
const LOOP='competition-loop';
const POLICY='desktop-goal-cloud-projection-v2';
const MAX_GOAL_EXPORT_BYTES=7_500;
const CONVERSATIONS=new Set(['desktop-panel','desktop-workspace']);
const WRITE_NAMES=new Set([GOAL_CREATE_TOOL,GOAL_REVISE_TOOL]);
const READ_NAMES=new Set(['goals.list','goals.get']);
const ALL_NAMES=new Set([...WRITE_NAMES,...READ_NAMES]);
const blockedText=value=>typeof value!=='string' || /(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|(?:^|[\s"'(])\/(?:[^\s/]+\/)*[^\s/]+|(?:api[_-]?key|password|secret|authorization|bearer)\s*[:=]|\bsk-[A-Za-z0-9_-]{12,})/i.test(value);

const goalViewSchema={type:'object',required:['id','revision','summary','validFrom','validUntil','sensitivity','state','reason','dependencies'],
  additionalProperties:false,properties:{id:{type:'string',minLength:1},revision:{type:'integer',minimum:1},
    summary:{type:'string'},validFrom:{type:'string'},validUntil:{type:'string'},
    sensitivity:{enum:['public','private']},state:{enum:['active','withdrawn']},reason:{type:'string'},
    dependencies:{type:'array',items:{type:'object',required:['id','revision'],additionalProperties:false,
      properties:{id:{type:'string',minLength:1},revision:{type:'integer',minimum:1}}}}}};
const listDescriptor={name:'goals.list',version:GOAL_TOOL_VERSION,sideEffect:'read',requiredScopes:['goals:read'],
  idempotencySupport:true,recoverySupport:true,requiresPresence:false,
  inputSchema:{type:'object',additionalProperties:false,properties:{afterId:{type:'string',minLength:1},
    limit:{type:'integer',minimum:1,maximum:20}}},
  outputSchema:{type:'object',required:['graphRevision','goals','nextAfterId'],additionalProperties:false,
    properties:{graphRevision:{type:'integer',minimum:0},goals:{type:'array',items:goalViewSchema},
      nextAfterId:{anyOf:[{type:'string',minLength:1},{type:'null'}]}}}};
const getDescriptor={name:'goals.get',version:GOAL_TOOL_VERSION,sideEffect:'read',requiredScopes:['goals:read'],
  idempotencySupport:true,recoverySupport:true,requiresPresence:false,
  inputSchema:{type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string',minLength:1}}},
  outputSchema:{type:'object',required:['graphRevision','goal'],additionalProperties:false,
    properties:{graphRevision:{type:'integer',minimum:0},goal:{anyOf:[goalViewSchema,{type:'null'}]}}}};

function projectedGoal(node) {
  if(!node || node.sensitivity==='restricted' || !['public','private'].includes(node.sensitivity)
    || blockedText(node.id) || blockedText(node.summary) || blockedText(node.reason)
    || !Array.isArray(node.dependencies) || node.dependencies.some(ref=>blockedText(ref?.id)
      || !Number.isSafeInteger(ref.revision) || ref.revision<1)) return null;
  return {id:node.id,revision:node.revision,summary:node.summary.slice(0,512),
    validFrom:node.validFrom,validUntil:node.validUntil,sensitivity:node.sensitivity,
    state:node.state,reason:node.reason.slice(0,512),
    dependencies:node.dependencies.map(ref=>({id:ref.id,revision:ref.revision}))};
}

/** Trusted Desktop adapter. Goal writes still use the public Goal tools and Runtime Policy. */
export function createDesktopGoalCloudHost({goalHost,namespace,readProactiveBinding,isConversationAllowed,question}) {
  if(!goalHost || !Array.isArray(goalHost.tools) || typeof goalHost.list!=='function'
    || typeof goalHost.get!=='function') throw Error('Goal host is unavailable');
  const writes=goalHost.tools.filter(tool=>WRITE_NAMES.has(tool.descriptor?.name)
    && tool.descriptor.version===GOAL_TOOL_VERSION);
  if(writes.length!==2 || new Set(writes.map(tool=>tool.descriptor.name)).size!==2) throw Error('Goal write tools are unavailable');
  let application,allowed=false,active=true,generation=randomUUID();
  const resourceDigest=createHash('sha256').update(JSON.stringify(['goals',namespace])).digest('hex'),runs=new Map();
  const snapshot=()=>({available:Boolean(application)&&active,sessionAllowed:!question&&allowed&&active,
    reason:allowed?'本会话可向 AgentArts 提供目标内容；目标写入仍需单独审批':'本会话目标云访问未开启'});
  const permitted=()=>active&&Boolean(application)&&(question?question.readResourceGeneration(resourceDigest)===generation:allowed);
  function proactiveScope(taskId) {
    if(!namespace || typeof readProactiveBinding!=='function') return;
    try {
      const scope=readProactiveBinding(taskId);
      const ref=value=>value && typeof value.id==='string' && value.id
        && Number.isSafeInteger(value.revision) && value.revision>0;
      if(!scope || scope.graphNamespace!==namespace || typeof scope.reviewTaskId!=='string'
        || !scope.reviewTaskId || typeof scope.bindingVersion!=='string' || !scope.bindingVersion
        || !Number.isSafeInteger(scope.graphRevision) || scope.graphRevision<0
        || ![scope.selectionDigest,scope.candidateDigest].every(value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value))
        || !Array.isArray(scope.targets) || !scope.targets.length || !scope.targets.every(ref)
        || !Array.isArray(scope.dependencies) || !scope.dependencies.every(ref)
        || goalHost.list().graphRevision!==scope.graphRevision) return;
      return {reviewTaskId:scope.reviewTaskId,graphNamespace:scope.graphNamespace,
        bindingVersion:scope.bindingVersion,graphRevision:scope.graphRevision,
        selectionDigest:scope.selectionDigest,candidateDigest:scope.candidateDigest,
        targets:scope.targets.map(value=>({id:value.id,revision:value.revision})),
        dependencies:scope.dependencies.map(value=>({id:value.id,revision:value.revision}))};
    } catch {return;}
  }
  function taskScope(taskId) {
    if(application.runtime.getTask(taskId).conversationId===`desktop-proactive-goals:${namespace}`) {
      return proactiveScope(taskId);
    }
  }
  function bound(taskId,claim=false,toolName) {
    if(!permitted() || typeof taskId!=='string') return false;
    let task;
    try {task=application.runtime.getTask(taskId);} catch {return false;}
    const proactive=task.conversationId===`desktop-proactive-goals:${namespace}`;
    const conversationAllowed=isConversationAllowed
      ? isConversationAllowed(task.conversationId,taskId)===true : CONVERSATIONS.has(task.conversationId);
    if(!conversationAllowed && !proactive) return false;
    const scope=proactive?proactiveScope(taskId):undefined;
    if(proactive && (!scope || WRITE_NAMES.has(toolName))) return false;
    const expected=scope?{generation,scopeDigest:createHash('sha256').update(JSON.stringify(scope)).digest('hex')}:generation;
    const saved=application.runtime.loadCheckpoint(taskId,CHECKPOINT);
    if(claim&&saved===undefined) application.runtime.saveCheckpointOnce(taskId,CHECKPOINT,expected);
    return isDeepStrictEqual(application.runtime.loadCheckpoint(taskId,CHECKPOINT),expected);
  }
  function readable(taskId,signal,toolName) {
    if(signal?.aborted || !bound(taskId,false,toolName)) throw Error('Goal cloud session is unavailable');
    if(question){const scope=runs.get(taskId);if(!scope)throw Error('Goal operation has no original question');
      question.currentRequirement({...scope,signal},'goals-session');}
  }
  function scopedGoal(node,taskId) {
    const goal=projectedGoal(node);
    if(!goal || !taskId) return goal;
    const scope=taskScope(taskId);
    if(!scope) return application.runtime.getTask(taskId).conversationId===`desktop-proactive-goals:${namespace}`?null:goal;
    const refs=[...scope.targets,...scope.dependencies];
    return refs.some(ref=>ref.id===goal.id && ref.revision===goal.revision)
      && goal.dependencies.every(dependency=>refs.some(ref=>isDeepStrictEqual(ref,dependency)))?goal:null;
  }
  // Revalidate the original read, without replacing it or rejecting unrelated graph changes.
  function currentReadResult(toolName,result,taskId) {
    try {
      const goals=toolName==='goals.list'?result.goals:[result.goal].filter(Boolean);
      return Array.isArray(goals)&&goals.every(goal=>isDeepStrictEqual(goal,
        scopedGoal(goalHost.get(goal.id).goal,taskId)));
    } catch {return false;}
  }
  function authorizedLocalHostTool(input,context,toolName) {
    if(!application || context?.signal?.aborted || typeof context.taskId!=='string') return false;
    const runId=`host-tool-${context.taskId}`;
    if(context.runId!==runId || context.authorizationRef!==runId) return false;
    try {
      const intent=application.runtime.loadCheckpoint(context.taskId,'host-tool-intent');
      const readback=application.readHostToolTask(context.taskId);
      const grant=application.runtime.policy.get(runId);
      const routine=application.runtime.loadCheckpoint(context.taskId,`routine-tool-policy:${runId}`);
      const authorizedRoutine=routine?.source==='trusted-routine-tool-policy'
        && routine.toolName===toolName && routine.toolVersion===GOAL_TOOL_VERSION
        && routine.argumentsDigest===intent?.argumentsDigest
        && grant?.taskId===context.taskId && grant.toolName===toolName
        && grant.authorizationRef===runId && grant.argumentsDigest===intent?.argumentsDigest
        && grant.usesRemaining===0 && grant.expiresAt===context.deadline
        && Date.parse(grant.expiresAt)>Date.now()
        && isDeepStrictEqual(grant.scopes,['goals:write'])
        && isDeepStrictEqual(context.scopes,['goals:write']);
      let authorizedApproval=false;
      try {authorizedApproval=application.runtime.getApproval(runId).state==='allowed';} catch {}
      return intent?.toolName===toolName && intent.toolVersion===GOAL_TOOL_VERSION
        && intent.commandId===readback.commandId && intent.namespace
        && readback.task.conversationId===`host-tool:${intent.namespace}`
        && readback.toolName===toolName && readback.toolVersion===GOAL_TOOL_VERSION
        && input?.goal?.sourceRef===`desktop-goal:${intent.commandId}`
        && isDeepStrictEqual(intent.arguments,input)
        && (authorizedRoutine || authorizedApproval);
    } catch {return false;}
  }
  function writeArguments(input,toolName) {
    const goal=input?.goal;
    if(!goal || typeof goal!=='object' || Array.isArray(goal) || goal.sensitivity==='restricted'
      || !['public','private'].includes(goal.sensitivity) || blockedText(goal.id)
      || blockedText(goal.summary) || blockedText(goal.reason) || Object.hasOwn(goal,'sourceRef')
      || !Array.isArray(goal.dependencies) || goal.dependencies.some(ref=>blockedText(ref?.id))) return false;
    if(toolName===GOAL_REVISE_TOOL) {
      const previous=goalHost.get(goal.id).goal;
      if(previous && !projectedGoal(previous)) return false;
    }
    return true;
  }
  function readList(input={},taskId) {
    if(!input || typeof input!=='object' || Array.isArray(input)) throw Error('Goal list arguments are invalid');
    const {graphRevision,goals}=goalHost.list();
    const limit=input.limit??20;
    const visible=goals.map(goal=>scopedGoal(goal,taskId)).filter(Boolean).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const remaining=visible.filter(goal=>input.afterId===undefined || goal.id>input.afterId);
    const page=[];
    const result=()=>({graphRevision,goals:page,nextAfterId:remaining.length>page.length?page.at(-1)?.id??null:null});
    for(const goal of remaining.slice(0,limit)) {
      page.push(goal);
      if(Buffer.byteLength(JSON.stringify(result()),'utf8')<=MAX_GOAL_EXPORT_BYTES)continue;
      page.pop();
      if(!page.length)throw Error('One Goal exceeds the cloud page projection budget; inspect this Goal locally');
      break;
    }
    return result();
  }
  function readOne(input,taskId) {
    if(!input || typeof input.id!=='string' || blockedText(input.id)) throw Error('Goal ID is unavailable');
    const {graphRevision,goal}=goalHost.get(input.id);
    return {graphRevision,goal:scopedGoal(goal,taskId)};
  }
  const tools=[...writes.map(tool=>{
    const schema=structuredClone(tool.descriptor.inputSchema);
    schema.properties.goal.required=schema.properties.goal.required.filter(key=>key!=='sourceRef');
    return {descriptor:{...tool.descriptor,inputSchema:schema},execute:async(input,context)=>{
      if(authorizedLocalHostTool(input,context,tool.descriptor.name)) return tool.execute(input,context);
      readable(context.taskId,context.signal,tool.descriptor.name);
      if(!writeArguments(input,tool.descriptor.name)) throw Error('Goal cannot be sent to the cloud');
      const goal={...structuredClone(input.goal),sourceRef:`desktop-goal-cloud:${context.taskId}:${context.runId}`};
      return tool.execute({...structuredClone(input),goal},context);
    }};
  }),{descriptor:listDescriptor,execute:async(input,context)=>{
    readable(context.taskId,context.signal);return readList(input,context.taskId);
  }},{descriptor:getDescriptor,execute:async(input,context)=>{
    readable(context.taskId,context.signal);return readOne(input,context.taskId);
  }}];
  const competitionToolAvailability=tools.map(tool=>({toolName:tool.descriptor.name,
    toolVersion:tool.descriptor.version,
    ...(WRITE_NAMES.has(tool.descriptor.name)?{publicEnumPaths:['/goal/sensitivity','/goal/state']}:{}),
    available:({taskId,signal})=>!signal?.aborted&&bound(taskId,true,tool.descriptor.name)}));
  const competitionToolExports=tools.map(tool=>({toolName:tool.descriptor.name,
    toolVersion:tool.descriptor.version,exportPolicyVersion:POLICY,
    accepts:({taskId,arguments:args,phase,projection})=>bound(taskId,false,tool.descriptor.name)
      && (phase!=='final' || !READ_NAMES.has(tool.descriptor.name) || currentReadResult(tool.descriptor.name,projection,taskId))
      && (!WRITE_NAMES.has(tool.descriptor.name) || writeArguments(args,tool.descriptor.name)),
    project:({taskId,result,signal})=>{
      readable(taskId,signal,tool.descriptor.name);
      if(READ_NAMES.has(tool.descriptor.name)&&!currentReadResult(tool.descriptor.name,result,taskId))
        throw Error('Goal read result is no longer exportable');
      let value;
      if(tool.descriptor.name==='goals.list') {
        value={graphRevision:result.graphRevision,goals:result.goals.map(goal=>scopedGoal(goal,taskId)).filter(Boolean),
          nextAfterId:result.nextAfterId};
      } else if(tool.descriptor.name==='goals.get') {
        value={graphRevision:result.graphRevision,goal:scopedGoal(result.goal,taskId)};
      } else if(result?.kind==='applied') {
        const current=goalHost.get(result.currentGoal.id).goal;
        if(!projectedGoal(current) || current.revision!==result.currentGoal.revision) throw Error('Goal result is no longer exportable');
        value={kind:'applied',graphRevision:result.graphRevision,
          previousGoal:result.previousGoal,currentGoal:result.currentGoal};
      } else if(result?.kind==='conflict'||result?.kind==='rejected') {
        value={kind:result.kind,graphRevision:result.graphRevision};
      } else throw Error('Goal result is invalid');
      if(Buffer.byteLength(JSON.stringify(value),'utf8')>MAX_GOAL_EXPORT_BYTES) throw Error('Goal result exceeds cloud projection limit');
      if(question)question.authorizeExport({...runs.get(taskId),signal},value,'goals-export');
      return structuredClone(value);
    }}));
  const revoke=()=>{allowed=false;if(question&&application)generation=question.rotateResourceGeneration(resourceDigest,generation);
    else generation=randomUUID();runs.clear();return snapshot();};
  return Object.freeze({tools,competitionToolAvailability,competitionToolExports,snapshot,
    prepareExport(scope){
      if(!question||scope.phase!=='preflight'||!ALL_NAMES.has(scope.proposal?.toolName))return;
      const original=application.readAuthorizationQuestionInvocation(scope.taskId,scope.runId);if(!original||!permitted())throw Error('Goal authorization binding is unavailable');
      const exact={...original,signal:scope.signal},captured=generation;
      const stable=createHash('sha256').update(JSON.stringify([resourceDigest,captured,POLICY])).digest('hex');
      question.prepare(exact,{requirements:[{requirementId:'goals-session',kind:'connector_session',scopes:['goals:cloud'],
        bindingDigest:createHash('sha256').update(JSON.stringify([scope.taskId,original.runId,captured])).digest('hex'),
        ruleBindingDigest:stable,summary:'仅此用户命名空间的目标资料；排除受限内容，目标写入仍绑定本次精确参数'}],
        assertCurrent:()=>permitted()&&captured===generation});
      question.prepareExport(exact,{requirementId:'goals-export',ruleBindingDigest:stable,
        summary:'向本任务选定 AgentArts 模型发送目标的固定脱敏字段，每次最多 7500 字节；无凭据与来源路径'});
      runs.set(scope.taskId,exact);
    },
    bindApplication(value) {
      if(application || !active || value?.profile!=='huawei_ict_agentarts' || !value.runtime) throw Error('Goal cloud binding is invalid');
      application=value;
      if(question)generation=question.readResourceGeneration(resourceDigest);
    },
    authorize(input) {
      if(question)throw Error('请在当前对话的统一授权卡允许此操作');
      if(!application || !active || !input || Object.keys(input).length!==1
        || input.goalCloudConsent!==true) throw Error('请明确允许本会话目标内容用于云端');
      revoke();allowed=true;return snapshot();
    },revoke,
    /** Call from the trusted AgentArts pre-send hook for every cloud request. */
    assertCloudSend(request) {
      if(!application || !request?.taskId) return;
      const catalog=application.runtime.loadCheckpoint(request.taskId,CATALOG);
      const offered=catalog?.entries?.some(entry=>ALL_NAMES.has(entry.name));
      const receipts=application.runtime.loadCheckpoint(request.taskId,LOOP)?.receipts;
      const receipt=receipts?.find(item=>item.proposal.proposalId===request.continuation?.proposalId);
      if((offered || ALL_NAMES.has(receipt?.proposal?.toolName))
        && (request.signal?.aborted || !bound(request.taskId))) throw Error('Goal cloud session was revoked');
      if(READ_NAMES.has(receipt?.proposal?.toolName)
        && (!isDeepStrictEqual(receipt.continuation,request.continuation)
          || !currentReadResult(receipt.proposal.toolName,receipt.continuation.result,request.taskId)))
        throw Error('Goal read result is no longer exportable');
    },
    close(){active=false;allowed=false;runs.clear();},
  });
}
