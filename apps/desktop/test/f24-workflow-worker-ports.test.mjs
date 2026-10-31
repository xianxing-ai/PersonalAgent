import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopF24WorkflowWorkerPorts} from '../electron/f24-workflow-worker-ports.js';

// Public Runtime package export and actual Desktop factory; source configuration,
// authorization and the readback lease here are explicitly Synthetic.
function fixture({reader=true,enabled=true,current=true,configured=true}={}) {
  const deadline=new Date(Date.now()+30000).toISOString(),calls={acquire:0,release:0};
  let app={readDelegatedUserTaskParent:()=>({taskId:'user',conversationId:'synthetic',deadline}),
    runtime:{getTask:()=>({state:'running'}),loadCheckpoint:()=>undefined}};
  const source={snapshot:()=>({sourceId:'synthetic-source',configRevision:1,configured,enabled,available:true,writeAvailable:false}),
    acquire(expected){calls.acquire++;assert.deepEqual(expected,{sourceId:'synthetic-source',configRevision:1});return {
      assertCurrent(){if(!current)throw Error('Synthetic source revoked');},release(){calls.release++;},
      ...(reader?{reconcileWrite:async()=>({state:'unknown'}),finalizeWrite:async()=>({state:'still_unknown'})}:{})};}};
  const bundle=createDesktopF24WorkflowWorkerPorts({getApplication:()=>app,getKnowledgeSourceConfig:()=>source,
    getKnowledgeTools:()=>({reconcileWrite(){},finalizeWrite(){}}),hostUserNamespace:'synthetic-user',authorizeExport:async()=>false});
  return {bundle,calls,scope:{taskId:'graph',deadline,signal:new AbortController().signal},removeApplication:()=>{app=undefined;}};
}

test('Desktop F24 exposes fixed public worker and actual readback lease without new-write permission',async()=>{
  const f=fixture(),[worker]=f.bundle.configuredWorkflowWorkerPorts;
  assert.equal(worker.workflowId,'F24');assert.equal(worker.toolName,'workflow.recovery.knowledge');
  assert.deepEqual(worker.requestSchema.required,['sourceTaskId']);assert.equal(worker.requestSchema.additionalProperties,false);
  assert.ok(f.bundle.tools.some(tool=>tool.descriptor.name==='workflow.host.f24_n09'));
  assert.equal(typeof f.bundle.recovery.readAvailable,'function');assert.equal(typeof f.bundle.recovery.reconcileOriginalReadback,'function');
  assert.equal(await worker.available(f.scope),true);assert.deepEqual(f.calls,{acquire:1,release:1});
  f.removeApplication();assert.equal(await worker.available(f.scope),false);
});

test('Desktop F24 does not treat a catalog method as a usable source readback port',async()=>{
  for(const options of [{reader:false},{current:false},{enabled:false},{configured:false}]) {
    const f=fixture(options);assert.equal(await f.bundle.configuredWorkflowWorkerPorts[0].available(f.scope),false);
    assert.equal(f.calls.release,f.calls.acquire);
  }
});

test('Desktop F24 absent trusted composition returns no registered tools or worker',()=>{
  const result=createDesktopF24WorkflowWorkerPorts();assert.deepEqual(result.tools,[]);assert.deepEqual(result.configuredWorkflowWorkerPorts,[]);
});
