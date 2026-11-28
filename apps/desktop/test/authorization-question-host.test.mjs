import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
const {AuthorizationQuestions}=await import(process.env.PA_TEST_AUTHORIZATION_QUESTION_SOURCE
  ??new URL('../../runtime/dist/application/authorization-question.js',import.meta.url));
const H='a'.repeat(64),R='b'.repeat(64);
function fixture(saved={}) {
  let task={state:'running',cancelRequested:false},generation='g1',changes=0;
  const store={get:key=>saved[key]===undefined?undefined:structuredClone(saved[key]),compareAndSet(key,expected,next){
    if(!isDeepStrictEqual(saved[key],expected))return false;saved[key]=structuredClone(next);return true;}};
  const scope={taskId:'task-1',runId:'run-1',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  const original={...scope,proposalId:'proposal-1',toolName:'todo.create',toolVersion:'1',argumentsDigest:H,scopes:['todo:write'],
    outputSchema:{type:'object',required:['id'],additionalProperties:true,properties:{id:{type:'string'}}}};
  const application={runtime:{bindTrustedHostState:()=>store,getTask:()=>task,getApproval:()=>({expiresAt:scope.deadline}),
    saveCheckpointOnce(){},
    invalidatePendingApproval(){task.state='failed';},expirePendingApprovals(){}},
    readAuthorizationQuestionInvocation:()=>['running','waiting_approval'].includes(task.state)?original:undefined,
    bindAuthorizationQuestion(){},
    readAuthorizationQuestionDestination:()=>H,
    readAuthorizationQuestionReceiptBinding:()=>undefined,
    readAuthorizationQuestionBinding:()=>['running','waiting_approval'].includes(task.state)?{conversationId:'conversation-1',digest:'original-owner'}:undefined};
  const options={createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>application,namespace:'test',
    resolveConversation:()=> 'conversation-1',available:()=>true,onUpdate:()=>changes++,
    profiles:[{ref:'fake',label:'Fake verified sandbox',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'fake'};
  const host=createDesktopAuthorizationQuestionHost(options);
  const prepare=()=>{
    host.prepare(scope,{requirements:[{requirementId:'todo-session',kind:'connector_session',scopes:['todo:write'],
      bindingDigest:H,ruleBindingDigest:R,summary:'Use this local todo resource'}],assertCurrent:()=>generation==='g1'});
    host.prepareExport(scope);
  };
  const respond=decision=>{const q=host.snapshot()[0];return host.respond({questionId:q.questionId,expectedRevision:q.revision,decision},q.conversationId);};
  return {host,scope,task,prepare,respond,saved,options,changeGeneration:()=>generation='g2',changes:()=>changes};
}

test('Runtime-owned approval remains unified while its asynchronous native preparation has no card yet',()=>{
  const f=fixture();f.prepare();f.task.state='waiting_approval';
  const application=f.options.getApplication(),runtime=application.runtime;
  runtime.getApproval=runId=>({taskId:f.scope.taskId,state:runId===f.scope.runId?'pending':'denied'});
  let marker={state:'pending',argumentsDigest:H};
  runtime.loadCheckpoint=(taskId,checkpointKey)=>{
    assert.equal(taskId,f.scope.taskId);assert.equal(checkpointKey,'authorization-question-active:'+f.scope.runId);return marker;
  };
  assert.equal(f.host.snapshot().length,0);assert.equal(f.host.hasPending(f.scope.runId),true);
  assert.equal(f.host.hasPending('other-run'),false);
  marker={state:'pending',argumentsDigest:R};assert.equal(f.host.hasPending(f.scope.runId),false);
  marker={state:'resolved',argumentsDigest:H};assert.equal(f.host.hasPending(f.scope.runId),false);
  f.host.close();assert.equal(f.host.hasPending(f.scope.runId),false);
});

test('one card receives tool, connector and bounded export requirements without prior session consent',async()=>{
  const f=fixture();f.prepare();assert.equal(f.host.snapshot().length,0,'preflight only registers, with no private export');
  assert.equal(f.host.requiresAuthorization(f.scope),true,'routine reads/writes must enter the host question');
  f.task.state='waiting_approval';const decision=f.host.requestToolAuthorization(f.scope);
  const card=f.host.snapshot()[0];assert.deepEqual(card.requirements.map(item=>item.kind),['tool','connector_session','export']);
  f.respond('allow_once');assert.equal(await decision,'allow_once');assert.equal(f.task.state,'waiting_approval','answer alone never starts a write');
  assert.throws(()=>f.host.currentRequirement(f.scope,'todo-session'),/已失效/);
  f.task.state='running';assert.equal(f.host.currentRequirement(f.scope,'todo-session'),true);
  const lease=f.host.authorizeExport(f.scope,{id:'todo-1'});assert.match(lease.resultDigest,/^[a-f0-9]{64}$/);
  assert.throws(()=>f.host.authorizeExport(f.scope,{id:'todo-1',secret:'do-not-export'}),/已失效/);
  f.changeGeneration();assert.throws(()=>f.host.currentRequirement(f.scope,'todo-session'),{code:'UNAUTHORIZED'});
  f.host.close();
});

test('the actual original send invocation replaces task summaries with its complete single-use content card',async()=>{
  const f=fixture(),source=f.options.getApplication().readAuthorizationQuestionInvocation();
  assert.equal(f.host.requiresAuthorization({...f.scope,toolName:'vendor.execute',sideEffect:'external_write'}),true);
  assert.equal(f.host.requiresAuthorization({...f.scope,toolName:'vendor.read',sideEffect:'read'}),false);
  source.toolName='mail.send';source.scopes=['mail:send'];source.sideEffect='external_write';
  source.arguments={to:'person@example.test',subject:'Exact subject',text:'body\n'+'x'.repeat(700)+'END'};
  f.host.prepare(f.scope,{taskConsent:{taskId:f.scope.taskId,bindingDigest:H,summary:'Prior broad task consent',mode:'workspace-write'}});
  const pending=f.host.requestToolAuthorization(f.scope),card=f.host.snapshot()[0];
  assert.ok(card.description.includes(JSON.stringify(source.arguments.text)));assert.match(card.description,/person@example.test/);
  assert.equal(card.canReuseTask,false);assert.equal(card.canAlways,false);
  f.task.unrelatedProgress='done';f.host.refresh();assert.equal(f.host.snapshot()[0].revision,card.revision);
  f.respond('allow_once');assert.equal(await pending,'allow_once');f.host.close();
});

test('repeated preparation cannot extend a decision deadline or change the original invocation deadline',async()=>{
  const f=fixture(),originalDeadline=f.scope.deadline;
  const earlier=new Date(Date.parse(originalDeadline)-30000).toISOString();
  const later=new Date(Date.parse(originalDeadline)-10000).toISOString();
  f.prepare();
  f.host.prepare(f.scope,{decisionDeadline:earlier});
  f.host.prepare(f.scope,{decisionDeadline:later});
  f.prepare();
  assert.throws(()=>f.host.prepare(f.scope,{decisionDeadline:new Date(Date.parse(originalDeadline)+1).toISOString()}),{code:'UNAUTHORIZED'});
  f.task.state='waiting_approval';
  const decision=f.host.requestToolAuthorization(f.scope);
  assert.equal(f.host.snapshot()[0].expiresAt,earlier);
  assert.equal(f.scope.deadline,originalDeadline);
  f.respond('allow_once');assert.equal(await decision,'allow_once');
  f.host.close();
});

test('running original export checks reuse the exact consumed requirement without a completed receipt',async()=>{
  const f=fixture();f.prepare();f.task.state='waiting_approval';const decision=f.host.requestToolAuthorization(f.scope);
  f.respond('allow_once');await decision;f.task.state='running';
  const value={id:'todo-1'},lease=f.host.authorizeExport(f.scope,value);
  assert.deepEqual(f.host.authorizeExport(f.scope,value),lease);
  assert.deepEqual(f.host.authorizeConsumedExport(f.scope,value),lease);
  assert.deepEqual(f.host.authorizeConsumedExport(f.scope,structuredClone(value)),lease);
  assert.throws(()=>f.host.authorizeExport(f.scope,{id:'todo-2'}),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.authorizeConsumedExport(f.scope,{id:'todo-2'}),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.authorizeConsumedExport({...f.scope,argumentsDigest:R},value),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.authorizeConsumedExport({...f.scope,deadline:new Date(0).toISOString()},value),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.authorizeConsumedExport({...f.scope,signal:AbortSignal.abort()},value),{code:'UNAUTHORIZED'});
  f.task.cancelRequested=true;
  assert.throws(()=>f.host.authorizeExport(f.scope,value),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.authorizeConsumedExport(f.scope,value),{code:'UNAUTHORIZED'});
  f.task.cancelRequested=false;f.changeGeneration();
  assert.throws(()=>f.host.authorizeExport(f.scope,value),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.authorizeConsumedExport(f.scope,value),{code:'UNAUTHORIZED'});
  f.host.close();
});

test('nonrunning export checks still require the original confirmed result receipt',async()=>{
  const f=fixture();f.prepare();f.task.state='waiting_approval';const decision=f.host.requestToolAuthorization(f.scope);
  f.respond('allow_once');await decision;f.task.state='running';
  const value={id:'todo-1'};f.host.authorizeExport(f.scope,value);f.task.state='succeeded';
  assert.throws(()=>f.host.currentRequirement(f.scope,'export'),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.authorizeConsumedExport(f.scope,value),{code:'UNAUTHORIZED'});
  f.host.close();
});

test('readConsumedOperation exposes immutable original receipt only through the existing consumed-result gate',async()=>{
  const f=fixture();f.prepare();f.task.state='waiting_approval';const pending=f.host.requestToolAuthorization(f.scope);
  assert.throws(()=>f.host.readConsumedOperation(f.scope),{code:'UNAUTHORIZED'});
  f.respond('allow_once');await pending;f.task.state='succeeded';
  assert.throws(()=>f.host.readConsumedOperation(f.scope),{code:'UNAUTHORIZED'});
  f.options.getApplication().readAuthorizationQuestionReceiptBinding=()=>({conversationId:'conversation-1',digest:'original-owner'});
  const receipt=f.host.readConsumedOperation(f.scope);
  assert.equal(receipt.request.taskId,f.scope.taskId);assert.equal(receipt.request.runId,f.scope.runId);
  assert.equal(receipt.receipt.decision,'allow_once');
  assert.throws(()=>{receipt.request.requirements[0].scopes.push('changed');},TypeError);
  assert.throws(()=>f.host.readConsumedOperation({...f.scope,runId:'other'}),{code:'UNAUTHORIZED'});
  assert.throws(()=>f.host.readConsumedOperation({...f.scope,signal:AbortSignal.abort()}),{code:'UNAUTHORIZED'});
  f.changeGeneration();assert.throws(()=>f.host.readConsumedOperation(f.scope),{code:'UNAUTHORIZED'});f.host.close();
});

test('deny and UI answer retries produce no connector or result export grant',async()=>{
  const f=fixture();f.prepare();f.task.state='waiting_approval';const decision=f.host.requestToolAuthorization(f.scope);
  const q=f.host.snapshot()[0];f.respond('deny');assert.equal(await decision,'deny');
  assert.throws(()=>f.host.respond({questionId:q.questionId,expectedRevision:q.revision,decision:'allow_once'},q.conversationId),/已处理/);
  f.task.state='running';assert.throws(()=>f.host.currentRequirement(f.scope,'todo-session'),/已失效/);
  assert.throws(()=>f.host.authorizeExport(f.scope,{id:'todo-1'}),/已失效/);f.host.close();
});

test('opaque resource generation survives restart and rotates with strict CAS without storing grants',()=>{
  const f=fixture(),resource=H,generation=f.host.readResourceGeneration(resource);
  const reopened=createDesktopAuthorizationQuestionHost(f.options);assert.equal(reopened.readResourceGeneration(resource),generation);
  const next=reopened.rotateResourceGeneration(resource,generation);assert.notEqual(next,generation);
  assert.equal(f.host.readResourceGeneration(resource),next);
  assert.throws(()=>f.host.rotateResourceGeneration(resource,generation),/已失效/);
  const metadata=Object.entries(f.saved).find(([key])=>key.startsWith('resource:'))[1];
  assert.deepEqual(Object.keys(metadata).sort(),['generation','revision']);f.host.close();reopened.close();
});

test('single non-external-write tool without extra prepared requirements supports allow_task and allow_always',async()=>{
  const saved={};
  const store={get:key=>saved[key]===undefined?undefined:structuredClone(saved[key]),
    compareAndSet(key,expected,next){if(!isDeepStrictEqual(saved[key],expected))return false;saved[key]=structuredClone(next);return true;}};
  let task={state:'waiting_approval',cancelRequested:false};
  const scope={taskId:'task-single',runId:'run-single-1',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  const original={...scope,proposalId:'p1',toolName:'weather.forecast',toolVersion:'1.0.0',sideEffect:'read',arguments:{city:'Beijing'},argumentsDigest:H,scopes:['weather:read'],outputSchema:{type:'object'}};
  const application={runtime:{bindTrustedHostState:()=>store,getTask:()=>task,getApproval:()=>({expiresAt:scope.deadline}),saveCheckpointOnce(){}},
    readAuthorizationQuestionInvocation:()=>original,bindAuthorizationQuestion(){},
    readAuthorizationQuestionBinding:()=>({conversationId:'conversation-1',digest:'owner-1'})};
  const host=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>application,
    namespace:'single-tool',resolveConversation:()=>'conversation-1',available:()=>true,
    profiles:[{ref:'default-read-only',label:'每次都询问',mode:'read-only',revision:1,available:true}],defaultProfileRef:'default-read-only'});
  const pending=host.requestToolAuthorization(scope);
  const card=host.snapshot()[0];
  assert.equal(card.canAlways,true);
  assert.equal(card.canReuseTask,true);
  assert.equal(card.suggestedDecision,'allow_task');
  host.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_task'},card.conversationId);
  assert.equal(await pending,'allow_once');
  host.close();
});

test('fullAccessAutoContent skips content confirmation for safe external writes and prepared content while forcing whitelistable cards for secrets',async()=>{
  const saved={};
  const store={get:key=>saved[key]===undefined?undefined:structuredClone(saved[key]),
    compareAndSet(key,expected,next){if(!isDeepStrictEqual(saved[key],expected))return false;saved[key]=structuredClone(next);return true;}};
  let task={state:'waiting_approval',cancelRequested:false},currentArgs={to:'friend@example.test',subject:'Hi',text:'Safe mail'};
  let currentTool='mail.send',currentScopes=['mail:send'],currentSideEffect='external_write',currentRunId='run-safe';
  const deadline=new Date(Date.now()+60000).toISOString();
  const application={runtime:{bindTrustedHostState:()=>store,getTask:()=>task,getApproval:()=>({expiresAt:deadline}),saveCheckpointOnce(){}},
    readAuthorizationQuestionInvocation:(_t,runId)=>({taskId:'task-full',runId,proposalId:'p-'+runId,toolName:currentTool,toolVersion:'1.0.0',
      sideEffect:currentSideEffect,arguments:currentArgs,argumentsDigest:H,scopes:currentScopes,deadline,outputSchema:{type:'object'}}),
    bindAuthorizationQuestion(){},
    readAuthorizationQuestionBinding:()=>({conversationId:'conversation-1',digest:'owner-1'})};
  const host=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>application,
    namespace:'full-content',resolveConversation:()=>'conversation-1',available:()=>true,
    profiles:[{ref:'full-access',label:'完全访问',mode:'full-access',revision:1,available:true,fullAccessAutoContent:true}],defaultProfileRef:'full-access'});

  const safeScope={taskId:'task-full',runId:currentRunId,deadline,signal:new AbortController().signal};
  assert.equal(await host.requestToolAuthorization(safeScope),'allow_once');
  assert.equal(host.snapshot().length,0);

  const validText='diff --git a/a.js b/a.js\n+console.log("ok")';
  const {createHash}=await import('node:crypto');
  const validDigest=createHash('sha256').update(JSON.stringify(validText)).digest('hex');
  const preparedScope={taskId:'task-full',runId:'run-pub',deadline,signal:new AbortController().signal};
  currentRunId='run-pub';
  host.prepare(preparedScope,{contentConfirmation:{digest:validDigest,text:validText}});
  assert.equal(await host.requestToolAuthorization(preparedScope),'allow_once');
  assert.equal(host.snapshot().length,0);

  currentRunId='run-secret-arg-deny';currentArgs={to:'friend@example.test',subject:'Leak',text:'token sk-1234567890abcdef1234'};
  const pendingDeny=host.requestToolAuthorization({taskId:'task-full',runId:currentRunId,deadline,signal:new AbortController().signal});
  const denyCard=host.snapshot().at(-1);
  assert.equal(denyCard.forceAsk,true);
  assert.equal(denyCard.canAlways,true);
  assert.match(denyCard.description,/检测到疑似凭据信息/);
  host.respond({questionId:denyCard.questionId,expectedRevision:denyCard.revision,decision:'deny'},denyCard.conversationId);
  assert.equal(await pendingDeny,'deny');

  currentRunId='run-secret-arg-whitelist';
  const pendingWhitelist=host.requestToolAuthorization({taskId:'task-full',runId:currentRunId,deadline,signal:new AbortController().signal});
  const whitelistCard=host.snapshot().at(-1);
  assert.equal(whitelistCard.forceAsk,true);
  host.respond({questionId:whitelistCard.questionId,expectedRevision:whitelistCard.revision,decision:'allow_always'},whitelistCard.conversationId);
  assert.equal(await pendingWhitelist,'allow_once');

  // Same secret fingerprint is now whitelisted automatically.
  currentRunId='run-secret-arg-reused';
  assert.equal(await host.requestToolAuthorization({taskId:'task-full',runId:currentRunId,deadline,signal:new AbortController().signal}),'allow_once');

  // A different secret in prepared content still forces a new card.
  currentRunId='run-secret-prepared';currentArgs={to:'friend@example.test',subject:'Clean',text:'Clean body'};
  const secretText='diff + const key="Bearer abcdefghijklmnopqrstuvwxyz";';
  const secretDigest=createHash('sha256').update(JSON.stringify(secretText)).digest('hex');
  const badPreparedScope={taskId:'task-full',runId:currentRunId,deadline,signal:new AbortController().signal};
  host.prepare(badPreparedScope,{contentConfirmation:{digest:secretDigest,text:secretText}});
  const pendingPrepared=host.requestToolAuthorization(badPreparedScope);
  const preparedCard=host.snapshot().at(-1);
  assert.equal(preparedCard.forceAsk,true);
  assert.equal(preparedCard.canAlways,true);
  host.respond({questionId:preparedCard.questionId,expectedRevision:preparedCard.revision,decision:'deny'},preparedCard.conversationId);
  assert.equal(await pendingPrepared,'deny');
  host.close();
});

test('#729 inputSchema numeric maxTokens skips false credential forceAsk while string maxTokens and closed panel deferral work end-to-end',async()=>{
  const saved={};
  const store={get:key=>saved[key]===undefined?undefined:structuredClone(saved[key]),
    compareAndSet(key,expected,next){if(!isDeepStrictEqual(saved[key],expected))return false;saved[key]=structuredClone(next);return true;}};
  let panelOpen=true;
  const deadline=new Date(Date.now()+60000).toISOString();
  const inputSchema={type:'object',properties:{query:{type:'string'},maxTokens:{type:'integer'}}};
  let currentArgs={query:'hello',maxTokens:512};
  const application={
    runtime:{bindTrustedHostState:()=>store,getTask:()=>({state:'waiting_approval',cancelRequested:false}),getApproval:()=>({expiresAt:deadline}),saveCheckpointOnce(){}},
    readAuthorizationQuestionInvocation:(_t,runId)=>({taskId:'task-quota',runId,proposalId:'p-'+runId,toolName:'vendor.generate',toolVersion:'1.0.0',
      sideEffect:'external_write',arguments:currentArgs,argumentsDigest:H,scopes:['vendor:write'],deadline,
      inputSchema,outputSchema:{type:'object'}}),
    bindAuthorizationQuestion(){},
    readAuthorizationQuestionBinding:()=>({conversationId:'conv-1',digest:'owner-1'}),
  };
  const host=createDesktopAuthorizationQuestionHost({
    createQuestions:options=>new AuthorizationQuestions(options),
    getApplication:()=>application,
    namespace:'quota-and-defer',
    resolveConversation:()=>'conv-1',
    available:()=>panelOpen,
    deferWhenUnavailable:true,
    profiles:[{ref:'full-access',label:'完全访问',mode:'full-access',revision:1,available:true,fullAccessAutoContent:true},
      {ref:'default-read-only',label:'每次都询问',mode:'read-only',revision:1,available:true}],
    defaultProfileRef:'full-access',
  });

  // maxTokens: 512 with integer schema does not trigger secret forceAsk in full-access.
  assert.equal(await host.requestToolAuthorization({taskId:'task-quota',runId:'run-ok',deadline,signal:new AbortController().signal}),'allow_once');

  // Switch to read-only and close panel: deferWhenUnavailable keeps manual request pending until panel reopens.
  host.selectSandbox({profileRef:'default-read-only',expectedRevision:host.sandboxSnapshot().selected.revision});
  panelOpen=false;
  currentArgs={query:'hello',maxTokens:'sk-1234567890abcdef1234'};
  const pending=host.requestToolAuthorization({taskId:'task-quota',runId:'run-deferred',deadline,signal:new AbortController().signal});
  await new Promise(resolve=>setImmediate(resolve));
  const card=host.snapshot().at(-1);
  assert.equal(card.state,'pending');
  assert.equal(card.forceAsk,true);
  panelOpen=true;
  host.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'deny'},card.conversationId);
  assert.equal(await pending,'deny');
  host.close();
});

test('#733 desktopOrdinaryEdit reuses same-window allow_task for ordinary edits without canAlways, and still asks on window switch, coordinates, Enter, or secrets',async()=>{
  const saved={},deadline=new Date(Date.now()+60000).toISOString();
  const store={get:key=>saved[key]===undefined?undefined:structuredClone(saved[key]),
    compareAndSet(key,expected,next){if(!isDeepStrictEqual(saved[key],expected))return false;saved[key]=structuredClone(next);return true;}};
  const windowA='11111111-1111-4111-8111-111111111111',windowB='22222222-2222-4222-8222-222222222222';
  let currentInvocation,taskState='waiting_approval';
  const application={
    runtime:{bindTrustedHostState:()=>store,getTask:()=>({state:taskState,cancelRequested:false}),getApproval:()=>({expiresAt:deadline}),saveCheckpointOnce(){}},
    readAuthorizationQuestionInvocation:()=>currentInvocation,
    bindAuthorizationQuestion(){},
    readAuthorizationQuestionBinding:()=>({conversationId:'conv-1',digest:'owner-1'}),
  };
  const host=createDesktopAuthorizationQuestionHost({
    createQuestions:options=>new AuthorizationQuestions(options),
    getApplication:()=>application,
    namespace:'desktop-ordinary-edit',
    resolveConversation:()=>'conv-1',
    available:()=>true,
    profiles:[{ref:'workspace-write',label:'受限写入',mode:'workspace-write',revision:1,available:true,lowRiskAuto:true,localWriteAuto:true}],
    defaultProfileRef:'workspace-write',
  });
  const makeScope=runId=>({taskId:'task-edit',runId,deadline,signal:new AbortController().signal});
  const prepareOrdinary=(runId,toolName,args,win=windowA)=>{
    currentInvocation={taskId:'task-edit',runId,proposalId:'p-'+runId,toolName,toolVersion:'1.0.0',sideEffect:'external_write',
      arguments:args,argumentsDigest:H,scopes:['computer:desktop:control'],deadline,outputSchema:{type:'object'}};
    const s=makeScope(runId);
    host.prepare(s,{
      taskConsent:{taskId:'task-edit',bindingDigest:win===windowA?H:R,summary:'在当前窗口普通输入框复用编辑',mode:'workspace-write'},
      desktopOrdinaryEdit:{windowRef:win},
    });
    return s;
  };

  // First ordinary focus asks once with allow_task allowed and canAlways: false
  const s1=prepareOrdinary('run-1','computer.desktop.focus',{targetRef:windowA,controlRef:windowA});
  const p1=host.requestToolAuthorization(s1);
  const c1=host.snapshot().at(-1);
  assert.equal(c1.state,'pending');
  assert.equal(c1.canAlways,false);
  assert.equal(c1.canReuseTask,true);
  assert.equal(c1.suggestedDecision,'allow_task');
  host.respond({questionId:c1.questionId,expectedRevision:c1.revision,decision:'allow_task'},c1.conversationId);
  assert.equal(await p1,'allow_once');
  assert.equal(host.readOrdinaryEditWindow(s1),undefined,'execution window requires running state');
  taskState='running';
  assert.equal(host.readOrdinaryEditWindow(s1),windowA);

  // Subsequent click / type / set_value in SAME windowA reuse task consent silently
  for(const [runId,toolName,args]of [
    ['run-2','computer.desktop.click',{targetRef:windowA,controlRef:windowA}],
    ['run-3','computer.desktop.type',{targetRef:windowA,controlRef:windowA,text:'hello world'}],
    ['run-4','computer.desktop.set_value',{targetRef:windowA,controlRef:windowA,text:'body'}],
  ]){
    const s=prepareOrdinary(runId,toolName,args,windowA);
    assert.equal(await host.requestToolAuthorization(s),'allow_once');
    assert.equal(host.readOrdinaryEditWindow(s),windowA);
  }

  // Secret in text bypasses taskConsent and forces explicit confirmation
  taskState='waiting_approval';
  const sSecret=prepareOrdinary('run-secret','computer.desktop.type',{targetRef:windowA,controlRef:windowA,text:'token sk-1234567890abcdef1234'},windowA);
  const pSecret=host.requestToolAuthorization(sSecret);
  assert.equal(host.snapshot().at(-1).forceAsk,true);
  host.respond({questionId:host.snapshot().at(-1).questionId,expectedRevision:host.snapshot().at(-1).revision,decision:'deny'},'conv-1');
  assert.equal(await pSecret,'deny');

  // Switching to windowB requires fresh approval
  const sOtherWin=prepareOrdinary('run-win-b','computer.desktop.type',{targetRef:windowB,controlRef:windowB,text:'hi'},windowB);
  const pOtherWin=host.requestToolAuthorization(sOtherWin);
  assert.equal(host.snapshot().at(-1).state,'pending');
  host.respond({questionId:host.snapshot().at(-1).questionId,expectedRevision:host.snapshot().at(-1).revision,decision:'deny'},'conv-1');
  assert.equal(await pOtherWin,'deny');

  // Unprepared coordinate click requires fresh complete content confirmation card
  currentInvocation={taskId:'task-edit',runId:'run-coord',proposalId:'p-coord',toolName:'computer.desktop.click',toolVersion:'1.0.0',
    sideEffect:'external_write',arguments:{targetRef:windowA,loc:[10,20]},argumentsDigest:H,scopes:['computer:desktop:control'],deadline,outputSchema:{type:'object'}};
  const sCoord=makeScope('run-coord');
  const pCoord=host.requestToolAuthorization(sCoord);
  assert.equal(host.snapshot().at(-1).canReuseTask,false);
  assert.match(host.snapshot().at(-1).description,/"loc": \[\s*10,\s*20\s*\]/s);
  host.respond({questionId:host.snapshot().at(-1).questionId,expectedRevision:host.snapshot().at(-1).revision,decision:'deny'},'conv-1');
  assert.equal(await pCoord,'deny');
  host.close();
});
