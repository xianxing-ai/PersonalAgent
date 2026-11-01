import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {calendarSnapshotVersion} from '@personal-agent/calendar';
import {getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {createF06TodoWorkflowPorts} from './f06-todo-workflow-ports.js';
import {createF07CalendarWorkflowPorts} from './f07-calendar-workflow-ports.js';
import {createF11CalendarWorkflowPorts} from './f11-calendar-workflow-ports.js';
import {createF12ConfiguredNotificationPorts} from './f12-notification-workflow-ports.js';
import {createF08MailWorkflowPorts} from './f08-mail-workflow-ports.js';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const text={type:'string',minLength:1,maxLength:1024};
const instant={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$'};
const f06Schema=object({todoTitle:{...text,maxLength:200},due:instant,remindUtc:instant},['todoTitle','remindUtc']);
const f07Schema=object({title:{...text,maxLength:200},slot:object({startUtc:instant,endUtc:instant,location:{...text,maxLength:512}},['startUtc','endUtc']),
  calendarReadArguments:object({fromUtc:instant,toUtc:instant,limit:{type:'integer',minimum:1,maximum:100}},['fromUtc','toUtc'])});
const f06Write=input=>({todoTitle:input.todoTitle,...(input.due!==undefined?{due:input.due}:{}),remindUtc:input.remindUtc});
const calendarCreate=input=>({summary:input.title,startUtc:input.slot.startUtc,endUtc:input.slot.endUtc,
  ...(input.slot.location!==undefined?{location:input.slot.location}:{})});
const canonicalInstant=value=>{
  const time=Date.parse(value),canonical=Number.isFinite(time)?new Date(time).toISOString():'';
  if(canonical!==(value.includes('.')?value:value.replace('Z','.000Z')))fail('INVALID_ARGUMENT','Business time is not a valid UTC instant');
  return canonical;
};

/** Fixed business graph composition. The caller supplies the pinned image separately.
 * This facade resolves the real application only at execution, before any Runtime exists at startup. */
export function createBusinessWorkflowWorkerPorts({runtimeModule,getApplication,businessTools=[],todoHost,notificationHost,
  competitionToolExports=[],prepareCompetitionToolExport,authorizeExport,readBusinessAvailability,now=Date.now}={}) {
  const tools=[],hosts=[],configuredWorkflowWorkerPorts=[],unavailable=[];
  if(!runtimeModule||typeof getApplication!=='function'||typeof authorizeExport!=='function'
    ||typeof readBusinessAvailability!=='function'||typeof prepareCompetitionToolExport!=='function'
    ||typeof runtimeModule.createWorkflowBusinessToolBridge!=='function')
    return {tools,hosts,configuredWorkflowWorkerPorts,unavailable:['business_workflow_trusted_ports_unavailable']};
  const lazy=read=>new Proxy({}, {get:(_,key)=> (...args)=>{
    const target=read();if(typeof target?.[key]!=='function')fail('UNSUPPORTED_CAPABILITY','Original Runtime method unavailable');
    return target[key](...args);
  }});
  const runtime=lazy(()=>getApplication()?.runtime),methods=lazy(()=>getApplication());
  const application=new Proxy({runtime},{get:(target,key)=>key==='runtime'?target.runtime:methods[key]});
  const descriptor=name=>businessTools.find(tool=>tool.descriptor?.name===name)?.descriptor;
  const operation=(bound,nodeId,toolName)=>bound.confirmedOperations.find(item=>item.nodeId===nodeId&&item.toolName===toolName);
  const completedNode=(bound,nodeId)=>operation(bound,nodeId,['F06_N02','F07_N03','F08_N02','F08_N04','F08_N05','F11_N03','F12_N03'].includes(nodeId)?'decision.choose_candidate'
    :['F07_N02','F11_N02'].includes(nodeId)?'calendar.events':nodeId==='F08_N01'?'mail.inbox':nodeId==='F08_N09'?'knowledge.search'
      :nodeId==='F08_N11'?'mail.reconcile_send':'workflow.host.'+nodeId.toLowerCase());
  const skippedClarification=(workflowId,bound,state,nodeId)=>(workflowId==='F11'&&nodeId==='F11_N04'||workflowId==='F08'&&nodeId==='F08_N06')
    &&state.result?.nodes[nodeId]?.state==='skipped'&&operation(bound,nodeId,'workflow.guard.'+nodeId.toLowerCase())?.result.state==='skipped';
  const graphScope=scope=>({taskId:scope.parentTaskId??scope.taskId,deadline:scope.deadline,signal:scope.signal});
  function current(workflowId,scope,input) {
    const own=graphScope(scope);
    if(own.signal?.aborted)fail('CANCELLED','Business workflow cancelled');
    if(!Number.isFinite(Date.parse(own.deadline))||Date.parse(own.deadline)<=now())fail('TIMEOUT','Business workflow deadline expired');
    const task=getApplication()?.runtime?.getTask(own.taskId);
    if(!task||task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state))
      fail('UNAUTHORIZED','Original business workflow is no longer active');
    const availability=readBusinessAvailability(workflowId,own);
    if(availability?.ready!==true||typeof availability.bindingId!=='string'||!availability.bindingId)
      fail('UNSUPPORTED_CAPABILITY','Business account or device is unavailable');
    const saved=runtime.loadCheckpoint(own.taskId,'business-workflow:'+workflowId+':availability');
    if(saved&&(saved.bindingId!==availability.bindingId||saved.deadline!==own.deadline))
      fail('REVISION_CONFLICT','Original business availability binding changed');
    if(input&&availability.bindingId!==input.businessBindingId)fail('REVISION_CONFLICT','Business account or device binding changed');
    return availability.bindingId;
  }
  function binding(workflowId,scope) {
    const own=graphScope(scope),bound=getApplication().readConfiguredWorkflowBinding({taskId:own.taskId,workflowId,
      sessionId:scope.sessionId,signal:scope.signal});
    if(!bound||bound.deadline!==scope.deadline)fail('UNAUTHORIZED','Original configured business graph unavailable');
    current(workflowId,scope,bound.input);return bound;
  }
  const receiptExport=workflowId=>async(scope,value)=>{
    binding(workflowId,scope);
    const allowed=await authorizeExport({...graphScope(scope),workflowId,stage:'receipt',value});
    binding(workflowId,scope);return allowed===true;
  };
  function addHost(host) {
    if(host?.tools?.length){hosts.push(host);tools.push(...host.tools);return true;}
    unavailable.push(host?.unavailable??'business_host_unavailable');return false;
  }
  function originalReceipt(taskId,scope,expected) {
    const app=getApplication(),readback=app.readHostToolTask(taskId),intent=runtime.loadCheckpoint(taskId,'host-tool-intent');
    const runId='host-tool-'+taskId,tool=[...businessTools,...tools].find(item=>item.descriptor.name===intent?.toolName
      &&item.descriptor.version===intent?.toolVersion)?.descriptor;
    const record=app.runtime.readToolExecutions(taskId).find(item=>item.evidenceId===runId);
    if(!intent||!tool||intent.deadline!==scope.deadline||readback.task.state!=='succeeded'||readback.commandId!==intent.commandId
      ||readback.toolName!==tool.name||readback.toolVersion!==tool.version||readback.confirmed?.runId!==runId
      ||!readback.confirmed.evidenceRefs.includes(runId)||!isDeepStrictEqual(readback.confirmed.result,expected)
      ||!record||record.toolName!==tool.name||record.toolVersion!==tool.version||record.policyDecision!=='allow'
      ||!record.executionStarted||record.state!=='confirmed'
      ||!runtime.matchesToolExecutionInput(record,{arguments:intent.arguments,scopeRef:runId}))
      fail('UNAUTHORIZED','Original business result evidence unavailable');
    return {intent,tool,context:{taskId,runId,authorizationRef:runId,scopes:[...tool.requiredScopes],deadline:scope.deadline,signal:scope.signal}};
  }
  async function exportBusinessResult(taskId,result,scope) {
    const {intent,tool,context}=originalReceipt(taskId,scope,result);
    const policy=competitionToolExports.find(item=>item.toolName===tool.name&&item.toolVersion===tool.version);
    if(!policy)fail('UNSUPPORTED_CAPABILITY','Original business result export policy unavailable');
    const proposal={kind:'tool_proposal',proposalId:intent.commandId,toolName:tool.name,toolVersion:tool.version,
      arguments:structuredClone(intent.arguments),verification:'unverified'};
    const exportScope={taskId,proposalId:intent.commandId,arguments:structuredClone(intent.arguments),signal:scope.signal};
    if(policy.accepts({...exportScope,phase:'preflight'})!==true)fail('UNAUTHORIZED','Original business result export scope denied');
    await prepareCompetitionToolExport({phase:'projection',taskId,runId:context.runId,proposal,deadline:scope.deadline,signal:scope.signal});
    const projection=await policy.project({taskId,proposalId:intent.commandId,result:structuredClone(result),signal:scope.signal});
    originalReceipt(taskId,scope,result);
    if(!isDeepStrictEqual(projection,result)||policy.accepts({...exportScope,phase:'final',projection})!==true)
      fail('UNAUTHORIZED','Business graph result exceeds the original export projection');
  }
  function child(workflowId,mappings) {
    let bridge,originalApplication;
    const getBridge=()=>{
      if(originalApplication&&originalApplication!==getApplication())fail('REVISION_CONFLICT','Original business Runtime changed');
      if(bridge)return bridge;
      originalApplication=getApplication();
      bridge=runtimeModule.createWorkflowBusinessToolBridge({application:originalApplication,now:()=>new Date(now()),
      assertCurrent:scope=>{binding(workflowId,scope);},
      resolveTool(request,scope){
        const bound=binding(workflowId,scope),mapping=mappings[request.actionKey];
        if(!mapping)fail('UNAUTHORIZED','Business action is not host configured');
        const [nodeId,toolName,arguments_,hostToolName='workflow.host.'+nodeId.toLowerCase()]=mapping(bound.input),tool=descriptor(toolName);
        if(!tool||!isDeepStrictEqual(request.input,arguments_))fail('UNAUTHORIZED','Business child descriptor or arguments changed');
        return {workflowId,nodeId,hostToolName,toolName,
          toolVersion:tool.version,arguments:structuredClone(arguments_)};
      }});return bridge;
    };
    return {read:(request,context)=>getBridge().read(request,context),async invoke(request,context){
      const receipt=await getBridge().invoke(request,context);
      await exportBusinessResult(receipt.taskId,receipt.result,context);return receipt;
    }};
  }
  function config(workflowId,requestSchema,requiredNames,resultSchema,frontier,complete,recheckCompletion,prepareInput) {
    const all=[...businessTools,...tools],requiredTools=requiredNames.map(name=>({name,
      version:name==='decision.choose_candidate'?'1.0.0':all.find(tool=>tool.descriptor.name===name)?.descriptor.version}));
    if(requiredTools.some(tool=>!tool.version)){unavailable.push(workflowId.toLowerCase()+'_required_tools_unavailable');return;}
    if(requiredTools.some(tool=>businessTools.some(item=>item.descriptor.name===tool.name)
      &&!competitionToolExports.some(item=>item.toolName===tool.name&&item.toolVersion===tool.version))){
      unavailable.push(workflowId.toLowerCase()+'_business_export_policy_unavailable');return;
    }
    const inputSchema={...requestSchema,properties:{...requestSchema.properties,businessBindingId:text},required:[...requestSchema.required,'businessBindingId']};
    const worker={workflowId,toolName:'workflow.business.'+workflowId.toLowerCase(),toolVersion:'1.0.0',
      configurationVersion:workflowId==='F06'?'business-20261031-f06-v2':workflowId==='F12'?'business-20261101-f12-v2':'business-20261031-v1',
      requestSchema,inputSchema,resultSchema,requiredTools,publicEnumPaths:workflowId==='F12'?['/trigger']:[],sideEffect:'external_write',
      available(scope){try{current(workflowId,scope);return true;}catch{return false;}},
      async resolveInput(arguments_,scope){
        validateToolValue(requestSchema,arguments_);const businessBindingId=current(workflowId,scope);
        arguments_=structuredClone(arguments_);
        if(workflowId==='F06'&&(!Number.isFinite(Date.parse(arguments_.remindUtc))
          ||arguments_.due!==undefined&&!Number.isFinite(Date.parse(arguments_.due))))fail('INVALID_ARGUMENT','Todo reminder time invalid');
        if(workflowId==='F06'){
          arguments_.remindUtc=canonicalInstant(arguments_.remindUtc);
          if(arguments_.due!==undefined)arguments_.due=canonicalInstant(arguments_.due);
        }
        if(workflowId==='F07'){
          const {slot,calendarReadArguments:window}=arguments_;
          if(!(Date.parse(window.fromUtc)<=Date.parse(slot.startUtc)&&Date.parse(slot.startUtc)<Date.parse(slot.endUtc)
            &&Date.parse(slot.endUtc)<=Date.parse(window.toUtc)))fail('INVALID_ARGUMENT','Calendar slot must fit the original read window');
          for(const [value,keys]of [[slot,['startUtc','endUtc']],[window,['fromUtc','toUtc']]])
            for(const key of keys)value[key]=canonicalInstant(value[key]);
        }
        if(workflowId==='F11'){
          const window=arguments_.calendarReadArguments;
          window.fromUtc=canonicalInstant(window.fromUtc);window.toUtc=canonicalInstant(window.toUtc);
          if(Date.parse(window.fromUtc)>=Date.parse(window.toUtc))fail('INVALID_ARGUMENT','F11 original calendar window must ascend');
          for(const key of ['startUtc','endUtc'])if(arguments_.update[key]!==undefined)arguments_.update[key]=canonicalInstant(arguments_.update[key]);
          if(arguments_.update.startUtc&&arguments_.update.endUtc&&Date.parse(arguments_.update.startUtc)>=Date.parse(arguments_.update.endUtc))
            fail('INVALID_ARGUMENT','F11 explicit update time must ascend');
        }
        runtime.saveCheckpointOnce(scope.taskId,'business-workflow:'+workflowId+':availability',{bindingId:businessBindingId,deadline:scope.deadline});
        if(prepareInput)await prepareInput(arguments_,scope);
        current(workflowId,scope);
        return {...structuredClone(arguments_),businessBindingId};
      },
      assertCurrent:scope=>{current(workflowId,scope);},
      async assertFrontier(scope){
        current(workflowId,scope,scope.input);
        const bound=binding(workflowId,{...scope,sessionId:scope.state.sessionId});
        if(!isDeepStrictEqual(bound.input,scope.input))return false;
        const template=getOwnedWorkflowTemplate(workflowId),node=template.nodes.find(item=>item.id===scope.proposal.nodeId);
        if(!node||node.dependencies.some(edge=>edge.required&&scope.state.result?.nodes[edge.nodeId]?.state!=='completed'
          &&!skippedClarification(workflowId,bound,scope.state,edge.nodeId)))return false;
        if(node.dependencies.some(edge=>edge.required&&!['input','assemble'].includes(template.nodes.find(item=>item.id===edge.nodeId)?.kind)
          &&!completedNode(bound,edge.nodeId)&&!skippedClarification(workflowId,bound,scope.state,edge.nodeId)))return false;
        if(scope.proposal.toolName==='decision.choose_candidate'){
          let context;try{context=JSON.parse(scope.proposal.arguments.context);}catch{return false;}
          // A semantic selection never widens the fixed plan used by the business write checks below.
          return context.workflowId===workflowId&&context.nodeId===node.id&&node.kind!=='input';
        }
        return frontier(scope,bound);
      },
      async authorizeExport(scope){
        current(workflowId,scope,scope.stage==='initial'?scope.value:undefined);
        if(scope.stage==='completion'&&recheckCompletion)await recheckCompletion(scope);
        if(scope.stage==='receipt'&&scope.value?.state==='confirmed'){
          const host=hosts.find(item=>item.tools.some(tool=>tool.descriptor.name===scope.proposal?.toolName));
          if(host?.authorizeReceipt){
            const {context}=originalReceipt(scope.localTaskId,scope,scope.value.result);
            await host.authorizeReceipt({context,result:structuredClone(scope.value.result)});
          }else if(businessTools.some(tool=>tool.descriptor.name===scope.proposal?.toolName))
            await exportBusinessResult(scope.localTaskId,scope.value.result,scope);
        }
        const result=await authorizeExport({...scope,workflowId});current(workflowId,scope,scope.stage==='initial'?scope.value:undefined);
        if(scope.stage==='completion'&&recheckCompletion)await recheckCompletion(scope);
        return result===true;
      },
      async verifyCompletion(scope){
        current(workflowId,scope,scope.input);
        const bound=binding(workflowId,{...scope,sessionId:scope.state.sessionId});
        if(!isDeepStrictEqual(bound.input,scope.input)||getOwnedWorkflowTemplate(workflowId).nodes.some(node=>node.required
          &&!(workflowId==='F06'&&node.id==='F06_N05'&&scope.state.result?.nodes[node.id]?.state==='skipped'
            &&operation(bound,node.id,'workflow.guard.f06_n05')?.result.state==='skipped')
          &&(scope.state.result?.nodes[node.id]?.state!=='completed'||!['input','assemble'].includes(node.kind)&&!completedNode(bound,node.id))))
          fail('RESULT_UNKNOWN','Business workflow required nodes are incomplete');
        const result=await complete(scope,bound);current(workflowId,scope,scope.input);return result;
      }};
    configuredWorkflowWorkerPorts.push(worker);
  }
  if(todoHost?.snapshot&&notificationHost?.reconcileDelivery&&descriptor('todo.create')
    &&runtimeModule.createRuntimeF06TodoWriteHost&&runtimeModule.createRuntimeF06NotificationDeliverHost&&runtimeModule.createRuntimeF06ReminderGuard){
    const bridge=child('F06',{'f06.todo.create':input=>['F06_N03','todo.create',{title:input.todoTitle,
      ...(input.due!==undefined?{dueUtc:input.due}:{}),remindUtc:input.remindUtc}]});
    const ports=createF06TodoWorkflowPorts({getApplication,bridge,todoHost,notificationHost,authorizeExport:receiptExport('F06'),now});
    const hostOptions={...ports,application,assertCurrent:scope=>{binding('F06',scope);},now:()=>new Date(now())};
    addHost(runtimeModule.createRuntimeF06TodoWriteHost({...hostOptions,requiredScopes:descriptor('todo.create').requiredScopes}));
    addHost(runtimeModule.createRuntimeF06NotificationDeliverHost({...hostOptions,requiredScopes:['notifications:deliver']}));
    addHost(runtimeModule.createRuntimeF06ReminderGuard({...hostOptions,requiredScopes:['todo:read']}));
    config('F06',f06Schema,['decision.choose_candidate','todo.create','workflow.host.f06_n03','workflow.host.f06_n04','workflow.guard.f06_n05','workflow.host.f06_n05'],
      object({todoId:text,reminderState:{type:'string',enum:['scheduled','delivered']},delivered:{type:'boolean'}}),async(scope,bound)=>{
        const {proposal}=scope,saved=runtime.loadCheckpoint(scope.taskId,'f06:n03-todo:'+scope.state.sessionId);
        if(proposal.nodeId==='F06_N03'&&proposal.toolName==='workflow.host.f06_n03')return isDeepStrictEqual(proposal.arguments,f06Write(bound.input));
        const identity=saved&&{todoId:saved.todoId,revision:saved.revision};
        if(proposal.nodeId==='F06_N04'&&proposal.toolName==='workflow.host.f06_n04')return !!identity&&isDeepStrictEqual(proposal.arguments,identity);
        if(proposal.nodeId==='F06_N05'&&proposal.toolName==='workflow.guard.f06_n05')return !!identity&&isDeepStrictEqual(proposal.arguments,{
          workflowId:'F06',nodeId:'F06_N05',input:bound.input,predecessorStates:{F06_N04:'completed'},
          predecessorOutputs:{F06_N04:operation(bound,'F06_N04','workflow.host.f06_n04')?.result}});
        if(proposal.nodeId==='F06_N05'&&proposal.toolName==='workflow.host.f06_n05')return !!identity&&isDeepStrictEqual(proposal.arguments,{notification:identity})
          &&operation(bound,'F06_N04','workflow.host.f06_n04')?.result.shouldFireAlarm===true
          &&operation(bound,'F06_N05','workflow.guard.f06_n05')?.result.state==='selected';
        return false;
      },async(scope,bound)=>{
        const created=operation(bound,'F06_N03','workflow.host.f06_n03'),delivered=operation(bound,'F06_N05','workflow.host.f06_n05');
        const saved=runtime.loadCheckpoint(scope.taskId,'f06:n03-todo:'+scope.state.sessionId);
        if(!created||!saved||created.result.todoId!==saved.todoId)
          fail('RESULT_UNKNOWN','F06 original Todo or delivery receipt unavailable');
        const originalScope={...scope,parentTaskId:scope.taskId,sessionId:scope.state.sessionId};
        if(scope.state.result.nodes.F06_N05.state==='skipped'){
          await ports.readScheduledReminder(originalScope);
          const result={todoId:saved.todoId,reminderState:'scheduled',delivered:false};
          runtime.saveCheckpointOnce(scope.taskId,'business-workflow:F06:completion',{sessionId:scope.state.sessionId,result});
          return {result,resultSummary:'Original Todo reminder schedule persisted; not yet delivered'};
        }
        if(delivered?.result.delivered!==true||operation(bound,'F06_N05','workflow.guard.f06_n05')?.result.state!=='selected')
          fail('RESULT_UNKNOWN','F06 original delivery condition or receipt unavailable');
        const result=await ports.deliverNotification(originalScope,
          {notification:{todoId:saved.todoId,revision:saved.revision}});
        if(result.delivered!==true)fail('RESULT_UNKNOWN','F06 original notification is not delivered');
        const completion={todoId:saved.todoId,reminderState:'delivered',delivered:true};
        runtime.saveCheckpointOnce(scope.taskId,'business-workflow:F06:completion',{sessionId:scope.state.sessionId,result:completion});
        return {result:completion,resultSummary:'Original Todo reminder delivery confirmed'};
      },async scope=>{
        const completion=runtime.loadCheckpoint(scope.taskId,'business-workflow:F06:completion');
        if(!completion||!isDeepStrictEqual(completion.result,scope.value))fail('UNAUTHORIZED','F06 original completion changed');
        const originalScope={...scope,parentTaskId:scope.taskId,sessionId:completion.sessionId};
        if(completion.result.reminderState==='scheduled')await ports.readScheduledReminder(originalScope);
        else{
          const saved=runtime.loadCheckpoint(scope.taskId,'f06:n03-todo:'+completion.sessionId);
          if(!saved||(await ports.deliverNotification(originalScope,{notification:{todoId:saved.todoId,revision:saved.revision}})).delivered!==true)
            fail('RESULT_UNKNOWN','F06 original delivery is no longer confirmed');
        }
      });
  }else unavailable.push('f06_business_dependencies_unavailable');
  if(descriptor('calendar.events')&&descriptor('calendar.create')&&runtimeModule.createRuntimeF07CalendarFreshnessHost
    &&runtimeModule.createRuntimeF07CalendarWriteHost){
    const mappings={'f07.calendar.create':input=>['F07_N05','calendar.create',calendarCreate(input)]};
    for(const phase of ['execute','before_export','after_export'])mappings['f07.calendar.recheck.'+phase]=input=>['F07_N04','calendar.events',input.calendarReadArguments];
    const bridge=child('F07',mappings),ports=createF07CalendarWorkflowPorts({getApplication,bridge,authorizeExport:receiptExport('F07'),now});
    const hostOptions={...ports,application,assertCurrent:scope=>{binding('F07',scope);},now:()=>new Date(now())};
    addHost(runtimeModule.createRuntimeF07CalendarFreshnessHost({...hostOptions,requiredScopes:descriptor('calendar.events').requiredScopes}));
    addHost(runtimeModule.createRuntimeF07CalendarWriteHost({...hostOptions,calendarCreate:businessTools.find(tool=>tool.descriptor.name==='calendar.create'),
      requiredScopes:descriptor('calendar.create').requiredScopes}));
    config('F07',f07Schema,['decision.choose_candidate','calendar.events','calendar.create','workflow.host.f07_n04','workflow.host.f07_n05'],
      object({eventId:text,eventCreated:{const:true},externalInviteHeld:{const:false}}),async(scope,bound)=>{
        const {proposal}=scope;
        if(proposal.nodeId==='F07_N02'&&proposal.toolName==='calendar.events')return isDeepStrictEqual(proposal.arguments,bound.input.calendarReadArguments);
        const original=operation(bound,'F07_N02','calendar.events')?.result;
        if(!original||original.hasMore!==false||original.nextCursor!==''||original.sourceVersion!==calendarSnapshotVersion(original.window,original.items))return false;
        if(proposal.nodeId==='F07_N04'&&proposal.toolName==='workflow.host.f07_n04')
          return isDeepStrictEqual(proposal.arguments,{calendarVersionAtRead:original.sourceVersion,calendarVersionNow:original.sourceVersion});
        if(proposal.nodeId==='F07_N05'&&proposal.toolName==='workflow.host.f07_n05'){
          const slot=bound.input.slot,fresh=operation(bound,'F07_N04','workflow.host.f07_n04')?.result;
          const overlaps=original.items.some(item=>{const [start,end]=String(item.validFor).split('/');
            return !Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))
              ||Date.parse(start)<Date.parse(slot.endUtc)&&Date.parse(end)>Date.parse(slot.startUtc);});
          return !overlaps&&fresh?.versionConsistent===true&&fresh.sourceVersion===original.sourceVersion
            &&isDeepStrictEqual(proposal.arguments,{title:bound.input.title,slot});
        }
        return false;
      },async(scope,bound)=>{
        const result=operation(bound,'F07_N05','workflow.host.f07_n05')?.result;
        if(result?.eventCreated!==true||result.externalInviteHeld!==false)fail('RESULT_UNKNOWN','F07 original creation receipt unavailable');
        const item=ports.readCreatedEvent({...scope,parentTaskId:scope.taskId,sessionId:scope.state.sessionId});
        if(typeof item.externalId!=='string'||!item.externalId)fail('RESULT_UNKNOWN','F07 original event identifier unavailable');
        return {result:{eventId:item.externalId,eventCreated:true,externalInviteHeld:false},resultSummary:'Original calendar creation and provider readback confirmed'};
      });
  }else unavailable.push('f07_business_dependencies_unavailable');
  if(todoHost?.snapshot&&descriptor('calendar.events')&&descriptor('calendar.update')&&descriptor('todo.update')?.inputSchema?.properties?.expectedRevision
    &&runtimeModule.createRuntimeF11CalendarChangeHost&&runtimeModule.createRuntimeF11PlanGuards){
    const f11Schema=object({calendarReadArguments:structuredClone(f07Schema.properties.calendarReadArguments),
      update:{...structuredClone(descriptor('calendar.update').inputSchema),minProperties:2},
      reminder:object({todoId:text,revision:{type:'integer',minimum:1},scheduleId:text,conversationId:text})});
    const selectedValue=bound=>{
      const selected=operation(bound,'F11_N03','decision.choose_candidate');
      const intent=selected&&runtime.loadCheckpoint(selected.localTaskId,'host-tool-intent');let context;
      try{context=JSON.parse(intent?.arguments.context);}catch{fail('UNAUTHORIZED','F11 original decision context unavailable');}
      const value=context.candidateValues?.find(candidate=>candidate.id===selected.result.selectedId)?.value;
      if(!value||value.requiresVoiceConfirm!==false||!isDeepStrictEqual(value.recommendedAlternative,{update:bound.input.update,reminder:bound.input.reminder}))
        fail('UNSUPPORTED_CAPABILITY','F11 missing decisions require an original voice clarification source');
      return value;
    };
    const sourcePlan=bound=>{
      const read=operation(bound,'F11_N02','calendar.events'),result=read?.result,window=bound.input.calendarReadArguments;
      if(!read||!isDeepStrictEqual(runtime.loadCheckpoint(read.localTaskId,'host-tool-intent')?.arguments,window)
        ||result?.hasMore!==false||result.nextCursor!==''||!isDeepStrictEqual(result.window,{fromUtc:window.fromUtc,toUtc:window.toUtc})
        ||result.sourceVersion!==calendarSnapshotVersion(result.window,result.items)
        ||result.items.filter(item=>item.externalId===(bound.input.update.externalId??bound.input.update.uid)).length!==1)
        fail('UNAUTHORIZED','F11 original complete event read unavailable');
      selectedValue(bound);return result.sourceVersion;
    };
    const bridge=child('F11',{
      'f11.calendar.recheck':input=>['F11_N05','calendar.events',input.calendarReadArguments],
      'f11.calendar.update':input=>['F11_N05','calendar.update',input.update],
      'f11.reminder.clear':input=>['F11_N05','todo.update',{id:input.reminder.todoId,expectedRevision:input.reminder.revision,clearReminder:true}],
    });
    const ports=createF11CalendarWorkflowPorts({getApplication,bridge,todoHost,authorizeExport:receiptExport('F11'),now});
    const hostOptions={...ports,application,assertCurrent:scope=>{binding('F11',scope);},now:()=>new Date(now())};
    addHost(runtimeModule.createRuntimeF11PlanGuards({...hostOptions,requiredScopes:['calendar:read','todo:read'],
      async resolvePlanGuard(scope,nodeId){
        const bound=binding('F11',scope);sourcePlan(bound);
        if(!await ports.verifyPlan(scope,{update:bound.input.update,reminder:bound.input.reminder}))fail('REVISION_CONFLICT','F11 original reminder plan changed');
        if(nodeId==='F11_N04')return 'skipped';
        if(operation(bound,'F11_N04','workflow.guard.f11_n04')?.result.state!=='skipped')fail('UNAUTHORIZED','F11 original clarification condition missing');
        return 'selected';
      }}));
    addHost(runtimeModule.createRuntimeF11CalendarChangeHost({...hostOptions,
      calendarUpdate:businessTools.find(tool=>tool.descriptor.name==='calendar.update'),
      requiredScopes:[...new Set([...descriptor('calendar.update').requiredScopes,...descriptor('todo.update').requiredScopes])],
      async verifyPlan(scope,input){sourcePlan(binding('F11',scope));return ports.verifyPlan(scope,input);},
      async invokeCalendarUpdate(scope,input,context){
        const bound=binding('F11',scope),version=sourcePlan(bound);
        const receipt=await bridge.invoke({actionKey:'f11.calendar.recheck',input:bound.input.calendarReadArguments},context);
        if(receipt.result?.sourceVersion!==version||receipt.result.hasMore!==false||receipt.result.nextCursor!==''
          ||receipt.result.sourceVersion!==calendarSnapshotVersion(receipt.result.window,receipt.result.items))
          fail('REVISION_CONFLICT','F11 original calendar window changed before update');
        return ports.invokeCalendarUpdate(scope,input,context);
      }}));
    const verifyChange=async scope=>{
      const original=ports.readChangeBinding(scope);
      if(!original)fail('RESULT_UNKNOWN','F11 original change binding unavailable');
      return runtimeModule.verifyF11ConfirmedCalendarAndReminder({application,...ports},scope,original);
    };
    config('F11',f11Schema,['decision.choose_candidate','calendar.events','calendar.update','todo.update',
      'workflow.guard.f11_n04','workflow.guard.f11_n05','workflow.host.f11_n05'],object({eventId:text,calendarUpdated:{const:true},oldTrafficAlarmVoided:{const:true}}),
      async(scope,bound)=>{
        const {proposal}=scope;
        if(proposal.nodeId==='F11_N02'&&proposal.toolName==='calendar.events')return isDeepStrictEqual(proposal.arguments,bound.input.calendarReadArguments);
        sourcePlan(bound);
        if(['F11_N04','F11_N05'].includes(proposal.nodeId)&&proposal.toolName==='workflow.guard.'+proposal.nodeId.toLowerCase()){
          const predecessors=proposal.nodeId==='F11_N04'?{F11_N03:selectedValue(bound)}:{F11_N03:selectedValue(bound),F11_N04:null};
          const states=proposal.nodeId==='F11_N04'?{F11_N03:'completed'}:{F11_N03:'completed',F11_N04:'skipped'};
          return isDeepStrictEqual(proposal.arguments,{workflowId:'F11',nodeId:proposal.nodeId,input:bound.input,predecessorOutputs:predecessors,predecessorStates:states});
        }
        return proposal.nodeId==='F11_N05'&&proposal.toolName==='workflow.host.f11_n05'
          &&operation(bound,'F11_N05','workflow.guard.f11_n05')?.result.state==='selected'
          &&isDeepStrictEqual(proposal.arguments,{update:bound.input.update,reminder:bound.input.reminder});
      },async(scope,bound)=>{
        const result=operation(bound,'F11_N05','workflow.host.f11_n05')?.result;
        if(result?.calendarUpdated!==true||result.oldTrafficAlarmVoided!==true)fail('RESULT_UNKNOWN','F11 original change receipt unavailable');
        await verifyChange({...scope,parentTaskId:scope.taskId,sessionId:scope.state.sessionId});
        const completion={eventId:bound.input.update.externalId??bound.input.update.uid,calendarUpdated:true,oldTrafficAlarmVoided:true};
        runtime.saveCheckpointOnce(scope.taskId,'business-workflow:F11:completion',{sessionId:scope.state.sessionId,result:completion});
        return {result:completion,resultSummary:'Original calendar update and old reminder cancellation confirmed'};
      },async scope=>{
        const original=runtime.loadCheckpoint(scope.taskId,'business-workflow:F11:completion');
        if(!original||!isDeepStrictEqual(original.result,scope.value))fail('UNAUTHORIZED','F11 original completion changed');
        await verifyChange({...scope,parentTaskId:scope.taskId,sessionId:original.sessionId});
      });
    unavailable.push('f11_missing_decision_voice_source_unavailable');
  }else unavailable.push('f11_business_dependencies_unavailable');
  if(['deliverRound','getDigest','getInterruptionPolicy','getLegacyPolicy','drain'].every(name=>typeof notificationHost?.[name]==='function')&&runtimeModule.createRuntimeF12ConfiguredReadHosts
    &&runtimeModule.createRuntimeF12NotificationDeliverHost){
    const ports=createF12ConfiguredNotificationPorts({getApplication,notificationHost,now});
    const selectionSchema={...object({itemId:text,itemIds:{type:'array',minItems:1,uniqueItems:true,items:text}},[]),
      oneOf:[{required:['itemId'],not:{required:['itemIds']}},{required:['itemIds'],not:{required:['itemId']}}]};
    const hostOptions={...ports,application,assertCurrent:scope=>{binding('F12',scope);ports.source(scope);},now:()=>new Date(now()),
      authorizeExport:receiptExport('F12')};
    addHost(runtimeModule.createRuntimeF12ConfiguredReadHosts({...hostOptions,readPolicy:ports.policy,readDigest:ports.digest,resolveAction:ports.action}));
    const delivery=runtimeModule.createRuntimeF12NotificationDeliverHost({...hostOptions,requiredScopes:['notifications:deliver']});
    addHost(delivery);
    const selectedValue=(scope,bound)=>{
      const selected=operation(bound,'F12_N03','decision.choose_candidate'),intent=selected&&runtime.loadCheckpoint(selected.localTaskId,'host-tool-intent');
      let context;try{context=JSON.parse(intent?.arguments.context);}catch{fail('UNAUTHORIZED','F12 original decision context unavailable');}
      const value=context.candidateValues?.find(candidate=>candidate.id===selected.result.selectedId)?.value;
      if(!isDeepStrictEqual(value,{action:ports.action(scope),roundId:ports.source(scope).roundId}))fail('UNAUTHORIZED','F12 selected action exceeds original feed policy');
      return value;
    };
    const completion=scope=>{
      const bound=binding('F12',scope),action=ports.action(scope);selectedValue(scope,bound);
      const expected=action==='deliver'?['selected','skipped']:['skipped','selected'];
      if(operation(bound,'F12_N04','workflow.guard.f12_n04')?.result.state!==expected[0]
        ||operation(bound,'F12_N05','workflow.guard.f12_n05')?.result.state!==expected[1])fail('RESULT_UNKNOWN','F12 original condition receipts unavailable');
      if(action==='deliver'){
        const result=operation(bound,'F12_N04','workflow.host.f12_n04')?.result;
        if(!result)fail('RESULT_UNKNOWN','F12 original delivery receipt unavailable');
        ports.verifyDeliveryResult(scope,result);
        const round=ports.notificationHost.getInterruptionRound(result.roundId);
        return {...ports.selection(scope),notificationState:result.delivered?'delivered':round.state==='suppressed'?'feed_only':'failed',delivered:result.delivered};
      }
      const result=operation(bound,'F12_N05','workflow.host.f12_n05')?.result;
      if(!isDeepStrictEqual(result,ports.digest(scope)))fail('REVISION_CONFLICT','F12 original unread digest changed');
      return {...ports.selection(scope),notificationState:'feed_only',delivered:false};
    };
    config('F12',{...selectionSchema,properties:{...selectionSchema.properties,trigger:{type:'string',enum:['event','on_demand']}},required:['trigger']},
      ['decision.choose_candidate','workflow.host.f12_n02','workflow.guard.f12_n04','workflow.guard.f12_n05','workflow.host.f12_n04','workflow.host.f12_n05'],
      {...selectionSchema,properties:{...selectionSchema.properties,notificationState:{type:'string',enum:['delivered','failed','feed_only']},delivered:{type:'boolean'}},required:['notificationState','delivered']},
      async(scope,bound)=>{
        const originalScope={...scope,parentTaskId:scope.taskId,sessionId:scope.state.sessionId},proposal=scope.proposal;
        ports.source(originalScope);
        if(proposal.nodeId==='F12_N02'&&proposal.toolName==='workflow.host.f12_n02')return isDeepStrictEqual(proposal.arguments,ports.selection(originalScope));
        const value=selectedValue(originalScope,bound);
        if(['F12_N04','F12_N05'].includes(proposal.nodeId)&&proposal.toolName==='workflow.guard.'+proposal.nodeId.toLowerCase())
          return isDeepStrictEqual(proposal.arguments,{workflowId:'F12',nodeId:proposal.nodeId,input:bound.input,
            predecessorOutputs:{F12_N03:value},predecessorStates:{F12_N03:'completed'}});
        if(operation(bound,proposal.nodeId,'workflow.guard.'+proposal.nodeId.toLowerCase())?.result.state!=='selected')return false;
        return proposal.nodeId==='F12_N04'&&proposal.toolName==='workflow.host.f12_n04'
          ?isDeepStrictEqual(proposal.arguments,ports.deliveryInput(originalScope))
          :proposal.nodeId==='F12_N05'&&proposal.toolName==='workflow.host.f12_n05'&&isDeepStrictEqual(proposal.arguments,ports.selection(originalScope));
      },async scope=>{
        const result=completion({...scope,parentTaskId:scope.taskId,sessionId:scope.state.sessionId});
        runtime.saveCheckpointOnce(scope.taskId,'business-workflow:F12:completion',{sessionId:scope.state.sessionId,result});
        return {result,resultSummary:'Original notification feed and durable channel outcome confirmed'};
      },async scope=>{
        const saved=runtime.loadCheckpoint(scope.taskId,'business-workflow:F12:completion');
        if(!saved||!isDeepStrictEqual(saved.result,scope.value)||!isDeepStrictEqual(completion({...scope,parentTaskId:scope.taskId,sessionId:saved.sessionId}),saved.result))
          fail('REVISION_CONFLICT','F12 completion changed during export');
      },ports.prepareInput);
    unavailable.push('f12_user_return_event_source_unavailable','f12_voice_delivery_unavailable');
  }else unavailable.push('f12_notification_application_host_unavailable');
  if(['mail.inbox','mail.archive','mail.send','mail.reconcile_send','knowledge.search'].every(name=>descriptor(name))
    &&runtimeModule.createRuntimeF08PreparedPlanHosts&&runtimeModule.createRuntimeF08MailArchiveHost&&runtimeModule.createRuntimeF08MailSendHost){
    const f08Schema=object({inbox:object({account:text,folder:text,limit:{type:'integer',const:100}}),
      knowledge:structuredClone(descriptor('knowledge.search').inputSchema),
      archive:{...structuredClone(descriptor('mail.archive').inputSchema),required:[...new Set([...descriptor('mail.archive').inputSchema.required,'account'])]},
      send:{...structuredClone(descriptor('mail.send').inputSchema),required:[...new Set([...descriptor('mail.send').inputSchema.required,'account'])]},
      knowledgeSources:{type:'array',minItems:1,maxItems:20,items:object({vaultId:text,path:text,line:{type:'integer',minimum:1},revision:{type:'string',pattern:'^[0-9a-f]{64}$'}})}});
    const selected=(bound,nodeId)=>{
      const op=operation(bound,nodeId,'decision.choose_candidate'),intent=op&&runtime.loadCheckpoint(op.localTaskId,'host-tool-intent');
      let context;try{context=JSON.parse(intent?.arguments.context);}catch{fail('UNAUTHORIZED','F08 original selected candidate unavailable');}
      return context.candidateValues?.find(candidate=>candidate.id===op.result.selectedId)?.value;
    };
    const mailSource=bound=>{
      const op=operation(bound,'F08_N01','mail.inbox'),result=op?.result,input=bound.input;
      if(!op||!isDeepStrictEqual(runtime.loadCheckpoint(op.localTaskId,'host-tool-intent')?.arguments,input.inbox)
        ||result.hasMore!==false||result.account!==input.inbox.account||result.folder!==input.inbox.folder
        ||!result.nextCursor.startsWith(input.archive.uidValidity+':')||input.archive.account!==input.inbox.account
        ||input.send.account!==input.inbox.account||input.archive.folder!==input.inbox.folder)
        fail('UNAUTHORIZED','F08 original complete inbox source unavailable');
      return result;
    };
    const verifyKnowledge=(bound,result)=>{
      if(result?.truncated!==false||!Array.isArray(result.hits)||bound.input.knowledgeSources.some(source=>!result.hits.some(hit=>isDeepStrictEqual(hit.source,source))))
        fail('REVISION_CONFLICT','F08 original knowledge source revisions unavailable');
    };
    const prepared=bound=>{
      mailSource(bound);
      const search=operation(bound,'F08_N09','knowledge.search');
      if(!search||!isDeepStrictEqual(runtime.loadCheckpoint(search.localTaskId,'host-tool-intent')?.arguments,bound.input.knowledge))
        fail('UNAUTHORIZED','F08 original knowledge read unavailable');
      verifyKnowledge(bound,search.result);
      if(!isDeepStrictEqual(selected(bound,'F08_N04'),bound.input.send)
        ||!isDeepStrictEqual(selected(bound,'F08_N05'),{send:bound.input.send,knowledgeSources:bound.input.knowledgeSources,requiresDecision:false}))
        fail('UNSUPPORTED_CAPABILITY','F08 missing decisions require the original F02 question source');
    };
    const bridge=child('F08',{
      'f08.mail.archive':input=>['F08_N03','mail.archive',input.archive],
      'f08.mail.send':input=>['F08_N07','mail.send',input.send],
      'f08.mail.plan-check':input=>['F08_N10','mail.inbox',input.inbox],
      'f08.mail.send-check':input=>['F08_N07','mail.inbox',input.inbox],
      'f08.mail.receipt-check':input=>['F08_N07','mail.inbox',input.inbox],
      'f08.mail.change-check':input=>['F08_N13','mail.inbox',input.inbox,'workflow.guard.f08_n13'],
      'f08.knowledge.send-check':input=>['F08_N07','knowledge.search',input.knowledge],
      'f08.knowledge.receipt-check':input=>['F08_N07','knowledge.search',input.knowledge],
    });
    const compareMail=(scope,bound,result)=>{
      const original=mailSource(bound),archive=ports.readOriginalWrite(scope,'archive');
      const stable=items=>items.map(({fetchedAt,...item})=>item).sort((a,b)=>a.dedupeKey.localeCompare(b.dedupeKey));
      const expected=archive?.state==='confirmed'?original.items.filter(item=>item.externalId!==bound.input.archive.folder+':'+bound.input.archive.uid):original.items;
      return result?.hasMore===false&&result.account===original.account&&result.folder===original.folder
        &&result.nextCursor.startsWith(bound.input.archive.uidValidity+':')&&isDeepStrictEqual(stable(result.items),stable(expected));
    };
    const fresh=async(scope,context,phase)=>{
      const bound=binding('F08',scope),mail=await bridge.invoke({actionKey:'f08.mail.'+phase+'-check',input:bound.input.inbox},context);
      if(!compareMail(scope,bound,mail.result))fail('REVISION_CONFLICT','F08 original inbox changed; retain prior effects for versioned replan');
      if(phase!=='plan'){
        const knowledge=await bridge.invoke({actionKey:'f08.knowledge.'+phase+'-check',input:bound.input.knowledge},context);
        verifyKnowledge(bound,knowledge.result);
      }
      binding('F08',scope);
    };
    const ports=createF08MailWorkflowPorts({getApplication,bridge,now,authorizeExport:async(scope,result)=>{
      const kind=result.sendOperationId?'send':'archive',original=ports.readOriginalWrite(scope,kind);
      if(!original||result.toolState!==original.state)fail('UNAUTHORIZED','F08 original write result changed');
      if(kind==='send')await fresh(scope,originalReceipt(scope.localTaskId,scope,result).context,'receipt');
      return receiptExport('F08')(scope,result);
    }});
    const hostOptions={...ports,application,assertCurrent:scope=>{binding('F08',scope);},now:()=>new Date(now())};
    addHost(runtimeModule.createRuntimeF08MailArchiveHost({...hostOptions,mailArchive:businessTools.find(tool=>tool.descriptor.name==='mail.archive'),
      requiredScopes:descriptor('mail.archive').requiredScopes,async verifyArchiveBinding(scope,input){const bound=binding('F08',scope);mailSource(bound);
        return isDeepStrictEqual(selected(bound,'F08_N02'),{archive:bound.input.archive})&&ports.verifyArchiveBinding(scope,input);}}));
    addHost(runtimeModule.createRuntimeF08MailSendHost({...hostOptions,mailSend:businessTools.find(tool=>tool.descriptor.name==='mail.send'),
      requiredScopes:descriptor('mail.send').requiredScopes,async invokeSend(scope,input,context){prepared(binding('F08',scope));await fresh(scope,context,'send');return ports.invokeSend(scope,input,context);}}));
    addHost(runtimeModule.createRuntimeF08PreparedPlanHosts({...hostOptions,sendInputSchema:descriptor('mail.send').inputSchema,
      authorizeExport:receiptExport('F08'),async verifyPreparedPlan(scope,input,context){const bound=binding('F08',scope);prepared(bound);
        if(!isDeepStrictEqual(input,{send:bound.input.send}))return false;await fresh(scope,context,'plan');return true;},
      async resolveCondition(scope,nodeId,context){
        const bound=binding('F08',scope);
        if(nodeId==='F08_N13'){
          mailSource(bound);const read=await bridge.invoke({actionKey:'f08.mail.change-check',input:bound.input.inbox},context);
          return compareMail(scope,bound,read.result)?'skipped':'selected';
        }
        if(nodeId==='F08_N12'){
          const original=await ports.resolveOriginalSend(scope),read=original&&await ports.readReconciliation(scope,original);
          if(!read)fail('RESULT_UNKNOWN','F08 original send reconciliation unavailable');return read.state==='confirmed'?'skipped':'selected';
        }
        prepared(bound);
        if(operation(bound,'F08_N10','workflow.host.f08_n10')?.result.planReady!==true)fail('UNAUTHORIZED','F08 original prepared plan receipt unavailable');
        if(nodeId==='F08_N06')return 'skipped';
        if(operation(bound,'F08_N06','workflow.guard.f08_n06')?.result.state!=='skipped')fail('UNAUTHORIZED','F08 original clarification condition missing');
        return 'selected';
      }}));
    addHost(runtimeModule.createRuntimeF08WaitReconciliationHost({...hostOptions,mailReconcile:businessTools.find(tool=>tool.descriptor.name==='mail.reconcile_send'),
      requiredScopes:descriptor('mail.reconcile_send').requiredScopes,authorizeExport:receiptExport('F08')}));
    const resultFor=async scope=>{
      const bound=binding('F08',scope);prepared(bound);
      if(operation(bound,'F08_N03','workflow.host.f08_n03')?.result.toolState!=='confirmed'||ports.readOriginalWrite(scope,'archive')?.state!=='confirmed')
        fail('RESULT_UNKNOWN','F08 original archive still requires reconciliation');
      const send=ports.readOriginalWrite(scope,'send'),original=await ports.resolveOriginalSend(scope),read=original&&await ports.readReconciliation(scope,original);
      if(!send||!original||read?.state!=='confirmed'||operation(bound,'F08_N13','workflow.guard.f08_n13')?.result.state!=='skipped'
        ||operation(bound,'F08_N12','workflow.guard.f08_n12')?.result.state!=='skipped')fail('RESULT_UNKNOWN','F08 original send or source change remains unresolved');
      return {archiveConfirmed:true,sendConfirmed:true,messageId:original.messageId};
    };
    config('F08',f08Schema,['decision.choose_candidate','mail.inbox','mail.archive','mail.send','mail.reconcile_send','knowledge.search',
      'workflow.host.f08_n03','workflow.host.f08_n07','workflow.host.f08_n10','workflow.host.f08_n12',
      'workflow.guard.f08_n06','workflow.guard.f08_n07','workflow.guard.f08_n12','workflow.guard.f08_n13'],
      object({archiveConfirmed:{const:true},sendConfirmed:{const:true},messageId:text}),async(scope,bound)=>{
        const {proposal}=scope,own={...scope,parentTaskId:scope.taskId,sessionId:scope.state.sessionId};
        if(proposal.nodeId==='F08_N01'&&proposal.toolName==='mail.inbox')return isDeepStrictEqual(proposal.arguments,bound.input.inbox);
        if(proposal.nodeId==='F08_N09'&&proposal.toolName==='knowledge.search')return isDeepStrictEqual(proposal.arguments,bound.input.knowledge);
        mailSource(bound);
        if(proposal.toolName==='workflow.guard.'+proposal.nodeId.toLowerCase()){
          const args=proposal.arguments;if(!isDeepStrictEqual(args.input,bound.input)||args.workflowId!=='F08'||args.nodeId!==proposal.nodeId)return false;
          const node=getOwnedWorkflowTemplate('F08').nodes.find(item=>item.id===proposal.nodeId);
          const values={},states={};for(const edge of node.dependencies){const item=scope.state.result?.nodes[edge.nodeId];states[edge.nodeId]=item?.state;
            values[edge.nodeId]=item?.state==='skipped'?null:['F08_N02','F08_N04','F08_N05'].includes(edge.nodeId)?selected(bound,edge.nodeId):completedNode(bound,edge.nodeId)?.result;}
          return isDeepStrictEqual(args.predecessorOutputs,values)&&isDeepStrictEqual(args.predecessorStates,states);
        }
        if(proposal.nodeId==='F08_N03'&&proposal.toolName==='workflow.host.f08_n03')return isDeepStrictEqual(proposal.arguments,bound.input.archive);
        if(proposal.nodeId==='F08_N10'&&proposal.toolName==='workflow.host.f08_n10')return isDeepStrictEqual(proposal.arguments,{send:bound.input.send});
        if(proposal.nodeId==='F08_N07'&&proposal.toolName==='workflow.host.f08_n07')return operation(bound,'F08_N07','workflow.guard.f08_n07')?.result.state==='selected'
          &&isDeepStrictEqual(proposal.arguments,bound.input.send);
        const original=await ports.resolveOriginalSend(own);
        if(proposal.nodeId==='F08_N11'&&proposal.toolName==='mail.reconcile_send')return !!original&&isDeepStrictEqual(proposal.arguments,
          {account:bound.input.send.account,messageId:original.messageId,idempotencyKey:original.idempotencyKey});
        return proposal.nodeId==='F08_N12'&&proposal.toolName==='workflow.host.f08_n12'&&!!original
          &&isDeepStrictEqual(proposal.arguments,{messageId:original.messageId,idempotencyKey:original.idempotencyKey});
      },async scope=>{const result=await resultFor({...scope,parentTaskId:scope.taskId,sessionId:scope.state.sessionId});
        runtime.saveCheckpointOnce(scope.taskId,'business-workflow:F08:completion',{sessionId:scope.state.sessionId,result});
        return {result,resultSummary:'Original archive and independently reconciled send confirmed'};
      },async scope=>{const saved=runtime.loadCheckpoint(scope.taskId,'business-workflow:F08:completion');
        if(!saved||!isDeepStrictEqual(saved.result,scope.value)||!isDeepStrictEqual(await resultFor({...scope,parentTaskId:scope.taskId,sessionId:saved.sessionId}),saved.result))
          fail('REVISION_CONFLICT','F08 original completion changed');});
    unavailable.push('f08_missing_decision_question_source_unavailable','f08_changed_source_replan_unavailable');
  }else unavailable.push('f08_mail_and_knowledge_dependencies_unavailable');
  return {tools,hosts,configuredWorkflowWorkerPorts,unavailable};
}
