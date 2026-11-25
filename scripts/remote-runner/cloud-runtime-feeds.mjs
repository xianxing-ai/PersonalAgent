import {createHash,randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {HttpFeedProvider,register,feedConfigBinding} from '@personal-agent/feeds';
import {proactiveWorkflowDigest as digest} from '@personal-agent/agentarts';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeProactiveConfirmedSourceRouter,readPersistedRuntimeProactiveWorkflow} from '@personal-agent/runtime/application';

const STATE='cloud-feed-source-v1',READ='cloud-feed-read-v1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(code,message)=>{throw new ProtocolError(code,message);};
const terminal=task=>task.cancelRequested||['succeeded','failed','cancelled','cancelling'].includes(task.state);
/** One explicit public source per cloud responsibility. Tracking never grants tool execution. */
export function createCloudRuntimeFeeds({getApplication,namespace,subscriptions=[],assertCurrent,now=Date.now,provider=new HttpFeedProvider()}) {
  if(!Array.isArray(subscriptions)||subscriptions.length>20)fail('INVALID_ARGUMENT','Bounded cloud feeds required');
  const configured=subscriptions.map(value=>{
    const url=new URL(value.url);
    if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(value.id)||typeof value.title!=='string'||!value.title.trim()||value.title.length>200
      ||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash
      ||!Number.isSafeInteger(value.intervalSeconds)||value.intervalSeconds<60||value.intervalSeconds>86400
      ||Object.keys(value).some(key=>!['id','title','url','intervalSeconds'].includes(key)))
      fail('INVALID_ARGUMENT','Cloud feeds require fixed credential-free public URLs and bounded intervals');
    return {id:value.id,title:value.title,url:url.href,intervalSeconds:value.intervalSeconds};
  });
  if(new Set(configured.map(value=>value.id)).size!==configured.length)fail('INVALID_ARGUMENT','Duplicate cloud feed');
  let workflow,router;
  const app=()=>{assertCurrent();const value=getApplication();if(!value?.runtime)fail('UNSUPPORTED_CAPABILITY','Original cloud Runtime unavailable');return value;};
  const state=binding=>app().runtime.loadCheckpoint(binding.taskId,STATE);
  const save=(binding,value)=>app().runtime.saveCheckpoint(binding.taskId,STATE,value);
  const grants=()=>app().createHostStateStore('knowledge-tracking');
  const grantKey=(sourceId,taskId)=>'feed-source-grant:'+hash({sourceId,taskId});
  const source=sourceId=>{
    assertCurrent();const value=configured.find(item=>item.id===sourceId);if(!value)return null;
    return {namespace,sourceId,subscriptionId:sourceId,configurationRef:feedConfigBinding(value,provider.source),
      sensitivity:'public',containsCredentials:false,available:true};
  };
  const tracking=query=>{
    const value=grants().get(grantKey(query.sourceId,query.taskId)),binding=source(query.sourceId),task=app().runtime.getTask(query.taskId);
    if(query.namespace!==namespace||!value||value.state!=='granted'||!binding||value.configurationRef!==binding.configurationRef
      ||value.namespace!==namespace||value.taskId!==task.taskId||value.conversationId!==task.conversationId
      ||value.purposeDigest!==digest(task.goal)||!(Date.parse(value.expiresAt)>now())||terminal(task))return {state:'none'};
    return value;
  };
  function active(binding) {
    const application=app(),runtime=application.runtime,value=state(binding),original=runtime.getTask(binding.sourceTaskId);
    if(!value||value.version!==1||value.state!=='tracking'||terminal(runtime.getTask(binding.taskId))||terminal(original)
      ||hashText(original.goal)!==binding.goalDigest||Date.parse(binding.taskDeadline)<=now()
      ||runtime.loadCheckpoint(binding.sourceTaskId,'private-copy-erasure')!==undefined
      ||runtime.loadCheckpoint(binding.sourceTaskId,'private-copy-erasure-binding')!==undefined)
      fail('UNAUTHORIZED','Original cloud source responsibility is unavailable');
    const grant=tracking({namespace,sourceId:value.sourceId,taskId:binding.sourceTaskId});
    if(grant.state!=='granted'||grant.revision!==value.revision)fail('UNAUTHORIZED','Original cloud tracking decision is unavailable');
    const saved=readPersistedRuntimeProactiveWorkflow(runtime,binding.taskId,binding.sessionId)?.application.state;
    const control=Object.values(saved?.commands??{}).sort((a,b)=>b.revision-a.revision)[0]?.command.action;
    if(['pause','cancel'].includes(saved?.pendingControl?.action??control))fail('UNAUTHORIZED','Original cloud responsibility is paused or cancelled');
    return value;
  }
  const hashText=value=>createHash('sha256').update(value??'').digest('hex');
  function readOrigin(binding,taskId) {
    const runtime=app().runtime,value=state(binding),origin=runtime.loadCheckpoint(taskId,READ),intent=runtime.loadCheckpoint(taskId,'host-tool-intent');
    if(!value||value.readTaskId!==taskId||origin?.version!==1||origin.workflowTaskId!==binding.taskId||origin.sourceTaskId!==binding.sourceTaskId
      ||origin.sourceId!==value.sourceId||origin.revision!==(value.readRevision??value.revision)||origin.commandId!==value.commandId
      ||runtime.findTaskByIdempotencyKey('host-tool:'+JSON.stringify([namespace,origin.commandId]))?.taskId!==taskId
      ||intent&&(intent.commandId!==origin.commandId||intent.argumentsDigest!==origin.argumentsDigest
        ||intent.toolName!=='feeds.collect'||toolArgumentsDigest(intent.arguments)!==origin.argumentsDigest))
      fail('UNAUTHORIZED','Source read is not the original cloud child operation');
    return origin;
  }
  const tools=[];
  const release=register({register(tool){if(tool.descriptor.name==='feeds.collect')tools.push({...tool,execute:async(input,context)=>{
    const runtime=app().runtime,origin=runtime.loadCheckpoint(context.taskId,READ);
    if(!origin||!workflow)fail('UNAUTHORIZED','Cloud feed has no original source binding');
    const binding=workflow.readBinding(origin.workflowTaskId);active(binding);readOrigin(binding,context.taskId);
    if(toolArgumentsDigest(input)!==origin.argumentsDigest)fail('SCOPE_DENIED','Original cloud feed arguments changed');
    const epoch=runtime.readExecutionEpoch(binding.taskId),result=await tool.execute(input,context);
    runtime.assertExecutionEpoch(binding.taskId,epoch);active(binding);readOrigin(binding,context.taskId);return result;
  }});return ()=>{};}},{provider,subscriptions:configured,trackRevisions:true,now});
  function schedule(binding) {
    const application=app(),runtime=application.runtime,value=active(binding),selected=configured.find(item=>item.id===value.sourceId);
    if(value.readTaskId)return value;
    if(Date.parse(value.nextRunAt)>=Date.parse(binding.taskDeadline))return value;
    const commandId='cloud-feed-'+hash([binding.taskId,value.sourceId,value.revision,value.sequence]);
    const task=application.prepareHostToolTask({commandId,toolName:'feeds.collect',toolVersion:tools[0].descriptor.version,deadline:binding.taskDeadline});
    const args={subscriptionId:selected.id,limit:100,...(value.cursor?{cursor:value.cursor}:{})},origin={version:1,workflowTaskId:binding.taskId,sourceTaskId:binding.sourceTaskId,
      sourceId:selected.id,revision:value.revision,commandId,argumentsDigest:toolArgumentsDigest(args)};
    runtime.saveCheckpointOnce(task.taskId,READ,origin);
    if(digest(runtime.loadCheckpoint(task.taskId,READ))!==digest(origin))fail('REVISION_CONFLICT','Original cloud source read changed');
    router.bindPreparedFeedRead({taskId:task.taskId,expectedTaskRevision:task.revision,trackingTaskId:binding.sourceTaskId,
      commandId,toolVersion:tools[0].descriptor.version,arguments:args});
    const scheduleId='cloud-feed:'+hash([binding.taskId,value.revision,value.sequence]);
    runtime.createSchedule({scheduleId,goal:task.goal,conversationId:task.conversationId,runAt:value.nextRunAt,timeZone:'UTC',
      missedRunPolicy:'run_once',taskIdempotencyKey:'host-tool:'+JSON.stringify([namespace,commandId])});
    const next={...value,readTaskId:task.taskId,readRevision:value.revision,commandId,scheduleId,arguments:args};save(binding,next);return next;
  }
  function restrict(binding,action='cancel') {
    const runtime=app().runtime,value=state(binding);if(!value)return;
    // Pausing prevents new execution through active(); keep the original unsent operation and schedule.
    if(action==='pause'&&(!value.readTaskId||['created','waiting_approval','succeeded'].includes(runtime.getTask(value.readTaskId).state)))return;
    if(value.readTaskId)runtime.requestCancel(value.readTaskId,'Original cloud source responsibility stopped');
    if(value.scheduleId){const conversation='host-tool:'+namespace;
      runtime.reconcileSchedules(conversation,runtime.listSchedules(conversation).filter(item=>item.scheduleId!==value.scheduleId).map(
        ({scheduleId,goal,conversationId,runAt,timeZone,missedRunPolicy,taskIdempotencyKey})=>({scheduleId,goal,conversationId,runAt,timeZone,missedRunPolicy,taskIdempotencyKey})));}
  }
  const host={tools,
    bindWorkflow(value){if(workflow&&workflow!==value)fail('REVISION_CONFLICT','Cloud source workflow changed');workflow=value;
      router=createRuntimeProactiveConfirmedSourceRouter({getApplication:app,getWorkflow:()=>workflow,namespace,
        resolveUserConversation:taskId=>app().runtime.getTask(taskId).conversationId,
        readSourceBinding:source,readTrackingGrant:tracking,readWorkflowBinding:taskId=>workflow.readBinding(taskId),allowPartialPages:true,now});},
    snapshot(binding){const value=state(binding);return configured.map(item=>{
      let status='available';if(value?.sourceId===item.id){status=value.state==='revoked'?'revoked':Date.parse(binding.taskDeadline)<=now()?'expired':'tracking';
        if(status==='tracking'&&value.readTaskId){const task=app().runtime.getTask(value.readTaskId);
          if(['waiting_approval','waiting_reconciliation','failed'].includes(task.state))status=task.state;
          else if(['cancelled','cancelling'].includes(task.state)||value.ingressUnavailable)status='waiting_reconciliation';}}
      return {sourceId:item.id,title:item.title,url:item.url,configurationRef:source(item.id).configurationRef,intervalSeconds:item.intervalSeconds,
        revision:value?.sourceId===item.id?value.revision:0,state:status,...(value?.sourceId===item.id?{
          ...(value.readTaskId?{readTaskId:value.readTaskId}:{}),nextRunAt:value.nextRunAt}:{})};});},
    configure(binding,input,commandId){
      const runtime=app().runtime,selected=source(input.sourceId),previous=state(binding);
      if(!selected||selected.configurationRef!==input.configurationRef||input.expectedRevision!==(previous?.revision??0)
        ||previous&&previous.sourceId!==input.sourceId)fail('REVISION_CONFLICT','Original cloud source choice changed');
      if(input.action==='track'&&(input.readAndCloudConsent!==true||previous))
        fail('UNAUTHORIZED','A cloud responsibility can acquire one explicit public source; use the original readback after admission');
      const original=runtime.getTask(binding.sourceTaskId),revision=(previous?.revision??0)+1;
      if(input.action==='revoke'){
        if(!previous)fail('NOT_FOUND','Original cloud tracking choice does not exist');
        restrict(binding);runtime.requestCancel(binding.taskId,'User revoked public cloud source tracking');
      }
      grants().set(grantKey(input.sourceId,binding.sourceTaskId),{state:input.action==='track'?'granted':'revoked',id:randomUUID(),revision,
        namespace,sourceId:input.sourceId,subscriptionId:input.sourceId,configurationRef:selected.configurationRef,
        taskId:binding.sourceTaskId,conversationId:original.conversationId,purposeDigest:digest(original.goal),
        publicLowRiskTracking:input.action==='track',expiresAt:binding.taskDeadline,classifiedAt:new Date(now()).toISOString(),classificationSource:'native-user-choice'});
      save(binding,{...(previous??{version:1,sourceId:input.sourceId,sequence:0,nextRunAt:new Date(now()).toISOString()}),
        revision,state:input.action==='track'?'tracking':'revoked',sourceCommandId:commandId});
    },
    approvalTaskIds(binding){const value=state(binding);if(!value?.readTaskId)return [];readOrigin(binding,value.readTaskId);return [value.readTaskId];},
    assertReadCurrent(binding,taskId){active(binding);readOrigin(binding,taskId);},restrict,
    async maintain(binding,context){
      const value=state(binding);if(!value||value.state!=='tracking')return {state:'unavailable'};
      try{active(binding);}catch{return {state:'unavailable'};}
      const application=app(),runtime=application.runtime,current=schedule(binding);if(!current.readTaskId)return {state:'expired'};
      runtime.recoverMissedSchedules('host-tool:'+namespace);runtime.dispatchDueSchedules('host-tool:'+namespace);
      if(runtime.getSchedule(current.scheduleId).status!=='fired')return {state:'scheduled'};
      readOrigin(binding,current.readTaskId);
      const task=runtime.getTask(current.readTaskId),intent=runtime.loadCheckpoint(task.taskId,'host-tool-intent');
      if(!intent&&task.state==='created')application.finalizeHostToolTask({taskId:task.taskId,commandId:current.commandId,
        expectedTaskRevision:task.revision,arguments:current.arguments});
      const read=application.readHostToolTask(task.taskId);
      if(read.task.state==='waiting_approval'&&read.approval?.state==='allowed')application.resumeHostToolTask(task.taskId);
      if(read.task.state!=='succeeded'||!read.confirmed)return {state:read.task.state};
      const routed=await router.routeConfirmedFeed({workflowTaskId:binding.taskId,taskId:task.taskId,runId:read.confirmed.runId,
        toolVersion:tools[0].descriptor.version,arguments:current.arguments,scopeRef:read.confirmed.runId,trackingTaskId:binding.sourceTaskId},context);
      if(!['persisted','already_persisted','no_changes'].includes(routed.state)){
        save(binding,{...current,ingressUnavailable:true});return {state:'unavailable'};}
      active(binding);const selected=configured.find(item=>item.id===current.sourceId);
      save(binding,{version:1,sourceId:current.sourceId,revision:current.revision,state:'tracking',sourceCommandId:current.sourceCommandId,
        sequence:current.sequence+1,cursor:routed.nextCursor,
        nextRunAt:new Date(Date.parse(read.task.updatedAt)+(routed.hasMore?0:selected.intervalSeconds*1000)).toISOString()});
      return {state:routed.state};
    },close(){release();}};
  return host;
}
