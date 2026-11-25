import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentServer} from '../src/server.mjs';

test('AgentArts requires an inner credential and preserves unauthenticated health checks', async t => {
  const calls=[];
  const orchestrator={invoke:async value=>{calls.push(value);return {kind:'text',text:'ok'};}};
  assert.throws(()=>createAgentServer({mode:'agentarts',orchestrator}), /Invalid server configuration/);
  const token='s'.repeat(32);
  const server=createAgentServer({mode:'agentarts',orchestrator,wssAuthToken:token});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`http://127.0.0.1:${server.address().port}`;
  const post=headers=>fetch(`${url}/invocations`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({query:'synthetic'})});
  assert.equal((await fetch(`${url}/ping`)).status,200);
  assert.equal((await post({authorization:'Bearer synthetic-platform-credential'})).status,503);
  assert.equal((await post({authorization:'Bearer synthetic-platform-credential','x-pa-agent-token':'Bearer invalid'})).status,401);
  assert.equal(calls.length,0);
  assert.equal((await post({authorization:'Bearer synthetic-platform-credential','x-pa-agent-token':`Bearer ${token}`})).status,200);
  assert.equal(calls.length,1);
});

test('standalone mode does not accept an inner header when no inner token is configured', async t => {
  const server=createAgentServer({mode:'standalone-validation',orchestrator:{invoke:async()=>({kind:'text',text:'ok'})}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const r=await fetch(`http://127.0.0.1:${server.address().port}/invocations`,{method:'POST',headers:{'content-type':'application/json','x-pa-agent-token':'Bearer invalid'},body:JSON.stringify({query:'synthetic'})}); assert.equal(r.status,503);
});
