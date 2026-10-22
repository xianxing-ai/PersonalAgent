import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication,createRuntimeApplication} from '../dist/application.js';

async function settle(app,id) {
  for(let n=0;n<200;n++) {
    const task=app.runtime.getTask(id);
    if(['succeeded','failed','cancelled','waiting_reconciliation'].includes(task.state) && !app.activeTaskCount)return task;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic task did not settle');
}

test('Synthetic request context is transient, bounded and rejects asynchronous or oversized host data before send',async t=>{
  for(const [name,read] of [['async',async()=> 'Synthetic'],['overflow',()=> 'x'.repeat(16000)]]) await t.test(name,async t=>{
    let sends=0;
    const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',
      coordinationInput:{beforeCoordinationSend(){},readRequestContext:read},
      coordination:{execute:async()=>{sends++;return {kind:'text',text:'must not send',verification:'mock'};}}});
    t.after(()=>app.close());const client=new Client(app);await client.connect();
    const task=await client.call('task.submit',{goal:'Synthetic goal',conversationId:'synthetic'},{idempotencyKey:name});
    assert.equal((await settle(app,task.taskId)).state,'failed');assert.equal(sends,0);
  });
});

test('Synthetic credential await cannot replace the trusted context reader or its final-payload budget',async t=>{
  for(const mutation of ['reader','meter']) await t.test(mutation,async t=>{
    let sends=0,count=10;
    const hooks={beforeCoordinationSend(){},readRequestContext:()=>'{"sampledAtUtc":"Synthetic-clock"}',
      goalTokenBudget:{tokenizerRef:'synthetic-meter',contextTokens:100,reservedOutputTokens:10,countTokens:()=>count}};
    const app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.invalid',runtimeName:'synthetic',
      coordinationInput:hooks,authorizationProvider:{read:async()=>{
        await Promise.resolve();if(mutation==='reader')hooks.readRequestContext=()=> 'Changed';else count=11;
        return 'Bearer Synthetic-only';}},fetchImpl:async()=>{sends++;throw Error('Must be rejected before HTTP');}});
    t.after(()=>app.close());const client=new Client(app);await client.connect();
    const task=await client.call('task.submit',{goal:'Synthetic goal',conversationId:'synthetic'},{idempotencyKey:mutation});
    assert.equal((await settle(app,task.taskId)).state,'failed');assert.equal(sends,0);
    assert.doesNotMatch(JSON.stringify(app.runtime.loadCheckpoint(task.taskId,'competition-context:v1')),/Synthetic-clock/);
  });
});
