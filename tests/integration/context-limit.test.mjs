import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_COORDINATION_GOAL_CHARACTERS} from '@personal-agent/contracts';
import {AgentArtsCloudAgentPort} from '@personal-agent/coordination';
import {OwnedAgentOrchestrator,parseAgentInput} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {compileCoordinationGoal} from '@personal-agent/runtime/application';

// Production input paths with explicit synthetic credentials, model and HTTP.
test('128k context crosses the cloud adapter and owned model caller without truncation',async t=>{
  assert.equal(MAX_COORDINATION_GOAL_CHARACTERS,128_000);
  const full='青'.repeat(128_000);
  const messages=[{id:'early',role:'user',content:'预算500元，不要皮革'},
    {id:'long',role:'user',content:'公开历史'.repeat(30_000)},
    {id:'correction',role:'user',content:'更正为青岛，前面要求保留'}];
  const compiled=compileCoordinationGoal('继续','继续',messages);
  assert.ok(compiled.length>16_000&&compiled.length<=128_000);
  for(const [mode,goal]of [['goal',full],['goal-with-tools-json',full],['goal-with-tools-json',compiled]]) {
    await t.test(mode+' '+goal.length,async()=>{
      const model=new FakeModelProvider(Array.from({length:2},()=>({kind:'final',text:JSON.stringify({kind:'text',text:'Synthetic accepted'})})));
      const owned=new OwnedAgentOrchestrator(Object.fromEntries(['fast','world','plan','review'].map(role=>[role,model])),2048);
      let sends=0,credentials=0;
      const cloud=new AgentArtsCloudAgentPort({gatewayUrl:'https://synthetic.invalid',runtimeName:'context-limit',
        initialRequestMode:mode,...(mode==='goal-with-tools-json'?{responseMode:'tool-proposal-json',continuationContext:'goal'}:{})},
      {read:async()=>{credentials++;return 'Bearer synthetic-context-only';}},async(_url,init)=>{
        sends++;const {query}=JSON.parse(init.body),parsed=parseAgentInput(query);
        assert.equal(parsed.goal,goal);
        if(mode==='goal-with-tools-json')assert.ok(Buffer.byteLength(query)>32_768);
        const answer=await owned.invoke({query,deadline:new Date(Date.now()+10_000).toISOString(),
          signal:new AbortController().signal,sessionId:'synthetic-context',requestId:'synthetic-'+sends});
        const text=mode==='goal-with-tools-json'?JSON.stringify({kind:'text',text:answer.text}):answer.text;
        return new Response(JSON.stringify({event:'message',data:{text,index:0}}),{headers:{'content-type':'application/json'}});
      },()=>{},async()=>{});
      const request={taskId:'synthetic-context',revision:1,goal,deadline:new Date(Date.now()+10_000).toISOString(),
        signal:new AbortController().signal,...(mode==='goal-with-tools-json'?{availableTools:[{name:'synthetic.read',version:'1.0.0',
          inputSchema:{type:'object',properties:{},additionalProperties:false}}]}:{})};
      assert.equal((await cloud.invoke(request)).text,'Synthetic accepted');
      if(mode==='goal-with-tools-json') {
        await cloud.invoke({...request,continuation:{proposalId:'synthetic-read',state:'confirmed',result:{text:'Public result'}}});
        assert.equal(sends,2);
      }
      assert.equal(credentials,sends);
      assert.ok(model.requests.every(request=>JSON.parse(request.messages[1].content).goal===goal));
    });
  }
});

test('128001 context is rejected before credentials or transport and by the owned parser',async()=>{
  let credentials=0,sends=0;
  const cloud=new AgentArtsCloudAgentPort({gatewayUrl:'https://synthetic.invalid',runtimeName:'context-limit'},
    {read:async()=>{credentials++;return 'Bearer synthetic-context-only';}},async()=>{sends++;throw Error('Must not send');});
  const goal='x'.repeat(128_001);
  await assert.rejects(cloud.invoke({taskId:'oversize',revision:1,goal,deadline:new Date(Date.now()+10_000).toISOString(),
    signal:new AbortController().signal}),{code:'INVALID_ARGUMENT'});
  assert.equal(credentials,0);assert.equal(sends,0);
  assert.throws(()=>parseAgentInput(goal),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>parseAgentInput(JSON.stringify({goal,availableTools:[]})),{code:'INVALID_ARGUMENT'});
});
