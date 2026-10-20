import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationHistoryTool} from '../electron/conversation-history-tool.js';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {Client} from '@personal-agent/client';

test('history lookup retrieves complete cited text and final export rechecks source content',async()=>{
 let content='x'.repeat(5000)+'结尾条件';
 const history=createConversationHistoryTool({readContext:({taskId})=>{assert.equal(taskId,'current');return [{id:'earlier',role:'assistant',content}];}});
 const context={taskId:'current',signal:new AbortController().signal},args={messageIds:['earlier']};
 const result=await history.tool.execute(args,context);
 assert.equal(result.messages[0].content,content);assert.match(result.messages[0].contentDigest,/^[0-9a-f]{64}$/);
 assert.equal(history.binding.accepts({...context,arguments:args,phase:'final',projection:result}),true);
 content='用户修改了原文';
 assert.equal(history.binding.accepts({...context,arguments:args,phase:'final',projection:result}),false);
});

test('history lookup cannot cross conversations, restore withheld sources or bypass cancellation and budgets',async()=>{
 const history=createConversationHistoryTool({readContext:()=>[{id:'public',role:'user',content:'public'},
  {id:'private',role:'assistant',content:'private',withheld:true},{id:'large',role:'assistant',content:'x'.repeat(66000)}]});
 const context={taskId:'current',signal:new AbortController().signal};
 for(const args of [{messageIds:['other-conversation']},{messageIds:['private']},{messageIds:['large']},{messageIds:['public','public']},{}]){
  assert.throws(()=>history.tool.execute(args,context));
  assert.equal(history.binding.accepts({...context,arguments:args,phase:'preflight'}),false);
 }
 assert.throws(()=>history.tool.execute({messageIds:['public']},{...context,signal:AbortSignal.abort()}),/取消/);
});

test('actual Runtime consumer retrieves an omitted assistant source through Policy and guarded continuation',async()=>{
 let app,sends=0;const original='x'.repeat(14900)+'结尾条件必须保留';
 const history=createConversationHistoryTool({readContext:({taskId,signal})=>app.readConversationContext({taskId,
  conversationId:app.runtime.getTask(taskId).conversationId,deadline:app.runtime.loadCheckpoint(taskId,'application-deadline'),signal})});
 app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'history-fixture',
  initialRequestMode:'goal-with-tools-json',responseMode:'tool-proposal-json',continuationContext:'goal',
  tools:[history.tool],competitionToolAvailability:[history.availability],competitionToolExports:[history.binding],
  automaticTools:[{toolName:history.tool.descriptor.name,toolVersion:'1.0.0'}],
  coordinationInput:{beforeCoordinationSend:()=>{},readConversationContext:async scope=>app.readConversationContext(scope)},
  authorizationProvider:{read:async()=> 'Bearer synthetic'},fetchImpl:async(_url,init)=>{
   const query=JSON.parse(JSON.parse(init.body).query);sends++;
   let reply;
   if(sends===1){const selected=JSON.parse(query.goal).conversationContext;
    assert.deepEqual(selected.selection.omittedAssistantIds,[earlier.taskId+':assistant']);
    reply={kind:'tool_proposal',proposalId:'read-history',toolName:'conversation.read_history',toolVersion:'1.0.0',arguments:{messageIds:selected.selection.omittedAssistantIds}};
   }else{assert.equal(query.continuation.result.messages[0].content,original);assert.ok(query.goal.includes('原来的结尾条件'));
    reply={kind:'text',text:'取回的原文结尾是：结尾条件必须保留。'};}
   return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(reply),index:0}}),{headers:{'content-type':'application/json'}});
  }});
 const earlier=app.runtime.submitTask({goal:'旧问题'.repeat(700),conversationId:'history',idempotencyKey:'earlier'});
 app.runtime.transitionTask(earlier.taskId,'planning');app.runtime.transitionTask(earlier.taskId,'running');app.runtime.transitionTask(earlier.taskId,'verifying');
 app.runtime.transitionTask(earlier.taskId,'succeeded',{resultSummary:original});
 try{
  const client=new Client(app);await client.connect();
  const {taskId}=await client.call('task.submit',{goal:'请取回原来的结尾条件',conversationId:'history'},{idempotencyKey:'history',timeoutMs:15000});
  let task;const end=Date.now()+15000;
  do{task=app.runtime.getTask(taskId);if(['succeeded','failed','waiting_reconciliation'].includes(task.state))break;await new Promise(r=>setTimeout(r,20));}while(Date.now()<end);
  assert.equal(task.state,'succeeded',JSON.stringify(task.error));assert.equal(sends,2);
  assert.match(task.resultSummary,/结尾条件必须保留/);
  const [execution]=app.runtime.readToolExecutions(taskId);assert.equal(execution.policyDecision,'allow');assert.equal(execution.state,'confirmed');
 }finally{app.close();}
});
