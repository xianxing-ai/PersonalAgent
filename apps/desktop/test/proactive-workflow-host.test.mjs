import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopProactiveWorkflowApplication} from '../electron/proactive-workflow-host.js';
import {createProactiveWorkflowController} from '@personal-agent/agentarts-runtime/proactive-controller';

test('missing trusted proactive configuration remains unavailable without creating a task or network request',async()=>{
  let calls=0;
  const host=createDesktopProactiveWorkflowApplication({application:{runtime:{getTask:()=>({goal:'public',conversationId:'fixture'}),loadCheckpoint:()=>undefined}},
    readConfiguration:()=>undefined,localDeviceAvailable:()=>true,createAdapter:()=>{calls++;assert.fail('no Fake adapter');}});
  assert.equal(host.snapshot().state,'unavailable');
  await assert.rejects(host.start({sourceTaskId:'source',commandId:'start',taskDeadline:new Date(Date.now()+60000).toISOString()}),/签名配置/);
  assert.equal(calls,0);
});

test('Desktop starts original Runtime worker through authenticated signed image HTTP; missing model/source ports stay explicit',async()=>{
  const root=resolve('.cache','desktop-proactive-fixtures');await mkdir(root,{recursive:true});const folder=await mkdtemp(join(root,'http-'));
  const secret='public-desktop-proactive-http-fixture-key-123456';
  const contract={id:'public-fixture',version:'v1',criteria:'public fixture only',qualifiedForMain:false,batchIndependent:true,
    candidates:[{id:'continue',description:'Continue assigned responsibility',action:'continue'},{id:'defer',description:'Keep pending',action:'defer'}]};
  const controller=createProactiveWorkflowController({receiptSecret:secret,decisionContracts:[contract]});let requests=0;
  const server=createServer(async(req,res)=>{try{
    assert.equal(req.headers.authorization,'Bearer public-outer');assert.equal(req.headers['x-pa-agent-token'],'Bearer public-inner');
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const value=JSON.parse(JSON.parse(Buffer.concat(chunks).toString()).query);requests++;
    const result=await controller({value,sessionId:req.headers['x-hw-agentarts-session-id'],requestId:req.headers['x-request-id'],
      deadline:req.headers['x-pa-deadline'],signal:new AbortController().signal});
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([
      {event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]));
  }catch{res.writeHead(400);res.end('fixture failed');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const app=createRuntimeApplication({path:join(folder,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'public-test',proactiveWorkflows:true});
  const host=createDesktopProactiveWorkflowApplication({application:app,localDeviceAvailable:()=>true,readConfiguration:()=>({contractRef:contract.id,
    adapter:{endpoint:'http://127.0.0.1:'+server.address().port+'/invocations',receiptSecret:secret,
      authorizationProvider:{read:async()=>'Bearer public-outer'},hostAuthorizationProvider:{read:async()=>'Bearer public-inner'}}})});
  let parent;
  try {
    const source=app.runtime.submitTask({goal:'Keep this public responsibility pending',conversationId:'public-fixture',idempotencyKey:'source'});
    const input={sourceTaskId:source.taskId,commandId:'public-start',taskDeadline:new Date(Date.now()+60000).toISOString()};
    parent=await host.start(input);assert.equal(parent.accepted,true);
    const until=Date.now()+10000;while(Date.now()<until&&app.runtime.getTask(parent.taskId).state!=='waiting_approval')await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.runtime.getTask(parent.taskId).state,'waiting_approval');
    assert.notEqual(app.runtime.getTask(parent.taskId).state,'succeeded');assert.ok(requests>=3);
    assert.equal((await host.start(input)).taskId,parent.taskId);
    await assert.rejects(host.start({...input,taskDeadline:new Date(Date.now()+120000).toISOString()}),/绑定其他参数/);
    assert.equal(host.read(parent.taskId).binding.taskId,parent.taskId);
    assert.ok(host.snapshot().missing.includes('local_decision_and_teacher_tools'));
    assert.equal(JSON.stringify(host.snapshot()).includes(secret),false);
    assert.equal(app.runtime.readToolExecutions(parent.taskId).some(record=>record.executionStarted),false);
  }finally{
    if(parent)app.runtime.requestCancel(parent.taskId,'fixture cleanup');
    while(app.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));app.close();
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    assert.ok(resolve(folder).startsWith(root));await rm(folder,{recursive:true,force:true});
  }
});
