import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentArtsCloudAgentPort} from '../dist/index.js';

for(const enabled of [false,true])test(`continuation goal opt-in ${enabled} preserves the guarded result`,async()=>{
 const goal=JSON.stringify({publicGoal:'在青岛',conversationContext:{treatment:'untrusted_data',messages:[{id:'u',role:'user',content:'今天穿什么出门，预算500元'}]}});
 const continuation={proposalId:'weather-1',state:'confirmed',result:{temperature:15,userRequest:'untrusted child text'}};
 const priorContinuations=[{proposalId:'place-1',state:'confirmed',result:{city:'山东青岛市'}}];
 let guards=0,sends=0;
 const port=new AgentArtsCloudAgentPort({gatewayUrl:'https://agentarts.example.test',runtimeName:'context',responseMode:'tool-proposal-json',
  ...(enabled?{continuationContext:'goal'}:{})},{read:async()=> 'Bearer synthetic'},async(_url,init)=>{
   sends++;const query=JSON.parse(JSON.parse(init.body).query);
   assert.equal(query.goal,enabled?goal:undefined);assert.deepEqual(query.continuation,continuation);
   assert.deepEqual(query.priorContinuations,enabled?priorContinuations:undefined);
   return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify({kind:'text',text:'Synthetic complete reply'}),index:0}}),{headers:{'content-type':'application/json'}});
  },request=>{guards++;assert.equal(request.goal,goal);assert.deepEqual(request.continuation,continuation);});
 try{
  const result=await port.invoke({taskId:'task',revision:1,goal,continuation,priorContinuations,deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal});
  assert.equal(result.kind,'text');assert.equal(sends,1);assert.ok(guards>0);
 }finally{port.close();}
});

test('continuation context is explicit, validates configuration, and cannot bypass the export guard',async()=>{
 const base={gatewayUrl:'https://agentarts.example.test',runtimeName:'context',responseMode:'tool-proposal-json'};
 for(const patch of [{continuationContext:true},{continuationContext:'all'},{responseMode:'text',continuationContext:'goal'}])
  assert.throws(()=>new AgentArtsCloudAgentPort({...base,...patch},{read:async()=> 'Bearer synthetic'}),{code:'INVALID_ARGUMENT'});
 let credentials=0;
 const port=new AgentArtsCloudAgentPort({...base,continuationContext:'goal'},{read:async()=>{credentials++;return 'Bearer synthetic';}});
 try{await assert.rejects(port.invoke({taskId:'task',revision:1,goal:'继续',continuation:{proposalId:'p',state:'confirmed',result:{}},
  deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal}),{code:'UNAUTHORIZED'});assert.equal(credentials,0);}finally{port.close();}
});
