import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopNativeExecutionHost} from '../electron/native-execution-host.js';

test('an unprepared native backend reports lossless JSON so an ordinary application card can be persisted',async()=>{
  const host=createDesktopNativeExecutionHost({coding:{},question:{},getApplication:()=>({readAuthorizationQuestionInvocation:()=>undefined}),readConfiguration:()=>undefined,
    ensureHelper:async()=>{throw Error('No native command was requested');}});
  try{
    for(const mode of ['read-only','workspace-write','full-access']){
      const readiness=host.describeExecution({toolName:'desktop.authorization.intent',requirements:[]},{mode});
      assert.equal(readiness.required,false);assert.equal(readiness.available,false);assert.equal(readiness.enforced,false);
      assert.deepEqual(JSON.parse(JSON.stringify(readiness)),readiness,'trusted CAS must not discard undefined fields');
    }
    const required=host.describeExecution({toolName:'workspace.npm_test',requirements:[]},{mode:'workspace-write'});
    assert.equal(required.required,true);assert.equal(required.available,false);assert.equal(required.enforced,false);
    await assert.rejects(host.prepare({toolName:'workspace.npm_test'}),/未降级/);
  }finally{host.close();}
});
