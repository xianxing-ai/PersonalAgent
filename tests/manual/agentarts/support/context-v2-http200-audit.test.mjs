import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {AgentArtsCloudAgentPort} from '@personal-agent/coordination';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';

// Structural synthetic fixtures only. No cloud capture, real credentials or global fetch.
const target = {gatewayUrl:'https://agentarts.example.test',runtimeName:'audit-fixture'};
const auth = {read:async()=> 'Bearer synthetic-audit'};
const message = (text, extra={}) => ({event:'message',data:{text,...extra}});
const finish = [{event:'task_end',data:{}},{event:'end',data:{}}];
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const sse = events => new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),
  {headers:{'content-type':'text/event-stream'}});
const controls = () => ({deadline:new Date(Date.now()+15000).toISOString(),signal:new AbortController().signal});
const goal = '合成上下文测试，首尾标记 FIXTURE-A FIXTURE-B。';

test('HTTP 200 is independent of provider event, body and application validation', async t=>{
  const cases = [
    ['explicit provider error after partial text',()=>sse([message('partial'),{event:'error',data:{message:'redacted fixture'}}]),
      {},{},'response_schema','provider_failure'],
    ['OpenAI-shaped completion with valid usage',()=>json({choices:[{message:{content:'answer'},finish_reason:'stop'}],
      usage:{prompt_tokens:23,completion_tokens:2,total_tokens:25}}),{},{},'response_schema','event_shape'],
    ['wrong media type',()=>new Response('synthetic HTML',{headers:{'content-type':'text/html'}}),
      {},{},'response_schema','content_type'],
    ['invalid UTF-8',()=>new Response(Uint8Array.of(0xc3,0x28),{headers:{'content-type':'application/json'}}),
      {},{},'response_body','utf8'],
    ['incomplete workflow',()=>sse([{event:'workflow_start',data:{}},{event:'workflow_end',data:{answer:'candidate'}}]),
      {},{},'response_schema','no_text'],
    ['wrong execution epoch',()=>json([
      message(JSON.stringify({executionEpochVersion:1,executionEpoch:3,result:'answer'})),...finish
    ]),{},{executionEpoch:4},'application_schema','application_contract']
  ];
  for(const [name,response,config,request,stage,schemaCategory] of cases)await t.test(name,async()=>{
    let sends=0,diagnostic;
    const port=new AgentArtsCloudAgentPort({...target,...config},auth,async(_url,init)=>{
      sends++;
      assert.equal(init.method,'POST');
      const body=JSON.parse(init.body);
      assert.equal(request.executionEpoch?JSON.parse(body.query).query:body.query,goal);
      assert.ok(!Object.hasOwn(body,'max_tokens'));
      return response();
    },undefined,undefined,receipt=>{diagnostic=receipt;});
    try{
      await assert.rejects(port.invoke({taskId:'offline-audit',revision:1,goal,...controls(),...request}),
        error=>error.code==='EXTERNAL_FAILURE'&&!error.message.includes('redacted fixture'));
      assert.equal(sends,1);
      assert.deepEqual([diagnostic.httpStatus,diagnostic.stage,diagnostic.schemaCategory],[200,stage,schemaCategory]);
    }finally{port.close();}
  });
});

test('accepted AgentArts text result does not carry usage or finish reason',async()=>{
  const port=new AgentArtsCloudAgentPort(target,auth,async()=>json([message('FIXTURE-A FIXTURE-B',{
    usage:{prompt_tokens:23,completion_tokens:2,total_tokens:25},finish_reason:'length'
  }),...finish]));
  try{
    const result=await port.invoke({taskId:'offline-audit',revision:1,goal,...controls()});
    assert.deepEqual(result,{kind:'text',text:'FIXTURE-A FIXTURE-B',verification:'unverified'});
  }finally{port.close();}
});

test('real Runtime entry records HTTP 200 provider failure without successful result or retry',async()=>{
  let sends=0,diagnostic;
  const app=createAgentArtsRuntimeApplication({...target,path:':memory:',authorizationProvider:auth,
    preparePayload:async()=>({assertBeforeSend(){}}),
    onDiagnostic:receipt=>{diagnostic=receipt;},
    fetchImpl:async()=>{sends++;return sse([{event:'error',data:{message:'redacted fixture'}}]);}});
  try{
    const client=new Client(app);
    await client.connect();
    const {taskId}=await client.call('task.submit',{goal,conversationId:'offline-audit'},{idempotencyKey:'http200'});
    const until=Date.now()+5000;
    while(Date.now()<until&&!['failed','succeeded','cancelled'].includes(app.runtime.getTask(taskId).state)){
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    const task=app.runtime.getTask(taskId);
    assert.equal(task.state,'failed');
    assert.equal(task.error?.code,'EXTERNAL_FAILURE');
    assert.equal(task.resultSummary,undefined);
    assert.equal(sends,1);
    assert.equal(diagnostic?.schemaCategory,'provider_failure');
  }finally{app.close();}
});
