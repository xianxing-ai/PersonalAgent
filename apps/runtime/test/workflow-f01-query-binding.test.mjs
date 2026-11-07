import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRuntime} from '../dist/index.js';
import {createF01QueryBinding} from '../dist/application/workflow-f01-query-binding.js';

// Synthetic native selection proof; actual storage and CAS use Runtime SQLite.
function fixture() {
  const now=Date.now(),deadline=new Date(now+60_000).toISOString(),signal=new AbortController().signal;
  const runtime=new TaskRuntime(':memory:',{now:()=>new Date(now)});
  const original=runtime.submitTask({goal:'Synthetic original user request',conversationId:'fixture-conversation',idempotencyKey:'f01-user'});
  const application={runtime,readDelegatedUserTaskParent:id=>id==='graph'?{taskId:original.taskId,conversationId:'fixture-conversation',deadline}:undefined};
  let current;
  const binding=createF01QueryBinding({application,now:()=>new Date(now),verifyOriginalSelection:selection=>
    current!==undefined&&JSON.stringify(selection)===JSON.stringify(current)});
  const selected={selectionId:'native-selection',parentTaskId:'graph',sessionId:'session',userTaskId:original.taskId,
    factId:'fact-from-user',sourceRef:'source-from-user',limit:1};
  const context={deadline,signal},scope={...context,parentTaskId:'graph',localTaskId:'host-task',operationId:'op',sessionId:'session'};
  return {runtime,binding,application,context,scope,selected,confirm:value=>{current=structuredClone(value);},revoke:()=>{current=undefined;}};
}

test('F01 query requires an exact native selection bound to original task, session and unrevoked permission',async()=>{
  const f=fixture();try {
    await assert.rejects(f.binding.resolveQuery(f.scope),{code:'UNSUPPORTED_CAPABILITY'});
    assert.throws(()=>f.binding.recordSelection(f.selected,undefined,f.context),{code:'UNAUTHORIZED'});
    f.confirm(f.selected);
    assert.throws(()=>f.binding.recordSelection({...f.selected,userTaskId:'other-user'},undefined,f.context),{code:'UNAUTHORIZED'});
    assert.throws(()=>f.binding.recordSelection({...f.selected,factId:'model-picked'},undefined,f.context),{code:'UNAUTHORIZED'});
    assert.deepEqual(f.binding.recordSelection(f.selected,undefined,f.context),{revision:1});
    assert.deepEqual(await f.binding.resolveQuery(f.scope),{factId:'fact-from-user',sourceRef:'source-from-user',limit:1});
    await assert.rejects(f.binding.resolveQuery({...f.scope,sessionId:'other-session'}),{code:'UNSUPPORTED_CAPABILITY'});
    await assert.rejects(f.binding.resolveQuery({...f.scope,parentTaskId:'other-graph'}),{code:'UNSUPPORTED_CAPABILITY'});
    f.revoke();await assert.rejects(f.binding.resolveQuery(f.scope),{code:'UNAUTHORIZED'});
  } finally {f.runtime.close();}
});

test('F01 selection changes use CAS and a revocation at the transaction gate cannot authorize a selection',async()=>{
  const f=fixture();try {
    let calls=0;
    const raced=createF01QueryBinding({application:f.application,now:()=>new Date(),verifyOriginalSelection:()=>++calls===1});
    assert.throws(()=>raced.recordSelection(f.selected,undefined,f.context),{code:'RESULT_UNKNOWN'});
    await assert.rejects(f.binding.resolveQuery(f.scope),{code:'UNSUPPORTED_CAPABILITY'});
    f.confirm(f.selected);f.binding.recordSelection(f.selected,undefined,f.context);
    const newer={...f.selected,selectionId:'new-native-selection',factId:'new-fact'};f.confirm(newer);
    assert.throws(()=>f.binding.recordSelection(newer,undefined,f.context),{code:'REVISION_CONFLICT'});
    assert.deepEqual(f.binding.recordSelection(newer,1,f.context),{revision:2});
    assert.equal((await f.binding.resolveQuery(f.scope)).factId,'new-fact');
    f.runtime.saveCheckpointOnce(f.selected.userTaskId,'private-copy-erasure',true);
    await assert.rejects(f.binding.resolveQuery(f.scope),{code:'UNAUTHORIZED'});
  } finally {f.runtime.close();}
});

test('F01 query binding cannot be created without a trusted selection verifier',()=>{
  const f=fixture();try {
    assert.throws(()=>createF01QueryBinding({application:f.application,now:()=>new Date()}),{code:'UNSUPPORTED_CAPABILITY'});
  } finally {f.runtime.close();}
});
