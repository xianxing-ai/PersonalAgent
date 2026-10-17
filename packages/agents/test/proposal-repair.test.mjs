import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolError} from '@personal-agent/contracts';
import {ModelGateway,StructuredToolProvider,FakeModelProvider} from '@personal-agent/models';
import {runAgent} from '../dist/index.js';

const tool={name:'fixture.write',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},
  outputSchema:{type:'object'},sideEffect:'external_write',requiredScopes:['fixture:write'],
  idempotencySupport:true,recoverySupport:false,requiresPresence:false};
const proposal={kind:'tool_proposal',proposal:{toolName:tool.name,toolVersion:tool.version,arguments:{}}};
function fixture(responses,options={}) {
  const text=new FakeModelProvider(responses.map(text=>({kind:'final',text})));
  let writes=0;const saved=new Map();
  const context={taskId:'proposal-repair',deadline:new Date(Date.now()+60_000).toISOString(),
    signal:new AbortController().signal,reportProgress(){},loadCheckpoint:key=>saved.get(key),
    saveCheckpoint:(key,value)=>saved.set(key,structuredClone(value))};
  const tools={list:()=>[tool],invoke:async()=>{assert.ok(text.requests.length>=2);writes++;return {state:'confirmed',result:{},evidenceRefs:['fixture-evidence']};}};
  return {text,context,saved,writes:()=>writes,options:{goal:'fixture only',maxSteps:4,
    model:new ModelGateway(new StructuredToolProvider(text)),tools,...options}};
}

for(const [label,bad] of [
  ['bad JSON','not JSON'],
  ['actual prose followed by fenced proposal',`I'll read the actual file first.\n\n\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``],
  ['extra version field',JSON.stringify({...proposal,proposal:{...proposal.proposal,version:'1.0.0'}})],
  ['unavailable tool',JSON.stringify({...proposal,proposal:{...proposal.proposal,toolName:'missing.write'}})],
  ['invalid arguments',JSON.stringify({...proposal,proposal:{...proposal.proposal,arguments:{unexpected:true}}})],
])test(`${label} is repaired within the existing budget before any write`,async()=>{
  const f=fixture([bad,JSON.stringify(proposal),' {"kind":"final","text":"done"}']);
  const outcome=await runAgent(f.context,f.options);
  assert.equal(outcome.status,'succeeded');assert.equal(outcome.steps,3);assert.equal(f.writes(),1);
  const correction=f.text.requests[1].messages;
  assert.equal(correction.some(m=>m.role==='assistant'),false,'missing raw reply must not be fabricated');
  assert.match(correction.at(-1).content,/rejected: /);assert.match(correction.at(-1).content,/without surrounding prose/);
  assert.equal(f.saved.get('agent-loop').repairs,1);
});

test('bad JSON repair limit and original step budget remain enforced',async()=>{
  const f=fixture(['bad','bad',JSON.stringify(proposal)]);
  await assert.rejects(runAgent(f.context,f.options),{code:'INVALID_ARGUMENT',message:'Model returned invalid proposal JSON'});
  assert.equal(f.text.requests.length,2);assert.equal(f.writes(),0);
  const short=fixture(['bad',JSON.stringify(proposal)],{maxSteps:1,maxRepairAttempts:5});
  await assert.rejects(runAgent(short.context,short.options),{code:'TIMEOUT'});
  assert.equal(short.text.requests.length,1);assert.equal(short.writes(),0);
  const none=fixture(['bad'],{maxRepairAttempts:0});
  await assert.rejects(runAgent(none.context,none.options),{code:'INVALID_ARGUMENT'});
  assert.equal(none.text.requests.length,1);
});

test('explicit token budget stops on unknown parsing usage without an extra call or invented usage',async()=>{
  const f=fixture(['bad',JSON.stringify(proposal)],{maxTokens:100});
  await assert.rejects(runAgent(f.context,f.options),{code:'INVALID_ARGUMENT',message:'Model returned invalid proposal JSON'});
  assert.equal(f.text.requests.length,1);assert.equal(f.writes(),0);
  assert.equal(f.saved.size,0,'unknown provider usage must not be replaced by a fabricated checkpoint');
  assert.equal(f.text.requests[0].maxOutputTokens,100);
});

test('explicit token budget preserves original validation repair when a ModelResult supplies usage',async()=>{
  const text=new FakeModelProvider([
    {kind:'tool_proposal',proposal:{toolName:'missing.write',toolVersion:'1.0.0',arguments:{}}},
    {kind:'final',text:'repaired without writing'},
  ]);
  const f=fixture([],{maxTokens:100,model:new ModelGateway(text)});
  const outcome=await runAgent(f.context,f.options);
  assert.equal(outcome.status,'succeeded');assert.equal(text.requests.length,2);assert.equal(f.writes(),0);
  assert.ok(text.requests[1].maxOutputTokens<100,'known result consumption remains charged');
});

for(const [code,message] of [
  ['UNAUTHORIZED','Provider returned HTTP 401'],['UNAUTHORIZED','Policy denied request'],
  ['INVALID_ARGUMENT','maxOutputTokens must be a positive integer'],
  ['UNSUPPORTED_CAPABILITY','Provider does not support text'],['EXTERNAL_FAILURE','Model returned invalid proposal JSON'],
  ['TIMEOUT','Model request deadline expired'],['CANCELLED','Model request was cancelled'],
  ['RESULT_UNKNOWN','Original invocation needs reconciliation'],
])test(`${code}: ${message} is not a proposal repair`,async()=>{
  const f=fixture([]);let calls=0;
  const error=new ProtocolError(code,message);
  f.options.model={complete:async()=>{calls++;throw error;}};
  await assert.rejects(runAgent(f.context,f.options),actual=>actual===error);
  assert.equal(calls,1);assert.equal(f.writes(),0);assert.equal(f.saved.size,0);
});

test('tool-side policy refusal never invokes model correction or repeats a write',async()=>{
  const f=fixture([JSON.stringify(proposal)]);let calls=0;
  f.options.tools.invoke=async()=>{calls++;throw new ProtocolError('UNAUTHORIZED','Tool proposal contains fields outside the tool contract');};
  await assert.rejects(runAgent(f.context,f.options),{code:'UNAUTHORIZED'});
  assert.equal(calls,1);assert.equal(f.text.requests.length,1);
});

test('repair checkpoint resumes with the consumed repair budget',async()=>{
  const f=fixture(['bad','bad']);
  await assert.rejects(runAgent(f.context,{...f.options,maxSteps:1}),{code:'TIMEOUT'});
  assert.equal(f.saved.get('agent-loop').step,2);
  await assert.rejects(runAgent(f.context,f.options),{code:'INVALID_ARGUMENT'});
  assert.equal(f.text.requests.length,2);assert.equal(f.writes(),0);
});
