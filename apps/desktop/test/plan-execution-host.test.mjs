import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createGoalHost} from '../electron/goal-host.js';

// Actual Runtime/SQLite source freeze; only native confirmation and unused cloud transport are Synthetic.
test('native confirmation with a changed actual Plan cannot create or dispatch a task',async t=>{
  let calls=0;
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,
    coordination:{execute:async()=>{calls++;throw Error('Must not send');}},coordinationBinding:'synthetic-fixed-deployment',
    assertCoordinationBinding:()=>{},
    coordinationInput:{prepareCoordinationGoal:async request=>request.publicGoal,beforeCoordinationSend:()=>{}},
    planExecution:{readCurrentFact:()=>undefined}});t.after(()=>app.close());
  const host=createGoalHost('synthetic-native-plan');host.bind(app);
  const store=app.runtime.bindCoordinationStore('synthetic-native-plan'),input={id:'plan',kind:'plan',summary:'Original selected summary',
    sourceRef:'synthetic-user',state:'active',sensitivity:'private',reason:'explicit plan',dependencies:[],
    validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z'};
  store.append(0,input);assert.equal(host.list().plans[0].summary,input.summary);
  await assert.rejects(host.executePlan({plan:{id:'plan',revision:1},expectedGraphRevision:1,requestId:'synthetic-native-confirmation'},
    {conversationId:'original-user-chat',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal,
      confirm:async dto=>{assert.equal(dto.summary,input.summary);assert.equal(dto.configurationRef,'synthetic-fixed-deployment');
        store.append(1,{...input,summary:'Changed during native dialog'});return true;}}),{code:'REVISION_CONFLICT'});
  assert.equal(app.runtime.listTasks({limit:10}).items.length,0);assert.equal(calls,0);
});
