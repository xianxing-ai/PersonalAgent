import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {FakeCalendarProvider} from '@personal-agent/calendar';
import {AuthorizationQuestions,createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createConnectorConversationTools} from '../electron/connector-conversation-tools.js';

const cache=new URL('../../../.cache/calendar-approval-flow/',import.meta.url);mkdirSync(cache,{recursive:true});
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
for(const [mode,denyWrite] of [['workspace-write',false],['workspace-write',true],['full-access',false]])test(`calendar lookup, pagination, update and readback (${mode}, ${denyWrite?'deny':'agree'})`,async()=>{
  let app,step=0,providerCalls=0;const exports=[],cards=[];
  const provider=new FakeCalendarProvider([]);
  await provider.writes.createEvent({uid:'synthetic-event',summary:'Before',startUtc:'2030-10-22T07:00:00Z',endUtc:'2030-10-22T08:00:00Z'});
  const question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new AuthorizationQuestions(options),getApplication:()=>app,
    namespace:'Synthetic-calendar-flow',resolveConversation:()=> 'Synthetic conversation',available:()=>true,
    profiles:[{ref:'bounded',mode,revision:1,label:'Synthetic application policy',available:true}],defaultProfileRef:'bounded'});
  const host=createConnectorConversationTools({question,getApplication:()=>app,resolveConversation:()=> 'Synthetic conversation',
    calendar:{binding:()=>({calendarUrl:'https://synthetic.invalid/calendar/',calendarName:'Synthetic',accountRef:'Synthetic calendar',revision:1}),
      readAuthorization:async()=> 'Synthetic authorization'},createCalendarProvider:()=>{providerCalls++;return provider;}});
  const range={fromUtc:'2030-10-22T00:00:00Z',toUtc:'2030-10-23T00:00:00Z'};
  const operations=[['calendar.events',range],['calendar.events',{...range,limit:1}],
    ['calendar.update',{externalId:'synthetic-event',summary:'After'}],['calendar.events',range]];
  app=createRuntimeApplication({path:path.join(mkdtempSync(new URL('case-',cache)),'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'Synthetic-calendar-flow',
    tools:host.tools,competitionToolAvailability:host.competitionToolAvailability,competitionToolExports:host.competitionToolExports,
    prepareCompetitionToolExport:scope=>host.prepareExport(scope),requiresToolAuthorization:scope=>question.requiresAuthorization(scope),
    requestToolAuthorization:scope=>question.requestToolAuthorization(scope),competitionMaxSteps:8,
    coordination:{async execute(request){
      if(request.continuation)exports.push(structuredClone(request.continuation));
      const next=operations[step++];if(!next)return {kind:'text',text:'Synthetic complete',verification:'mock'};
      const descriptor=host.tools.find(tool=>tool.descriptor.name===next[0]).descriptor;
      return {kind:'tool_proposal',proposalId:'synthetic-'+step,toolName:descriptor.name,toolVersion:descriptor.version,arguments:next[1],verification:'unverified'};
    }}});
  const client=new Client(app);await client.connect();
  try{
    const submitted=await client.call('task.submit',{goal:'Synthetic change one calendar event',conversationId:'Synthetic conversation'},{idempotencyKey:'calendar-flow'});
    for(let index=0;index<1000;index++){
      const card=question.snapshot().find(item=>item.state==='pending');
      if(card){cards.push(card);assert.ok(cards.length<=2,'ordinary calendar editing must not ask a third time');
        assert.deepEqual(card.requirements.map(item=>item.kind),['tool','connector_session','export']);
        if(cards.length===1)assert.equal(providerCalls,0,'no account access before the first card');
        const decision=denyWrite&&card.toolName==='calendar.update'?'deny':card.suggestedDecision;
        question.respond({questionId:card.questionId,expectedRevision:card.revision,decision},card.conversationId);
      }
      if(['succeeded','failed','cancelled','waiting_reconciliation'].includes(app.runtime.getTask(submitted.taskId).state))break;
      await pause();
    }
    const task=app.runtime.getTask(submitted.taskId);assert.equal(task.state,denyWrite?'cancelled':'succeeded',JSON.stringify(task.error));
    assert.equal(cards.length,mode==='full-access'?0:2);
    assert.deepEqual(cards.map(item=>item.toolName),mode==='full-access'?[]:['calendar.events','calendar.update']);
    const writes=app.runtime.readToolExecutions(submitted.taskId).filter(record=>record.toolName==='calendar.update'&&record.state==='confirmed');
    assert.equal(writes.length,denyWrite?0:1);
    if(!denyWrite){assert.equal(exports.length,4);assert.ok(exports.at(-1).result.items.some(item=>item.contentRef.includes('After')));
      const readbacks=app.runtime.readToolExecutions(submitted.taskId).filter(record=>record.toolName==='calendar.events'&&record.state==='confirmed');
      assert.equal(readbacks.length,3);assert.equal(new Set(readbacks.map(record=>record.evidenceId)).size,3);}
  }finally{question.close();while(app.activeTaskCount)await pause();await host.close();app.close();}
});
