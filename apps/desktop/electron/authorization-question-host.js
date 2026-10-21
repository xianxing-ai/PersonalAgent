import {createHash,randomUUID} from 'node:crypto';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=()=>{throw new ProtocolError('UNAUTHORIZED','原操作的精确授权已失效，未执行或发送新的资料');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const key=scope=>JSON.stringify([scope.taskId,scope.runId]);
const requestFields=scope=>({taskId:scope.taskId,proposalId:scope.proposalId,runId:scope.runId,toolName:scope.toolName,
  toolVersion:scope.toolVersion,argumentsDigest:scope.argumentsDigest,deadline:scope.deadline,signal:scope.signal});

/** Enforce declared fields recursively even when an old descriptor permits arbitrary keys. */
function boundedProjection(schema,value,depth=0) {
  if(depth>24)denied();
  const alternatives=schema?.anyOf??schema?.oneOf;
  if(Array.isArray(alternatives)){
    let matched=false;
    for(const alternative of alternatives){try{validateToolValue(alternative,value);boundedProjection(alternative,value,depth+1);matched=true;break;}catch{}}
    if(!matched)denied();return;
  }
  if(schema?.$ref)denied();
  if(value===null||typeof value!=='object')return;
  if(Array.isArray(value)){
    if(!schema?.items||Array.isArray(schema.items))denied();
    for(const item of value)boundedProjection(schema.items,item,depth+1);
    return;
  }
  if(!schema?.properties||Object.keys(value).some(name=>!Object.hasOwn(schema.properties,name)))denied();
  for(const [name,item] of Object.entries(value))boundedProjection(schema.properties[name],item,depth+1);
}

/** Trusted Main adapter. Never receives a profile, task binding or requirement from Renderer. */
export function createDesktopAuthorizationQuestionHost({createQuestions,getApplication,namespace,resolveConversation,
  available,onUpdate=()=>{},profiles,defaultProfileRef,resolveProfile,describeExecution,now=Date.now}) {
  const preparations=new Map(),operations=new Map(),owners=new Map(),batchDerivations=new Map(),projections=new Map();let application,questions,closed=false;
  function stateStore(){
    const current=getApplication();if(closed||!current?.runtime)denied();
    return current.runtime.bindTrustedHostState('desktop-authorization:'+digest(namespace));
  }
  function readResourceGeneration(resourceDigest){
    if(typeof resourceDigest!=='string'||!/^[a-f0-9]{64}$/u.test(resourceDigest))denied();
    const store=stateStore(),stateKey='resource:'+resourceDigest,existing=store.get(stateKey);
    if(existing!==undefined){if(typeof existing?.generation!=='string'||!Number.isSafeInteger(existing.revision))denied();return existing.generation;}
    const generation=randomUUID();
    if(!store.compareAndSet?.(stateKey,undefined,{generation,revision:1}))denied();
    return generation;
  }
  function rotateResourceGeneration(resourceDigest,expectedGeneration){
    if(readResourceGeneration(resourceDigest)!==expectedGeneration)denied();
    const store=stateStore(),stateKey='resource:'+resourceDigest,existing=store.get(stateKey),generation=randomUUID();
    if(existing?.generation!==expectedGeneration||!store.compareAndSet?.(stateKey,existing,{generation,revision:existing.revision+1}))denied();
    questions?.refresh();onUpdate();
    return generation;
  }
  function service() {
    const current=getApplication();
    if(closed||!current?.runtime)denied();
    if(current!==application){
      questions?.close();application=current;
      questions=createQuestions({store:current.runtime.bindTrustedHostState('desktop-authorization:'+digest(namespace)),profiles,
        defaultProfileRef,now,available,onChange:onUpdate,resolveProfile,describeExecution,
        readBinding:request=>{
          const original=current.readAuthorizationQuestionBinding(request);
          if(!original||getApplication()!==current)return undefined;
          if(!owners.has(request.taskId))owners.set(request.taskId,resolveConversation(request.taskId)??original.conversationId);
          return {...original,conversationId:owners.get(request.taskId)};
        },
        readReceiptBinding:request=>{
          const binding=current.readAuthorizationQuestionReceiptBinding(request);
          return binding&&getApplication()===current?{...binding,conversationId:owners.get(request.taskId)??binding.conversationId}:undefined;
        },
        canExecute:request=>{
          try {const task=current.runtime.getTask(request.taskId);
            return getApplication()===current&&task.state==='running'&&!task.cancelRequested;
          }catch{return false;}
        },
        onInvalidated:(binding,state)=>{
          try {if(state==='expired')current.runtime.expirePendingApprovals();
            else current.runtime.invalidatePendingApproval(binding.runId,state==='cancelled'?'cancelled':'stale');
          }catch{/* No approval exists for a metadata-only preparation. No grant is issued. */}
        }});
    }
    return questions;
  }
  function original(scope) {
    const value=getApplication()?.readAuthorizationQuestionInvocation(scope.taskId,scope.runId);
    if(!value||scope.signal?.aborted||Date.parse(scope.deadline)<=now()
      ||['runId','toolName','toolVersion','argumentsDigest'].some(name=>scope[name]!==undefined&&scope[name]!==value[name])
      ||value.deadline!==scope.deadline)denied();
    return {...value,signal:scope.signal};
  }
  function prepare(scope,{requirements=[],assertCurrent=()=>true}={}) {
    const source=original(scope),identity=key(source),prior=preparations.get(identity);
    if(operations.has(identity))denied();
    const requested=structuredClone(requirements);
    if(prior&&prior.argumentsDigest!==source.argumentsDigest)denied();
    const merged=new Map((prior?.requirements??[]).map(item=>[item.requirementId,item]));
    for(const requirement of requested){const old=merged.get(requirement.requirementId);if(old&&!same(old,requirement))denied();merged.set(requirement.requirementId,requirement);}
    preparations.set(identity,{...requestFields(source),requirements:[...merged.values()],
      assertCurrent:()=>assertCurrent()&&(prior?.assertCurrent?.()??true)});
  }
  function buildRequest(source,prepared){
    const tool={requirementId:'tool',kind:'tool',scopes:[...source.scopes],bindingDigest:digest({taskId:source.taskId,runId:source.runId,
      toolName:source.toolName,toolVersion:source.toolVersion,argumentsDigest:source.argumentsDigest,deadline:source.deadline}),
      ...((prepared?.requirements??[]).some(item=>item.requirementId!=='tool'&&item.ruleBindingDigest)
        ?{ruleBindingDigest:digest({toolName:source.toolName,toolVersion:source.toolVersion,scopes:[...source.scopes].sort()})}:{}),
      summary:`执行 ${source.toolName}；仅本操作参数及所列范围`};
    return {...requestFields(source),requirements:[tool,...(prepared?.requirements??[]).filter(item=>item.requirementId!=='tool')]};
  }
  async function requestToolAuthorization(scope) {
    const source=original(scope),identity=key(source),prepared=preparations.get(identity),request=buildRequest(source,prepared);
    const current=()=>getApplication()===application&&(prepared?.assertCurrent?.()??true);
    const api=service();
    getApplication().bindAuthorizationQuestion(request);
    const expiry=getApplication().runtime.getApproval(source.runId).expiresAt;
    const derived=batchDerivations.get(identity);
    let receipt;
    if(derived){
      getApplication().assertMailReadQuestionPage(derived.parent.request.taskId,source.taskId,derived.batchId);
      const parentConsumer=derived.parent.request.runId+':'+derived.requirementId;
      receipt=api.deriveConsumedResult(derived.parent.receipt,derived.parent.request,derived.requirementId,parentConsumer,request,
        ()=>current()&&derived.assertCurrent());
      getApplication().runtime.saveCheckpoint(source.taskId,'authorization-question-derived:'+source.runId,
        {questionId:receipt.questionId,parentQuestionId:derived.parent.receipt.questionId,requirementId:derived.requirementId,
          batchId:derived.batchId,argumentsDigest:source.argumentsDigest,deadline:source.deadline});
      batchDerivations.delete(identity);
    }else receipt=await api.request(request,current,expiry);
    if(receipt.decision==='deny')return 'deny';
    api.consume(receipt,request,'tool',source.runId+':tool');
    operations.set(identity,{request,receipt,consumers:new Map([['tool',source.runId+':tool']]),outputSchema:source.outputSchema});
    return 'allow_once';
  }
  function operation(scope) {
    const source=original(scope),entry=operations.get(key(source));
    if(!entry||entry.request.argumentsDigest!==source.argumentsDigest||entry.request.deadline!==source.deadline)denied();
    return {source,entry};
  }
  function currentRequirement(scope,requirementId) {
    const {source,entry}=operation(scope),consumerId=source.runId+':'+requirementId;
    const task=getApplication().runtime.getTask(source.taskId);
    if(task.state!=='running'||task.cancelRequested)denied();
    if(!entry.consumers.has(requirementId)){
      service().consume(entry.receipt,entry.request,requirementId,consumerId);entry.consumers.set(requirementId,consumerId);
    }
    service().assertRequirement(entry.receipt,entry.request,requirementId,consumerId);return true;
  }
  function prepareExport(scope,{summary,scopes=['model:export'],bindingDigest,ruleBindingDigest,requirementId='export',projectionSchema,assertCurrent=()=>true}={}) {
    const source=original(scope),schema=projectionSchema??source.outputSchema;
    const projectionDigest=digest(schema);
    const destination=getApplication().readAuthorizationQuestionDestination?.(source.taskId);
    if(typeof destination!=='string')denied();
    const projectionKey=key(source)+':'+requirementId,prior=projections.get(projectionKey);
    if(prior&&digest(prior)!==projectionDigest)denied();
    projections.set(projectionKey,structuredClone(schema));
    prepare(source,{requirements:[{requirementId,kind:'export',scopes,
      bindingDigest:bindingDigest??digest({taskId:source.taskId,runId:source.runId,argumentsDigest:source.argumentsDigest,projectionDigest}),
      ...(ruleBindingDigest?{ruleBindingDigest:digest({ruleBindingDigest,destination,projectionDigest})}:{}),
      summary:summary??`向本任务选定的 AgentArts 模型发送 ${source.toolName} 已声明字段的结果（最多 960 KiB），不含额外字段或凭据`} ],
      assertCurrent:()=>assertCurrent()&&getApplication().readAuthorizationQuestionDestination(source.taskId)===destination});
  }
  function authorizeExport(scope,result,requirementId='export') {
    const {source,entry}=operation(scope);
    const schema=projections.get(key(source)+':'+requirementId)??entry.outputSchema;
    validateToolValue(schema,result);boundedProjection(schema,result);
    if(Buffer.byteLength(JSON.stringify(result),'utf8')>960*1024)denied();
    currentRequirement(source,requirementId);
    const resultDigest=digest(result);
    const prior=entry.resultDigests??new Map();
    if(prior.has(requirementId)&&prior.get(requirementId)!==resultDigest)denied();prior.set(requirementId,resultDigest);entry.resultDigests=prior;
    getApplication().runtime.saveCheckpointOnce(source.taskId,'authorization-question-export:'+source.runId+':'+requirementId,
      {questionId:entry.receipt.questionId,revision:entry.receipt.revision,leaseRef:entry.receipt.receiptRef,resultDigest,
        schemaDigest:digest(schema),policyVersion:'desktop-declared-fields-v1',stage:requirementId,deadline:source.deadline});
    // A precise result hash supplements the bounded preflight rule. It grants no tool use.
    return {taskId:source.taskId,runId:source.runId,argumentsDigest:source.argumentsDigest,resultDigest,deadline:source.deadline};
  }
  function readExecutionPolicy(scope){
    const {entry}=operation(scope);return service().executionProfile(entry.receipt,entry.request);
  }
  function assertConsumedResult(scope,requirementId){
    const entry=operations.get(key(scope)),consumerId=scope.runId+':'+requirementId;
    if(!entry||entry.request.taskId!==scope.taskId||entry.request.deadline!==scope.deadline)denied();
    service().assertConsumedResult(entry.receipt,entry.request,requirementId,consumerId);return true;
  }
  function authorizeConsumedExport(scope,result,requirementId='export'){
    if(getApplication()?.runtime.getTask(scope.taskId).state==='running')return authorizeExport(scope,result,requirementId);
    const entry=operations.get(key(scope));if(!entry||scope.signal?.aborted||entry.request.deadline!==scope.deadline)denied();
    const schema=projections.get(key(scope)+':'+requirementId)??entry.outputSchema;
    validateToolValue(schema,result);boundedProjection(schema,result);
    if(Buffer.byteLength(JSON.stringify(result),'utf8')>960*1024)denied();
    const consumerId=scope.runId+':'+requirementId;
    if(!entry.consumers.has(requirementId)){
      service().consumeConfirmedExport(entry.receipt,entry.request,requirementId,consumerId);entry.consumers.set(requirementId,consumerId);
    }
    service().assertConsumedResult(entry.receipt,entry.request,requirementId,consumerId);
    const resultDigest=digest(result),previous=entry.confirmedResultDigests??new Map();
    if(previous.has(requirementId)&&previous.get(requirementId)!==resultDigest)denied();previous.set(requirementId,resultDigest);
    entry.confirmedResultDigests=previous;
    getApplication().runtime.saveCheckpointOnce(scope.taskId,'authorization-question-export:'+scope.runId+':'+requirementId,
      {questionId:entry.receipt.questionId,revision:entry.receipt.revision,leaseRef:entry.receipt.receiptRef,resultDigest,
        schemaDigest:digest(schema),policyVersion:'desktop-declared-fields-v1',stage:requirementId,deadline:scope.deadline});
    return {taskId:scope.taskId,runId:scope.runId,argumentsDigest:entry.request.argumentsDigest,resultDigest,deadline:scope.deadline};
  }
  function deriveMailBatch(parentScope,nextScope,{batchId,requirementId,assertCurrent}){
    if(typeof assertCurrent!=='function'||!assertCurrent())denied();
    assertConsumedResult(parentScope,requirementId);
    const parent=operations.get(key(parentScope)),source=original(nextScope);
    if(parent.request.toolName!=='mail.inbox'||source.toolName!=='mail.inbox')denied();
    getApplication().assertMailReadQuestionPage(parent.request.taskId,source.taskId,batchId);
    batchDerivations.set(key(source),{parent,batchId,requirementId,assertCurrent});return true;
  }
  return {
    requiresAuthorization:scope=>preparations.has(key(scope)),
    prepare,prepareExport,requestToolAuthorization,currentRequirement,authorizeExport,authorizeConsumedExport,assertConsumedResult,deriveMailBatch,readExecutionPolicy,
    readResourceGeneration,rotateResourceGeneration,
    request:(request,current)=>service().request(request,current),
    consume:(...args)=>service().consume(...args),assertRequirement:(...args)=>service().assertRequirement(...args),
    respond:(input,conversationId)=>service().respond(input,conversationId),
    snapshot:conversationId=>closed||!getApplication()?.runtime?[]:service().snapshot(conversationId),
    hasPending:runId=>!closed&&Boolean(getApplication()?.runtime)&&service().hasPending(runId),
    sandboxSnapshot:()=>service().sandboxSnapshot(),selectSandbox:input=>service().selectSandbox(input),revokeRule:input=>service().revokeRule(input),
    close(){closed=true;questions?.close();preparations.clear();operations.clear();owners.clear();batchDerivations.clear();projections.clear();},
  };
}
