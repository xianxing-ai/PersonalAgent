import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createRuntimeProactiveDecisionTools} from '../dist/application.js';
import {AgentArtsCloudAgentPort,CompetitionCoordinator} from '@personal-agent/coordination';

const input={authorityBoundary:'test selection only',contract:{id:'public',version:'v1',criteria:'Preserve source-backed work',qualifiedForMain:false,
  batchIndependent:true,candidates:[{id:'continue',description:'Continue',action:'continue'},{id:'defer',description:'Keep pending',action:'defer'}]},
  independentQuestions:[{itemId:'item-1',contextRef:'original-context',candidateOnly:true}]};
const context=()=>({taskId:'original-task',runId:'original-run',authorizationRef:'test-grant',scopes:['proactive:decision'],
  deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
const readContext=(taskId,contextRef)=>{assert.equal(taskId,'original-task');assert.equal(contextRef,'original-context');return {facts:[{id:'public-fact',revision:2}],sourceTexts:['original public user quote']};};
const selection={itemId:'item-1',candidateId:'continue',uncertain:false,complex:false,importance:'important',authorityRequired:false};

test('teacher works through the actual catalog-mode coordinator without exporting tools or accepting proposals',async()=>{
  let sends=0,guards=0,catalogs=0;
  let answer={kind:'text',text:JSON.stringify({selections:[selection]})};
  const cloud=new AgentArtsCloudAgentPort({gatewayUrl:'https://agentarts.example.test',runtimeName:'fixture',
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json'},
    {read:async()=> 'Bearer explicit-fixture'},async(_url,init)=>{
      sends++;const wire=JSON.parse(init.body),query=JSON.parse(wire.query);
      assert.deepEqual(query.availableTools,[]);assert.match(query.goal,/public-fact/);
      return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(answer)}}),{headers:{'content-type':'application/json'}});
    },request=>{guards++;assert.equal(request.textOnly,true);assert.equal(request.availableTools,undefined);},async()=>{catalogs++;});
  const teacher=new CompetitionCoordinator(cloud);
  const [tool]=createRuntimeProactiveDecisionTools({readContext,getRevision:()=>3,teacher});
  const result=await tool.execute(input,context());assert.equal(result.selections[0].candidateId,'continue');
  assert.equal(sends,1);assert.equal(guards,1);assert.equal(catalogs,0);
  answer={kind:'tool_proposal',proposalId:'p',toolName:'fixture.write',toolVersion:'1.0.0',arguments:{}};
  await assert.rejects(tool.execute(input,context()),{code:'EXTERNAL_FAILURE'});
  assert.equal(sends,2);assert.equal(guards,2);assert.equal(catalogs,0);cloud.close();
});

test('original local chooser receives full context and returns only an unqualified candidate receipt',async()=>{
  let calls=0;
  const [tool]=createRuntimeProactiveDecisionTools({readContext,getRevision:()=>3,localChooser:{choose:async request=>{
    calls++;const value=JSON.parse(request.context);assert.equal(value.observation.originalContext.facts[0].revision,2);
    assert.deepEqual(request.candidates.map(value=>value.id),['continue','defer']);
    return {state:'review',selected:{id:'continue',revision:1},receipt:{id:'actual-local-fixture-receipt',
      contextDigest:createHash('sha256').update(request.context).digest('hex')}};
  }}});
  const output=await tool.execute(input,context());assert.equal(calls,1);assert.equal(output.selections[0].decidedBy,'laya');
  assert.equal(output.selections[0].uncertain,true);assert.equal(output.selections[0].decisionRef,'actual-local-fixture-receipt');
});

test('teacher uses original coordinator once and cannot introduce candidates, tools or proof fields',async()=>{
  for(const reply of [{kind:'text',text:JSON.stringify({selections:[selection]})},
    {kind:'text',text:JSON.stringify({selections:[{...selection,candidateId:'invented'}]})},
    {kind:'text',text:JSON.stringify({selections:[{...selection,decisionRef:'model-claimed-proof'}]})},
    {kind:'tool_proposal',toolName:'execute.anything'}]) {
    let calls=0;
    const [tool]=createRuntimeProactiveDecisionTools({readContext,getRevision:()=>3,teacher:{execute:async request=>{
      calls++;assert.equal(request.taskId,'original-task');assert.equal(request.revision,3);
      assert.equal(request.textOnly,true);
      assert.match(JSON.parse(request.goal).goal,/public-fact/);return reply;
    }}});
    if(reply.kind==='text'&&JSON.parse(reply.text).selections[0].candidateId==='continue'&&!JSON.parse(reply.text).selections[0].decisionRef) {
      const result=await tool.execute(input,context());assert.equal(result.selections[0].decidedBy,'deepseek');
      assert.match(result.selections[0].decisionRef,/^proactive-teacher:/);
    }else await assert.rejects(tool.execute(input,context()),{code:'EXTERNAL_FAILURE'});
    assert.equal(calls,1);
  }
});

test('cancelled or unauthorized decisions do not expose a late teacher result',async()=>{
  const cancel=new AbortController();let calls=0;
  const [tool]=createRuntimeProactiveDecisionTools({readContext,getRevision:()=>3,teacher:{execute:async()=>{
    calls++;cancel.abort();return {kind:'text',text:JSON.stringify({selections:[selection]})};}}});
  await assert.rejects(tool.execute(input,{...context(),scopes:[]}),{code:'SCOPE_DENIED'});assert.equal(calls,0);
  await assert.rejects(tool.execute(input,{...context(),signal:cancel.signal}),{code:'CANCELLED'});assert.equal(calls,1);
});
