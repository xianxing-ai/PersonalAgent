import test from 'node:test';
import assert from 'node:assert/strict';
import {availableThinkingModels} from '../src/features/conversation/model-thinking-picker.js';
import {fixture,snapshot,selection,tick,revision} from '../test-support/model-thinking-fixture.mjs';

test('configured AgentArts without a loaded catalog shows its default without claiming model readiness',()=>{
  for(const configuration of [{agentArts:{configured:true}},{model:{configured:true}}]){
    const f=fixture({...snapshot(),...configuration,agentArtsModels:{catalog:null,preferences:null}});
    assert.equal(f.state.modelLabel,'AgentArts 默认模型');
    assert.match(f.state.detail,/模型目录未加载/);
    assert.equal(f.state.native.available,false);assert.equal(f.state.disabled,true);
    assert.equal(f.calls.length,0);
  }
  const f=fixture({...snapshot(),agentArts:{configured:false},model:{configured:false},agentArtsModels:{catalog:null}});
  assert.equal(f.state.modelLabel,'模型未配置');assert.match(f.state.detail,/连接未配置/);
  assert.equal(f.state.native.available,false);assert.equal(f.state.disabled,true);
});

test('an implicit default retains its catalog name while invalid manual selections remain unavailable',()=>{
  const data=snapshot();delete data.conversationPreference.modelSelection;
  const f=fixture(data);assert.equal(f.state.modelLabel,'A');assert.equal(f.state.manual,false);
  for(const preference of [{modelId:'missing'},{modelId:'blocked'},
    {modelId:'a',executionModel:{...selection('a'),catalogRevision:'b'.repeat(64)}}]){
    f.update(snapshot(1,false,preference));
    assert.equal(f.state.native.available,false);assert.match(f.state.modelLabel,/不可用/);
    assert.doesNotMatch(f.state.modelLabel,/默认模型|未配置/);
  }
  assert.equal(f.calls.length,0);
});

test('an explicit offline model keeps its identity without claiming an AgentArts connection',()=>{
  const f=fixture({...snapshot(),fakeModel:true,agentArts:{configured:false},
    model:{configured:true,label:'Fake Model · 离线测试'},agentArtsModels:{catalog:null,preferences:null}});
  assert.equal(f.state.modelLabel,'Fake Model · 离线测试');assert.match(f.state.detail,/离线测试模型/);
  assert.equal(f.state.native.available,false);assert.equal(f.state.disabled,true);assert.equal(f.calls.length,0);
});

test('the existing custom-provider entry displays the trusted host identity and disabled state',()=>{
  const data={...snapshot(),agentArts:{configured:false},agentArtsModels:{catalog:null,preferences:null},
    model:{provider:'pangu',configured:true,enabled:true,label:'盘古大模型 2.0'}};
  const f=fixture(data);assert.equal(f.state.modelLabel,'盘古大模型 2.0');assert.match(f.state.detail,/模型设置/);
  assert.equal(f.state.native.available,false);assert.equal(f.state.disabled,true);
  f.update({...data,model:{...data.model,enabled:false}});assert.equal(f.state.modelLabel,'盘古大模型 2.0（已停用）');
  f.update({...data,model:{...data.model,configured:false}});assert.equal(f.state.modelLabel,'模型未配置');
  assert.match(f.state.detail,/连接未配置/);assert.equal(f.calls.length,0);
});

test('workspace picker offers every published text model and excludes unavailable or nontext models',async()=>{
  const f=fixture();assert.deepEqual(availableThinkingModels(snapshot()).map(model=>model.id),['a','b','custom-model']);
  await f.controller.chooseModel('blocked');assert.equal(f.calls.length,0);
  const pending=f.controller.chooseModel('custom-model');assert.deepEqual(f.calls[0].payload,{modelId:'custom-model',conversationId:'conversation-1'});
  f.calls[0].resolve();await pending;assert.equal(f.state.modelLabel,'Custom');assert.equal(f.state.nativeSlider,false);
  assert.match(f.state.detail,/供应商管理/);
});
test('default combination preserves primary and submodel preferences without pinning a model',async()=>{
  const data=snapshot(),f=fixture(data),pending=f.commit(4);
  assert.equal(f.calls[0].name,'conversation.model');assert.equal(f.state.manual,false);
  assert.equal(f.calls[0].payload.modelSelection,'default');assert.equal(f.state.native.modelId,'a');assert.equal(f.state.native.reasoningEffort,'high');
  f.calls[0].resolve();await pending;assert.deepEqual(data.agentArtsModels.preferences,{catalogRevision:'a'.repeat(64),defaultModelId:'a',defaultSubmodelId:'b',reasoningEffort:'medium',submodelReasoningEffort:'max'});
});
test('returning from a manual model to defaults removes the explicit model and effort',async()=>{
  const f=fixture(snapshot(2,false,{modelId:'a',executionModel:selection('a','high')}));
  const pending=f.controller.chooseModel('');assert.deepEqual(f.calls[0].payload,{modelId:'',modelSelection:'default',depth:2,fast:false,catalogRevision:revision,conversationId:'conversation-1'});
  f.calls[0].resolve();await pending;assert.equal(f.state.manual,false);assert.equal(f.state.index,2);
});
test('audio and subtask snapshots preserve held drag and never generate preference writes',async()=>{
  const f=fixture();f.preview(4);
  f.update({...snapshot(),audioLevel:.5,subagentTasks:[{taskId:'child',resultSummary:'<untrusted>'}]});
  assert.equal(f.state.index,4);assert.equal(f.calls.length,0);
  const pending=f.controller.commitLevel(4);f.update({...snapshot(),audioLevel:.2});
  assert.equal(f.calls.length,1);assert.equal(f.state.index,4);f.calls[0].resolve();await pending;
});
test('workspace latest failure rolls back to the newest observed pair, preserving a fresh drag',async()=>{
  const f=fixture(),pending=f.commit(5);f.update(snapshot(2,true));f.calls[0].reject(Error('failed'));await pending;
  assert.equal(f.state.preference.depth,2);assert.equal(f.state.preference.fast,true);
  const retry=f.commit(3);f.preview(4);f.calls[1].resolve();await retry;assert.equal(f.state.index,4);
  const final=f.controller.commitLevel(4);f.calls[2].resolve();await final;
});
test('partial save reports failure and only reflects the model already acknowledged by the host',async()=>{
  const f=fixture(snapshot(1,false,{modelId:'a',executionModel:selection('a')}));
  const pending=f.commit(3);f.calls[0].resolve();await tick();f.calls[1].reject(Error('depth failed'));await pending;
  assert.equal(f.state.preference.executionModel.reasoningEffort,'high');assert.equal(f.state.preference.depth,1);
  await assert.rejects(f.controller.flush(),/未保存/);
  const retry=f.commit(3);assert.equal(f.calls[2].name,'thinking.update');f.calls[2].resolve();await retry;await f.controller.flush();
});
test('catalog change cancels queued old intents and the previous request cannot write thinking to a new session',async()=>{
  const f=fixture(snapshot(1,false,{modelId:'a',executionModel:selection('a')}));
  const pending=f.commit(3),flush=f.controller.flush();f.controller.chooseModel('b');
  const changed=snapshot(2);changed.agentArtsModels.catalog.revision='b'.repeat(64);changed.agentArtsModels.preferences.catalogRevision='b'.repeat(64);f.update(changed);
  f.calls[0].resolve();await pending;await assert.rejects(flush,/切换/);
  assert.equal(f.calls.length,1);assert.equal(f.state.index,2);assert.deepEqual(f.errors,[]);
});
test('provider default omits native effort while retaining the single slider',async()=>{
  const f=fixture(snapshot(4,false,{modelId:'a',executionModel:selection('a','high')}));
  const pending=f.commit(0);assert.deepEqual(f.calls[0].payload.executionModel,selection('a'));
  f.calls[0].resolve();await pending;assert.equal(f.state.level,'默认');assert.equal(f.state.max,3);
});
