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
