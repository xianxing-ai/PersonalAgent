import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createF12ExplicitReturnSource} from '../electron/f12-explicit-return-source.js';
import {originalReturn} from './fixtures/f12-return-scenario.mjs';

async function fixture(t,options){
  const cache=new URL('../../../.cache/f12-explicit-return/',import.meta.url);mkdirSync(cache,{recursive:true});
  const file=path.join(mkdtempSync(new URL('case-',cache)),'runtime.sqlite');
  let app=runtimeModule.createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',proactiveWorkflows:true});
  t.after(()=>app.close());
  const original=await originalReturn(app,options),reader=createF12ExplicitReturnSource({getApplication:()=>app,
    readPersistedWorkflow:runtimeModule.readPersistedRuntimeProactiveWorkflow});
  const task=app.runtime.submitTask({goal:'Public original F12 digest request',conversationId:'fixture-chat',idempotencyKey:'f12-digest-request'});
  return {get app(){return app;},original,reader,restart(){app.close();app=runtimeModule.createRuntimeApplication({path:file,profile:'huawei_ict_agentarts',proactiveWorkflows:true});},
    scope:{taskId:task.taskId,deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal}};
}

test('F12 records only an acknowledged original explicit return and reads the same proof without another control',async t=>{
  const {app,original,reader,scope}=await fixture(t);assert.equal(original.error,undefined);
  assert.throws(()=>reader.read(original.source,scope),{code:'UNAUTHORIZED'});
  const accepted=reader.acceptExplicitReturn(original.source),before=runtimeModule.readPersistedRuntimeProactiveWorkflow(app.runtime,original.source.taskId,original.source.sessionId);
  assert.equal(accepted.conversationId,'fixture-chat');assert.deepEqual(reader.acceptExplicitReturn(original.source),accepted);
  assert.deepEqual(reader.read(original.source,scope).source,original.source);
  assert.deepEqual(runtimeModule.readPersistedRuntimeProactiveWorkflow(app.runtime,original.source.taskId,original.source.sessionId),before);
  assert.throws(()=>reader.read({...original.source,commandId:'replacement'},scope),{code:'REVISION_CONFLICT'});
  assert.throws(()=>reader.read(original.source,{...scope,deadline:new Date(Date.now()-1).toISOString()}),{code:'CANCELLED'});
  assert.throws(()=>reader.read(original.source,{...scope,deadline:new Date(Date.parse(accepted.taskDeadline)+1).toISOString()}),{code:'UNAUTHORIZED'});
  const abort=new AbortController();abort.abort();assert.throws(()=>reader.read(original.source,{...scope,signal:abort.signal}),{code:'CANCELLED'});
  await original.control('pause','after-return');assert.throws(()=>reader.read(original.source,scope),{code:'REVISION_CONFLICT'});
});

test('F12 explicit UI source survives SQLite restart without replaying the original control',async t=>{
  const f=await fixture(t);f.reader.acceptExplicitReturn(f.original.source);
  const proof=f.reader.read(f.original.source,f.scope);f.restart();assert.deepEqual(f.reader.read(f.original.source,f.scope),proof);
});

for(const action of ['resume','enter_unattended'])test('F12 '+action+' is not a user return even after a confirmed control',async t=>{
  const {original,reader}=await fixture(t,{action});assert.equal(original.error,undefined);
  assert.throws(()=>reader.acceptExplicitReturn(original.source),{code:'REVISION_CONFLICT'});
});

test('F12 unknown original return control cannot create a UI source marker',async t=>{
  const {original,reader}=await fixture(t,{unknown:true});assert.ok(original.error);
  assert.throws(()=>reader.acceptExplicitReturn(original.source),{code:'REVISION_CONFLICT'});
});
