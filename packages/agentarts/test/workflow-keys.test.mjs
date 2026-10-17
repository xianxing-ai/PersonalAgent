import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveOwnedWorkflowKeys} from '../dist/index.js';
const token='synthetic-trusted-peer-transport-token-32-chars';
test('trusted transport configuration derives stable different-purpose workflow keys',()=>{
  const first=deriveOwnedWorkflowKeys({transportToken:token}),second=deriveOwnedWorkflowKeys({transportToken:token});
  assert.deepEqual(first,second);assert.notEqual(first.checkpointKey,first.receiptSecret);
  assert.notEqual(first.checkpointKey,token);assert.notEqual(first.receiptSecret,token);
  assert.notEqual(deriveOwnedWorkflowKeys({transportToken:token+'rotated'}).checkpointKey,first.checkpointKey);
});
test('explicit dedicated secrets override derivation; no missing configuration manufactures receipt trust',()=>{
  const checkpointKey='synthetic-independent-checkpoint-secret',receiptSecret='synthetic-independent-receipt-secret';
  assert.deepEqual(deriveOwnedWorkflowKeys({transportToken:token,checkpointKey,receiptSecret}),{checkpointKey,receiptSecret});
  assert.deepEqual(deriveOwnedWorkflowKeys({checkpointKey}),{checkpointKey});
  assert.throws(()=>deriveOwnedWorkflowKeys({}),{code:'UNSUPPORTED_CAPABILITY'});
  assert.throws(()=>deriveOwnedWorkflowKeys({transportToken:'short'}),{code:'INVALID_ARGUMENT'});
});
