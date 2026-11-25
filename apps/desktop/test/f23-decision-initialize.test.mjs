import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createDesktopF23DecisionConfiguration,F23_INITIALIZE_TOOL} from '../electron/f23-decision-configuration.js';

test('F23 initialization uses the original Runtime grant and actual durable consumer; it cannot replace an existing baseline',async t=>{
  // Real Runtime/Policy/ToolGateway/SQLite. Catalog and human approval are explicit Fixtures.
  const base=join(process.cwd(),'.cache','f23-initialize');mkdirSync(base,{recursive:true});
  const selection={catalogRevision:'a'.repeat(64),modelId:'fixture-model'};let app,approvals=0;
  const models={snapshot:()=>({catalog:{revision:selection.catalogRevision}}),readExecutionModel:()=>structuredClone(selection),
    resolveExecutionModel:value=>{assert.deepEqual(value,selection);return structuredClone(value);}};
  const host=createDesktopF23DecisionConfiguration({runtimeModule,getApplication:()=>app,models,namespace:'fixture'});
  app=runtimeModule.createRuntimeApplication({path:join(mkdtempSync(join(base,'run-')),'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'fixture',
    tools:[host.tool],hostOnlyTools:[F23_INITIALIZE_TOOL],requiresToolAuthorization:()=>true,
    requestToolAuthorization:async()=>{approvals++;return 'allow_once';}});t.after(()=>app.close());
  const scope={deadline:new Date(Date.now()+15000).toISOString(),signal:new AbortController().signal};
  const wait=async task=>{while(app.activeTaskCount&&Date.now()<Date.parse(scope.deadline))await new Promise(resolve=>setTimeout(resolve,5));return app.readHostToolTask(task.taskId);};
  const input={commandId:'original',catalogRevision:selection.catalogRevision};
  const first=host.initialize(input,scope),result=await wait(first);
  assert.equal(result.task.state,'succeeded',JSON.stringify(result.task.error));assert.equal(approvals,1);
  assert.deepEqual(host.readDecisionConfiguration().executionModel,selection);assert.equal(host.snapshot().binding.configuration.revision,1);
  assert.throws(()=>host.initialize({...input,commandId:'replacement'},scope),{code:'REVISION_CONFLICT'});
  assert.equal(approvals,1);assert.equal(host.snapshot().binding.configuration.revision,1);
});
