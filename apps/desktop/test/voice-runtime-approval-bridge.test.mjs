import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceRuntimeApprovalBridge} from '../electron/voice-runtime-approval-bridge.js';

test('voice focuses only the existing original card; no second question or approval response',async()=>{
  const expiresAt=new Date(Date.now()+30000).toISOString(),scope={taskId:'parent',conversationId:'ui',deadline:expiresAt,signal:new AbortController().signal};
  let approval={taskId:'child',requestTaskId:'parent',conversationId:'ui',approvalId:'original',revision:2,
    state:'pending',taskState:'waiting_approval',argumentsDigest:'a'.repeat(64),expiresAt};
  let card={taskId:'child',sourceApprovalId:'original',state:'pending',questionId:'formal',revision:4,expiresAt},focused=0;
  const bridge=createVoiceRuntimeApprovalBridge({readPendingApproval:()=>approval,readCurrentQuestion:()=>card,focusQuestion:()=>{focused++;}});
  assert.equal((await bridge.prepareTaskApproval(scope)).questionId,'formal');assert.equal(focused,1);
  for(const change of [{sourceApprovalId:'other'},{taskId:'another'},{state:'answered'}]){
    const original=card;card={...card,...change};assert.equal(await bridge.prepareTaskApproval(scope),null);card=original;
  }
  for(const change of [{conversationId:'another'},{requestTaskId:'another'},{state:'allowed'}]){
    const original=approval;approval={...approval,...change};assert.equal(await bridge.prepareTaskApproval(scope),null);approval=original;
  }
  const abort=new AbortController();abort.abort();await assert.rejects(bridge.prepareTaskApproval({...scope,signal:abort.signal}),/失效/);
  card=null;assert.equal(await bridge.prepareTaskApproval(scope),null);assert.equal(focused,1);
});
