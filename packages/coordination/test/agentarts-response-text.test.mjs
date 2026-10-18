import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseAgentArtsResponseText} from '../dist/index.js';
const opts=extra=>({signal:new AbortController().signal,deadline:new Date(Date.now()+5_000).toISOString(),...extra});
const events=text=>[{event:'message',data:{text}},{event:'task_end',data:{}},{event:'end',data:{}}];
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('image response reuses strict JSON and SSE terminal parsing',async()=>{
  const value=JSON.stringify({checkpoint:'test',state:'waiting_tool'});
  assert.equal(await parseAgentArtsResponseText(response(events(value)),opts()),value);
  const sse=events(value).map(e=>'data: '+JSON.stringify(e)+'\n\n').join('');
  assert.equal(await parseAgentArtsResponseText(new Response(sse,{headers:{'content-type':'text/event-stream'}}),opts()),value);
});
test('owned image host may select larger text envelope without changing defaults',async()=>{
  const value='中'.repeat(20_000);
  await assert.rejects(parseAgentArtsResponseText(response(events(value)),opts()),/text limit/);
  assert.equal(await parseAgentArtsResponseText(response(events(value)),opts({maxTextChars:30_000,maxResponseBytes:100_000})),value);
});
test('JSON requires both terminal events and rejects late text',async()=>{
  for(const value of [[events('x')[0]],events('x').slice(0,2),[...events('x'),events('late')[0]]])
    await assert.rejects(parseAgentArtsResponseText(response(value),opts()),/event order|text follows/);
});
test('body limit and malformed UTF-8 remain enforced',async()=>{
  await assert.rejects(parseAgentArtsResponseText(response(events('中'.repeat(100))),opts({maxResponseBytes:100})),/byte limit/);
  await assert.rejects(parseAgentArtsResponseText(new Response(new Uint8Array([0xc3,0x28]),{headers:{'content-type':'application/json'}}),opts()),/UTF-8/);
});
test('cancel/deadline stop reads without retaining pending reader',async()=>{
  let cancelled=0;
  const stream=new ReadableStream({cancel(){cancelled++;}});
  const controller=new AbortController();
  const reading=parseAgentArtsResponseText(new Response(stream,{headers:{'content-type':'application/json'}}),opts({signal:controller.signal}));
  controller.abort();await assert.rejects(reading,e=>e.code==='CANCELLED');
  assert.equal(cancelled,1);
  await assert.rejects(parseAgentArtsResponseText(response(events('x')),opts({deadline:new Date(Date.now()-1).toISOString()})),e=>e.code==='TIMEOUT');
});
test('provider failures expose no provider body in error',async()=>{
  const marker='private-provider-detail';
  await assert.rejects(parseAgentArtsResponseText(response([{event:'error',data:{message:marker}}]),opts()),e=>!e.message.includes(marker)&&e.code==='EXTERNAL_FAILURE');
  await assert.rejects(parseAgentArtsResponseText(new Response(marker,{status:403}),opts()),e=>!e.message.includes(marker)&&e.code==='EXTERNAL_FAILURE');
});
