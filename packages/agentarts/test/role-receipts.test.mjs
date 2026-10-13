import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnedAgentOrchestrator} from '../dist/index.js';
import {FakeModelProvider} from '@personal-agent/models';

const invocation = overrides => ({query:'private-user-input',deadline:new Date(Date.now()+5000).toISOString(),
  signal:new AbortController().signal,sessionId:'session-1',requestId:'request-1',...overrides});
const fixture = () => new FakeModelProvider([{kind:'final',text:JSON.stringify({kind:'text',text:'private-model-output'})}]);
const agent = (provider,receipt) => new OwnedAgentOrchestrator({fast:provider,world:provider,plan:provider,review:provider},2048,receipt);
const pair = (receipts,status) => {
  assert.equal(receipts.length,2);
  assert.deepEqual(receipts.map(r=>r.status),['started',status]);
  assert.equal(receipts[0].spanId,receipts[1].spanId);
  assert.equal(receipts[0].startedAt,receipts[1].startedAt);
  assert.ok(Number.isFinite(Date.parse(receipts[1].endedAt)));
  assert.ok(receipts[1].durationMs>=0);
};

test('same-role concurrent requests sharing a requestId retain independent spans on reverse completion',async()=>{
  const provider=fixture(),completions=[],receipts=[];
  const response={response:{kind:'final',text:JSON.stringify({kind:'text',text:'private-model-output'})},
    deployment:provider.deployment,usage:{totalTokens:2},latencyMs:0};
  provider.complete=()=>new Promise(resolve=>completions.push(()=>resolve(response)));
  const orchestrator=agent(provider,r=>receipts.push(r));
  const first=orchestrator.invoke(invocation()),second=orchestrator.invoke(invocation());
  assert.equal(completions.length,2);
  assert.equal(receipts.length,2);
  assert.notEqual(receipts[0].spanId,receipts[1].spanId);
  const [firstSpan,secondSpan]=receipts.map(r=>r.spanId);
  completions[1](); await second;
  completions[0](); await first;
  assert.deepEqual(receipts.map(r=>r.spanId),[firstSpan,secondSpan,secondSpan,firstSpan]);
  for (const span of [firstSpan,secondSpan]) pair(receipts.filter(r=>r.spanId===span),'completed');
  assert.equal(JSON.stringify(receipts).includes('private-'),false);
  assert.equal(receipts[2].totalTokens,2);
});

test('cancellation, expiry and provider failure each close their started span without error content',async()=>{
  for (const mode of ['cancel','timeout','provider']) {
    const provider=fixture(),receipts=[],controller=new AbortController();
    provider.complete=mode==='provider' ? async()=>{throw Error('private-key https://private-endpoint/');} : ()=>new Promise(()=>{});
    const pending=agent(provider,r=>receipts.push(r)).invoke(invocation({signal:controller.signal,
      deadline:new Date(Date.now()+(mode==='timeout'?40:5000)).toISOString()}));
    if(mode==='cancel')controller.abort('private-cancel-reason');
    await assert.rejects(pending,{code:mode==='cancel'?'CANCELLED':mode==='timeout'?'TIMEOUT':'EXTERNAL_FAILURE'});
    pair(receipts,'failed');
    assert.equal(JSON.stringify(receipts).includes('private-'),false);
    assert.equal(receipts[1].totalTokens,undefined);
  }
});

test('sync and async receipt failures cannot fail a model invocation',async()=>{
  for (const receipt of [()=>{throw Error('sink');},async()=>{throw Error('sink');}]) {
    assert.deepEqual(await agent(fixture(),receipt).invoke(invocation()),{kind:'text',text:'private-model-output'});
  }
  // Let rejected observer promises settle; node:test treats unhandled rejections as failures.
  await new Promise(resolve=>setImmediate(resolve));
});

test('pre-cancelled invocation starts no span or model call',async()=>{
  const provider=fixture(),receipts=[],controller=new AbortController(); controller.abort();
  await assert.rejects(agent(provider,r=>receipts.push(r)).invoke(invocation({signal:controller.signal})),{code:'CANCELLED'});
  assert.equal(provider.requests.length,0); assert.equal(receipts.length,0);
});
