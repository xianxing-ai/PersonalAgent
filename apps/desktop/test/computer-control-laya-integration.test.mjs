import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {Client} from '@personal-agent/client';
import {LayaActionChoiceService} from '@personal-agent/cognition';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createWindowsNativeDesktopControlHost} from '@personal-agent/windows-client';
import {createComputerControlLaya} from '../electron/computer-control-laya.js';
import {createComputerControlLease} from '../electron/computer-control-lease.js';
import {createDesktopWindowsControlHost} from '../electron/windows-control-host.js';

test('synthetic integration: original Runtime and Policy carry a local Laya suggestion after an observation',async()=>{
  let app,ready=false,deviceCalls=0,choices=0;
  const windowRef=randomUUID(),controlRef=randomUUID();
  const transport={start:async()=>{ready=true;},stop:async()=>{ready=false;},close:async()=>{ready=false;},isReady:()=>ready,
    request:async method=>{
      assert.equal(method,'observe');deviceCalls++;
      return {targetRef:randomUUID(),windowRef,observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30000).toISOString(),
        window:{title:'Synthetic test window',bounds:{x:0,y:0,width:500,height:400}},truncated:false,
        controls:[{ref:controlRef,role:'Edit',name:'Synthetic editor',enabled:true,patterns:['value'],value:'private fixture'}]};
    }};
  const chooser=new LayaActionChoiceService({infer:async()=>{choices++;return {answers:{action:{choice:'candidate_0',
    probabilities:{candidate_0:0.9,candidate_1:0.1},answer_confidence:0.9,confidence:0.8}}};}});
  const laya={snapshot:()=>({ready:true,state:'ready'}),choose:request=>chooser.choose(request)};
  const helper=createComputerControlLaya({getHost:()=>laya,readTask:taskId=>app?.runtime.getTask(taskId)});
  const host=createDesktopWindowsControlHost({createControlHost:createWindowsNativeDesktopControlHost,isFullAccess:()=>true,
    readPolicyBinding:()=> 'synthetic-policy',readTaskBinding:()=> 'synthetic-conversation',allowObservationExport:true,
    providerOptions:{transport,selectControl:input=>helper.select(input)}});
  host.configure({enabled:true,allowObservationExport:true});
  await host.start({deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
  const selected=new Set(['computer.request_access','computer.desktop.observe','computer.desktop.suggest_control']);
  const lease=createComputerControlLease({getRuntime:()=>app?.runtime});
  const tools=lease.wrapTools(host.tools.filter(tool=>selected.has(tool.descriptor.name)));
  const availability=host.competitionToolAvailability.filter(item=>selected.has(item.toolName));
  const exports=host.competitionToolExports.filter(item=>selected.has(item.toolName));
  const names=host.competitionToolAvailability.find(item=>item.toolName==='computer.desktop.suggest_control');
  assert.match(names.publicDescription,/local Laya/);assert.ok(names.publicEnumPaths.includes('/operation'));
  const proposal=(proposalId,toolName,args)=>({kind:'tool_proposal',proposalId,toolName,toolVersion:'1.0.0',arguments:args,verification:'unverified'});
  const port=new FakeCoordinationPort(request=>{
    const previous=request.continuation;
    if(!previous){
      const exposed=request.availableTools.find(item=>item.name==='computer.desktop.suggest_control');
      assert.match(exposed.inputSchema.description,/local Laya/);
      assert.deepEqual(exposed.inputSchema.properties.operation.enum,['type','set_value','click','invoke','select','focus']);
      return proposal('access','computer.request_access',{});
    }
    if(previous.proposalId==='access')return proposal('observe','computer.desktop.observe',{});
    if(previous.proposalId==='observe')return proposal('suggest','computer.desktop.suggest_control',
      {targetRef:previous.result.snapshot.targetRef,operation:'set_value'});
    assert.equal(previous.result.state,'control_suggested');assert.equal(previous.result.controlRef,controlRef);
    return {kind:'text',text:'Synthetic suggestion received; no input was sent.',verification:'unverified'};
  });
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',coordination:port,tools,
    competitionToolAvailability:availability,competitionToolExports:exports,retainPriorToolResults:true,competitionMaxSteps:5,
    isUserPresent:taskId=>host.hasPresence(taskId),prepareCompetitionToolExport:async scope=>{
      if(scope.phase==='preflight'&&scope.proposal.toolName.startsWith('computer.desktop.'))await host.prepareToolPresence(scope);
    }});
  host.bind(app);
  try {
    const client=new Client(app,Date.now);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Suggest the editor for synthetic input',conversationId:'synthetic'},
      {idempotencyKey:'laya-computer-synthetic',timeoutMs:60000});
    const approved=new Set(),end=Date.now()+15000;let final;
    while(Date.now()<end){
      const task=app.runtime.getTask(taskId);if(['succeeded','failed'].includes(task.state)){final=task;break;}
      for(const approval of (await client.call('approval.list',{taskId})).items){
        if(approval.state!=='pending'||approved.has(approval.approvalId))continue;
        approved.add(approval.approvalId);
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      }
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(final?.state,'succeeded',JSON.stringify(final?.error));
    assert.equal(choices,1);assert.equal(deviceCalls,1);
    assert.deepEqual(app.runtime.readToolExecutions(taskId).map(item=>item.toolName),
      ['computer.request_access','computer.desktop.observe','computer.desktop.suggest_control']);
    assert.equal(app.runtime.readToolExecutions(taskId).every(item=>item.state==='confirmed'&&item.policyDecision==='allow'),true);
  } finally {lease.close();await host.close();app.close();}
});
