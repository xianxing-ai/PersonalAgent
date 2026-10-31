import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {createF02PendingQuestionHost,createF02FinalTranscriptHost,createF02ConfirmationHost,createF02ControlHosts}
  from '@personal-agent/runtime/application';
import {createF02VoiceGraphPorts} from './f02-voice-graph-ports.js';

const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text={type:'string',minLength:1,maxLength:2048};
const fail=(code,message)=>{throw new ProtocolError(code,message);};

/** Fixed original-question F02. No microphone start, ASR fallback, card decision,
 * new business task or grant is synthesized by this composition. */
export function createF02WorkflowWorkerPorts({getApplication,authorizationQuestions,liveVoiceHost,microphoneHost,
  voiceCommandHost,verifyAudioEvidence,authorizeExport,now=Date.now}={}) {
  const current=()=>{const app=getApplication?.();if(!app?.runtime)fail('UNSUPPORTED_CAPABILITY','F02 Runtime unavailable');return app;};
  // Registration is before Runtime construction; every call reaches the current
  // real application. No task state, record or authority is cached in this facade.
  const application={runtime:new Proxy({},{get(_target,name){
    if(name==='policy')return {get:(...args)=>current().runtime.policy.get(...args)};
    return (...args)=>current().runtime[name](...args);
  }})};
  for(const name of ['readHostToolTask','readDelegatedUserTaskParent','readToolConversation','readPendingToolInvocation',
    'readAuthorizationQuestionInvocation','readAuthorizationQuestionBinding'])application[name]=(...args)=>current()[name](...args);
  const receiptExports=new Map();
  const bundle=createF02VoiceGraphPorts({getApplication,authorizationQuestions,liveVoiceHost,microphoneHost,verifyAudioEvidence,
    now:()=>new Date(now()),authorizeExport:({scope,result})=>{
      const input=receiptExports.get(scope.localTaskId),read=current().readHostToolTask(scope.localTaskId);
      if(!input||input.taskId!==scope.parentTaskId||input.deadline!==scope.deadline||!isDeepStrictEqual(read.confirmed?.result,result))
        fail('UNAUTHORIZED','F02 original receipt export request unavailable');
      return authorizeExport({...input,workflowId:'F02'});
    }});
  if(!bundle.ports||typeof authorizeExport!=='function')return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:bundle.unavailable};
  const ports=bundle.ports,base={application,...ports,requiredScopes:['workflow:voice']};
  const hosts=[createF02PendingQuestionHost(base),createF02FinalTranscriptHost(base),createF02ConfirmationHost(base)];
  async function wait(scope,read){
    for(;;){ports.assertCurrent(scope);const value=read();if(value!==undefined)return value;
      await new Promise(resolve=>setTimeout(resolve,25));}
  }
  const original=scope=>{
    const {selected,item}=ports.question(scope),app=current(),task=app.runtime.getTask(selected.sourceTaskId);
    const record=app.runtime.readToolExecutions(selected.sourceTaskId).find(value=>value.evidenceId===selected.sourceApprovalId);
    if(record&&(record.taskId!==selected.sourceTaskId||record.toolName!==selected.toolName||record.toolVersion!==selected.toolVersion))
      fail('UNAUTHORIZED','F02 original execution identity changed');
    return {selected,item,app,task,record};
  };
  const confirmed=scope=>{
    const value=original(scope),{selected,app,task,record}=value;
    const invocation=app.readAuthorizationQuestionInvocation(selected.sourceTaskId,selected.sourceApprovalId,true);
    if(task.cancelRequested||!record||record.state!=='confirmed'||!record.executionStarted||record.policyDecision!=='allow'
      ||!invocation||invocation.argumentsDigest!==selected.argumentsDigest
      ||!app.runtime.matchesToolExecutionInput(record,{arguments:invocation.arguments,scopeRef:selected.sourceApprovalId}))
      fail('RESULT_UNKNOWN','F02 original operation is not confirmed');
    authorizationQuestions.readConsumedOperation({taskId:selected.sourceTaskId,runId:selected.sourceApprovalId,
      deadline:selected.sourceDeadline,signal:scope.signal});
    return value;
  };
  const control=createF02ControlHosts({application,assertCurrent:ports.assertCurrent,now:ports.now,
    async guard(nodeId,scope){
      const value=nodeId==='F02_N05'?await wait(scope,()=>{
        const next=original(scope);return next.item.state==='pending'?undefined:next;
      }):original(scope);
      if(nodeId==='F02_N01')return value.item.state==='pending'&&value.item.revision===value.selected.questionRevision?'selected':'skipped';
      if(nodeId==='F02_N05')return value.item.state==='allowed'?'selected':'skipped';
      return value.task.cancelRequested?'selected':'skipped';
    },
    async observe(nodeId,scope){
      const value=original(scope),{selected,item,task,record,app}=value;
      const result={questionId:selected.questionId,questionRevision:item.revision,sourceTaskId:selected.sourceTaskId,sourceRunId:selected.sourceApprovalId};
      if(nodeId==='F02_N02'){
        if(item.state!=='pending'||item.revision!==selected.questionRevision)fail('REVISION_CONFLICT','F02 original question changed');
        const request={...selected,deadline:scope.deadline,signal:scope.signal};
        const accepted=liveVoiceHost?.askCurrentQuestion?.();
        if(accepted?.state!=='queued'||accepted.questionId!==selected.questionId||accepted.questionRevision!==selected.questionRevision)
          fail('UNSUPPORTED_CAPABILITY','F02 original question playback unavailable');
        const delivery=await wait(scope,()=>liveVoiceHost.readQuestionDelivery(request));
        return {...result,state:'delivered',sessionId:delivery.sessionId,drainId:delivery.drainId,playbackVerified:false};
      }
      if(nodeId==='F02_N06'||nodeId==='F02_N11'){
        confirmed(scope);return {...result,state:'confirmed',evidenceRefs:[selected.sourceApprovalId]};
      }
      if(nodeId==='F02_N07'){
        if(!['stale','expired','cancelled'].includes(item.state)||item.revision<=selected.questionRevision)
          fail('UNSUPPORTED_CAPABILITY','F02 original question is not invalidated');
        return {...result,state:'invalidated'};
      }
      if(nodeId==='F02_N08'){
        const approval=app.runtime.getApproval(selected.sourceApprovalId);
        if(item.state!=='denied'||approval.state!=='denied'||record?.executionStarted)
          fail('UNAUTHORIZED','F02 original operation was not denied before execution');
        return {...result,state:'denied'};
      }
      if(nodeId==='F02_N09'){
        if(!task.cancelRequested)fail('UNAUTHORIZED','F02 has no original local stop request');
        return {...result,state:'cancellation_requested',stopped:task.state==='cancelled'
          &&(!record||!app.runtime.isToolExecutionActive(record)&&!record.executionStarted)};
      }
      if(nodeId==='F02_N10'){
        if(item.state!=='pending'||item.revision!==selected.questionRevision)fail('REVISION_CONFLICT','F02 original question changed');
        const card=voiceCommandHost?.prepareApproval?.({approvalId:selected.sourceApprovalId});
        if(card?.questionId!==selected.questionId||card.revision!==selected.questionRevision)
          fail('UNSUPPORTED_CAPABILITY','F02 original local card unavailable');
        return {...result,state:'card_available'};
      }
      fail('UNSUPPORTED_CAPABILITY','Unknown F02 host action');
    }});
  const tools=[...hosts.flatMap(host=>host.tools),...control];
  const byName=new Map(tools.map(tool=>[tool.descriptor.name,tool]));
  const requestSchema=object({questionId:text});
  const inputSchema=object({questionId:text,questionRevision:{type:'integer',minimum:1},conversationId:text,
    sourceTaskId:text,sourceApprovalId:text,sourceDeadline:text,toolName:text,toolVersion:text,argumentsDigest:text});
  const resultSchema=object({state:{enum:['confirmed','denied','cancelled']},questionId:text,questionRevision:{type:'integer',minimum:1},
    sourceTaskId:text,sourceRunId:text});
  const worker={workflowId:'F02',toolName:'workflow.voice.question',toolVersion:'1.0.0',configurationVersion:'desktop-f02-original-v1',
    requestSchema,inputSchema,resultSchema,publicEnumPaths:[],requiredTools:tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),sideEffect:'local_write',
    available(scope){try{ports.assertCurrent(scope);return ports.deviceEvidenceReady(scope)&&typeof voiceCommandHost?.prepareApproval==='function';}catch{return false;}},
    assertCurrent:ports.assertCurrent,
    async resolveInput(args,scope){
      ports.assertCurrent(scope);const app=current(),original=app.readDelegatedUserTaskParent(scope.taskId);
      if(!original||original.deadline!==scope.deadline)fail('UNAUTHORIZED','F02 original user task unavailable');
      authorizationQuestions.refresh();
      const saved=app.runtime.loadCheckpoint(scope.taskId,'f02:original-question-input');
      if(saved!==undefined){
        if(saved.deadline!==scope.deadline||saved.input.questionId!==args.questionId||saved.input.conversationId!==original.conversationId)
          fail('REVISION_CONFLICT','F02 original question input changed');
        return structuredClone(saved.input);
      }
      const item=authorizationQuestions.snapshot(original.conversationId).find(item=>item.questionId===args.questionId&&item.state==='pending');
      if(!item)fail('UNAUTHORIZED','F02 original pending question unavailable');
      const invocation=app.readPendingToolInvocation(item.taskId,item.sourceApprovalId);
      if(!invocation||invocation.toolName!==item.toolName||app.readToolConversation(item.taskId)!==original.conversationId)
        fail('UNAUTHORIZED','F02 original pending invocation unavailable');
      const input={questionId:item.questionId,questionRevision:item.revision,conversationId:original.conversationId,
        sourceTaskId:item.taskId,sourceApprovalId:item.sourceApprovalId,sourceDeadline:invocation.deadline,
        toolName:invocation.toolName,toolVersion:invocation.toolVersion,argumentsDigest:invocation.argumentsDigest};
      if(!app.runtime.saveCheckpointOnce(scope.taskId,'f02:original-question-input',{deadline:scope.deadline,input}))
        fail('REVISION_CONFLICT','F02 question input was concurrently bound');
      return input;
    },
    async assertFrontier(input){
      ports.assertCurrent(input);const proposal=input.proposal,tool=byName.get(proposal.toolName);
      if(!tool||proposal.toolVersion!==tool.descriptor.version||!proposal.toolName.endsWith('.'+proposal.nodeId.toLowerCase()))return false;
      if(proposal.toolName.startsWith('workflow.guard.'))return proposal.arguments.workflowId==='F02'
        &&proposal.arguments.nodeId===proposal.nodeId&&isDeepStrictEqual(proposal.arguments.input,input.input);
      return isDeepStrictEqual(proposal.arguments,{});
    },
    async authorizeExport(input){
      ports.assertCurrent(input);
      if(input.stage==='receipt'){
        const read=current().readHostToolTask(input.localTaskId);
        if(read.task.state!=='succeeded'||!read.confirmed) return false;
        const host=hosts.find(host=>host.tools.some(tool=>tool.descriptor.name===input.proposal.toolName));
        if(host?.authorizeReceipt){
          const descriptor=byName.get(input.proposal.toolName).descriptor;
          receiptExports.set(input.localTaskId,input);
          try{await host.authorizeReceipt({context:{taskId:input.localTaskId,runId:read.confirmed.runId,authorizationRef:read.confirmed.runId,
            scopes:[...descriptor.requiredScopes],deadline:input.deadline,signal:input.signal},result:read.confirmed.result});}
          finally{receiptExports.delete(input.localTaskId);}
          ports.assertCurrent(input);return true;
        }
      }
      const allowed=await authorizeExport({...input,workflowId:'F02'});ports.assertCurrent(input);return allowed===true;
    },
    async verifyCompletion(input){
      ports.assertCurrent(input);const operations=input.state.confirmedOperations??{};
      const successful=node=>Object.values(operations).find(op=>op.nodeId===node&&op.toolName==='workflow.host.'+node.toLowerCase()
        &&input.readbacks.some(read=>read.task.taskId===op.localTaskId&&read.task.state==='succeeded'&&read.confirmed));
      const selected=input.input,items=authorizationQuestions.snapshot(selected.conversationId);
      const question=items.find(item=>item.questionId===selected.questionId&&item.taskId===selected.sourceTaskId&&item.sourceApprovalId===selected.sourceApprovalId);
      if(!question)fail('UNAUTHORIZED','F02 original completion question unavailable');
      let state,required;
      if(question.state==='allowed'){state='confirmed';required=['F02_N01','F02_N02','F02_N03','F02_N05','F02_N06','F02_N11'];}
      else if(question.state==='denied'){state='denied';required=['F02_N01','F02_N02','F02_N03','F02_N08'];}
      else {state='cancelled';required=['F02_N09'];}
      if(required.some(node=>!successful(node)))fail('UNAUTHORIZED','F02 required original node receipts unavailable');
      const last=successful(state==='confirmed'?'F02_N11':state==='denied'?'F02_N08':'F02_N09');
      const read=input.readbacks.find(read=>read.task.taskId===last.localTaskId).confirmed.result;
      if(read.questionId!==selected.questionId||read.sourceTaskId!==selected.sourceTaskId||read.sourceRunId!==selected.sourceApprovalId
        ||state==='cancelled'&&read.stopped!==true)fail('RESULT_UNKNOWN','F02 original effect is not confirmed');
      if(state==='confirmed')confirmed({parentTaskId:input.taskId,sessionId:input.state.sessionId,deadline:input.deadline,signal:input.signal});
      return {result:{state,questionId:selected.questionId,questionRevision:question.revision,sourceTaskId:selected.sourceTaskId,sourceRunId:selected.sourceApprovalId},
        resultSummary:'F02 original card and operation receipts verified; acoustic acceptance is separate'};
    }};
  return {tools,configuredWorkflowWorkerPorts:[worker],authorizeFinalRead:ports.authorizeFinalRead,unavailable:bundle.unavailable};
}
