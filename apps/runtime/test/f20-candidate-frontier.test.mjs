import test from 'node:test';
import assert from 'node:assert/strict';
import {assertF20CandidateSelection} from '../dist/application.js';

function createMockRuntime({taskState='running',cancelRequested=false}={}) {
  const checkpoints=new Map();
  const tasks=new Map([['parent-task',{taskId:'parent-task',state:taskState,cancelRequested}]]);
  return {
    getTask(taskId) {
      const task=tasks.get(taskId);
      if(!task)throw Error('Task not found: '+taskId);
      return task;
    },
    loadCheckpoint(taskId,key) {
      return checkpoints.get(`${taskId}:${key}`);
    },
    saveCheckpoint(taskId,key,value) {
      checkpoints.set(`${taskId}:${key}`,value);
    },
    setTaskState(taskId,state,cancel=false) {
      tasks.set(taskId,{taskId,state,cancelRequested:cancel});
    }
  };
}

function validFixture() {
  const runtime=createMockRuntime();
  const parentTaskId='parent-task';
  const operationId='op-1';
  const localTaskId='local-child-1';
  const candidateValues=[
    {id:'cand-1',value:{version:1,docMarkdown:'# Doc 1',sampleSnippet:'export const a = 1;'}},
    {id:'cand-2',value:{version:1,docMarkdown:'# Doc 2',sampleSnippet:'export const b = 2;'}},
    {id:'cand-abstain',abstain:true}
  ];
  const proposal={
    operationId,
    nodeId:'F20_N02',
    toolName:'decision.choose_candidate',
    arguments:{
      context:JSON.stringify({
        workflowId:'F20',
        nodeId:'F20_N02',
        candidateValues
      })
    }
  };

  runtime.saveCheckpoint(parentTaskId,`owned-workflow:operation:${operationId}`,{
    taskId:parentTaskId,
    workflowId:'F20',
    localTaskId,
    proposal
  });
  runtime.saveCheckpoint(parentTaskId,`owned-workflow:intent:${operationId}`,{
    taskId:parentTaskId,
    workflowId:'F20',
    proposal
  });
  runtime.saveCheckpoint(localTaskId,'coding-repair:parent',{
    taskId:parentTaskId,
    operationId
  });

  return {runtime,parentTaskId,operationId,candidateValues,selectedId:'cand-1'};
}

test('assertF20CandidateSelection succeeds on valid bound candidate selection',()=> {
  const {runtime,parentTaskId,operationId,candidateValues,selectedId}=validFixture();
  assert.doesNotThrow(()=>assertF20CandidateSelection({
    runtime,parentTaskId,operationId,candidateValues,selectedId
  }));
});

test('assertF20CandidateSelection rejects invalid task, operation or selection identifiers',()=> {
  const {runtime,parentTaskId,operationId,candidateValues,selectedId}=validFixture();
  for(const bad of ['',null,undefined,'   ','a'.repeat(2049)]) {
    assert.throws(()=>assertF20CandidateSelection({runtime,parentTaskId:bad,operationId,candidateValues,selectedId}),{code:'UNAUTHORIZED'});
    assert.throws(()=>assertF20CandidateSelection({runtime,parentTaskId,operationId:bad,candidateValues,selectedId}),{code:'UNAUTHORIZED'});
    assert.throws(()=>assertF20CandidateSelection({runtime,parentTaskId,operationId,candidateValues,selectedId:bad}),{code:'UNAUTHORIZED'});
  }
});

test('assertF20CandidateSelection enforces task lifecycle and readOnlyRecovery states',()=> {
  const {runtime,parentTaskId,operationId,candidateValues,selectedId}=validFixture();
  
  // Cancelled or invalid state in active execution
  runtime.setTaskState(parentTaskId,'succeeded');
  assert.throws(()=>assertF20CandidateSelection({runtime,parentTaskId,operationId,candidateValues,selectedId}),{code:'UNAUTHORIZED'});
  runtime.setTaskState(parentTaskId,'failed');
  assert.throws(()=>assertF20CandidateSelection({runtime,parentTaskId,operationId,candidateValues,selectedId}),{code:'UNAUTHORIZED'});
  runtime.setTaskState(parentTaskId,'running',true);
  assert.throws(()=>assertF20CandidateSelection({runtime,parentTaskId,operationId,candidateValues,selectedId}),{code:'UNAUTHORIZED'});

  // waiting_approval allowed in active execution
  runtime.setTaskState(parentTaskId,'waiting_approval');
  assert.doesNotThrow(()=>assertF20CandidateSelection({runtime,parentTaskId,operationId,candidateValues,selectedId}));

  // readOnlyRecovery requires waiting_reconciliation
  runtime.setTaskState(parentTaskId,'running');
  assert.throws(()=>assertF20CandidateSelection({runtime,parentTaskId,operationId,candidateValues,selectedId,readOnlyRecovery:true}),{code:'UNAUTHORIZED'});
  runtime.setTaskState(parentTaskId,'waiting_reconciliation');
  assert.doesNotThrow(()=>assertF20CandidateSelection({runtime,parentTaskId,operationId,candidateValues,selectedId,readOnlyRecovery:true}));
});

test('assertF20CandidateSelection rejects drifted checkpoints or foreign operations',()=> {
  const {runtime,parentTaskId,operationId,candidateValues,selectedId}=validFixture();

  // Missing or corrupted operation checkpoint
  runtime.saveCheckpoint(parentTaskId,`owned-workflow:operation:${operationId}`,undefined);
  assert.throws(()=>assertF20CandidateSelection({runtime,parentTaskId,operationId,candidateValues,selectedId}),{code:'UNAUTHORIZED'});

  // Corrupted workflowId
  const f1=validFixture();
  const opCheckpoint=f1.runtime.loadCheckpoint(parentTaskId,`owned-workflow:operation:${operationId}`);
  f1.runtime.saveCheckpoint(parentTaskId,`owned-workflow:operation:${operationId}`,{...opCheckpoint,workflowId:'F15'});
  assert.throws(()=>assertF20CandidateSelection({...f1}),{code:'UNAUTHORIZED'});

  // Intent mismatch
  const f2=validFixture();
  f2.runtime.saveCheckpoint(parentTaskId,`owned-workflow:intent:${operationId}`,{...opCheckpoint,proposal:{...opCheckpoint.proposal,toolName:'other'}});
  assert.throws(()=>assertF20CandidateSelection({...f2}),{code:'UNAUTHORIZED'});

  // Host parent mismatch
  const f3=validFixture();
  f3.runtime.saveCheckpoint('local-child-1','coding-repair:parent',{taskId:'foreign-task',operationId});
  assert.throws(()=>assertF20CandidateSelection({...f3}),{code:'UNAUTHORIZED'});
});

test('assertF20CandidateSelection rejects abstain, duplicates, outside IDs and context drift',()=> {
  // Selecting abstain candidate
  const f1=validFixture();
  assert.throws(()=>assertF20CandidateSelection({...f1,selectedId:'cand-abstain'}),{code:'UNAUTHORIZED'});

  // Candidate ID outside original frontier
  const f2=validFixture();
  assert.throws(()=>assertF20CandidateSelection({...f2,selectedId:'cand-unseen'}),{code:'UNAUTHORIZED'});

  // Duplicate candidate IDs in candidateValues
  const f3=validFixture();
  const duplicates=[...f3.candidateValues,{id:'cand-1',value:{}}];
  assert.throws(()=>assertF20CandidateSelection({...f3,candidateValues:duplicates}),{code:'UNAUTHORIZED'});

  // Context candidateValues drifted from graph
  const f4=validFixture();
  const drifted=[{id:'cand-1',value:{different:true}}];
  assert.throws(()=>assertF20CandidateSelection({...f4,candidateValues:drifted}),{code:'UNAUTHORIZED'});

  // Invalid JSON context
  const f5=validFixture();
  const op=f5.runtime.loadCheckpoint(f5.parentTaskId,`owned-workflow:operation:${f5.operationId}`);
  const badProposal={...op.proposal,arguments:{context:'not valid json'}};
  f5.runtime.saveCheckpoint(f5.parentTaskId,`owned-workflow:operation:${f5.operationId}`,{...op,proposal:badProposal});
  f5.runtime.saveCheckpoint(f5.parentTaskId,`owned-workflow:intent:${f5.operationId}`,{...op,proposal:badProposal});
  assert.throws(()=>assertF20CandidateSelection({...f5}),{code:'UNAUTHORIZED'});
});
