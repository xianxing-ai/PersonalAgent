import {isDeepStrictEqual} from 'node:util';

/** Original pending-question graph only. Capture transport is not acoustic proof. */
export function createF02VoiceGraphPorts({getApplication,authorizationQuestions,liveVoiceHost,
  microphoneHost,verifyAudioEvidence,authorizeExport,now=()=>new Date()}={}) {
  if(typeof getApplication!=='function'||typeof authorizationQuestions?.snapshot!=='function'
    ||typeof authorizationQuestions?.refresh!=='function'||typeof authorizeExport!=='function')
    return {unavailable:'f02_voice_desktop_ports_unavailable',ports:undefined};
  const assertCurrent=scope=>{
    const application=getApplication();
    if(!application?.runtime)throw Error('F02 Runtime unavailable');
    const task=application.runtime.getTask(scope.parentTaskId??scope.taskId);
    if(scope.signal?.aborted||scope.deadline!==undefined&&(!Number.isFinite(Date.parse(scope.deadline))||now().getTime()>=Date.parse(scope.deadline))
      ||task.cancelRequested||!['running','waiting_approval'].includes(task.state))throw Error('F02 original task is no longer current');
  };
  const readBinding=scope=>{
    assertCurrent(scope);
    const binding=getApplication().readConfiguredWorkflowBinding({taskId:scope.parentTaskId??scope.taskId,
      workflowId:'F02',sessionId:scope.sessionId,signal:scope.signal});
    if(!binding||binding.deadline!==scope.deadline)throw Error('F02 original graph binding unavailable');
    return binding;
  };
  const question=scope=>{
    const binding=readBinding(scope),selected=binding.input;
    const original=getApplication().readDelegatedUserTaskParent(scope.parentTaskId??scope.taskId);
    if(!original||selected.conversationId!==original.conversationId)throw Error('F02 original conversation differs');
    authorizationQuestions.refresh();
    const item=authorizationQuestions.snapshot(original.conversationId).find(item=>item.questionId===selected.questionId
      &&item.taskId===selected.sourceTaskId&&item.sourceApprovalId===selected.sourceApprovalId);
    if(!item)throw Error('F02 selected question unavailable');
    return {binding,selected,item};
  };
  const first=scope=>{
    const {binding,selected,item}=question(scope);
    const operation=binding.confirmedOperations.find(op=>op.nodeId==='F02_N01'&&op.toolName==='workflow.host.f02_n01');
    if(!operation||operation.result.questionId!==selected.questionId||operation.result.revision!==selected.questionRevision)
      throw Error('F02 original question receipt unavailable');
    return {selected,item,questionTaskId:operation.localTaskId};
  };
  const readFinal=binding=>liveVoiceHost?.readFinalUserAudio?.(binding);
  const resolveOriginalVoice=scope=>{
    const {selected,item,questionTaskId}=first(scope);
    if(item.state!=='pending'||item.revision!==selected.questionRevision)return undefined;
    const host={hostTaskId:scope.localTaskId,parentTaskId:scope.parentTaskId,graphSessionId:scope.sessionId};
    const receipt=readFinal({...selected,...host,deadline:scope.deadline,signal:scope.signal});
    if(!receipt)return undefined;
    return {questionTaskId,questionId:selected.questionId,questionRevision:selected.questionRevision,
      sourceTaskId:selected.sourceTaskId,sourceApprovalId:selected.sourceApprovalId,
      sessionId:receipt.sessionId,utteranceId:receipt.utteranceId,...host};
  };
  const authorizeFinalRead=(request,receipt)=>{
    try {
      const scope={parentTaskId:request.parentTaskId,localTaskId:request.hostTaskId,sessionId:request.graphSessionId,
        deadline:request.deadline,signal:request.signal};
      const {input}=readBinding(scope),app=getApplication(),runId='host-tool-'+scope.localTaskId;
      const task=app.runtime.getTask(scope.localTaskId),read=app.readHostToolTask(scope.localTaskId);
      const parent=app.runtime.loadCheckpoint(scope.localTaskId,'coding-repair:parent');
      const intent=app.runtime.loadCheckpoint(scope.parentTaskId,'owned-workflow:intent:'+parent?.operationId);
      const record=app.runtime.readToolExecutions(scope.localTaskId).find(item=>item.evidenceId===runId),grant=app.runtime.policy.get(runId);
      if(parent?.taskId!==scope.parentTaskId||intent?.workflowId!=='F02'||intent.sessionId!==scope.sessionId
        ||intent.proposal?.nodeId!=='F02_N03'||intent.proposal.toolName!=='workflow.host.f02_n03'
        ||!isDeepStrictEqual(intent.proposal.arguments,{})||intent.deadline!==scope.deadline
        ||task.cancelRequested||!['running','succeeded'].includes(task.state)||read.toolName!=='workflow.host.f02_n03'
        ||read.commandId!==parent.operationId||!record||record.toolName!==read.toolName||record.toolVersion!==read.toolVersion
        ||!record.executionStarted||record.policyDecision!=='allow'||!app.runtime.matchesToolExecutionInput(record,{arguments:{},scopeRef:runId})
        ||!grant||grant.taskId!==scope.localTaskId||grant.toolName!==read.toolName||!grant.scopes.includes('workflow:voice')
        ||Date.parse(grant.expiresAt)<=now().getTime())return false;
      return ['questionId','questionRevision','conversationId','sourceTaskId','sourceApprovalId'].every(key=>request[key]===input[key]&&receipt[key]===input[key]);
    }catch{return false;}
  };
  const verify=(scope,binding,receipt)=>{
    assertCurrent(scope);
    const {selected}=first(scope),request={...binding,conversationId:selected.conversationId,deadline:scope.deadline,signal:scope.signal};
    const capture=liveVoiceHost?.readFinalCaptureEvidence?.(request),playback=liveVoiceHost?.readQuestionDelivery?.(request);
    if(!capture||!playback||capture.transcriptDigest!==receipt.transcriptDigest||capture.sessionId!==receipt.sessionId
      ||capture.utteranceId!==receipt.utteranceId||playback.sessionId!==receipt.sessionId
      ||Date.parse(receipt.startedAt)<Date.parse(playback.completedAt)||typeof verifyAudioEvidence!=='function')return false;
    // A PCM counter, OS device probe or renderer drain cannot prove absence of echo.
    const verified=verifyAudioEvidence({scope,binding:structuredClone(binding),receipt:structuredClone(receipt),capture,playback});
    if(verified&&typeof verified.then==='function'){void verified.catch(()=>{});return false;}
    return verified===true;
  };
  return {unavailable:typeof verifyAudioEvidence==='function'?null:'f02_acoustic_playback_evidence_unavailable',ports:{
    assertCurrent,readBinding,question,first,readFinal,resolveOriginalVoice,authorizeFinalRead,
    async waitForFinal(scope){
      for(;;){
        assertCurrent(scope);const {selected,item}=question(scope);
        if(item.state!=='pending'||item.revision!==selected.questionRevision)throw Error('F02 original voice question changed');
        if(!authorizeFinalRead({...selected,hostTaskId:scope.localTaskId,parentTaskId:scope.parentTaskId,
          graphSessionId:scope.sessionId,deadline:scope.deadline,signal:scope.signal},selected))
          throw Error('F02 original transcript read authority was revoked');
        if(resolveOriginalVoice(scope))return;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    },
    questions:{snapshot:(...args)=>authorizationQuestions.snapshot(...args),refresh:()=>authorizationQuestions.refresh(),
      assertRequirement:(...args)=>authorizationQuestions.assertRequirement(...args),
      assertConsumedResult(receipt,request,requirementId,consumerId){
        if(requirementId!=='tool'||consumerId!==request.runId+':tool')throw Error('F02 original consumer differs');
        const read=authorizationQuestions.readConsumedOperation(request);
        const {signal:_,...before}=request,{signal:__,...after}=read.request;
        if(!isDeepStrictEqual(before,after)||!isDeepStrictEqual(receipt,read.receipt))throw Error('F02 original decision differs');
      }},
    resolveOriginalQuestion(scope){const {selected,item}=question(scope);
      return item.state==='pending'&&item.revision===selected.questionRevision
        ?{questionId:selected.questionId,sourceTaskId:selected.sourceTaskId,runId:selected.sourceApprovalId}:undefined;},
    resolveOriginalConfirmation(scope){
      const {selected,questionTaskId}=first(scope);
      const read=authorizationQuestions.readConsumedOperation({taskId:selected.sourceTaskId,runId:selected.sourceApprovalId,
        deadline:selected.sourceDeadline,signal:scope.signal});
      return {questionTaskId,...read};
    },
    verifyAudioEvidence:verify,
    async authorizeExport(scope,result){assertCurrent(scope);const allowed=await authorizeExport({scope,result,now:now()});assertCurrent(scope);return allowed===true;},
    deviceEvidenceReady(scope){
      return typeof verifyAudioEvidence==='function'&&typeof liveVoiceHost?.readFinalUserAudio==='function'
        &&typeof liveVoiceHost?.readFinalCaptureEvidence==='function'&&typeof liveVoiceHost?.readQuestionDelivery==='function'
        &&typeof authorizationQuestions.readConsumedOperation==='function'
        &&!!microphoneHost?.readCaptureReceipt?.({purpose:'live',deadline:scope.deadline,signal:scope.signal});
    },now,
  }};
}
