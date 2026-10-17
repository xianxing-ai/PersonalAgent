import test from 'node:test';
import assert from 'node:assert/strict';
import {computeSubtaskInputDigest,createSubagentDispatchTool} from '../dist/index.js';
import {validateToolValue} from '@personal-agent/contracts';
test('native child effort is a separate schema field and bound into replay identity',()=>{
  const original={subtaskId:'id',role:'coder',goal:'work',model:'model',thinkingDepth:0};
  assert.equal(computeSubtaskInputDigest(original),JSON.stringify({subtaskId:'id',role:'coder',goal:'work',model:'model',thinkingDepth:0}));
  const selected={...original,reasoningEffort:'high'};
  assert.notEqual(computeSubtaskInputDigest(selected),computeSubtaskInputDigest(original));
  const schema=createSubagentDispatchTool(async()=>({})).descriptor.inputSchema;
  validateToolValue(schema,{subtasks:[selected]});
  assert.throws(()=>validateToolValue(schema,{subtasks:[{...original,reasoningEffort:5}]}));
});
