import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnedAgentOrchestrator,parseAgentInput,PROMPT_VERSION} from '../dist/index.js';
import {FakeModelProvider} from '@personal-agent/models';

const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const tool=(name,inputSchema)=>({name,version:'1.0.0',inputSchema});
const text={type:'string',minLength:1};
const tools=[tool('workspace.list_files',schema({})),tool('workspace.read_text',schema({path:text})),
  tool('workspace.preview_text_patch',schema({path:text,expectedSha256:text,newText:text})),
  tool('workspace.apply_text_patch',schema({previewId:text})),
  tool('workspace.run_allowed_command',schema({recipeId:{type:'string',enum:['npm-test']}}))];
const proposal=(index,args,id='next-'+index)=>({kind:'tool_proposal',proposalId:id,toolName:tools[index].name,
  toolVersion:tools[index].version,arguments:args});
const receipt=(id,result)=>({proposalId:id,state:'confirmed',result});
const control=query=>({query:JSON.stringify(query),deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal,
  sessionId:'synthetic-continuation-session',requestId:'synthetic-continuation-request'});
function fixture(outputs,{selector,options}={}){
  const fast=new FakeModelProvider(outputs.map(value=>({kind:'final',text:JSON.stringify(value)})));
  const unused=new FakeModelProvider([]),receipts=[];
  const agent=new OwnedAgentOrchestrator({fast,world:unused,plan:unused,review:unused},512,value=>receipts.push(value),selector,undefined,options);
  return {agent,fast,unused,receipts};
}
const goal='实现用户要求的鹈鹕动画页面；先读取当前工程，预览和应用最小改动，再运行已有测试并按真实结果回答。';
const continued=(result,extra={})=>({goal,availableTools:tools,continuation:receipt('previous-step',result),...extra});

test('goal-bound continuation preserves its bounded frozen catalog, prior receipts and existing model selection',()=>{
  const executionModel={catalogRevision:'a'.repeat(64),modelId:'synthetic-cloud',reasoningEffort:'high'};
  const priorContinuations=[receipt('earlier-step',{files:['index.html']})],query=continued({text:'current source'},{priorContinuations,executionModel});
  const parsed=parseAgentInput(JSON.stringify(query));
  assert.equal(parsed.kind,'continuation');assert.equal(parsed.goal,goal);assert.deepEqual(parsed.availableTools,tools);
  assert.deepEqual(parsed.priorContinuations,priorContinuations);assert.deepEqual(parsed.executionModel,executionModel);
  assert.equal(Object.isFrozen(parsed.availableTools),true);assert.equal(Object.isFrozen(parsed.availableTools[1].inputSchema),true);
  assert.equal(PROMPT_VERSION,'owned-1.10');
});

test('ordinary conversation can propose read, preview, apply and check before answering from explicit Fake receipts',async()=>{
  const outputs=[proposal(0,{}),proposal(1,{path:'index.html'}),
    proposal(2,{path:'index.html',expectedSha256:'synthetic-old-sha',newText:'synthetic new source'}),
    proposal(3,{previewId:'synthetic-preview'}),proposal(4,{recipeId:'npm-test'}),{kind:'text',text:'已按提供的检查回执完成。'}];
  const values=[{files:['index.html']},{path:'index.html',text:'synthetic old source',sha256:'synthetic-old-sha'},
    {previewId:'synthetic-preview'},{applied:true},{recipeId:'npm-test',exitCode:0,passed:true}];
  const f=fixture(outputs),confirmed=[];
  assert.deepEqual(await f.agent.invoke(control({goal,availableTools:tools})),outputs[0]);
  for(let step=1;step<outputs.length;step++){
    const continuation=receipt(outputs[step-1].proposalId,values[step-1]);
    const output=await f.agent.invoke(control({goal,availableTools:tools,continuation,...(confirmed.length?{priorContinuations:[...confirmed]}:{})}));
    assert.deepEqual(output,outputs[step]);assert.equal(Object.hasOwn(output,'verification'),false);confirmed.push(continuation);
  }
  assert.equal(f.fast.requests.length,6);assert.equal(f.unused.requests.length,0);
  const finalInput=JSON.parse(f.fast.requests.at(-1).messages[1].content);
  assert.equal(finalInput.goal,goal);assert.deepEqual(finalInput.availableTools,tools);assert.equal(finalInput.priorContinuations.length,4);
  for(const request of f.fast.requests.slice(1)){
    const prompt=request.messages[0].content;
    assert.match(prompt,/一个必要的下一步工具提案/);assert.match(prompt,/不在聊天文本中索要批准/);
    assert.match(prompt,/由原统一宿主卡片处理审批/);assert.doesNotMatch(prompt,/独立审批执行|不追加动作/);
    assert.doesNotMatch(prompt,/只输出text类型的合法JSON对象/);assert.equal(request.maxOutputTokens,512);
  }
});

test('a consistent command receipt does not terminate a larger goal while a permitted next read remains',async()=>{
  const next=proposal(1,{path:'generated.html'}),f=fixture([next]);
  assert.deepEqual(await f.agent.invoke(control(continued({recipeId:'npm-test',exitCode:0,passed:true}))),next);
  assert.equal(f.fast.requests.length,1);
  const invalid=fixture([next]);
  await assert.rejects(invalid.agent.invoke(control(continued({recipeId:'npm-test',exitCode:1,passed:true}))),{code:'INVALID_ARGUMENT'});
  assert.equal(invalid.fast.requests.length,0);
});

test('legacy receipt-only and goal-without-catalog continuations remain result-only',async()=>{
  for(const extra of [{},{goal}]){
    const f=fixture([proposal(1,{path:'index.html'})]);
    await assert.rejects(f.agent.invoke(control({continuation:receipt('old-read',{text:'original'}),...extra})),{code:'EXTERNAL_FAILURE'});
    assert.match(f.fast.requests[0].messages[0].content,/只输出text类型的合法JSON对象/);
  }
  const deterministic=fixture([]);
  const answer=await deterministic.agent.invoke(control({continuation:receipt('legacy-check',{recipeId:'npm-test',exitCode:1,passed:false})}));
  assert.equal(answer.kind,'text');assert.match(answer.text,/未通过/);assert.equal(deterministic.fast.requests.length,0);
});

test('continuation proposals still reject absent tools, wrong versions, bad parameters and fabricated authority',async()=>{
  const legitimate=proposal(1,{path:'index.html'});
  for(const output of [{...legitimate,toolName:'unpublished.tool'},{...legitimate,toolVersion:'latest'},
    {...legitimate,arguments:{}},{...legitimate,arguments:{path:'index.html',scope:'invented'}},
    {...legitimate,authorizationRef:'invented'},{...legitimate,verification:'verified'}]){
    await assert.rejects(fixture([output]).agent.invoke(control(continued({text:'source'}))));
  }
  await assert.rejects(fixture([legitimate]).agent.invoke(control(continued({text:'source'},{availableTools:[]}))),{code:'UNSUPPORTED_CAPABILITY'});
});

test('catalog without original goal, unconfirmed data, duplicate identities and existing size excesses fail closed',()=>{
  for(const query of [
    {continuation:receipt('read',{}),availableTools:tools},
    continued({}, {continuation:{proposalId:'read',state:'unknown',result:{}}}),
    continued({}, {availableTools:[tools[0],tools[0]]}),
    continued({}, {availableTools:Array.from({length:65},(_,index)=>tool('synthetic.tool'+index,schema({})))}),
    continued({}, {availableTools:[tool('synthetic.large',{type:'object',description:'x'.repeat(24_576)})]}),
    continued({}, {priorContinuations:[receipt('previous-step',{})]}),
    continued({}, {unexpected:true}),
    continued({}, {goal:''}),
  ])assert.throws(()=>parseAgentInput(JSON.stringify(query)));
  assert.throws(()=>parseAgentInput(JSON.stringify(continued({}, {goal:'x'.repeat(1_100_001)}))),{code:'INVALID_ARGUMENT'});
});

test('new continuation uses the selected existing cloud model with the original deadline and cancellation',async()=>{
  const selectedModel=new FakeModelProvider([{kind:'final',text:JSON.stringify(proposal(1,{path:'index.html'}))}]),resolved=[];
  const executionModel={catalogRevision:'b'.repeat(64),modelId:'synthetic-cloud',reasoningEffort:'high'};
  const f=fixture([],{options:{executionModels:{catalog(){assert.fail('no dispatch model catalog is needed');},resolve(value){resolved.push(value);return selectedModel;}}}});
  const request=control(continued({text:'source'},{executionModel}));
  assert.equal((await f.agent.invoke(request)).kind,'tool_proposal');assert.deepEqual(resolved,[executionModel]);
  assert.equal(selectedModel.requests[0].deadline,request.deadline);assert.equal(selectedModel.requests[0].reasoningEffort,'high');
  assert.equal(f.fast.requests.length,0);
  const cancelled=fixture([{kind:'text',text:'unused'}]),controller=new AbortController();controller.abort();
  await assert.rejects(cancelled.agent.invoke({...control(continued({})),signal:controller.signal}),{code:'CANCELLED'});
  await assert.rejects(cancelled.agent.invoke({...control(continued({})),deadline:'2000-01-01T00:00:00.000Z'}),{code:'TIMEOUT'});
  assert.equal(cancelled.fast.requests.length,0);
});

test('final candidate selection can still reject a valid continuation proposal',async()=>{
  const f=fixture([proposal(1,{path:'index.html'})],{selector:{select:async()=> 'review'}});
  const output=await f.agent.invoke(control(continued({text:'source'})));
  assert.equal(output.kind,'text');assert.match(output.text,/RECHECK/);
});

test('repair context keeps its existing World route instead of enabling ordinary continuation tool proposals',async()=>{
  const fast=new FakeModelProvider([]),world=new FakeModelProvider([{kind:'final',text:JSON.stringify({
    disposition:'KEEP',affected:[],reason:'没有相关变化',missing_information:[]})}]);
  const agent=new OwnedAgentOrchestrator({fast,world,plan:fast,review:fast},512);
  const repairContext={expectedGraphRevision:1,targets:[{node:{id:'plan',revision:1},requestedSummary:'原计划',requestedDependencies:[]}],
    allowedDependencies:[{id:'plan',revision:1}]};
  const result=await agent.invoke(control(continued({repairContext})));
  assert.equal(result.kind,'text');assert.match(result.text,/KEEP/);assert.equal(world.requests.length,1);assert.equal(fast.requests.length,0);
});
