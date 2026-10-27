import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopProactiveWorkflowApplication} from '../electron/proactive-workflow-host.js';

test('ordinary task history is not hydrated to find the original proactive sessions',t=>{
  const application=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});
  t.after(()=>application.close());
  const runtime=application.runtime,conversationId='desktop-panel';
  const create=id=>runtime.submitTask({goal:'Synthetic public maintenance history',conversationId,idempotencyKey:id});
  const source=create('source'),session=create('session'),invalid=create('invalid-binding');
  const configuration={contractRef:'synthetic-history',adapter:{endpoint:'http://synthetic.invalid/invocations'}};
  const imageBinding=createHash('sha256').update(JSON.stringify({contractRef:configuration.contractRef,
    endpoint:configuration.adapter.endpoint,invokeMode:'published'})).digest('hex');
  const binding={version:1,taskId:session.taskId,sourceTaskId:source.taskId,sessionId:'synthetic-session',
    taskDeadline:new Date(Date.now()+60_000).toISOString(),contractRef:configuration.contractRef,imageBinding};
  runtime.saveCheckpoint(session.taskId,'desktop-proactive-workflow-v1',binding);
  runtime.saveCheckpoint(invalid.taskId,'desktop-proactive-workflow-v1',{...binding,taskId:'wrong-task'});
  // More than the old ten-page maintenance/list cap. These are ordinary Runtime
  // tasks, not workflow sessions; neither their bodies nor their checkpoints are needed.
  const ordinary=new Set(Array.from({length:1100},(_,index)=>create('ordinary-'+index).taskId));
  let unrelatedReads=0;
  const load=runtime.loadCheckpoint.bind(runtime);
  runtime.loadCheckpoint=(taskId,key)=>{if(ordinary.has(taskId))unrelatedReads++;return load(taskId,key);};
  const host=createDesktopProactiveWorkflowApplication({application,readConfiguration:()=>configuration,
    resolveUserConversation:id=>id===source.taskId?conversationId:undefined,
    readPersistedSession:(taskId,sessionId)=>{
      assert.equal(taskId,session.taskId);assert.equal(sessionId,binding.sessionId);
      return {application:{state:{binding,contractRef:configuration.contractRef}}};
    },createAdapter:()=>assert.fail('a history read cannot call a cloud adapter')});

  const page=host.maintenancePage();
  assert.deepEqual(page.items.map(item=>item.binding.taskId),[session.taskId]);
  assert.equal(page.nextBeforeSequence,undefined);
  assert.equal(unrelatedReads,0,'maintenance must not hydrate ordinary task bodies');
  assert.deepEqual(host.listConversation(conversationId),{sessions:[{taskId:session.taskId,
    taskState:'created',taskDeadline:binding.taskDeadline}],truncated:false});
  assert.equal(unrelatedReads,0,'conversation lookup must not hydrate unrelated history');
  assert.deepEqual(host.readPersistedSessions().map(item=>item.binding),[binding]);
  assert.equal(unrelatedReads,0,'startup recovery must not hydrate unrelated history');
  assert.equal(runtime.getTask(session.taskId).state,'created','a candidate query cannot execute a task');
  assert.equal(runtime.readToolExecutions(session.taskId).length,0);
  runtime.saveCheckpoint(source.taskId,'private-copy-erasure-binding',{synthetic:true});
  assert.equal(host.maintenancePage().items[0].withheld,true,'original privacy fencing remains authoritative');
});
