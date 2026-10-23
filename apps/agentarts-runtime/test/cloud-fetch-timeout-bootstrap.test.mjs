import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {brotliDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createCloudFetchTimeoutCommand} from '../scripts/cloud-fetch-timeout-command.mjs';
import {deadlineDispatcher,installCloudFetchDeadline,safeFetchError,safeResponseShape} from '../scripts/cloud-fetch-timeout-bootstrap.mjs';

async function fixture(t) {
  const server=createServer((request,response)=>{
    if(request.url==='/headers')setTimeout(()=>response.end('ok'),1500);
    else if(request.url==='/body'){response.writeHead(200);response.flushHeaders();response.write('first');setTimeout(()=>response.end('last'),1500);}
    else setTimeout(()=>response.end('late'),500);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  await fetch('data:text/plain,init');
  return {url:`http://127.0.0.1:${server.address().port}`,agent:globalThis[Symbol.for('undici.globalDispatcher.1')]};
}
test('exact Node 24 bundled dispatcher overrides short headers and body timeouts',async t=>{
  assert.equal(process.version,'v24.15.0');
  const {url,agent}=await fixture(t);
  const baseline=deadlineDispatcher(agent,20),extended=deadlineDispatcher(agent,4000);
  await assert.rejects(fetch(url+'/headers',{dispatcher:baseline}),error=>error.cause?.code==='UND_ERR_HEADERS_TIMEOUT');
  assert.equal(await (await fetch(url+'/headers',{dispatcher:extended})).text(),'ok');
  const shortBody=await fetch(url+'/body',{dispatcher:baseline});
  await assert.rejects(shortBody.text(),error=>error.cause?.code==='UND_ERR_BODY_TIMEOUT');
  assert.equal(await (await fetch(url+'/body',{dispatcher:extended})).text(),'firstlast');
});
test('original deadline/cancellation signal remains authoritative with longer dispatcher timeout',async t=>{
  const {url,agent}=await fixture(t);
  const signal=AbortSignal.timeout(30);
  await assert.rejects(fetch(url+'/cancel',{dispatcher:deadlineDispatcher(agent,1000),signal}),{name:'TimeoutError'});
  assert.equal(signal.aborted,true);
});
test('wrapper targets only configured HTTPS model origins and preserves max body, credentials and signal',async t=>{
  const original=globalThis.fetch,calls=[],records=[];
  const value={choices:[{finish_reason:'length',message:{content:'',reasoning_content:'PRIVATE REASONING'}}],usage:{prompt_tokens:12,completion_tokens:20,total_tokens:32,completion_tokens_details:{reasoning_tokens:20}},private:'PRIVATE BODY'};
  let returned;
  globalThis.fetch=async(input,init)=>{calls.push({input,init});return returned=Response.json(value,{headers:{'x-request-id':'upstream-safe-id'}});};
  t.after(()=>{globalThis.fetch=original;});
  await installCloudFetchDeadline({environment:{PA_AGENT_TIMEOUT_MS:'1800000',PA_AGENT_MODEL_BASE_URL:'https://trusted.invalid/inference/v1',PA_AGENT_PLAN_BASE_URL:'https://role.invalid/v1'},onShape:record=>records.push(record)});
  const signal=new AbortController().signal;
  const init={method:'POST',headers:{authorization:'synthetic'},body:JSON.stringify({model:'unchanged',reasoning_effort:'max',stream:false}),signal,redirect:'error'};
  const response=await fetch('https://trusted.invalid/inference/v1/chat/completions',init);
  assert.equal(response,returned);assert.deepEqual(await response.json(),value);
  assert.equal(records[0].finishReason,'length');assert.deepEqual(records[0].content,{type:'string',length:0});
  assert.deepEqual(records[0].reasoningContent,{type:'string',length:17});
  assert.equal(records[0].usage.reasoning_tokens,20);
  assert.equal(JSON.stringify(records).includes('PRIVATE'),false);
  assert.ok(calls.at(-1).init.dispatcher);
  for(const field of ['headers','body','signal','redirect'])assert.equal(calls.at(-1).init[field],init[field]);
  await fetch('https://role.invalid/v1/chat/completions',init);assert.ok(calls.at(-1).init.dispatcher);
  for(const target of ['https://foreign.invalid/v1/chat/completions','http://trusted.invalid/inference/v1/chat/completions','https://trusted.invalid/ping']){
    await fetch(target,init);assert.equal(calls.at(-1).init,init);
  }
  assert.equal(records.length,2);
});
test('unsafe bootstrap configuration fails closed and error telemetry has no secret text',async()=>{
  await assert.rejects(installCloudFetchDeadline({environment:{PA_AGENT_TIMEOUT_MS:'1800000'}}));
  await assert.rejects(installCloudFetchDeadline({environment:{PA_AGENT_TIMEOUT_MS:'1800000',PA_AGENT_MODEL_BASE_URL:'http://unsafe.invalid/v1'}}));
  assert.throws(()=>deadlineDispatcher({},10));
  assert.deepEqual(safeFetchError({name:'TypeError',message:'private request',code:'private value',cause:{code:'UND_ERR_HEADERS_TIMEOUT',message:'secret'}}),
    {event:'model_fetch_transport_error',name:'TypeError',code:'UNKNOWN',causeCode:'UND_ERR_HEADERS_TIMEOUT'});
  const generated=await createCloudFetchTimeoutCommand();
  assert.ok(generated.command.length<=10);
  assert.ok(generated.command.every(value=>Buffer.byteLength(value)<=256));
  const prefix=generated.command[2].match(/Buffer\.from\('([A-Za-z0-9+/=]*)'\+/)?.[1];
  assert.notEqual(prefix,undefined);
  const runnable=brotliDecompressSync(Buffer.from(prefix+generated.command.slice(3).join(''),'base64'));
  assert.equal(createHash('sha256').update(runnable).digest('hex'),generated.runnableSha256);
  assert.match(runnable.toString(),/event:'fetch_timeout_bootstrap'/);
  assert.match(generated.sourceSha256,/^[0-9a-f]{64}$/);
  const malformed=safeResponseShape(new Response(),{choices:[{finish_reason:'PRIVATE',message:{content:['PRIVATE'],reasoning_content:{private:'PRIVATE'}}}],usage:{prompt_tokens:-1,completion_tokens:'PRIVATE',private:'PRIVATE'}});
  assert.equal(malformed.finishReason,'unknown');assert.deepEqual(malformed.usage,{});
  assert.deepEqual(malformed.content,{type:'array',length:null});
  assert.equal(JSON.stringify(malformed).includes('PRIVATE'),false);
});
