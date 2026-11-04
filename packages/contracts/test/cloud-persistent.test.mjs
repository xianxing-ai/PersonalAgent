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
