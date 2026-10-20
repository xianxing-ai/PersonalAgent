import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '../dist/application.js';

for(const revokePrior of [false,true])test(`multiple confirmed tools preserve original context and recheck prior export scope (${revokePrior})`,async()=>{
 let app,firstAllowed=true,sends=0;
 const descriptor=name=>({name,version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'},
  sideEffect:'read',requiredScopes:['fixture:read'],requiresPresence:false,idempotencySupport:true,recoverySupport:true});
 const names=['fixture.first','fixture.second'];
 const messages=[{id:'original',role:'user',content:'今天穿什么出门，预算不超过500元，不要皮革。'}];
 app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',runtimeName:'context',
  responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',continuationContext:'goal',
  tools:names.map((name,i)=>({descriptor:descriptor(name),execute:async()=>{if(i===1&&revokePrior)firstAllowed=false;return {source:name,value:i===0?'山东青岛市':'14–19°C，小雨'};}})),
  automaticTools:names.map(toolName=>({toolName,toolVersion:'1.0.0'})),
  competitionToolAvailability:names.map(toolName=>({toolName,toolVersion:'1.0.0',available:()=>true})),
  competitionToolExports:names.map((toolName,i)=>({toolName,toolVersion:'1.0.0',exportPolicyVersion:'fixture-v1',accepts:()=>i!==0||firstAllowed,project:({result})=>result})),
  coordinationInput:{readConversationContext:async()=>messages,beforeCoordinationSend:()=>{}},
  authorizationProvider:{read:async()=> 'Bearer synthetic'},fetchImpl:async(_url,init)=>{
   const query=JSON.parse(JSON.parse(init.body).query);sends++;
   assert.deepEqual(JSON.parse(query.goal).conversationContext.messages,messages);
   if(sends===3){assert.equal(query.priorContinuations.length,1);assert.equal(query.priorContinuations[0].result.value,'山东青岛市');
    assert.equal(query.continuation.result.value,'14–19°C，小雨');}
   const output=sends<3?{kind:'tool_proposal',proposalId:'proposal-'+sends,toolName:names[sends-1],toolVersion:'1.0.0',arguments:{}}
    :{kind:'text',text:'薄外套、长袖和长裤，不用皮革，按500元内搭配。'};
   return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(output),index:0}}),{headers:{'content-type':'application/json'}});
  }});
 try{
  const client=new Client(app);await client.connect();
  const {taskId}=await client.call('task.submit',{goal:'在青岛',conversationId:'c'},{idempotencyKey:'context',timeoutMs:15000});
  const end=Date.now()+15000;let task;
  do{task=app.runtime.getTask(taskId);if(['succeeded','failed','waiting_reconciliation'].includes(task.state))break;await new Promise(r=>setTimeout(r,20));}while(Date.now()<end);
  assert.equal(sends,revokePrior?2:3,JSON.stringify(task.error));
  assert.equal(task.state,revokePrior?'waiting_reconciliation':'succeeded',JSON.stringify(task.error));
  if(revokePrior)assert.equal(app.runtime.loadCheckpoint(taskId,'competition-export-withheld').withheld,true);
  else assert.match(task.resultSummary,/500元/);
  assert.equal(app.runtime.readToolExecutions(taskId).length,2);
 }finally{app.close();}
});
