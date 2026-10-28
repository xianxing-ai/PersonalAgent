import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {createAgentServer} from '../src/server.mjs';
import {createWikiWorkflowController} from '../src/wiki-controller.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deployment={provider:'fake',deployment:'synthetic',model:'fixture'};
function request() {
  const data={stage:'extract',system:'Only extract facts',input:'{"untrusted":"SYNTHETIC_PRIVATE_DOCUMENT"}',
    maxOutputCharacters:8000,maxOutputTokens:2000};
  return {wikiVersion:1,operation:'compile',requestId:hash('request-1'),inputDigest:hash(data),...data};
}

test('Wiki workflow requires the host credential and invokes only the ModelGateway',async t=>{
  const calls=[],records=[],token='a'.repeat(40);
  const model={deployment,async complete(input){calls.push(input);return {deployment,usage:{inputTokens:7,outputTokens:5},
    response:{kind:'final',text:'{"claims":[]}'}};}};
  const server=createAgentServer({mode:'standalone-validation',orchestrator:{invoke:async()=>({})},wssAuthToken:token,
    serviceControllers:{wikiVersion:createWikiWorkflowController({model,onCall:record=>records.push(record)})}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const endpoint=`http://127.0.0.1:${server.address().port}/invocations`,payload=request();
  const send=(credential,value=payload)=>fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',
    ...(credential?{'X-PA-Agent-Token':`Bearer ${credential}`}:{}) ,'X-Request-Id':payload.requestId},body:JSON.stringify({query:JSON.stringify(value)})});
  assert.equal((await send()).status,401);assert.equal(calls.length,0);
  const response=await send(token);assert.equal(response.status,200);
  const events=await response.json(),receipt=JSON.parse(events[0].data.text);
  assert.equal(receipt.verification,'unverified');assert.deepEqual(receipt.output,{claims:[]});
  assert.equal(receipt.inputDigest,payload.inputDigest);assert.deepEqual(calls[0].tools,[]);
  assert.ok(calls[0].messages[0].content.includes('untrusted data'));
  assert.equal(JSON.stringify(records).includes('SYNTHETIC_PRIVATE_DOCUMENT'),false);
  assert.equal((await send(token,{...payload,input:'changed after authorization'})).status,502);
  assert.equal(calls.length,1);
});

test('Wiki controller rejects model tool proposals and malformed model JSON',async()=>{
  const value=request(),scope={value,requestId:value.requestId,deadline:new Date(Date.now()+5000).toISOString(),signal:new AbortController().signal};
  const toolModel={deployment,async complete(){return {deployment,response:{kind:'tool_proposal',proposal:{}}};}};
  await assert.rejects(createWikiWorkflowController({model:toolModel})(scope),{code:'EXTERNAL_FAILURE'});
  const invalidModel={deployment,async complete(){return {deployment,response:{kind:'final',text:'not json'}};}};
  await assert.rejects(createWikiWorkflowController({model:invalidModel})(scope),{code:'PROTOCOL_MISMATCH'});
});
