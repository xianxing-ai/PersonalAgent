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

test('F28 model roles cannot replace original dispatch condition evidence',async()=>{
  const options={getApplication:()=>({runtime:{getTask:()=>({state:'running',cancelRequested:false})}}),
    modelApiHost:{readHarnessConfiguration:()=>({nativeRoles:{research:true,analysis:true,coder:true}})},
    authorizeExport:async()=>true};
  const scope={taskId:'original'},input={workflowId:'F28',nodeId:'F28_N03',input:{},predecessorOutputs:{},predecessorStates:{}};
  assert.equal(await createF28ModelGraphPorts(options).ports.resolveGuardState(scope,input),'unknown');
  const wired=createF28ModelGraphPorts({...options,resolveOriginalDispatchState:async(actualScope,actualInput)=>{
    assert.equal(actualScope,scope);assert.equal(actualInput,input);return 'selected';
  }});
  assert.equal(await wired.ports.resolveGuardState(scope,input),'selected');
});

for(const [name,create,options] of [
  ['F02',createF02VoiceGraphPorts,{authorizationQuestions:{snapshot:()=>({pending:[]}),refresh:()=>{}}}],
  ['F14',createF14ObservationGraphPorts,{browserObserveTool:{descriptor:{name:'browser.observe',version:'1.0.0',sideEffect:'read'}}}],
  ['F28',createF28ModelGraphPorts,{modelApiHost:{readHarnessConfiguration:()=>({})}}],
]) {
  test(`${name} export awaits the exact authorization decision and rechecks the original task`,async()=>{
    let cancelled=false,decision=true,pending;
    const scope={taskId:'original-task'},result={value:'original-result'};
    const application={runtime:{getTask:id=>{
      assert.equal(id,'original-task');return {state:'running',cancelRequested:cancelled};
    }}};
    const bundle=create({...options,getApplication:()=>application,authorizeExport:async request=>{
      assert.equal(request.scope,scope);assert.equal(request.result,result);
      await pending;return decision;
    }});
    assert.equal(await bundle.ports.authorizeExport(scope,result),true);
    decision=false;assert.equal(await bundle.ports.authorizeExport(scope,result),false);
    decision='true';assert.equal(await bundle.ports.authorizeExport(scope,result),false);
    decision=true;
    let finish;pending=new Promise(resolve=>{finish=resolve;});
    const authorization=bundle.ports.authorizeExport(scope,result);
    cancelled=true;finish();
    await assert.rejects(authorization,/no longer current/);
  });
}
