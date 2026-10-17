// Test-only worker: process-local trust, production SDK/default fetch, synthetic credentials.
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createRemoteMcpConfig} from '../../../apps/desktop/electron/remote-mcp-config.js';
import {createDesktopRemoteMcpHost} from '../../../apps/desktop/electron/remote-mcp-host.js';

const token='synthetic-tls-token-only',deadline=()=>new Date(Date.now()+30000).toISOString();
let stage='input';
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()}; // Explicit Fake, not encryption evidence.
async function waitFor(app,taskId,state){
  for(let i=0;i<1000;i++){if(app.runtime.getTask(taskId).state===state)return;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail('Expected Runtime state '+state);
}
async function idle(app){for(let i=0;i<1000&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(app.activeTaskCount,0);}
function checkParent(phase){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{process.removeListener('message',receive);reject(Error('Parent readback timed out'));},5000);
  const receive=value=>{if(value?.phase===phase){clearTimeout(timer);process.removeListener('message',receive);value.ok?resolve():reject(Error('Parent readback refused'));}};
  process.on('message',receive);process.send({phase});
});}
async function run({mode,userData,definition}){
  const endpoint=new URL(definition.endpoint);
  assert.equal(endpoint.protocol,'https:');assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.pathname,'/mcp');assert.ok(endpoint.port);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED,undefined);assert.equal(process.env.NODE_OPTIONS,undefined);
  let config=createRemoteMcpConfig({userData,safeStorage}),host,app;
  stage='configure';
  config.configure({...definition,credential:{token,expiresAt:new Date(Date.now()+120000).toISOString()}});
  const assemble=()=>createDesktopRemoteMcpHost({config,confirmConnection:async()=>true}); // No fetch override.
  host=assemble();
  try{
    if(mode!=='success'){
      stage='reject-connection';
      await assert.rejects(host.connect({signal:new AbortController().signal,deadline:deadline()}),{code:mode==='directory-mismatch'?'REVISION_CONFLICT':'EXTERNAL_FAILURE'});
      assert.equal(host.snapshot().connected,false);assert.throws(()=>host.arguments({key:'public'}));
      return {status:'passed',mode,connectionRejected:true};
    }
    const application=()=>createRuntimeApplication({path:path.join(userData,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-tls-user',tools:host.tools});
    stage='connect';await host.connect({signal:new AbortController().signal,deadline:deadline()});app=application();
    const client=new Client(app,Date.now);await client.connect();
    const input={commandId:'tls-confirmed-read',toolName:definition.tool.descriptor.name,toolVersion:definition.tool.descriptor.version,
      arguments:host.arguments({key:'public'}),deadline:deadline()};
    stage='approval';const taskId=app.submitHostToolTask(input).task.taskId;
    await waitFor(app,taskId,'waiting_approval');await checkParent('before-approval');
    const approval=app.readHostToolTask(taskId).approval;
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    await waitFor(app,taskId,'succeeded');await idle(app);
    stage='confirmed-readback';const result=app.readHostToolTask(taskId);assert.deepEqual(result.confirmed.result,{text:'public synthetic reference'});
    const record=app.runtime.readToolExecutions(taskId)[0];assert.equal(record.state,'confirmed');assert.equal(record.executionStarted,true);assert.equal(record.policyDecision,'allow');
    assert.equal(app.runtime.readEvidence(taskId)[0].verification,'conditional');assert.doesNotMatch(JSON.stringify(result),/synthetic-tls-token/);
    assert.equal(app.submitHostToolTask(input).task.taskId,taskId);await checkParent('after-read');
    app.close();app=undefined;await host.dispose();config.dispose();
    await checkParent('before-restart');
    stage='restart-readback';config=createRemoteMcpConfig({userData,safeStorage});host=assemble();app=application();
    assert.equal(host.snapshot().connected,false);assert.deepEqual(app.readHostToolTask(taskId).confirmed.result,result.confirmed.result);
    assert.throws(()=>app.submitHostToolTask({...input,commandId:'stale-tls-envelope'}),{code:'INVALID_ARGUMENT'});
    await checkParent('after-restart');config.revoke();
    return {status:'passed',mode,profile:'huawei_ict_agentarts',defaultFetch:true,tlsVerified:true,storage:'explicit Fake',
      approvalBeforeCall:true,restartedDisconnected:true,staleEnvelopeRejected:true,evidence:'conditional'};
  }finally{if(app){await idle(app);app.close();}await host.dispose();config.dispose();}
}
process.once('message',input=>{
  void run(input).then(receipt=>process.send({receipt},()=>process.disconnect()),error=>{
    process.exitCode=1;process.send({error:{stage,type:error.name,code:error.code??'UNEXPECTED_FAILURE'}},()=>process.disconnect());
  });
});
