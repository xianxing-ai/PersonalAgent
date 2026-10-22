import assert from 'node:assert/strict';
import test from 'node:test';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createConnectorReadOrigin} from '../electron/connector-read-origin.js';

function fixture(t) {
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts'});
  t.after(()=>app.close());
  let configurationRef='original-mail-configuration',available=true;
  let sequence=0;
  const origin=createConnectorReadOrigin({getApplication:()=>app,readSourceAuthorization:()=>({available,configurationRef})});
  const submit=()=>app.runtime.submitTask({goal:'Synthetic original read',conversationId:'host-tool:synthetic',idempotencyKey:'synthetic-mail-origin-'+(++sequence)});
  return {app,origin,submit,change:()=>{configurationRef='replacement-mail-configuration';},revoke:()=>{available=false;}};
}

test('native mail origin freezes the actual read configuration and original conversation without private data',t=>{
  const f=fixture(t),task=f.submit();f.origin.bind({taskId:task.taskId,conversationId:'desktop-panel:original'});
  assert.deepEqual(f.origin.read(task.taskId),{configurationRef:'original-mail-configuration',conversationId:'desktop-panel:original'});
  f.origin.bind({taskId:task.taskId,conversationId:'desktop-panel:original'});
  assert.throws(()=>f.origin.bind({taskId:task.taskId,conversationId:'desktop-panel:other'}),{code:'UNAUTHORIZED'});
  assert.equal(f.origin.read(task.taskId).conversationId,'desktop-panel:original');
});

test('an old mail result cannot inherit a replacement configuration or be rebound on event replay',t=>{
  const f=fixture(t),task=f.submit();f.origin.bind({taskId:task.taskId,conversationId:'desktop-panel'});f.change();
  assert.equal(f.origin.read(task.taskId),undefined);
  assert.throws(()=>f.origin.bind({taskId:task.taskId,conversationId:'desktop-panel'}),{code:'UNAUTHORIZED'});
  const fresh=f.submit();f.origin.bind({taskId:fresh.taskId,conversationId:'desktop-panel'});
  assert.equal(f.origin.read(fresh.taskId).configurationRef,'replacement-mail-configuration');
});

test('withdrawn, erased and cancelled source tasks cannot supply native mail origin',t=>{
  const f=fixture(t),task=f.submit();f.origin.bind({taskId:task.taskId,conversationId:'desktop-panel'});
  f.app.runtime.saveCheckpoint(task.taskId,'private-copy-erasure-binding',{synthetic:true});
  assert.equal(f.origin.read(task.taskId),undefined);
  const cancelled=f.submit();f.origin.bind({taskId:cancelled.taskId,conversationId:'desktop-panel'});
  f.app.runtime.requestCancel(cancelled.taskId,'Synthetic cancellation');assert.equal(f.origin.read(cancelled.taskId),undefined);
  const revoked=f.submit();f.origin.bind({taskId:revoked.taskId,conversationId:'desktop-panel'});f.revoke();
  assert.equal(f.origin.read(revoked.taskId),undefined);
  assert.throws(()=>f.origin.bind({taskId:f.submit().taskId,conversationId:'desktop-panel'}),{code:'UNAUTHORIZED'});
});
