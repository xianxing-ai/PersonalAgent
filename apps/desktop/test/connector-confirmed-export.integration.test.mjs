import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FakeCalendarProvider} from '@personal-agent/calendar';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';

// Real Runtime, SQLite, Policy and authorization questions; the calendar provider is explicitly Fake.
test('confirmed connector host result consumes only its original question export after execution',async t=>{
  let application,prepared,preparationFailure,revision=1,calls=0;
  const provider=new FakeCalendarProvider([]),fetchWindow=provider.fetchWindow.bind(provider);
  provider.fetchWindow=(...args)=>{calls++;return fetchWindow(...args);};
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),
    getApplication:()=>application,namespace:'Synthetic-confirmed-calendar',resolveConversation:taskId=>application.runtime.getTask(taskId).conversationId,available:()=>true,
    profiles:[{ref:'bounded',mode:'workspace-write',revision:1,label:'Synthetic policy',available:true}],defaultProfileRef:'bounded'});
  const host=createConnectorConversationTools({question,getApplication:()=>application,resolveConversation:taskId=>application.runtime.getTask(taskId).conversationId,
    calendar:{binding:()=>({calendarUrl:'https://synthetic.invalid/calendar/',calendarName:'Synthetic',accountRef:'Synthetic',revision}),
      readAuthorization:async()=> 'Synthetic authorization'},createCalendarProvider:()=>provider});
  const tool=host.tools.find(item=>item.descriptor.name==='calendar.events');
  application=createRuntimeApplication({path:path.join(mkdtempSync(path.join(tmpdir(),'pa-confirmed-export-')),'runtime.sqlite'),
    profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic-confirmed-calendar',tools:host.tools,
    requiresToolAuthorization:()=>true,requestToolAuthorization:async scope=>{
      const pending=application.readPendingToolInvocation(scope.taskId,scope.runId);
      const readback=application.readHostToolTask(scope.taskId);
      prepared={...scope,proposalId:readback.commandId,proposal:{proposalId:readback.commandId,
        toolName:pending.toolName,toolVersion:pending.toolVersion,arguments:pending.arguments}};
      try{
        await host.prepareExport({...prepared,phase:'preflight'});
        return await question.requestToolAuthorization(scope);
      }catch(error){preparationFailure=error.message;throw error;}
    }});
  t.after(async()=>{question.close();await host.close();application.close();});
  const args={fromUtc:'2030-10-22T00:00:00Z',toUtc:'2030-10-23T00:00:00Z'};
  const submitted=application.submitHostToolTask({commandId:'confirmed-calendar',toolName:tool.descriptor.name,
    toolVersion:tool.descriptor.version,arguments:args,deadline:new Date(Date.now()+60_000).toISOString()});
  const taskId=submitted.task.taskId;let cards=0;
  for(let attempt=0;attempt<1000;attempt++){
    const card=question.snapshot().find(item=>item.state==='pending');
    if(card){cards++;assert.equal(calls,0);question.respond({questionId:card.questionId,expectedRevision:card.revision,
      decision:card.suggestedDecision},card.conversationId);}
    if(!['running','waiting_approval','pending'].includes(application.runtime.getTask(taskId).state))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  while(application.activeTaskCount)await new Promise(resolve=>setTimeout(resolve,5));
  const readback=application.readHostToolTask(taskId);
  assert.equal(readback.task.state,'succeeded',JSON.stringify({error:readback.task.error,preparationFailure}));assert.equal(cards,1);assert.equal(calls,1);
  const policy=host.competitionToolExports.find(item=>item.toolName===tool.descriptor.name),result=readback.confirmed.result;
  const signal=new AbortController().signal,scope={...prepared,signal,arguments:args,result};
  assert.throws(()=>policy.project({...scope,result:{...result,items:[{forged:true}]}}),{code:'UNAUTHORIZED'});
  const intent=application.runtime.loadCheckpoint(taskId,'host-tool-intent');
  application.runtime.saveCheckpoint(taskId,'host-tool-intent',{...intent,commandId:'substituted'});
  assert.throws(()=>policy.project(scope),{code:'UNAUTHORIZED'});
  application.runtime.saveCheckpoint(taskId,'host-tool-intent',intent);
  assert.deepEqual(policy.project(scope),result);
  assert.equal(policy.accepts({...scope,phase:'final',projection:result}),true);
  assert.deepEqual(policy.project(scope),result,'readback neither reruns the provider nor expands the original export');
  assert.equal(calls,1);
  assert.equal(policy.accepts({...scope,phase:'final',projection:{...result,items:[{forged:true}]}}),false);
  assert.throws(()=>policy.project({...scope,signal:AbortSignal.abort()}),{code:'UNAUTHORIZED'});
  revision++;
  assert.throws(()=>policy.project(scope),{code:'UNAUTHORIZED'});
  assert.equal(policy.accepts({...scope,phase:'final',projection:result}),false);assert.equal(calls,1);
});
