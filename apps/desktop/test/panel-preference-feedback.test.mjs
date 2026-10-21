import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,snapshot,selection,tick,revision} from '../test-support/model-thinking-fixture.mjs';

test('single default slider restores observed settings on save failure and blocks submission',async()=>{
  const f=fixture(),pending=f.commit(5),flush=f.controller.flush();
  assert.deepEqual(f.calls[0].payload,{modelId:'',modelSelection:'default',catalogRevision:revision,depth:5,fast:false,conversationId:'conversation-1'});
  f.calls[0].reject(Error('disk failed'));await pending;await assert.rejects(flush,/未保存/);
  assert.equal(f.state.index,1);assert.equal(f.state.saving,false);assert.deepEqual(f.errors,['disk failed']);
});
test('serialized slider commits coalesce and old failure preserves the latest choice',async()=>{
  const f=fixture(),pending=f.commit(5);f.commit(3);f.commit(4);f.update(snapshot());
  assert.equal(f.calls.length,1);assert.equal(f.state.index,4);
  f.calls[0].reject(Error('old failure'));await tick();
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].payload.depth,4);assert.deepEqual(f.errors,[]);
  f.calls[1].resolve();await pending;assert.equal(f.state.index,4);await f.controller.flush();
});
test('Fast shares the writer and keeps the latest complete depth and mode pair',async()=>{
  const f=fixture(),pending=f.commit(5);f.controller.setFast(true);f.update(snapshot(3,true));
  assert.equal(f.state.preference.depth,5);assert.equal(f.state.preference.fast,true);
  f.calls[0].reject(Error('old'));await tick();
  assert.deepEqual(f.calls[1].payload,{modelId:'',modelSelection:'default',catalogRevision:revision,depth:5,fast:true,conversationId:'conversation-1'});
  f.calls[1].reject(Error('fast failed'));await pending;
  assert.equal(f.state.preference.depth,3);assert.equal(f.state.preference.fast,true);
});
test('successful explicit retry clears only feedback belonging to this picker',async()=>{
  for(const newer of [false,true]){
    const f=fixture(),first=f.commit(5);f.calls[0].reject(Error('failed'));await first;
    const retry=f.commit(5);if(newer)f.newerError();f.calls[1].resolve();await retry;
    assert.equal(f.cleared,newer?0:1);
  }
});
test('drag previews without IPC, survives snapshots and saves once on release',async()=>{
  const f=fixture();
  for(const level of [2,3,4,5]){f.preview(level);f.update(snapshot());assert.equal(f.state.index,level);}
  assert.equal(f.calls.length,0);const pending=f.controller.commitLevel(5);
  assert.equal(f.calls.length,1);f.calls[0].resolve();await pending;
});
test('uncommitted preview survives an old failure; session change discards it and late replies',async()=>{
  const f=fixture(),pending=f.commit(3);f.preview(5);f.calls[0].reject(Error('old'));await pending;
  assert.equal(f.state.index,5);
  const next={...snapshot(2),conversationState:{activeId:'conversation-2'}};f.update(next);
  assert.equal(f.state.index,2);assert.equal(f.state.failure,undefined);
  const save=f.commit(4);f.update(snapshot(1));f.calls[1].reject(Error('previous session'));await save;
  assert.equal(f.state.index,1);assert.equal(f.errors.length,1);
});
test('manual model native effort updates one slider and hidden execution depth together',async()=>{
  const f=fixture(snapshot(1,false,{modelId:'a',executionModel:selection('a')}));
  assert.equal(f.state.nativeSlider,true);assert.equal(f.state.max,3);
  const pending=f.commit(3);assert.deepEqual(f.calls[0].payload,{executionModel:selection('a','high'),conversationId:'conversation-1'});
  f.calls[0].resolve();await tick();assert.deepEqual(f.calls[1].payload,{depth:4,fast:false,conversationId:'conversation-1'});
  f.calls[1].resolve();await pending;assert.equal(f.state.level,'高');await f.controller.flush();
});
