import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import {getOwnedWorkflowTemplate} from '@personal-agent/agentarts';
import {createRuntimeF14DeviceControlHost,createWorkflowBusinessToolBridge,readWorkflowBusinessToolSource} from '@personal-agent/runtime/application';

const fail=(code,message)=>{throw new ProtocolError(code,message);};
const text={type:'string',minLength:1,maxLength:4096};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const values={type:'array',minItems:1,maxItems:20,items:object({label:text,text:{type:'string',maxLength:500}})};
const requestSchema=object({url:text,values,clickTarget:text});
const resultSchema=object({receiptId:text,lockReleased:{const:true},goalVerified:{const:false}});
const key='f14:device-session';
const reference=receipt=>({taskId:receipt.taskId,runId:receipt.runId,scopeRef:receipt.scopeRef,toolName:receipt.toolName,
  toolVersion:receipt.toolVersion,arguments:structuredClone(receipt.arguments)});

/** Original owned-browser session only; no new driver, scheduler, Policy or lock. */
export function createF14WorkflowWorkerPorts({getApplication,browserHost,computerControlLease,authorizationQuestions,
  authorizeExport,now=Date.now}={}) {
  if(typeof getApplication!=='function'||!browserHost?.tools||typeof computerControlLease?.reserveWorkflow!=='function'
    ||typeof authorizationQuestions?.currentRequirement!=='function'||typeof authorizationQuestions?.readConsumedOperation!=='function'
    ||typeof authorizeExport!=='function')
    return {tools:[],configuredWorkflowWorkerPorts:[],unavailable:'f14_original_device_ports_unavailable',authorizeWorkflowTarget:()=>false};
  let bridgeApplication,bridgeValue;const operations=new Map();
  const active=scope=>{
    const app=getApplication(),taskId=scope.parentTaskId??scope.taskId,task=app?.runtime.getTask(taskId);
    if(scope.signal.aborted||task?.cancelRequested)fail('CANCELLED','F14 original graph cancelled');
    if(!Number.isFinite(Date.parse(scope.deadline))||Date.parse(scope.deadline)<=now())fail('TIMEOUT','F14 original graph expired');
    if(!task||!['running','waiting_approval'].includes(task.state)||app.runtime.loadCheckpoint(taskId,'application-deadline')!==scope.deadline)
      fail('UNAUTHORIZED','F14 original graph unavailable');
    if(scope.sessionId){
      const bound=app.readConfiguredWorkflowBinding({taskId,workflowId:'F14',sessionId:scope.sessionId,signal:scope.signal});
      if(!bound||bound.deadline!==scope.deadline)fail('UNAUTHORIZED','F14 original session unavailable');
      return {app,taskId,bound};
    }
    return {app,taskId};
  };
  const session=scope=>{
    const {app,taskId,bound}=active(scope),saved=app.runtime.loadCheckpoint(taskId,key);
    if(!saved||saved.sessionId!==scope.sessionId||saved.deadline!==scope.deadline||!bound)
      fail('UNAUTHORIZED','F14 original device session unavailable');
    return {app,taskId,bound,saved};
  };
  const authorized=context=>{
    const app=getApplication(),read=app.readHostToolTask(context.taskId);
    const invocation=app.readAuthorizationQuestionInvocation(context.taskId,context.runId,read.task.state==='succeeded');
    const grant=app.runtime.policy.get(context.authorizationRef);
    if(!invocation||!grant||grant.taskId!==context.taskId||grant.toolName!==invocation.toolName
      ||grant.argumentsDigest!==invocation.argumentsDigest||Date.parse(grant.expiresAt)<=now()
      ||invocation.deadline!==context.deadline||invocation.scopes.some(scope=>!grant.scopes.includes(scope)))
      fail('UNAUTHORIZED','F14 original exact Policy grant is no longer current');
  };
  const hostActive=(scope,context)=>{active(scope);authorized(context);};
  const observation=(scope,receipt)=>{
    const proof=readWorkflowBusinessToolSource(getApplication(),scope,receipt,receipt.toolName),value=proof.receipt.result;
    authorized({taskId:receipt.taskId,runId:receipt.runId,authorizationRef:receipt.scopeRef,deadline:scope.deadline});
    authorized({...proof.sourceHost,authorizationRef:proof.sourceHost.runId,deadline:scope.deadline});
    if(proof.graph.workflowId!=='F14'||!['f14.browser.observe','f14.browser.before_submit',...Array.from({length:20},(_,i)=>'f14.browser.type.'+i),'f14.browser.click'].includes(proof.actionKey)
      ||!value||!['observed','action_observed'].includes(value.state)||value.source!=='playwright'||value.goalVerified!==false
      ||typeof value.targetRef!=='string'||!Number.isFinite(Date.parse(value.observedAt))||Date.parse(value.observedAt)>now()
      ||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=now()||Date.parse(value.expiresAt)>Date.parse(scope.deadline)
      ||!Array.isArray(value.controls)||value.controls.length>100
      ||value.url!==active(scope).bound.input.url)fail('UNAUTHORIZED','F14 original current browser observation changed');
    return value;
  };
  const lease=scope=>{const {saved}=session(scope);if(!saved.lease)fail('UNAUTHORIZED','F14 original input reservation unavailable');
    computerControlLease.readWorkflowReservation(saved.lease);return saved.lease;};
  const resolution=(request,scope)=>{
    const {bound}=active(scope);let nodeId,toolName,args;
    if(request.actionKey==='f14.browser.observe'){nodeId='F14_N01';toolName='browser.observe';args={};}
    else if(request.actionKey==='f14.browser.before_submit'){
      lease(scope);
      if(!bound.confirmedOperations.some(item=>item.nodeId==='F14_N05'&&item.result?.confirmed===true))
        fail('UNAUTHORIZED','F14 original confirmation is required for the final observation');
      nodeId='F14_N06';toolName='browser.observe';args={};
    }
    else {
      const {saved}=session(scope);lease(scope);const observed=observation(scope,saved.current);
      const type=/^f14\.browser\.type\.(\d+)$/.exec(request.actionKey);
      if(type){
        const index=Number(type[1]),field=bound.input.values[index];
        if(!field||index!==saved.typed.length)fail('UNAUTHORIZED','F14 original field sequence changed');
        const controls=observed.controls.filter(item=>item.name===field.label&&['input','textarea'].includes(item.tag)
          &&!item.disabled&&!['password','file','hidden'].includes(item.inputType?.toLowerCase()));
        if(controls.length!==1)fail('UNAUTHORIZED','F14 field requires one exact current editable control');
        nodeId='F14_N03';toolName='browser.type';args={targetRef:observed.targetRef,ref:controls[0].ref,text:field.text,clear:true};
      }else if(request.actionKey==='f14.browser.click'){
        if(saved.typed.length!==bound.input.values.length)fail('UNAUTHORIZED','F14 original fields are not confirmed');
        const controls=observed.controls.filter(item=>item.name===bound.input.clickTarget&&item.tag==='button'&&!item.disabled);
        if(controls.length!==1)fail('UNAUTHORIZED','F14 submit requires one exact current button');
        nodeId='F14_N06';toolName='browser.click';args={targetRef:observed.targetRef,ref:controls[0].ref};
      }else return undefined;
    }
    if(!isDeepStrictEqual(request.input,args))fail('UNAUTHORIZED','F14 original device arguments changed');
    return {workflowId:'F14',nodeId,hostToolName:'workflow.host.'+nodeId.toLowerCase(),toolName,toolVersion:'1.0.0',arguments:args};
  };
  const bridge=()=>{
    const app=getApplication();if(bridgeApplication!==app){bridgeApplication=app;
      bridgeValue=createWorkflowBusinessToolBridge({application:app,resolveTool:resolution,assertCurrent:hostActive,now:()=>new Date(now())});}
    return bridgeValue;
  };
  const currentOperation=(args,context,toolName)=>{
    for(const entry of operations.values()){
      const read=bridge().read(entry.request,entry.context);
      if(read.taskId!==context.taskId||read.runId!==context.runId)continue;
      const resolved=resolution(entry.request,entry.scope);
      if(resolved?.toolName!==toolName||!isDeepStrictEqual(args,resolved.arguments)||context.deadline!==entry.scope.deadline
        ||context.signal.aborted||context.authorizationRef!==context.runId)fail('UNAUTHORIZED','F14 current device child changed');
      hostActive(entry.scope,entry.context);authorized(context);return entry;
    }
    fail('UNAUTHORIZED','F14 device child is not the currently awaited original operation');
  };
  async function invoke(scope,context,actionKey,input){
    const request={actionKey,input};if(operations.has(context.taskId))fail('REVISION_CONFLICT','F14 host already awaits a device child');
    const entry={request,context,scope};operations.set(context.taskId,entry);
    try{return await bridge().invoke(request,context);}finally{if(operations.get(context.taskId)===entry)operations.delete(context.taskId);}
  }
  const authorizeWorkflowTarget=input=>{
    try{
      const entry=currentOperation(input.args,input.scope,input.toolName),{saved}=session(entry.scope);lease(entry.scope);
      const observed=observation(entry.scope,saved.current);
      return saved.current.taskId===input.sourceTaskId&&observed.targetRef===input.targetRef
        &&observed.url===input.url&&observed.expiresAt===input.expiresAt;
    }catch{return false;}
  };
  const question=input=>'确认在 '+input.url+' 填充 '+input.values.map(item=>item.label+'='+item.text).join('；')+' 后点击 '+input.clickTarget;
  const template=getOwnedWorkflowTemplate('F14');
  const nodeArguments=(nodeId,input)=>({F14_N01:{url:input.url},F14_N02:{lockKey:'desktop_input_lock'},F14_N03:{values:input.values},
    F14_N05:{question:question(input)},F14_N06:{clickTarget:input.clickTarget}})[nodeId];
  const operation=(bound,nodeId,toolName)=>{
    const original=bound.confirmedOperations.find(item=>item.nodeId===nodeId&&item.toolName===toolName);
    if(original)authorized({taskId:original.localTaskId,runId:original.readback.confirmed.runId,
      authorizationRef:original.readback.confirmed.runId,deadline:bound.deadline});
    return original;
  };
  const selected=(bound,nodeId)=>{
    const original=operation(bound,nodeId,'decision.choose_candidate');if(!original)return;
    const invocation=getApplication().readAuthorizationQuestionInvocation(original.localTaskId,original.readback.confirmed.runId,true);
    if(!invocation)fail('UNAUTHORIZED','F14 original selection arguments unavailable');
    const context=JSON.parse(invocation.arguments.context);
    return context.candidateValues.find(item=>item.id===original.result.selectedId);
  };
  const predecessors=(bound,nodeId)=>{
    const node=template.nodes.find(item=>item.id===nodeId),outputs={};
    if(!node)fail('UNAUTHORIZED','F14 fixed node unavailable');
    for(const edge of node.dependencies){
      const value=edge.nodeId==='F14_N04'?selected(bound,edge.nodeId)?.value
        :operation(bound,edge.nodeId,'workflow.host.'+edge.nodeId.toLowerCase())?.result;
      if(!value)fail('UNAUTHORIZED','F14 original predecessor receipt unavailable');
      outputs[edge.nodeId]=value;
    }
    return {predecessorOutputs:outputs,predecessorStates:Object.fromEntries(node.dependencies.map(edge=>[edge.nodeId,'completed']))};
  };
  const guardArguments=(bound,nodeId)=>({workflowId:'F14',nodeId,input:bound.input,...predecessors(bound,nodeId)});
  const {tools}=createRuntimeF14DeviceControlHost({getApplication,assertCurrent:hostActive,now:()=>new Date(now()),
    async guard(nodeId,input,scope){
      const {bound}=session(scope);lease(scope);
      if(!isDeepStrictEqual(input,guardArguments(bound,nodeId)))fail('UNAUTHORIZED','F14 original condition input changed');
      // Both conditions preserve the original local confirmation and its exact receipt.
      // A model branch cannot skip the card or authorize the submit operation.
      if(selected(bound,'F14_N04')?.value?.mustHaltForVoice!==true)fail('UNAUTHORIZED','F14 original confirmation decision unavailable');
      return 'selected';
    },
    async invoke(nodeId,input,scope,context){
      const {app,taskId,bound}=active(scope),expected=nodeArguments(nodeId,bound.input);
      if(!isDeepStrictEqual(input,expected))fail('UNAUTHORIZED','F14 fixed node input changed');
      if(nodeId==='F14_N01'){
        const receipt=await invoke(scope,context,'f14.browser.observe',{}),observed=observation(scope,receipt);
        if(!app.runtime.saveCheckpointOnce(taskId,key,{sessionId:scope.sessionId,deadline:scope.deadline,current:reference(receipt),initial:reference(receipt),typed:[]}))
          fail('REVISION_CONFLICT','F14 original observation already bound');
        return {elementsFound:observed.controls.length};
      }
      const {saved}=session(scope);
      if(nodeId==='F14_N02'){
        observation(scope,saved.current);
        if(saved.lease)fail('UNAUTHORIZED','F14 original reservation cannot be reconstructed');
        const reserved=computerControlLease.reserveWorkflow({taskId,sessionId:scope.sessionId,deadline:scope.deadline,signal:scope.signal,
          assertCurrent:()=>{hostActive(scope,context);},authorizeOperation:(args,child,name)=>{
            try{const current=currentOperation(args,child,name).scope;
              return current.parentTaskId===taskId&&current.sessionId===scope.sessionId;}catch{return false;}}});
        app.runtime.saveCheckpoint(taskId,key,{...saved,lease:reserved});return {lockAcquired:true};
      }
      lease(scope);
      if(nodeId==='F14_N05'){
        authorizationQuestions.currentRequirement(context,'tool');
        return {confirmed:true};
      }
      if(nodeId==='F14_N03'){
        for(let index=saved.typed.length;index<bound.input.values.length;index++){
          const latest=session(scope).saved,observed=observation(scope,latest.current),field=bound.input.values[index];
          const controls=observed.controls.filter(item=>item.name===field.label&&['input','textarea'].includes(item.tag)&&!item.disabled);
          if(controls.length!==1)fail('UNAUTHORIZED','F14 current field unavailable');
          const receipt=await invoke(scope,context,'f14.browser.type.'+index,{targetRef:observed.targetRef,ref:controls[0].ref,text:field.text,clear:true});
          const result=observation(scope,receipt),readback=result.controls.filter(item=>item.name===field.label&&item.value===field.text);
          if(readback.length!==1)fail('RESULT_UNKNOWN','F14 original field write is not independently visible');
          app.runtime.saveCheckpoint(taskId,key,{...latest,current:reference(receipt),typed:[...latest.typed,reference(receipt)]});
        }
        return {fieldsPopulated:bound.input.values.length};
      }
      if(!bound.confirmedOperations.some(item=>item.nodeId==='F14_N05'&&item.result?.confirmed===true))
        fail('UNAUTHORIZED','F14 original formal confirmation is required before submit');
      const beforeSubmit=await invoke(scope,context,'f14.browser.before_submit',{}),observed=observation(scope,beforeSubmit);
      for(const field of bound.input.values){
        const matches=observed.controls.filter(item=>item.name===field.label&&['input','textarea'].includes(item.tag)&&!item.disabled);
        if(matches.length!==1||matches[0].value!==field.text)fail('REVISION_CONFLICT','F14 original field value changed while awaiting confirmation');
      }
      const refreshed={...saved,current:reference(beforeSubmit),beforeSubmit:reference(beforeSubmit)};
      app.runtime.saveCheckpoint(taskId,key,refreshed);
      const buttons=observed.controls.filter(item=>item.name===bound.input.clickTarget&&item.tag==='button'&&!item.disabled);
      if(buttons.length!==1)fail('UNAUTHORIZED','F14 current submit control unavailable');
      const receipt=await invoke(scope,context,'f14.browser.click',{targetRef:observed.targetRef,ref:buttons[0].ref});
      observation(scope,receipt);
      computerControlLease.releaseWorkflow(saved.lease);
      app.runtime.saveCheckpoint(taskId,key,{...refreshed,current:reference(receipt),submitted:reference(receipt),released:true});
      return {receiptId:receipt.runId,lockReleased:true};
    }});
  const required=['browser.observe','browser.type','browser.click'];
  const worker={workflowId:'F14',toolName:'workflow.browser.form',toolVersion:'1.0.0',configurationVersion:'desktop-f14-original-v2',
    requestSchema,inputSchema:requestSchema,resultSchema,publicEnumPaths:[],sideEffect:'external_write',
    requiredTools:[...tools.map(tool=>({name:tool.descriptor.name,version:tool.descriptor.version})),
      ...[...required,'decision.choose_candidate'].map(name=>({name,version:'1.0.0'}))],
    assertCurrent:scope=>{active(scope);},available(scope){try{active(scope);const status=browserHost.snapshot();
      return status.connected===true&&status.available===true&&!status.busy&&status.releaseState==='confirmed'
        &&required.every(name=>browserHost.tools.some(tool=>tool.descriptor.name===name&&tool.descriptor.version==='1.0.0'));}catch{return false;}},
    async resolveInput(input,scope){active(scope);let url;try{url=new URL(input.url);}catch{fail('INVALID_ARGUMENT','F14 requires an original public page URL');}
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash
        ||new Set(input.values.map(item=>item.label)).size!==input.values.length||question(input).length>4096)
        fail('UNAUTHORIZED','F14 fixed original form input is invalid');
      return {...structuredClone(input),url:url.href};},
    assertFrontier(scope){
      const {input,proposal,state}=scope,{bound}=active({...scope,sessionId:state.sessionId});
      const node=template.nodes.find(item=>item.id===proposal.nodeId);
      if(!node||!isDeepStrictEqual(bound.input,input)||proposal.toolVersion!=='1.0.0'
        ||node.dependencies.some(edge=>state.result?.nodes[edge.nodeId]?.state!=='completed'))return false;
      const original=predecessors(bound,node.id),expected=nodeArguments(node.id,input);
      if(proposal.toolName==='workflow.guard.'+node.id.toLowerCase())
        return ['F14_N05','F14_N06'].includes(node.id)&&isDeepStrictEqual(proposal.arguments,guardArguments(bound,node.id));
      if(['F14_N05','F14_N06'].includes(node.id)
        &&operation(bound,node.id,'workflow.guard.'+node.id.toLowerCase())?.result.state!=='selected')return false;
      if(proposal.toolName==='decision.choose_candidate'){
        let context;try{context=JSON.parse(proposal.arguments.context);}catch{return false;}
        return context.workflowId==='F14'&&context.nodeId===node.id&&isDeepStrictEqual(context.input,input)
          &&isDeepStrictEqual(context.predecessors,original.predecessorOutputs)&&isDeepStrictEqual(context.predecessorStates,original.predecessorStates)
          &&Array.isArray(context.candidateValues)&&Array.isArray(proposal.arguments.candidates)
          &&isDeepStrictEqual(context.candidateValues.map(item=>item.id),proposal.arguments.candidates.map(item=>item.id))
          &&context.candidateValues.every(item=>!item.branches&&(item.abstain===true?item.value===null
            :node.id==='F14_N04'?isDeepStrictEqual(Object.keys(item.value??{}).sort(),['mustHaltForVoice','summary'])
              &&item.value.mustHaltForVoice===true&&typeof item.value.summary==='string'&&item.value.summary.length>0&&item.value.summary.length<=4096
              :isDeepStrictEqual(item.value,{arguments:expected})));
      }
      return !!expected&&proposal.toolName==='workflow.host.'+node.id.toLowerCase()&&isDeepStrictEqual(proposal.arguments,expected)
        &&isDeepStrictEqual(selected(bound,node.id)?.value,{arguments:expected});
    },
    async authorizeExport(input){
      const current=()=>{
        const {app,taskId}=active(input);
        if(input.stage==='receipt'){
          const read=app.readHostToolTask(input.localTaskId);
          if(!read.confirmed||!['decision.choose_candidate',...tools.map(tool=>tool.descriptor.name)].includes(read.toolName))
            fail('UNAUTHORIZED','F14 original export receipt unavailable');
          authorized({taskId:input.localTaskId,runId:read.confirmed.runId,authorizationRef:read.confirmed.runId,deadline:input.deadline});
          if(read.toolName==='workflow.host.f14_n05')authorizationQuestions.readConsumedOperation({taskId:input.localTaskId,
            runId:read.confirmed.runId,deadline:input.deadline,signal:input.signal});
        }
        if(input.stage==='completion'){
          const saved=app.runtime.loadCheckpoint(taskId,key),receipt=saved?.submitted;
          if(!receipt)fail('UNAUTHORIZED','F14 original completion source unavailable');
          authorized({taskId:receipt.taskId,runId:receipt.runId,authorizationRef:receipt.scopeRef,deadline:input.deadline});
        }
      };
      current();const allowed=await authorizeExport({...input,workflowId:'F14'});current();return allowed===true;
    },
    async verifyCompletion(input){
      const {app,taskId}=active(input),saved=app.runtime.loadCheckpoint(taskId,key),scope={...input,parentTaskId:taskId,sessionId:saved?.sessionId};
      if(!saved?.submitted||saved.released!==true||saved.typed.length!==input.input.values.length)
        fail('UNAUTHORIZED','F14 original submitted receipt and released lock are required');
      observation(scope,saved.submitted);
      for(const receipt of [...saved.typed,saved.submitted])authorized({taskId:receipt.taskId,runId:receipt.runId,
        authorizationRef:receipt.scopeRef,deadline:input.deadline});
      const names=new Set(input.readbacks.filter(read=>read.task.state==='succeeded'&&read.confirmed).map(read=>read.toolName));
      if(!['f14_n01','f14_n02','f14_n03','f14_n05','f14_n06'].every(node=>names.has('workflow.host.'+node)))
        fail('UNAUTHORIZED','F14 original local completion chain is incomplete');
      const {bound}=active(scope);
      if(template.nodes.some(node=>input.state.result?.nodes[node.id]?.state!=='completed'||!selected(bound,node.id))
        ||!['F14_N05','F14_N06'].every(nodeId=>operation(bound,nodeId,'workflow.guard.'+nodeId.toLowerCase())?.result.state==='selected'))
        fail('UNAUTHORIZED','F14 original decisions and condition receipts are incomplete');
      return {result:{receiptId:saved.submitted.runId,lockReleased:true,goalVerified:false},resultSummary:'原浏览器填写和点击已确认，输入锁已释放；外部业务结果未声称验证。'};
    }};
  return {tools,configuredWorkflowWorkerPorts:[worker],authorizeWorkflowTarget,unavailable:null};
}
