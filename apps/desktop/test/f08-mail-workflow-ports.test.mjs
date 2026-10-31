import test from 'node:test';
import assert from 'node:assert/strict';
import {createF08MailWorkflowPorts} from '../electron/f08-mail-workflow-ports.js';

test('F08 archive binds original account/UID epoch/Message-ID and reconciliation binds the original child',async()=>{
  const now=Date.now(),deadline=new Date(now+60_000).toISOString(),signal=new AbortController().signal;
  const archive={account:'fixture',folder:'INBOX',uid:3,uidValidity:19,messageId:'<fixture@example.invalid>'};
  const send={account:'fixture',to:'recipient@example.invalid',subject:'Fixture',text:'Fixture'},checkpoints=new Map();
  const bound={deadline,input:{archive,send},confirmedOperations:[{nodeId:'F08_N01',toolName:'mail.inbox',result:{items:[
    {source:'mail',accountRef:'fixture',externalId:'INBOX:3',dedupeKey:'fixture:19:INBOX:3:<fixture@example.invalid>'}]}}]};
  const app={runtime:{loadCheckpoint:(id,key)=>checkpoints.get(id+key),saveCheckpointOnce:(id,key,value)=>{
    if(!checkpoints.has(id+key))checkpoints.set(id+key,structuredClone(value));}},readConfiguredWorkflowBinding:()=>bound};
  const scope={parentTaskId:'parent',sessionId:'session',operationId:'original-send',deadline,signal};
  const ports=createF08MailWorkflowPorts({getApplication:()=>app,authorizeExport:async()=>true,now:()=>now,bridge:{async invoke({input}){
    return {taskId:'smtp-child',runId:'host-tool-smtp-child',toolName:'mail.send',arguments:input,
      result:{state:'unknown',externalId:'<sent@example.invalid>',actionId:'mail-send:host-tool-smtp-child',evidenceRefs:[]}};
  }}});
  assert.equal(await ports.verifyArchiveBinding(scope,archive),true);
  assert.equal(await ports.verifyArchiveBinding(scope,{...archive,uidValidity:20}),false);
  const action=await ports.invokeSend(scope,send,{});assert.equal(action.idempotencyKey,'host-tool-smtp-child');
  const original=await ports.resolveOriginalSend(scope);assert.equal(await ports.readReconciliation(scope,original),undefined);
  bound.confirmedOperations.push({nodeId:'F08_N11',toolName:'mail.reconcile_send',localTaskId:'reconcile',
    result:{state:'confirmed',externalId:original.messageId}});
  app.runtime.saveCheckpointOnce('reconcile','host-tool-intent',{arguments:{account:'fixture',messageId:original.messageId,idempotencyKey:original.idempotencyKey}});
  assert.equal((await ports.readReconciliation(scope,original)).state,'confirmed');
  await assert.rejects(ports.readReconciliation(scope,{...original,idempotencyKey:'replacement'}),{code:'UNAUTHORIZED'});
  checkpoints.set('reconcilehost-tool-intent',{arguments:{account:'other',messageId:original.messageId,idempotencyKey:original.idempotencyKey}});
  await assert.rejects(ports.readReconciliation(scope,original),{code:'UNAUTHORIZED'});
});
