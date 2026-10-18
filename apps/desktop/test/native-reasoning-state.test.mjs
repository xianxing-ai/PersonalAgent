import test from 'node:test';import assert from 'node:assert/strict';import {nativeReasoningState} from '../src/features/conversation/native-reasoning.js';
test('null catalog or preferences snapshot stays unavailable without throwing',()=>{
  const state=nativeReasoningState({agentArtsModels:{catalog:null,preferences:null},conversationPreference:null});
  assert.equal(state.available,false);assert.equal(state.catalogRevision,undefined);assert.equal(state.modelId,undefined);
});
test('valid catalog with null preferences still resolves the catalog default model',()=>{
  const state=nativeReasoningState({agentArtsModels:{catalog:{revision:'a'.repeat(64),defaultModelId:'text',models:[{id:'text',type:'text',availability:'unverified',reasoningEfforts:['low']}]},preferences:null},conversationPreference:null});
  assert.equal(state.modelId,'text');assert.equal(state.available,true);
});
