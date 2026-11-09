import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCloudPersistentCommand} from '../dist/cloud-persistent.js';
const owner={runtimeId:'runtime-one',hostId:'host-one',deploymentVersion:'fixed-v1',contractRef:'public-responsibility',contractVersion:'1'};
const base={version:1,commandId:'read-one',owner,deadline:'2026-11-03T12:00:00.000Z',operation:'readback',originCommandId:'submit-one'};
test('cloud protocol permits original readback and rejects authority/identity widening',()=>{
  assert.deepEqual(parseCloudPersistentCommand(base),base);
  for(const patch of [{grant:{scope:'*'}},{target:{taskId:'another',sessionId:'another'}},{operation:'control'},{deadline:'not-a-date'},
    {owner:{...owner,deploymentVersion:'Latest'}},{operation:'approval',approval:{decision:'allow_once'}}])
    assert.throws(()=>parseCloudPersistentCommand({...base,...patch}));
});

test('cloud todo and notification commands retain bounded original identities without implicit approval',()=>{
  const command={...base,operation:'todo',originCommandId:undefined,target:{taskId:'original-task',sessionId:'original-session'},
    todo:{action:'create',title:'Original cloud reminder',remindUtc:'2026-11-03T11:30:00.000Z'}};
  delete command.originCommandId;assert.deepEqual(parseCloudPersistentCommand(command),command);
  for(const patch of [{todo:{action:'update',id:'original-todo',status:'done'}},
    {todo:{...command.todo,grant:true}},{todo:{action:'update',id:'original-todo',expectedRevision:1}},
    {notification:{action:'read',itemIds:['item-one']}},{todo:{...command.todo,id:'foreign-todo'}}])
    assert.throws(()=>parseCloudPersistentCommand({...command,...patch}));
  const read={...command,operation:'notification',notification:{action:'read',itemIds:['original-reminder']}};
  delete read.todo;assert.deepEqual(parseCloudPersistentCommand(read),read);
  assert.throws(()=>parseCloudPersistentCommand({...read,notification:{action:'read',itemIds:['same','same']}}));
});
