import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentServer} from '../src/server.mjs';
import {createTestVersionController} from '../src/test-version-controller.mjs';
const token='test-token-public-fixture-not-secret-123456';
const deployment={provider:'explicit-fake',deployment:'test-only',model:'test',verification:'mock',
  capabilities:{text:true,streaming:false,toolCalling:false,structuredOutput:false,vision:false}};
test('test image model turn uses configured gateway, real control signal and metadata; never executes tools',async t=>{
  const calls=[],controller=createTestVersionController({models:{plan:{deployment,complete:async request=>{
    calls.push(request);return {response:{kind:'final',text:'{"kind":"final","text":"fixture"}'},deployment,latencyMs:1};
  }}}});
  const server=createAgentServer({mode:'standalone-validation',authToken:token,wssAuthToken:token,
    orchestrator:{invoke:async()=>{throw Error('Test invocation must not fall through');}},testVersionController:controller});
  server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port+'/invocations';
  const query={testVersion:1,operation:'model_turn',modelRef:'plan',reasoningEffort:'none',messages:[{role:'user',content:'public fixture'}]};
  const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({query:JSON.stringify(query)})});
  assert.equal(response.status,200);const events=await response.json(),answer=JSON.parse(events[0].data.text);
  assert.equal(answer.result.deployment.verification,'mock');assert.equal(calls.length,1);
  assert.deepEqual(calls[0].tools,[]);assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(calls[0].reasoningEffort,'none');
  const badEffort=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({query:JSON.stringify({...query,reasoningEffort:'unadvertised-depth'})})});assert.equal(badEffort.status,400);assert.equal(calls.length,1);
  const invalid=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({query:JSON.stringify({...query,modelRef:'attacker-url'})})});assert.equal(invalid.status,400);
  assert.equal(calls.length,1);
});
test('test protocol is explicitly disabled by default',async t=>{
  const server=createAgentServer({mode:'standalone-validation',authToken:token,
    orchestrator:{invoke:async()=>{throw Error('No fallback');}}});
  server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/invocations',{method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({query:JSON.stringify({testVersion:1,operation:'capabilities'})})});
  assert.equal(response.status,503);
});
