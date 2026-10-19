import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {createProactiveWorkflowController} from '@personal-agent/agentarts-runtime/proactive-controller';
import {createDesktopProactiveWorkflowApplication} from '../electron/proactive-workflow-host.js';
import {createDesktopProactiveConversationTools} from '../electron/proactive-conversation-tools.js';

test('Synthetic public conversation -> original Policy -> signed local mirror start/pause -> bounded model continuation',async()=>{
  const secret='synthetic-local-mirror-public-signing-key-32';
  const contract={id:'synthetic-core',version:'1',criteria:'Synthetic public responsibility',qualifiedForMain:false,batchIndependent:true,
    candidates:[{id:'continue',description:'Continue',action:'continue'},{id:'defer',description:'Defer',action:'defer'}]};
  const controller=createProactiveWorkflowController({receiptSecret:secret,decisionContracts:[contract]});let imageCalls=0;
  const server=createServer(async(req,res)=>{try {
    assert.equal(req.headers.authorization,'Bearer synthetic-outer');
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const result=await controller({value:JSON.parse(JSON.parse(Buffer.concat(chunks).toString()).query),
      sessionId:req.headers['x-hw-agentarts-session-id'],requestId:req.headers['x-request-id'],
      deadline:req.headers['x-pa-deadline'],signal:new AbortController().signal});imageCalls++;
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify([{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]));
  }catch{res.writeHead(400);res.end('Synthetic mirror rejected request');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let app,host,workflowTaskId;const requests=[],conversationId='desktop-panel:11111111-1111-4111-8111-111111111111';
  const deadline=new Date(Date.now()+60_000).toISOString();
  const resolveUserConversation=id=>app.runtime.getTask(id).conversationId;
  const adapter=createDesktopProactiveConversationTools({getApplication:()=>app,getHost:()=>host,
    isConversationAllowed:id=>id===conversationId,resolveUserConversation});
  app=createAgentArtsRuntimeApplication({path:':memory:',hostUserNamespace:'synthetic-core',proactiveWorkflows:true,
    gatewayUrl:'https://synthetic-agentarts.invalid',runtimeName:'synthetic-no-external-cloud',
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',competitionMaxSteps:8,
    tools:adapter.tools,competitionToolAvailability:adapter.competitionToolAvailability,competitionToolExports:adapter.competitionToolExports,
    authorizationProvider:{read:async()=>'Bearer synthetic-no-external-call'},
    fetchImpl:async(_url,init)=>{
      const query=JSON.parse(JSON.parse(init.body).query);requests.push(query);
      if(requests.length===2)workflowTaskId=query.continuation.result.taskId;
      const proposal=requests.length===1?{toolName:'proactive.workflow.start',arguments:{taskDeadline:deadline}}
        :requests.length===2?{toolName:'proactive.workflow.control',arguments:{taskId:workflowTaskId,action:'pause',expectedControlRevision:0}}:undefined;
      const result=proposal?{kind:'tool_proposal',proposalId:'synthetic-control-'+requests.length,toolVersion:'1.0.0',...proposal}
        :{kind:'text',text:'Synthetic responsibility accepted and paused; completion has not been claimed'};
      return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]),
        {headers:{'content-type':'application/json'}});
    }});
  host=createDesktopProactiveWorkflowApplication({application:app,localDeviceAvailable:()=>true,resolveUserConversation,
    readConfiguration:()=>({contractRef:contract.id,adapter:{endpoint:'http://127.0.0.1:'+server.address().port+'/invocations',
      receiptSecret:secret,authorizationProvider:{read:async()=>'Bearer synthetic-outer'},
      hostAuthorizationProvider:{read:async()=>'Bearer synthetic-inner'}}})});
  try {
    const client=new Client(app);await client.connect();
    const {taskId}=await client.call('task.submit',{conversationId,goal:'Keep a public pelican responsibility pending, then pause it'},
      {idempotencyKey:'synthetic-core-proactive'});
    let state;const approved=new Set();
    for(let i=0;i<500;i++) {
      state=app.runtime.getTask(taskId);
      for(const approval of (await client.call('approval.list',{taskId})).items)if(approval.state==='pending'&&!approved.has(approval.approvalId)) {
        approved.add(approval.approvalId);await client.call('authorization.respond',{
          approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      }
      if(['succeeded','failed','waiting_reconciliation'].includes(state.state))break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(state.state,'succeeded',JSON.stringify(state.error));assert.equal(approved.size,2);
    assert.equal(requests[0].availableTools.length,4);
    assert.deepEqual(requests[0].availableTools.find(item=>item.name.endsWith('.control')).inputSchema.properties.action.enum,
      ['pause','resume','cancel','enter_unattended','return']);
    assert.equal(requests[1].continuation.result.accepted,true);
    assert.equal(requests[2].continuation.result.mode,'paused');assert.equal(requests[2].continuation.result.controlRevision,1);
    assert.equal(JSON.stringify(requests).includes(secret),false);assert.equal(JSON.stringify(requests).includes('checkpoint'),false);
    assert.equal(app.runtime.readToolExecutions(taskId).filter(item=>item.state==='confirmed').length,2);
    assert.notEqual(app.runtime.getTask(workflowTaskId).state,'succeeded','accepted/paused responsibility does not imply completed work');
    assert.ok(imageCalls>=3);
    assert.equal(host.listConversation(conversationId).sessions[0].taskId,workflowTaskId);
  }finally {
    if(workflowTaskId)app.runtime.requestCancel(workflowTaskId,'Synthetic cleanup');
    for(let n=0;n<100&&app.activeTaskCount;n++)await new Promise(resolve=>setTimeout(resolve,5));
    app.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  }
});
