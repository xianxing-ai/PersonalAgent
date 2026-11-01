import {isDeepStrictEqual} from 'node:util';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter,getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {assertOwnedWorkflowHostScope,readF03CompetitionReview,readCompetitionWorkflowRepairReceipt} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

const text={type:'string',minLength:1},integer={type:'integer',minimum:0};
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const reference=object({graphTaskId:text,readRunId:text});
const argsSchema=object({sourceDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}});
const requestSchema=object({source:reference});
const fail=(code,message)=>{throw new ProtocolError(code,message);};
const originalKey='f03:original-mail-review';
const repairKey='f03:original-repair';

/** Lazy Competition-only composition. Private source export and every tool authorization remain independent. */
export function createF03MailReviewWorkflowPorts({getApplication,sourceChanges,authorizeExport,assertCurrent,
  readDecisionConfiguration,assertDecisionConfiguration,now=Date.now}={}) {
  if(typeof getApplication!=='function'||typeof sourceChanges?.readReviewSource!=='function'||typeof authorizeExport!=='function'
    ||typeof assertCurrent!=='function'||readDecisionConfiguration&&typeof assertDecisionConfiguration!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:['f03_original_mail_review_ports_unavailable']};
  const app=()=>getApplication(),runtime=()=>app().runtime;
  const scopeOf=scope=>({taskId:scope.parentTaskId??scope.taskId,deadline:scope.deadline,signal:scope.signal});
  const operation=(bound,nodeId,kind='host')=>bound.confirmedOperations.find(item=>item.nodeId===nodeId
    &&item.toolName===(kind==='decision'?'decision.choose_candidate':`workflow.${kind}.${nodeId.toLowerCase()}`));
  function active(scope){
    const own=scopeOf(scope),task=runtime().getTask(own.taskId);
    if(own.signal?.aborted)fail('CANCELLED','Original F03 review cancelled');
    if(!Number.isFinite(Date.parse(own.deadline))||Date.parse(own.deadline)<=now())fail('TIMEOUT','Original F03 review expired');
    if(app().profile!=='huawei_ict_agentarts'||task.cancelRequested||!['running','waiting_approval','waiting_reconciliation'].includes(task.state))
      fail('UNAUTHORIZED','Original F03 graph is not active');
    if(assertCurrent(own)!==undefined)fail('UNAUTHORIZED','F03 source guard must be synchronous');
    return own;
  }
  function read(scope){
    const own=active(scope),saved=runtime().loadCheckpoint(own.taskId,originalKey);
    if(!saved||saved.deadline!==own.deadline)fail('UNAUTHORIZED','Original F03 source is not bound');
    const current=sourceChanges.readReviewSource(saved.source,own,saved.review.graphRevision);
    if(!isDeepStrictEqual(current,saved.original))fail('REVISION_CONFLICT','Original private F03 source changed');
    if(saved.decisionConfiguration)assertDecisionConfiguration(saved.decisionConfiguration,own);
    const repair=runtime().loadCheckpoint(own.taskId,repairKey);
    const receipt=repair&&readCompetitionWorkflowRepairReceipt(runtime(),repair);
    const graph=runtime().bindCoordinationStore(saved.review.graphNamespace).read();
    if(graph.revision!==saved.review.graphRevision&&(!receipt?.graphUpdateVerified||receipt.graphRevision!==graph.revision))
      fail('REVISION_CONFLICT','F03 original graph revision changed');
    return {own,saved,receipt};
  }
  function bound(scope){const state=read(scope),value=app().readConfiguredWorkflowBinding({taskId:state.own.taskId,
    workflowId:'F03',sessionId:scope.sessionId??scope.state?.sessionId,signal:scope.signal});
    if(!value||value.deadline!==scope.deadline||!isDeepStrictEqual(value.input.review,state.saved.review))
      fail('UNAUTHORIZED','Original F03 configured graph is unavailable');return {...state,bound:value};}
  const sourceScope=(scope,operationId)=>({taskId:scope.parentTaskId??scope.taskId,sessionId:scope.sessionId??scope.state?.sessionId,
    operationId,deadline:scope.deadline,signal:scope.signal});
  function selection(scope){const state=bound(scope),selected=operation(state.bound,'F03_N02','decision');
    if(!selected)fail('UNAUTHORIZED','Original F03 decision is unavailable');
    return {...state,selected,review:readF03CompetitionReview(app(),sourceScope(scope,selected.operationId),state.saved.review)};}
  const tools=[];
  function host(nodeId,kind,sideEffect,outputSchema,execute){
    const toolName=`workflow.${kind}.${nodeId.toLowerCase()}`;
    tools.push(createOwnedWorkflowAdapter({nodeId,kind,sideEffect,requiredScopes:sideEffect==='read'?['memory:read']:['cognition:repair'],
      inputSchema:kind==='guard'?object({workflowId:{const:'F03'},nodeId:{const:nodeId},input:{type:'object'},
        predecessorOutputs:{type:'object'},predecessorStates:{type:'object'}}):argsSchema,outputSchema,async execute(args,context){
        const scope=assertOwnedWorkflowHostScope({runtime:runtime(),context,workflowId:'F03',nodeId,hostToolName:toolName,
          proposalArguments:args,assertCurrent:scope=>{const state=bound(scope);if((kind==='guard'?args.input?.review?.sourceDigest:args.sourceDigest)!==state.saved.review.sourceDigest
            ||kind==='guard'&&!isDeepStrictEqual(args.input,state.bound.input))
            fail('UNAUTHORIZED','Original F03 source digest changed');},now:()=>new Date(now())});
        const result=await execute(scope,context);read(scope);return result;
      }}));
  }
  host('F03_N05','host','read',object({context:{type:'array',items:{type:'object'}},review:{type:'object'}}),scope=>{
    const {saved}=bound(scope);return {context:saved.original.privateContext,review:saved.review};});
  host('F03_N03','host','local_write',object({state:{enum:['requires_review','applied']},graphRevision:integer}),async(scope,context)=>{
    let state=selection(scope);
    if(!state.review)return {state:'requires_review',graphRevision:state.saved.review.graphRevision};
    let marker=runtime().loadCheckpoint(scope.parentTaskId,repairKey);
    if(!marker){
      const request={sourceTaskId:scope.parentTaskId,sourceOperationId:state.selected.operationId,
        idempotencyKey:'f03-original-'+toolArgumentsDigest([scope.parentTaskId,state.selected.operationId]),deadline:scope.deadline};
      // prepareLocalRepair persists its exact immutable intent before Runtime dispatch.
      const task=app().submitLocalRepair(request);
      marker={taskId:task.taskId,sourceTaskId:request.sourceTaskId,sourceOperationId:request.sourceOperationId};
      if(!runtime().saveCheckpointOnce(scope.parentTaskId,repairKey,marker)
        &&!isDeepStrictEqual(runtime().loadCheckpoint(scope.parentTaskId,repairKey),marker))fail('REVISION_CONFLICT','Original F03 repair changed');
    }
    for(;;){
      const receipt=readCompetitionWorkflowRepairReceipt(runtime(),marker);
      if(receipt?.graphUpdateVerified)return {state:'applied',graphRevision:receipt.graphRevision};
      const task=runtime().getTask(marker.taskId);
      if(['failed','cancelled','cancelling'].includes(task.state))fail('UNAUTHORIZED','Original F03 repair was refused or cancelled');
      if(['waiting_reconciliation','succeeded'].includes(task.state))fail('RESULT_UNKNOWN','Original F03 repair needs exact readback');
      read(scope);
      await new Promise(resolve=>{const done=()=>{clearTimeout(timer);context.signal.removeEventListener('abort',done);resolve();};
        const timer=setTimeout(done,25);context.signal.addEventListener('abort',done,{once:true});if(context.signal.aborted)done();});
    }
  });
  host('F03_N06','host','read',object({effects:{type:'array',items:{type:'object'}},compensationProposed:{const:false}}),scope=>{
    const {saved}=bound(scope);
    if(saved.original.effects.some(effect=>effect.result?.state!=='confirmed'))fail('RESULT_UNKNOWN','Original mail effect must be reconciled before review');
    return {effects:saved.original.effects,compensationProposed:false};
  });
  for(const nodeId of ['F03_N07','F03_N08','F03_N09','F03_N10'])host(nodeId,'guard','read',object({state:{enum:['skipped']}}),scope=>{
    const {bound:graph}=bound(scope),effect=operation(graph,'F03_N06');
    if(!effect||effect.result.compensationProposed!==false||effect.result.effects.some(item=>item.result?.state!=='confirmed'))
      fail('RESULT_UNKNOWN','Original effects or compensation condition are unavailable');
    return {state:'skipped'};
  });
  const scheduledSchema=object({state:{enum:['requires_review','scheduled']},graphRevision:integer,scheduledTaskId:text},['state','graphRevision']);
  host('F03_N04','host','local_write',scheduledSchema,async scope=>{
    const {saved,bound:graph,receipt}=bound(scope),repair=operation(graph,'F03_N03');
    if(!repair)fail('UNAUTHORIZED','Original F03 repair result unavailable');
    if(repair.result.state==='requires_review')return {state:'requires_review',graphRevision:saved.review.graphRevision};
    const plan=receipt?.updatedNodes.find(item=>item.kind==='plan'&&item.id===saved.original.plan.id);
    if(!receipt?.graphUpdateVerified||!plan)fail('RESULT_UNKNOWN','Original repaired Plan is not current');
    const selection={graphNamespace:saved.review.graphNamespace,expectedGraphRevision:receipt.graphRevision,plan:{id:plan.id,revision:plan.revision}};
    const key='f03:scheduled-original-plan',prior=runtime().loadCheckpoint(scope.parentTaskId,key);
    let task=app().readPlanExecutionTask(selection);
    if(prior){if(!isDeepStrictEqual(prior.selection,selection)||!task||prior.sourceDigest!==app().readPlanExecutionBinding(task.taskId)?.sourceDigest)
      fail('RESULT_UNKNOWN','Original Plan admission requires readback');}
    else {
      const preview=app().previewPlanExecution(selection,scope);read(scope);
      const intent={selection,sourceDigest:preview.sourceDigest};
      if(!runtime().saveCheckpointOnce(scope.parentTaskId,key,intent))fail('RESULT_UNKNOWN','Original Plan admission is already bound');
      task=await app().submitPlanExecutionTask({...selection,sourceDigest:preview.sourceDigest,
        conversationId:saved.original.conversationId,deadline:scope.deadline},{signal:scope.signal});
    }
    if(!task||task.cancelRequested||['failed','cancelled','cancelling'].includes(task.state))fail('RESULT_UNKNOWN','Original Plan was not admitted');
    return {state:'scheduled',graphRevision:receipt.graphRevision,scheduledTaskId:task.taskId};
  });
  const resultSchema=object({state:{enum:['requires_review','scheduled']},sourceDigest:text,graphRevision:integer,effectsPreserved:{const:true},scheduledTaskId:text},
    ['state','sourceDigest','graphRevision','effectsPreserved']);
  const worker={workflowId:'F03',toolName:'workflow.business.f03',toolVersion:'1.0.0',configurationVersion:'competition-mail-review-v1',
    requestSchema,publicEnumPaths:[],inputSchema:object({source:reference,review:{type:'object'},privateContext:{type:'array',items:{type:'object'}},
      executionModel:object({catalogRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},modelId:text,
        reasoningEffort:{enum:['none','minimal','low','medium','high','xhigh','max']}},['catalogRevision','modelId']),decisionConfiguration:{type:'object'}},
      ['source','review','privateContext']),resultSchema,sideEffect:'local_write',
    requiredTools:[{name:'decision.choose_candidate',version:'1.0.0'},...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version}))],
    available:scope=>{try{active(scope);return true;}catch{return false;}},
    resolveInput(args,scope){validateToolValue(requestSchema,args);const own=active(scope),original=sourceChanges.readReviewSource(args.source,own);
      if(app().readToolConversation(scope.taskId)!==original.conversationId)fail('UNAUTHORIZED','F03 source belongs to another original conversation');
      const decisionConfiguration=readDecisionConfiguration?.(own);
      if(decisionConfiguration)assertDecisionConfiguration(decisionConfiguration,own);
      const saved={deadline:scope.deadline,source:args.source,review:original.review,original,...(decisionConfiguration?{decisionConfiguration}:{})};
      if(!runtime().saveCheckpointOnce(scope.taskId,originalKey,saved)&&!isDeepStrictEqual(runtime().loadCheckpoint(scope.taskId,originalKey),saved))
        fail('REVISION_CONFLICT','Original F03 admission changed');
      return {source:structuredClone(args.source),review:structuredClone(original.review),privateContext:structuredClone(original.privateContext),
        ...(decisionConfiguration?{executionModel:structuredClone(decisionConfiguration.executionModel),decisionConfiguration:structuredClone(decisionConfiguration.configuration)}:{})};
    },
    assertCurrent:scope=>{if(runtime().loadCheckpoint(scopeOf(scope).taskId,originalKey))read(scope);else active(scope);},
    assertFrontier(scope){
      const state=bound(scope),node=getOwnedWorkflowTemplate('F03').nodes.find(item=>item.id===scope.proposal.nodeId);
      if(!node||node.dependencies.some(edge=>edge.required&&!['completed','skipped'].includes(scope.state.result?.nodes[edge.nodeId]?.state)))return false;
      if(scope.proposal.toolName==='decision.choose_candidate'){
        let context;try{context=JSON.parse(scope.proposal.arguments.context);}catch{return false;}
        if(context.workflowId!=='F03'||context.nodeId!==node.id)return false;
        if(node.id!=='F03_N02')return true;
        return context.candidateValues?.every(item=>item.abstain===true&&item.value===null||isDeepStrictEqual(item.value,{action:'defer'})
          ||state.saved.review.candidate&&isDeepStrictEqual(item.value,{action:'revise',repair:state.saved.review.candidate}))===true;
      }
      if(scope.proposal.toolName===`workflow.guard.${node.id.toLowerCase()}`)return scope.proposal.arguments.workflowId==='F03'
        &&scope.proposal.arguments.nodeId===node.id&&isDeepStrictEqual(scope.proposal.arguments.input,state.bound.input);
      return isDeepStrictEqual(scope.proposal.arguments,{sourceDigest:state.saved.review.sourceDigest})
        &&tools.some(tool=>tool.descriptor.name===scope.proposal.toolName&&tool.descriptor.version===scope.proposal.toolVersion);
    },
    async authorizeExport(scope){read(scope);const result=await authorizeExport({...scope,workflowId:'F03'});read(scope);return result===true;},
    verifyCompletion(scope){
      const state=bound(scope);for(const id of ['F03_N05','F03_N02','F03_N03','F03_N06','F03_N04'])
        if(!operation(state.bound,id,id==='F03_N02'?'decision':'host')||scope.state.result?.nodes[id]?.state!=='completed')
          fail('RESULT_UNKNOWN','Original F03 required receipt is missing');
      for(const id of ['F03_N07','F03_N08','F03_N09','F03_N10'])if(scope.state.result?.nodes[id]?.state!=='skipped'
        ||['F03_N07','F03_N08'].includes(id)&&operation(state.bound,id,'guard')?.result.state!=='skipped')fail('RESULT_UNKNOWN','Original F03 condition was not checked');
      const final=operation(state.bound,'F03_N04').result;
      return {result:{...final,sourceDigest:state.saved.review.sourceDigest,effectsPreserved:true},
        resultSummary:final.state==='scheduled'?'原计划修复已核实并受理新版本；既有邮件效果保留。':'原来源变化已核实；缺有效替代事实，计划仍需审查，既有邮件效果保留。'};
    }};
  async function submitChange(scope,change){
    if(!change?.reviewReference)return {state:'requires_review',reason:change?.reason??'original_plan_source_missing'};
    const own=scopeOf(scope),reference=change.reviewReference,original=sourceChanges.readReviewSource(reference,own);
    if(reference.graphTaskId!==own.taskId||reference.readRunId!==change.change?.readRunId)
      fail('UNAUTHORIZED','F03 admission does not match the original mailbox change');
    const request={conversationId:original.conversationId,deadline:scope.deadline,
      idempotencyKey:'f08-source-review-'+toolArgumentsDigest(reference),arguments:{source:reference}};
    const key='f08:competition-review:'+reference.readRunId,intent={request,sourceDigest:original.review.sourceDigest};
    const prior=runtime().loadCheckpoint(own.taskId,key);
    if(prior&&!isDeepStrictEqual(prior,intent))fail('REVISION_CONFLICT','Original F03 admission source changed');
    if(typeof app().readF03MailReviewTask!=='function'||typeof app().submitF03MailReviewTask!=='function')
      fail('UNSUPPORTED_CAPABILITY','Original native F03 admission is unavailable');
    let task=app().readF03MailReviewTask(request.idempotencyKey);
    if(!task){
      if(prior||!runtime().saveCheckpointOnce(own.taskId,key,intent))fail('RESULT_UNKNOWN','Original F03 admission needs readback');
      task=await app().submitF03MailReviewTask(request,{signal:scope.signal});
    }
    if(!task||task.conversationId!==request.conversationId)fail('UNAUTHORIZED','Original F03 admission identity changed');
    return {state:'review_submitted',taskId:task.taskId,reviewState:task.state,sourceDigest:intent.sourceDigest};
  }
  return {tools,configuredWorkflowWorkerPorts:[worker],unavailable:[],submitChange,competitionSource:{resolve({sourceTaskId,sourceOperationId}){
    const saved=runtime().loadCheckpoint(sourceTaskId,originalKey);if(!saved)return;
    const intent=runtime().loadCheckpoint(sourceTaskId,'owned-workflow:intent:'+sourceOperationId);if(!intent)return;
    const scope={taskId:sourceTaskId,sessionId:intent.sessionId,operationId:sourceOperationId,deadline:saved.deadline,signal:new AbortController().signal};
    read(scope);return readF03CompetitionReview(app(),scope,saved.review);
  }}};
}
