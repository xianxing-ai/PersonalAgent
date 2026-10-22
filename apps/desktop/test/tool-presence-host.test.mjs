import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolPresenceHost} from '../electron/tool-presence-host.js';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication,createDesktopSubagentDispatchTool} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

function fixture({fullAccess=false,policyBinding='sandbox:1:read-only'}={}){
  let time=1000,native,registrations=0,disposals=0,timerId=0;const prompts=[],timers=new Map(),bindings=new Map([['a','ui-a'],['b','ui-b']]);
  const policy={fullAccess,binding:policyBinding};
  const host=createToolPresenceHost({now:()=>time,isTaskCurrent:task=>bindings.has(task),readTaskBinding:task=>bindings.get(task),onPrompt:value=>prompts.push(value),
    isFullAccess:()=>policy.fullAccess,readPolicyBinding:()=>policy.binding,
    registerNativeShortcut:callback=>{assert.equal(native,undefined,'one native shortcut owner');native=callback;registrations++;return()=>{native=undefined;disposals++;};},
    setTimer:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,at:time+delay});return id;},clearTimer:id=>timers.delete(id)});
  return {host,prompts,bindings,policy,fire:()=>native?.(),handler:()=>native,counts:()=>({registrations,disposals}),
    scope:(task='a',milliseconds=60000)=>({taskId:task,deadline:new Date(time+milliseconds).toISOString(),signal:new AbortController().signal}),
    advance:milliseconds=>{time+=milliseconds;for(const [id,timer]of[...timers])if(timer.at<=time){timers.delete(id);timer.callback();}},setTime:value=>{time=value;}};
}
test('full access issues a policy-sourced task lease without registering or inventing a native gesture',async()=>{
  const f=fixture({fullAccess:true,policyBinding:'sandbox:2:full-access'});
  try{const scope=f.scope('a'),result=await f.host.tools[0].execute({},scope);
    assert.deepEqual(result,{state:'policy_allowed',expiresAt:new Date(31000).toISOString(),authorizationGranted:false});
    assert.equal(f.host.isUserPresent('a'),true);assert.equal(f.host.isUserPresent('b'),false);
    assert.deepEqual(f.counts(),{registrations:0,disposals:0});assert.deepEqual(f.prompts,[]);
    const receipt=await f.host.requestPresence(scope);assert.equal(receipt.source,'full-access-policy');
    assert.deepEqual(f.host.competitionToolExports[0].project({taskId:'a',result,signal:scope.signal}),result);
    assert.throws(()=>f.host.competitionToolExports[0].project({taskId:'a',result:{...result,state:'present'},signal:scope.signal}),{code:'UNAUTHORIZED'});
  }finally{f.host.close();}
});
test('full-access lease revokes on policy revision, restricted mode, task change, cancel and deadline',async()=>{
  const f=fixture({fullAccess:true,policyBinding:'sandbox:1:full-access'});
  try{await f.host.requestPresence(f.scope());f.policy.binding='sandbox:2:full-access';assert.equal(f.host.isUserPresent('a'),false);
    await f.host.requestPresence(f.scope());f.policy.fullAccess=false;assert.equal(f.host.isUserPresent('a'),false);
    f.policy.fullAccess=true;await f.host.requestPresence(f.scope());f.bindings.set('a','other-conversation');assert.equal(f.host.isUserPresent('a'),false);
    const controller=new AbortController();await f.host.requestPresence({...f.scope(),signal:controller.signal});controller.abort();assert.equal(f.host.isUserPresent('a'),false);
    await f.host.requestPresence(f.scope('a',10));f.advance(10);assert.equal(f.host.isUserPresent('a'),false);
    assert.equal(f.counts().registrations,0);
  }finally{f.host.close();}
});
test('full access fails closed without a trusted policy binding and cannot revive a closed host',async()=>{
  const f=fixture({fullAccess:true,policyBinding:''});
  await assert.rejects(f.host.requestPresence(f.scope()),{code:'UNAUTHORIZED'});assert.equal(f.counts().registrations,0);
  f.policy.binding='sandbox:1:full-access';await f.host.requestPresence(f.scope());f.host.close();
  assert.equal(f.host.isUserPresent('a'),false);await assert.rejects(f.host.requestPresence(f.scope()),{code:'UNSUPPORTED_CAPABILITY'});
});
test('a policy revision invalidates a pending restricted gesture instead of converting it to full access',async()=>{
  const f=fixture();try{const request=f.host.requestPresence(f.scope()),denied=assert.rejects(request,{code:'UNAUTHORIZED'});
    f.policy.binding='sandbox:2:full-access';f.policy.fullAccess=true;f.fire();await denied;assert.equal(f.host.isUserPresent('a'),false);
    const receipt=await f.host.requestPresence(f.scope());assert.equal(receipt.source,'full-access-policy');assert.equal(f.counts().registrations,1);
  }finally{f.host.close();}
});
test('trusted refresh and a new full-access request settle obsolete queued gestures without F9',async()=>{
  const f=fixture();try{
    const old=f.host.requestPresence(f.scope()),denied=assert.rejects(old,{code:'UNAUTHORIZED'});
    f.policy.fullAccess=true;f.policy.binding='sandbox:2:full-access';
    const receipt=await f.host.requestPresence(f.scope());await denied;
    assert.equal(receipt.source,'full-access-policy');assert.equal(f.handler(),undefined);
    f.policy.fullAccess=false;f.policy.binding='sandbox:3:read-only';f.host.refresh();assert.equal(f.host.isUserPresent('a'),false);
    const a=f.host.requestPresence(f.scope()),b=f.host.requestPresence(f.scope('b'));
    const failures=Promise.all([assert.rejects(a,{code:'UNAUTHORIZED'}),assert.rejects(b,{code:'UNAUTHORIZED'})]);
    f.policy.binding='sandbox:4:read-only';f.host.refresh();await failures;assert.equal(f.handler(),undefined);
  }finally{f.host.close();}
});
test('one F9 confirms only the unique current request; independent tasks retain distinct short receipts',async()=>{
  const f=fixture();try{let second=false;const a=f.host.requestPresence(f.scope('a')),b=f.host.requestPresence(f.scope('b')).then(value=>{second=true;return value;});
    assert.equal(f.host.isUserPresent('a'),false);assert.equal(f.host.isUserPresent('b'),false);f.fire();
    const receipt=await a;assert.equal(receipt.taskId,'a');assert.equal(second,false);assert.equal(f.host.isUserPresent('a'),true);assert.equal(f.host.isUserPresent('b'),false);
    assert.equal(f.prompts.at(-1).taskId,'b');f.fire();await b;assert.equal(f.host.isUserPresent('b'),true);
    assert.equal(f.counts().registrations,1);assert.equal(f.counts().disposals,1);f.advance(30000);assert.equal(f.host.isUserPresent('a'),false);
  }finally{f.host.close();}
});
test('cancel, deadline, changed canonical task binding and clock rollback revoke presence',async()=>{
  const f=fixture();try{const controller=new AbortController(),scope={...f.scope('a'),signal:controller.signal};
    const a=f.host.requestPresence(scope);f.fire();await a;assert.equal(f.host.isUserPresent('a'),true);controller.abort();assert.equal(f.host.isUserPresent('a'),false);
    const b=f.host.requestPresence(f.scope('b',20));f.fire();await b;f.advance(20);assert.equal(f.host.isUserPresent('b'),false);
    const c=f.host.requestPresence(f.scope('a'));f.fire();await c;f.bindings.set('a','foreign-ui');assert.equal(f.host.isUserPresent('a'),false);
    const d=f.host.requestPresence(f.scope('b'));f.fire();await d;f.setTime(1);assert.equal(f.host.isUserPresent('b'),false);
  }finally{f.host.close();}
});
test('a stale head never causes the next queued task to be confirmed by the same native event',async()=>{
  const f=fixture();try{const a=f.host.requestPresence(f.scope('a')),denied=assert.rejects(a,{code:'UNAUTHORIZED'});let done=false;
    const b=f.host.requestPresence(f.scope('b')).then(()=>{done=true;});f.bindings.set('a','changed');f.fire();await denied;assert.equal(done,false);
    assert.equal(f.host.isUserPresent('b'),false);f.fire();await b;assert.equal(done,true);
  }finally{f.host.close();}
});
test('legacy Notepad shares the native slot, gets one callback and no generic task presence',async()=>{
  const f=fixture();try{let confirmations=0;const remove=f.host.registerConfirmation(()=>confirmations++);assert.equal(typeof remove,'function');
    const pending=f.host.requestPresence(f.scope('a'));f.fire();assert.equal(confirmations,1);assert.equal(f.host.isUserPresent('a'),false);
    f.fire();await pending;remove();assert.equal(confirmations,1);
    const next=f.host.requestPresence(f.scope('b'));assert.equal(f.host.registerConfirmation(()=>confirmations++),undefined);f.fire();await next;
  }finally{f.host.close();}
});
test('unregister and close invalidate stale native handlers and settle pending requests',async()=>{
  const f=fixture();let confirmations=0;const remove=f.host.registerConfirmation(()=>confirmations++),old=f.handler();remove();
  const pending=f.host.requestPresence(f.scope('a')),cancelled=assert.rejects(pending,{code:'CANCELLED'});old();assert.equal(f.host.isUserPresent('a'),false);
  f.host.close();await cancelled;f.fire();old();assert.equal(confirmations,0);assert.equal(f.host.isUserPresent('a'),false);assert.equal(f.handler(),undefined);
  await assert.rejects(f.host.requestPresence(f.scope('a')),{code:'UNSUPPORTED_CAPABILITY'});
});
test('missing native registration and foreign tasks fail closed',async()=>{
  const host=createToolPresenceHost({registerNativeShortcut:()=>undefined,isTaskCurrent:()=>true,readTaskBinding:()=> 'canonical',onPrompt:()=>{}});
  try{assert.equal(host.registerConfirmation(()=>{}),undefined);await assert.rejects(host.requestPresence({taskId:'a',deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal}),{code:'UNSUPPORTED_CAPABILITY'});}
  finally{host.close();}
  const f=fixture();try{await assert.rejects(f.host.requestPresence(f.scope('foreign')),{code:'UNAUTHORIZED'});assert.equal(f.counts().registrations,0);}finally{f.host.close();}
});
test('generic registered request exports only its current native receipt and accepts no model scope',async()=>{
  const f=fixture();try{const tool=f.host.tools[0],context=f.scope('a'),availability=f.host.competitionToolAvailability[0],policy=f.host.competitionToolExports[0];
    assert.equal(tool.descriptor.name,'desktop.request_presence');assert.equal(tool.descriptor.requiresPresence,false);
    assert.equal(availability.available(context),true);assert.equal(policy.accepts({taskId:'a',arguments:{},signal:context.signal}),true);
    await assert.rejects(tool.execute({taskId:'b'},context),{code:'INVALID_ARGUMENT'});
    const pending=tool.execute({},context);assert.equal(f.host.isUserPresent('a'),false);f.fire();const result=await pending;
    assert.deepEqual(policy.project({taskId:'a',result,signal:context.signal}),{state:'present',expiresAt:new Date(31000).toISOString(),authorizationGranted:false});
    assert.throws(()=>policy.project({taskId:'b',result,signal:context.signal}),{code:'UNAUTHORIZED'});
    f.advance(30000);assert.throws(()=>policy.project({taskId:'a',result,signal:context.signal}),{code:'UNAUTHORIZED'});
  }finally{f.host.close();}
});
async function until(predicate){for(let attempt=0;attempt<500;attempt++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Synthetic Runtime did not settle');}
const schema={type:'object',properties:{},additionalProperties:false};
test('original Runtime child discovers a gated write, requests real host gesture, separately approves and continues',async()=>{
  let app,native,prompt,writes=0;const received=[];
  const broker=createToolPresenceHost({registerNativeShortcut:handler=>{native=handler;return()=>{native=undefined;};},onPrompt:value=>{prompt=value;},
    isTaskCurrent:id=>{try{const task=app.runtime.getTask(id);return !task.cancelRequested&&['running','waiting_approval'].includes(task.state);}catch{return false;}},
    readTaskBinding:id=>app?.readToolConversation(id)});
  const access=broker.tools[0];
  const write={descriptor:{name:'computer.synthetic_write',version:'1.0.0',inputSchema:schema,outputSchema:{type:'object'},sideEffect:'external_write',requiredScopes:['computer:write'],requiresPresence:true,idempotencySupport:false,recoverySupport:false},execute:async()=>{writes++;return {written:true};}};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)}),tools=[dispatch,access,write];
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,tools,isUserPresent:id=>broker.isUserPresent(id),
    readConversationPreference:()=>({depth:2,fast:false}),automaticTools:[dispatch,access].map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version})),
    competitionToolAvailability:[...broker.competitionToolAvailability,...[dispatch,write].map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,publicEnumPaths:tool===dispatch?['/subtasks/*/role']:[]}))],
    competitionToolExports:[...broker.competitionToolExports,...[dispatch,write].map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'synthetic-presence',accepts:()=>true,project:({result})=>result}))],
    coordination:{execute:async request=>{received.push(request);if(app.runtime.getTask(request.taskId).conversationId==='ui')return {kind:'text',text:'Parent summary',verification:'unverified'};
      if(!request.continuation){assert.ok(request.availableTools.some(tool=>tool.name===write.descriptor.name));assert.equal(broker.isUserPresent(request.taskId),false);
        return {kind:'tool_proposal',proposalId:'access',toolName:access.descriptor.name,toolVersion:'1.0.0',arguments:{},verification:'unverified'};}
      if(request.continuation.proposalId==='access')return {kind:'tool_proposal',proposalId:'write',toolName:write.descriptor.name,toolVersion:'1.0.0',arguments:{},verification:'unverified'};
      return {kind:'text',text:'Child confirmed write result',verification:'unverified'};}}});
  const client=new Client(app);await client.connect();
  try{const task=await client.call('task.submit',{goal:'Synthetic access then write',conversationId:'ui'},{idempotencyKey:'presence-chain',timeoutMs:60000});
    await until(()=>prompt?.state==='waiting');assert.equal(writes,0);native();
    let approval;await until(()=>{const [child]=app.readSubagentTasks(task.taskId);approval=child&&app.runtime.listApprovals({taskId:child.taskId,state:'pending'}).items[0];return approval&&app.activeTaskCount===0;});
    assert.equal(writes,0,'F9 creates presence, not a Policy approval');assert.equal(approval.action,write.descriptor.name);
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await until(()=>app.runtime.getTask(task.taskId).state==='succeeded'&&app.activeTaskCount===0);assert.equal(writes,1);
    const [child]=app.readSubagentTasks(task.taskId);assert.equal(child.state,'succeeded');assert.equal(received.filter(request=>request.taskId===child.taskId).length,3);
  }finally{broker.close();app.close();}
});
test('discoverable write proposed before F9 is rejected with no approval and zero I/O',async()=>{
  let writes=0,requests=0;const descriptor={name:'computer.synthetic_write',version:'1.0.0',inputSchema:schema,outputSchema:{type:'object'},sideEffect:'external_write',requiredScopes:['computer:write'],requiresPresence:true,idempotencySupport:false,recoverySupport:false};
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',isUserPresent:()=>false,
    tools:[{descriptor,execute:async()=>{writes++;return {};}}],
    competitionToolAvailability:[{toolName:descriptor.name,toolVersion:descriptor.version,available:()=>true}],
    competitionToolExports:[{toolName:descriptor.name,toolVersion:descriptor.version,exportPolicyVersion:'synthetic',accepts:()=>true,project:({result})=>result}],
    coordination:{execute:async request=>{requests++;assert.ok(request.availableTools.some(tool=>tool.name===descriptor.name));
      return {kind:'tool_proposal',proposalId:'early-write',toolName:descriptor.name,toolVersion:descriptor.version,arguments:{},verification:'unverified'};}}});
  const client=new Client(app);await client.connect();try{const {taskId}=await client.call('task.submit',{goal:'Synthetic early write',conversationId:'ui'},{idempotencyKey:'early-write'});
    await until(()=>app.runtime.getTask(taskId).state==='failed'&&app.activeTaskCount===0);
    assert.equal(app.runtime.getTask(taskId).error.code,'UNSUPPORTED_CAPABILITY');assert.equal(requests,1);assert.equal(writes,0);
    assert.equal(app.runtime.listApprovals({taskId}).items.length,0);assert.deepEqual(app.runtime.readToolExecutions(taskId),[]);
  }finally{app.close();}
});
test('revoked real receipt is denied by the Gateway even after a matching grant and forged presence input',async()=>{
  let app,native,writes=0;const broker=createToolPresenceHost({registerNativeShortcut:handler=>{native=handler;return()=>{native=undefined;};},onPrompt:()=>{},
    isTaskCurrent:id=>!!app.runtime.getTask(id)&&!app.runtime.getTask(id).cancelRequested,readTaskBinding:id=>app.readToolConversation(id)});
  const descriptor={name:'computer.synthetic_write',version:'1.0.0',inputSchema:schema,outputSchema:{type:'object'},sideEffect:'external_write',requiredScopes:['computer:write'],requiresPresence:true,idempotencySupport:false,recoverySupport:false};
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:[{descriptor,execute:async()=>{writes++;return {};}}],isUserPresent:id=>broker.isUserPresent(id)});
  try{const task=app.runtime.submitTask({goal:'Synthetic revoked presence',conversationId:'ui',idempotencyKey:'revoke'}),deadline=new Date(Date.now()+60000).toISOString(),controller=new AbortController();
    const pending=broker.requestPresence({taskId:task.taskId,deadline,signal:controller.signal});native();await pending;
    app.runtime.policy.grant({authorizationRef:'approved-run',taskId:task.taskId,toolName:descriptor.name,scopes:descriptor.requiredScopes,argumentsDigest:toolArgumentsDigest({}),expiresAt:deadline,maxUses:1});
    controller.abort();const result=await app.runtime.runTask(task.taskId,async worker=>{await app.tools.invoke({taskId:task.taskId,runId:'approved-run',authorizationRef:'approved-run',toolName:descriptor.name,toolVersion:'1.0.0',arguments:{},deadline,signal:worker.signal,userPresent:true});return {resultSummary:'done'};},{deadline,sideEffect:'external_write'});
    assert.equal(result.state,'failed');assert.equal(writes,0);assert.equal(app.runtime.policy.get('approved-run').usesRemaining,1);
  }finally{broker.close();app.close();}
});
