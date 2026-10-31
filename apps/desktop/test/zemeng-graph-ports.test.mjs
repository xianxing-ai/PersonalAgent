import test from 'node:test';
import assert from 'node:assert/strict';
import {createF02VoiceGraphPorts} from '../electron/f02-voice-graph-ports.js';
import {createF14ObservationGraphPorts} from '../electron/f14-observation-graph-ports.js';
import {createF28ModelGraphPorts} from '../electron/f28-model-graph-ports.js';
import {createUnavailableCloudPersistentHost} from '../electron/cloud-persistent-unavailable.js';

test('F02/F14/F28 Desktop ports stay unavailable without trusted hosts',()=>{
  assert.equal(createF02VoiceGraphPorts().unavailable,'f02_voice_desktop_ports_unavailable');
  assert.equal(createF14ObservationGraphPorts().unavailable,'f14_observation_desktop_ports_unavailable');
  assert.equal(createF28ModelGraphPorts().unavailable,'f28_native_config_desktop_ports_unavailable');
});

test('cloudPersistent host is explicitly unavailable',()=>{
  const host=createUnavailableCloudPersistentHost();
  assert.equal(host.available(),false);
  assert.equal(host.ref,'desktop:cloud-persistent:unavailable');
  assert.throws(()=>host.assertAvailable(),{code:'UNSUPPORTED_CAPABILITY'});
});

test('F14 ports expose browser.observe binding without inventing observation',()=>{
  const application={runtime:{
    getTask:()=>({state:'running',cancelRequested:false}),
    loadCheckpoint:()=>({localTaskId:'obs-task',operationId:'obs-op'}),
  }};
  const browserObserveTool={descriptor:{name:'browser.observe',version:'1.0.0',sideEffect:'read',requiredScopes:['browser:observe']}};
  const bundle=createF14ObservationGraphPorts({
    getApplication:()=>application,browserObserveTool,authorizeExport:async()=>true,
  });
  assert.equal(bundle.unavailable,null);
  assert.equal(bundle.ports.browserObserve,browserObserveTool);
});
