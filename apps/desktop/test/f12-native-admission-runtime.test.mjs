import test from 'node:test';
import assert from 'node:assert/strict';
import {scenario} from './fixtures/f12-runtime-scenario.mjs';

test('trusted F12 return selects the exact original graph before cloud and repeated admission only reads it',async t=>{
  const f=await scenario(t,{returning:true,multi:true,nativeReturn:true});
  assert.equal(f.child.state,'succeeded',JSON.stringify(f.diagnostics));
  assert.equal(f.sends,0);assert.ok(f.cloud.length>0);assert.ok(f.cloud.every(request=>request.continuation));
  const before=f.app.runtime.listTasks({limit:100}).items.length;
  assert.equal(f.app.submitF12ReturnDigestTask(f.nativeRequest).taskId,f.root.taskId);
  assert.equal(f.app.runtime.listTasks({limit:100}).items.length,before);
  assert.throws(()=>f.app.submitF12ReturnDigestTask({...f.nativeRequest,arguments:{...f.nativeRequest.arguments,itemIds:['unapproved']}}),
    {code:'REVISION_CONFLICT'});
  assert.equal(f.host.getDigest({trigger:'on_return'}).items.length,2);
});

test('native F12 admission cannot replace the trusted button marker or expired request',async t=>{
  const f=await scenario(t,{returning:true,nativeReturn:true,unrecordedReturn:true});
  assert.equal(f.child.state,'failed');assert.equal(f.sends,0);assert.equal(f.proposals.length,0);
  assert.throws(()=>f.app.submitF12ReturnDigestTask({...f.nativeRequest,idempotencyKey:'expired',deadline:'2000-01-01T00:00:00.000Z'}),
    {code:'INVALID_ARGUMENT'});
  assert.throws(()=>f.app.submitF12ReturnDigestTask({...f.nativeRequest,idempotencyKey:'event',arguments:{itemId:'item',trigger:'event'}}),
    {code:'INVALID_ARGUMENT'});
});

test('cloud cannot replace a completed native return digest with another graph',async t=>{
  const f=await scenario(t,{returning:true,nativeReturn:true,nativeFinalTool:true});
  assert.equal(f.child.state,'failed',JSON.stringify(f.diagnostics));
  assert.equal(f.app.runtime.loadCheckpoint(f.child.taskId,'competition-coordination-failure').code,'SCOPE_DENIED');
  assert.equal(f.sends,0);
});
