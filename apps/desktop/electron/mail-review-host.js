import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fields=['workKey','sourceRevision','projectionDigest','receiptId'];
const binding=item=>({workKey:item.workKey,sourceRevision:item.sourceRevision,projectionDigest:item.projectionDigest,receiptId:item.receipt?.id??item.receiptId});
const equal=(a,b)=>fields.every(key=>a?.[key]===b?.[key]);
const valid=value=>value&&Object.keys(value).sort().join(',')===[...fields].sort().join(',')&&fields.every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=512);
const denied=()=>{throw new ProtocolError('UNAUTHORIZED','Mail review source or consent changed');};
const terminal=new Set(['succeeded','failed','cancelled']);
const bindingSchema={type:'object',additionalProperties:false,required:fields,properties:Object.fromEntries(fields.map(key=>[key,{type:'string',minLength:1,maxLength:512}]))};
const envelopeSchema={type:'object',additionalProperties:false,required:['binding','labelKeys','headers'],properties:{binding:bindingSchema,
  labelKeys:{type:'array',minItems:2,maxItems:16,items:{type:'string',maxLength:128}},headers:{type:'object',additionalProperties:false,
    required:['headersOnly','text'],properties:{headersOnly:{const:true},text:{type:'string',maxLength:32000}}}}};

/** Trusted composition only. Original Runtime tasks, question leases and NotificationHost own execution. */
export function createDesktopMailReviewHost({getApplication,mail,question,readConfigurationRef,confirmConsent,getNotifications,
  namespace,labelKeys=['meeting','work','subscription','transaction','personal','other'],onUpdate=()=>{},now=Date.now}){
  const application=()=>getApplication(),runtime=()=>application().runtime;
  let store,saved,closed=false,busy=false,controller=new AbortController();
  const prepared=new Map();
  const configuration=()=>{try{const value=readConfigurationRef();return typeof value==='string'&&value?value:undefined;}catch{return undefined;}};
  const state=()=>{if(!store)store=runtime().bindTrustedHostState('desktop-mail-review');
    if(!saved){saved=store.get(digest(namespace))??{version:1,enabled:true,watermark:null,configurationRef:null,generation:null,selected:[],entries:{}};
      if(saved.version!==1)denied();}
    if(saved.enabled&&!saved.configurationRef){const config=configuration();if(config){
      Object.assign(saved,{configurationRef:config,watermark:new Date(now()).toISOString(),generation:randomUUID()});persist();
    }}return saved;};
  const persist=()=>{store.set(digest(namespace),saved);try{onUpdate();}catch{}};
  const context=deadline=>({deadline,signal:controller.signal});
  const current=entry=>{
    const s=state();if(closed||!s.enabled||controller.signal.aborted||s.configurationRef!==configuration()
      ||entry.generation!==s.generation||now()>=Date.parse(entry.deadline))denied();
    const item=mail.readReviewAnalysis(entry.binding.workKey,context(entry.deadline));
    if(!item||!equal(binding(item),entry.binding))denied();return item;
  };
  const scopeEntry=scope=>{
    if(scope.toolName!=='mail.review'||scope.toolVersion!=='1.0.0'||scope.signal.aborted)denied();
    const intent=runtime().loadCheckpoint(scope.taskId,'host-tool-intent');
    const entry=Object.values(state().entries).find(item=>item.commandId===intent?.commandId);
    if(!entry||!equal(intent.arguments,entry.binding)||scope.deadline!==entry.deadline||entry.taskId&&entry.taskId!==scope.taskId)denied();
    if(!entry.taskId){entry.taskId=scope.taskId;persist();}current(entry);return entry;
  };
  const executionScope=context=>{
    const original=prepared.get(context.taskId)?.scope;
    if(!original||context.taskId!==original.taskId||context.runId!==original.runId||context.deadline!==original.deadline
      ||context.argumentsDigest!==original.argumentsDigest||context.signal.aborted||original.signal.aborted)denied();
    return {...original,signal:AbortSignal.any([original.signal,context.signal,controller.signal])};
  };
  const stop=()=>{const s=state();controller.abort();prepared.clear();
    for(const entry of Object.values(s.entries))if(entry.taskId&&!terminal.has(runtime().getTask(entry.taskId).state)){
      runtime().requestCancel(entry.taskId,'Mail review consent revoked');entry.state='revoked';}
    persist();};
  const recordNotification=(entry,outcome)=>{
    const value=outcome?.attempts?.banner?.state;if(!['delivered','failed','unknown'].includes(value))return;
    const settled=value!=='unknown';
    if(entry.notificationState!==value||entry.notificationSettled!==settled){
      entry.notificationState=value;entry.notificationSettled=settled;persist();}
  };
  const retryEntry=(ref,item)=>{
    const entry=state().entries[ref.workKey],taskId=entry?.taskId;
    if(!entry||!equal(entry.binding,ref)||!item||item.state!=='accepted'||item.taskId!==taskId||!taskId)denied();
    const task=runtime().getTask(taskId),intent=runtime().loadCheckpoint(taskId,'host-tool-intent'),
      attempt=runtime().loadCheckpoint(taskId,'mail-review-attempt:v1'),inflight=runtime().loadCheckpoint(taskId,'competition-cloud-inflight');
    const record=runtime().readToolExecutions(taskId).find(value=>value.evidenceId==='host-tool-'+taskId);
    const noResult=['competition-cloud-unknown','mail-review-result:v1','tool-result-host-tool-'+taskId];
    if(task.state!=='failed'||task.error?.code!=='EXTERNAL_FAILURE'||item.cloudReview!==undefined
      ||intent?.toolName!=='mail.review'||intent.toolVersion!=='1.0.0'||intent.commandId!==entry.commandId
      ||!equal(intent.arguments,ref)||attempt?.version!==1||!equal(attempt.binding,ref)
      ||noResult.some(key=>runtime().loadCheckpoint(taskId,key)!==undefined)
      ||record?.taskId!==taskId||record.toolName!=='mail.review'||record.toolVersion!=='1.0.0'
      ||record.state!=='failed'||record.executionStarted!==true||record.policyDecision!=='allow')denied();
    const legacyAbsent=['competition-cloud-dispatch-binding','competition-cloud-dispatch-context','competition-cloud-request-identity',
      'competition-cloud-received','competition-cloud-terminal-error','application-profile','application-deadline','competition-max-steps'];
    if(task.error.message==='Cloud coordination failed'&&inflight?.accepted===false
      &&legacyAbsent.every(key=>runtime().loadCheckpoint(taskId,key)===undefined))
      return {entry,reason:'legacy-mail-review-before-dispatch'};
    const diagnostic=runtime().loadCheckpoint(taskId,'competition-coordination-failure'),
      received=runtime().loadCheckpoint(taskId,'competition-cloud-received'),
      terminalError=runtime().loadCheckpoint(taskId,'competition-cloud-terminal-error'),
      dispatch=runtime().loadCheckpoint(taskId,'competition-cloud-dispatch-binding'),
      dispatchContext=runtime().loadCheckpoint(taskId,'competition-cloud-dispatch-context'),
      identities=runtime().loadCheckpoint(taskId,'competition-cloud-request-identity');
    const identity=inflight&&{sessionId:inflight.sessionId,requestId:inflight.requestId,idempotencyKey:inflight.idempotencyKey,
      payloadDigest:inflight.payloadDigest,...(inflight.serverInstanceId===undefined?{}:{serverInstanceId:inflight.serverInstanceId})};
    const requestIdentity=identities?.requests?.[0];
    if(!isDeepStrictEqual(diagnostic,{version:'1.0',phase:'initial',kind:'agentarts_terminal',code:'EXTERNAL_FAILURE',remoteCode:'INVALID_ARGUMENT'})
      ||inflight?.accepted!==true||!isDeepStrictEqual(received,inflight)
      ||terminalError!==undefined&&!isDeepStrictEqual(terminalError,{version:'1.0',kind:'wss_terminal_error',receipt:inflight})
      ||!identity||Object.values(identity).some(value=>typeof value!=='string'||!value)
      ||typeof attempt.configurationRef!=='string'||!attempt.configurationRef
      ||attempt.deadline!==entry.deadline||intent.deadline!==entry.deadline
      ||!isDeepStrictEqual(dispatch,{bindingVersion:'1.0',configurationRef:attempt.configurationRef,invocation:identity})
      ||dispatchContext?.snapshotVersion!=='1.0'||dispatchContext.taskId!==taskId||dispatchContext.configurationRef!==attempt.configurationRef
      ||!isDeepStrictEqual(dispatchContext.invocation,identity)||dispatchContext.request?.phase!=='initial'
      ||dispatchContext.request.deadline!==entry.deadline
      ||runtime().loadCheckpoint(taskId,'application-profile')!=='huawei_ict_agentarts'
      ||runtime().loadCheckpoint(taskId,'application-deadline')!==entry.deadline||runtime().loadCheckpoint(taskId,'competition-max-steps')!==1
      ||identities?.formatVersion!=='1.0.0'||!Array.isArray(identities.requests)||identities.requests.length!==1
      ||!Array.isArray(identities.conflicts)||identities.conflicts.length!==0
      ||requestIdentity?.sessionId!==inflight.sessionId||requestIdentity.requestId!==inflight.requestId
      ||requestIdentity.payloadDigest!==inflight.payloadDigest||requestIdentity.attempts!==1
      ||!Number.isSafeInteger(requestIdentity.revision)||requestIdentity.revision<0||requestIdentity.revision!==dispatchContext.request.revision
      ||!Number.isFinite(Date.parse(requestIdentity.recordedAt)))denied();
    return {entry,reason:'mail-review-remote-invalid-argument'};
  };
  const api={
    snapshot(){const s=state(),rows=Object.values(s.entries);return {enabled:s.enabled&&!closed,watermark:s.watermark,
      pending:rows.filter(item=>!['applied','failed','unknown','revoked'].includes(item.state)).length,
      reviewed:rows.filter(item=>item.state==='applied').length,failed:rows.filter(item=>['failed','unknown'].includes(item.state)).length};},
    async configure(input){
      if(!input||Object.keys(input).some(key=>!['enabled','selectedBindings'].includes(key))||typeof input.enabled!=='boolean')denied();
      if(!input.enabled){await api.revoke();return api.snapshot();}
      if(closed)denied();
      if(controller.signal.aborted)controller=new AbortController();
      const selected=input.selectedBindings??[];if(!Array.isArray(selected)||selected.some(value=>!valid(value))
        ||new Set(selected.map(ref=>ref.workKey)).size!==selected.length)denied();
      const config=configuration();if(!config)denied();
      const deadline=new Date(now()+30*60_000).toISOString();
      const selectedRetries=()=>selected.flatMap(ref=>{const item=mail.readReviewAnalysis(ref.workKey,context(deadline));
        if(!item||!equal(binding(item),ref))denied();
        if(item.state==='pending'){if(state().entries[ref.workKey])denied();return [];}
        const retry=retryEntry(ref,item);return [{...ref,previousTaskId:retry.entry.taskId,reason:retry.reason}];});
      const retries=selectedRetries(),retryDigest=digest(retries);
      const consent=await confirmConsent({payload:{enabled:true,selectedBindings:structuredClone(selected),configurationRef:config,
        ...(retries.length?{selectedRetries:structuredClone(retries)}:{})},
        scope:{configurationRef:config,selectedBindingsDigest:digest(selected),headersOnly:true,newOnly:true,
          ...(retries.length?{selectedRetriesDigest:retryDigest}:{})},
        summary:'允许明确选择的邮件及启用后新模糊邮件的信头在所选云模型复核；不读取正文，不批量发送历史邮件'
          +(retries.some(retry=>retry.reason==='legacy-mail-review-before-dispatch')?'；包括重新复核已证实在发送前失败的所选旧任务':'')
          +(retries.some(retry=>retry.reason==='mail-review-remote-invalid-argument')?'；包括重新复核远端已明确以参数错误拒绝的所选旧任务':''),
        deadline,signal:controller.signal,isCurrent:()=>{try{return !closed&&configuration()===config&&digest(selectedRetries())===retryDigest;}catch{return false;}}});
      if(consent!==true||closed||configuration()!==config||digest(selectedRetries())!==retryDigest)denied();
      await api.revoke();closed=false;controller=new AbortController();
      const s=state();
      for(const retry of retries){const item=mail.readReviewAnalysis(retry.workKey,context(deadline)),permit=retryEntry(retry,item);
        if(permit.reason!==retry.reason)denied();
        s.retryHistory??={};s.retryHistory[retry.previousTaskId]={entry:structuredClone(permit.entry),
          reason:permit.reason,state:'prepared',requestedAt:new Date(now()).toISOString()};persist();
        const released=mail.retryCachedAnalysis({...binding(retry),previousTaskId:retry.previousTaskId},context(deadline));
        if(!released||released.state!=='pending'||released.taskId!==undefined||!equal(binding(released),retry))denied();
        s.retryHistory[retry.previousTaskId].state='released';delete s.entries[retry.workKey];persist();
      }
      Object.assign(s,{enabled:true,configurationRef:config,watermark:new Date(now()).toISOString(),generation:randomUUID(),selected:structuredClone(selected)});persist();return api.snapshot();
    },
    prepareAuthorization(scope){
      if(scope.toolName!=='mail.review')return;
      const entry=scopeEntry(scope),rule=digest([namespace,entry.generation,entry.binding,state().configurationRef]);
      question.prepare(scope,{requirements:[{requirementId:'mail-review-source',kind:'connector_session',scopes:['mail:review'],
        bindingDigest:digest([scope.taskId,scope.runId,scope.argumentsDigest,entry.binding,entry.deadline]),ruleBindingDigest:rule,
        summary:'复核本封已选邮件的本机信头分类；不读取正文，不执行邮件指令或业务写入'}],assertCurrent:()=>{try{current(entry);return true;}catch{return false;}}});
      question.prepareExport(scope,{requirementId:'mail-review-export',projectionSchema:envelopeSchema,
        bindingDigest:digest([rule,scope.taskId,scope.runId,scope.argumentsDigest]),ruleBindingDigest:digest([rule,'export']),
        summary:'仅将这封邮件绑定的信头和固定分类标签发送至所选云模型复核；不读取正文',assertCurrent:()=>{try{current(entry);return true;}catch{return false;}}});
      prepared.set(scope.taskId,{scope,entry});
    },
    async readEnvelope(ref,context){
      const scope=executionScope(context);
      const entry=scopeEntry(scope);if(!equal(ref,entry.binding)||!prepared.has(scope.taskId))denied();
      question.currentRequirement(scope,'mail-review-source');const item=current(entry);
      if(item.projection?.headersOnly!==true||item.projection?.sensitivity!=='private'||typeof item.projection.text!=='string'||item.projection.text.length>32000)denied();
      const envelope={binding:structuredClone(ref),labelKeys:[...labelKeys],headers:{headersOnly:true,text:item.projection.text}};
      question.authorizeExport(scope,envelope,'mail-review-export');
      prepared.get(scope.taskId).envelopeDigest=digest(envelope);return structuredClone(envelope);
    },
    assertExport(ref,envelope,context){
      const scope=executionScope(context);
      const entry=scopeEntry(scope),item=current(entry),preparedEntry=prepared.get(scope.taskId);
      if(!equal(ref,entry.binding)||!preparedEntry||preparedEntry.envelopeDigest!==digest(envelope)
        ||envelope.headers?.text!==item.projection.text||digest(envelope.labelKeys)!==digest(labelKeys))denied();
      question.authorizeConsumedExport(scope,envelope,'mail-review-export');
    },
    async tick(){
      if(closed||busy)return;busy=true;
      try{
        const s=state();
        // Reading the original OS receipt grants no send and survives configuration generations/deadlines.
        for(const entry of Object.values(s.entries))if(entry.batchId&&entry.notificationState==='unknown'){
          const notifications=getNotifications?.();
          if(typeof notifications?.reconcileDelivery==='function'){
            try{recordNotification(entry,notifications.reconcileDelivery('desktop-batch-'+digest(entry.batchId)));}
            catch{/* Preserve unknown for a later original-round readback; never send again. */}
          }
        }
        if(!s.enabled)return;
        const config=configuration();if(!config)return;
        if(state().configurationRef!==config){await api.revoke();return;}
        const active=Object.values(s.entries).some(entry=>entry.generation===s.generation&&['submitting','pending'].includes(entry.state));
        const pending=active?[]:mail.pendingReviewAnalyses(context(new Date(now()+30*60_000).toISOString()),
          {observedAtOrAfter:s.watermark,workKeys:s.selected.filter(ref=>!s.entries[ref.workKey]).map(ref=>ref.workKey),
            excludeWorkKeys:Object.keys(s.entries),limit:1});
        const selected=!active&&pending.find(item=>item.state==='pending'&&!s.entries[item.workKey]&&(s.selected.some(ref=>equal(ref,binding(item)))
          ||Number.isFinite(Date.parse(item.observedAt))&&Date.parse(item.observedAt)>=Date.parse(s.watermark)));
        if(selected){
          const entry={binding:binding(selected),generation:s.generation,deadline:new Date(now()+30*60_000).toISOString(),
            commandId:'mail-review-'+digest([namespace,s.generation,binding(selected)]),state:'submitting'};
          s.entries[selected.workKey]=entry;persist();
          try{const read=application().submitHostToolTask({commandId:entry.commandId,toolName:'mail.review',toolVersion:'1.0.0',arguments:entry.binding,deadline:entry.deadline});
            entry.taskId=read.task.taskId;entry.state='pending';persist();
            mail.confirmCachedAnalysisAccepted({...entry.binding,taskId:entry.taskId},context(entry.deadline));
          }catch{entry.state='unknown';persist();}
        }
        for(const entry of Object.values(s.entries)){
          if(entry.generation!==s.generation||!entry.taskId||['failed','unknown','revoked'].includes(entry.state))continue;
          if(entry.batchId&&entry.notificationState==='unknown')continue;
          try{
          const read=application().readHostToolTask(entry.taskId);
          if(!terminal.has(read.task.state))continue;
          if(read.task.state!=='succeeded'){entry.state='failed';persist();continue;}
          if(entry.state!=='applied'){
            const result=runtime().loadCheckpoint(entry.taskId,'mail-review-result:v1');
            if(!result||!equal(result.binding,entry.binding)){entry.state='unknown';persist();continue;}
            const item=current(entry);
            mail.applyCachedAnalysisReview({...entry.binding,taskId:entry.taskId,review:result.result},context(entry.deadline));
            entry.state='applied';entry.notify=result.result.notificationRecommendation==='notify';persist();
          }
          if(entry.notify&&!entry.notificationSettled){
            current(entry);const notifications=getNotifications?.();if(!notifications)continue;
            const id='mail-cloud-review-'+digest([entry.taskId,entry.binding]),scope={kind:'connector',connectorId:'mail'};
            if(!entry.batchId){notifications.ingest([{source:'mail',accountRef:namespace,externalId:id,dedupeKey:id,
              contentRef:'云端信头复核提示有邮件需要关注；请查看原邮件后确认。',occurredAt:new Date(now()).toISOString(),fetchedAt:new Date(now()).toISOString(),sensitivity:'private'}],{scope});
              const batch=notifications.drain().batches.find(batch=>batch.itemRefs.includes(id));if(!batch)continue;entry.batchId=batch.id;persist();}
            const outcome=await notifications.deliverBatch({batchId:entry.batchId,scope,expiresAt:entry.deadline,
              title:'PersonalAgent · 邮件复核提醒',body:'云端信头复核提示有邮件需要关注；请查看原邮件后确认。',source:'mail-cloud-review'});
            recordNotification(entry,outcome);
          }
          }catch{entry.state='failed';persist();}
        }
      }catch{/* Safe metadata remains pending; original tasks are never re-dispatched. */}
      finally{busy=false;}
    },
    async revoke(){state().enabled=false;stop();},
    async close(){closed=true;stop();},
  };return api;
}
