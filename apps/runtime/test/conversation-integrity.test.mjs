import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeApplication,createAgentArtsRuntimeApplication,compileCoordinationGoal} from '../dist/application.js';
import {Client} from '@personal-agent/client';
import {bindCompiledContext} from '../dist/application/context-binding.js';

test('long history preserves early constraints, corrections, multiple requests and provenance',()=>{
 const messages=[{id:'budget',role:'user',content:'预算不超过500元；不要皮革。还要说明带什么。'},
  ...Array.from({length:40},(_,i)=>[{id:'u'+i,role:'user',content:'第'+i+'次补充'},
   {id:'a'+i,role:'assistant',content:'历史助手回答'.repeat(150)}]).flat(),
  {id:'correct',role:'user',content:'更正：地点改为青岛；预算和其他限制不变。'}];
 const goal=compileCoordinationGoal('在青岛','在青岛',messages,'preserve-user-requests'),compiled=JSON.parse(goal);
 assert.ok(goal.length<=16000);
 assert.deepEqual(compiled.conversationContext.messages.filter(m=>m.role==='user'),messages.filter(m=>m.role==='user'));
 assert.ok(compiled.conversationContext.selection.omittedAssistantIds.length>0);
 assert.equal(compiled.conversationContext.selection.policy,'preserve-user-requests-v1');
 const checkpoint=bindCompiledContext({taskId:'t',conversationId:'c',deadline:'d',configurationRef:'f',publicGoal:'在青岛',preparedGoal:'在青岛',compiledGoal:goal,messages});
 assert.ok(checkpoint.selection.omittedAssistantDigests.length>0);
 assert.equal(JSON.stringify(checkpoint).includes('不要皮革'),false);
});

test('critical user information cannot be silently dropped and escaping counts toward the limit',()=>{
 assert.throws(()=>compileCoordinationGoal('继续','继续',[{id:'critical',role:'user',content:'必需条件'.repeat(6000)}]),{code:'INVALID_ARGUMENT'});
 assert.throws(()=>compileCoordinationGoal('继续','继续',[{id:'critical',role:'user',content:'"\\'.repeat(5000)}]),{code:'INVALID_ARGUMENT'});
 const goal=JSON.parse(compileCoordinationGoal('继续','继续',[{id:'long',role:'assistant',content:'x'.repeat(20000)}],'preserve-user-requests'));
 assert.deepEqual(goal.conversationContext.selection.omittedAssistantIds,['long']);
});

test('failed, cancelled and pending requests survive with cutoff state and cannot import future answers',t=>{
 const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});t.after(()=>app.close());
 const submit=(goal,conversationId='c')=>app.runtime.submitTask({goal,conversationId,idempotencyKey:crypto.randomUUID()}).taskId;
 const pending=submit('先帮我保留预算500元');
 const failed=submit('不要红色');app.runtime.transitionTask(failed,'planning');app.runtime.transitionTask(failed,'running');
 app.runtime.transitionTask(failed,'failed',{error:{code:'EXTERNAL_FAILURE',message:'synthetic',retryable:false}});
 const cancelled=submit('还要回答下雨是否带伞');app.runtime.requestCancel(cancelled);app.runtime.confirmCancellation(cancelled);
 submit('别的会话秘密','other');
 const current=submit('在青岛');
 app.runtime.transitionTask(pending,'planning');app.runtime.transitionTask(pending,'running');app.runtime.transitionTask(pending,'verifying');
 app.runtime.transitionTask(pending,'succeeded',{resultSummary:'这是当前问题之后才到达的回答'});
 submit('后来的消息');
 const messages=app.readConversationContext({taskId:current,conversationId:'c',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
 assert.deepEqual(messages.map(m=>[m.content,m.taskState]),[['先帮我保留预算500元','created'],['不要红色','failed'],['还要回答下雨是否带伞','cancelled']]);
 app.runtime.saveCheckpoint(failed,'private-copy-erasure',{});
 assert.equal(app.readConversationContext({taskId:current,conversationId:'c',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal}).some(m=>m.taskId===failed),false);
});

test('mixed voice and text are ordered by source timestamp rather than appended by channel',t=>{
 const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});t.after(()=>app.close());
 const messages=app.readConversationContext({conversationId:'voice',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,
  historyMessages:[{id:'last',role:'user',content:'改成蓝色',createdAt:'2026-10-20T03:00:00Z'},
   {id:'first',role:'user',content:'先选红色',createdAt:'2026-10-20T02:00:00Z'}]});
 assert.deepEqual(messages.map(m=>m.id),['first','last']);
});

test('revoked tool export cannot be resurrected through later assistant history or an overlay',t=>{
 let allowed=true;
 const binding={toolName:'fixture.read',toolVersion:'1.0.0',exportPolicyVersion:'v1',accepts:()=>allowed,project:({result})=>result};
 const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',competitionToolExports:[binding]});t.after(()=>app.close());
 const earlier=app.runtime.submitTask({goal:'原始用户问题',conversationId:'c',idempotencyKey:'earlier'});
 app.runtime.transitionTask(earlier.taskId,'planning');app.runtime.transitionTask(earlier.taskId,'running');app.runtime.transitionTask(earlier.taskId,'verifying');
 app.runtime.transitionTask(earlier.taskId,'succeeded',{resultSummary:'权限撤销后不能恢复的旧回答'});
 app.runtime.saveCheckpoint(earlier.taskId,'competition-loop',{receipts:[{proposal:{kind:'tool_proposal',proposalId:'p',toolName:'fixture.read',toolVersion:'1.0.0',arguments:{},verification:'unverified'},
  continuation:{result:{text:'old source'}},exportPolicyVersion:'v1'}]});
 const current=app.runtime.submitTask({goal:'继续',conversationId:'c',idempotencyKey:'current'});
 const scope={taskId:current.taskId,conversationId:'c',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
 assert.equal(app.readConversationContext(scope).length,2);
 allowed=false;
 const messages=app.readConversationContext({...scope,historyMessages:[{id:earlier.taskId+':assistant',taskId:earlier.taskId,role:'assistant',content:'不能通过覆盖恢复'}]});
 assert.equal(messages.length,1);assert.equal(messages[0].role,'user');assert.equal(messages[0].answerWithheld,true);
 assert.equal(messages[0].content,'原始用户问题');
});

test('revocation of a child source also withholds the parent answer without discarding its user request',t=>{
 let allowed=true;
 const binding={toolName:'fixture.read',toolVersion:'1.0.0',exportPolicyVersion:'v1',accepts:()=>allowed,project:({result})=>result};
 const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',competitionToolExports:[binding]});t.after(()=>app.close());
 const finish=(goal,conversationId)=>{
  const task=app.runtime.submitTask({goal,conversationId,idempotencyKey:crypto.randomUUID()});
  app.runtime.transitionTask(task.taskId,'planning');app.runtime.transitionTask(task.taskId,'running');app.runtime.transitionTask(task.taskId,'verifying');
  app.runtime.transitionTask(task.taskId,'succeeded',{resultSummary:'由来源生成的回答'});return task.taskId;
 };
 const parent=finish('原始主问题','c'),child=finish('子问题','desktop-subtask:'+parent);
 app.runtime.saveCheckpoint(child,'subtask-parent',{parentTaskId:parent,role:'coordinator'});
 app.runtime.saveCheckpoint(child,'competition-loop',{receipts:[{proposal:{kind:'tool_proposal',proposalId:'p',toolName:'fixture.read',toolVersion:'1.0.0',arguments:{},verification:'unverified'},
  continuation:{result:{text:'old source'}},exportPolicyVersion:'v1'}]});
 const current=app.runtime.submitTask({goal:'继续',conversationId:'c',idempotencyKey:'current'});
 const scope={taskId:current.taskId,conversationId:'c',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
 assert.equal(app.readConversationContext(scope).length,2);allowed=false;
 const messages=app.readConversationContext(scope);assert.equal(messages.length,1);assert.equal(messages[0].content,'原始主问题');assert.equal(messages[0].answerWithheld,true);
});

test('revocation during credential lookup blocks historical answer bytes before HTTP',async()=>{
 let app,allowed=true,sends=0;
 const binding={toolName:'fixture.read',toolVersion:'1.0.0',exportPolicyVersion:'v1',accepts:()=>allowed,project:({result})=>result};
 app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'history',
  competitionToolExports:[binding],coordinationInput:{beforeCoordinationSend:()=>{},readConversationContext:async scope=>app.readConversationContext(scope)},
  authorizationProvider:{read:async()=>{allowed=false;return 'Bearer synthetic';}},fetchImpl:async()=>{sends++;throw Error('Must not send revoked history');}});
 try{
  const earlier=app.runtime.submitTask({goal:'历史问题',conversationId:'c',idempotencyKey:'earlier'});
  app.runtime.transitionTask(earlier.taskId,'planning');app.runtime.transitionTask(earlier.taskId,'running');app.runtime.transitionTask(earlier.taskId,'verifying');
  app.runtime.transitionTask(earlier.taskId,'succeeded',{resultSummary:'撤销后禁止发送的历史回答'});
  app.runtime.saveCheckpoint(earlier.taskId,'competition-loop',{receipts:[{proposal:{kind:'tool_proposal',proposalId:'p',toolName:'fixture.read',toolVersion:'1.0.0',arguments:{},verification:'unverified'},
   continuation:{result:{}},exportPolicyVersion:'v1'}]});
  const client=new Client(app);await client.connect();const {taskId}=await client.call('task.submit',{goal:'继续',conversationId:'c'},{idempotencyKey:'current'});
  const end=Date.now()+5000;while(!['failed','succeeded'].includes(app.runtime.getTask(taskId).state)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
  assert.equal(app.runtime.getTask(taskId).state,'failed');assert.equal(sends,0);
 }finally{app.close();}
});
