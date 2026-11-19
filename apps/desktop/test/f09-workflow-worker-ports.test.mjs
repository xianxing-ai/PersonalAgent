import test from 'node:test';
import assert from 'node:assert/strict';
import {createF09WorkflowWorkerPorts} from '../electron/f09-workflow-worker-ports.js';

function fixture({sessionAllowed=true,harnessOk=true}={}) {
  const exports=[],access=[];
  const feedsHost={
    snapshot:()=>({sessionAllowed,subscriptions:sessionAllowed?[{id:'sub-1'}]:[]}),
    authorizeWorkflowFeedSourceExport(binding){exports.push(binding);return sessionAllowed;},
    assertWorkflowFeedAccess(binding){access.push(binding);return sessionAllowed;},
  };
  const application={runtime:{getTask:()=>({state:'running',cancelRequested:false})}};
  const readHarnessVersions=()=>harnessOk
    ?{workflowVersion:'agentarts-deployment:v-test',runtimeVersion:'rt',executionKind:'real_host'}
    :undefined;
  const ports=createF09WorkflowWorkerPorts({getApplication:()=>application,feedsHost,readHarnessVersions});
  const scope={taskId:'task',deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal};
  return {ports,scope,exports,access};
}

test('F09 worker ports resolve authorized subscription inputRef and refuse when revoked',async()=>{
  const f=fixture();
  assert.equal(f.ports.available(f.scope),true);
  assert.deepEqual(await f.ports.resolveInput('sub-1',f.scope),{subscriptionId:'sub-1'});
  assert.equal(await f.ports.resolveInput('missing',f.scope),undefined);
  assert.equal(await f.ports.authorizeInput({...f.scope,inputRef:'sub-1',value:{subscriptionId:'sub-1'}}),true);
  assert.equal(await f.ports.authorizeSource({...f.scope,parentTaskId:'p',sourceTaskId:'s',sourceOperationId:'op',result:{items:[]}}),true);
  assert.equal(f.exports.length,1);
  const revoked=fixture({sessionAllowed:false});
  assert.equal(revoked.ports.available(revoked.scope),false);
  assert.equal(await revoked.ports.resolveInput('sub-1',revoked.scope),undefined);
});

test('F09 worker ports stay unavailable without pinned agentarts-deployment harness',()=>{
  const f=fixture({harnessOk:false});
  assert.equal(f.ports.available(f.scope),false);
  assert.equal(f.ports.assertFrontier({...f.scope,input:{subscriptionId:'sub-1'}}),false);
});
