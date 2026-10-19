import test from 'node:test';import assert from 'node:assert/strict';
import {nativeReasoningState} from '../src/features/conversation/native-reasoning.js';
const revision='b'.repeat(64);
const catalog={version:'1.0',revision,defaultModelId:'text',models:[{id:'text',displayName:'Text',type:'text',availability:'unverified',reasoningEfforts:['high'],requestProfile:'standard'}]};
test('absent catalog and absent saved preferences degrade instead of dereferencing null',()=>{assert.deepEqual(nativeReasoningState({agentArtsModels:{catalog:null,preferences:null},conversationPreference:null}),{catalogRevision:undefined,modelId:undefined,efforts:[],reasoningEffort:undefined,available:false});});
test('matching saved defaults apply; stale revision falls back to the catalog default',()=>{assert.equal(nativeReasoningState({agentArtsModels:{catalog,preferences:{catalogRevision:revision,defaultModelId:'text',reasoningEffort:'high'}},conversationPreference:null}).reasoningEffort,'high');assert.equal(nativeReasoningState({agentArtsModels:{catalog,preferences:{catalogRevision:'a'.repeat(64),defaultModelId:'stale'}},conversationPreference:null}).modelId,'text');});
