import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfiguredWorkflowDecisionScope,prepareConfiguredWorkflowDecisionQuestion} from '../electron/configured-workflow-decision-source.js';

// Synthetic metadata only. Runtime consumer tests independently exercise the real original graph and Policy.
function fixture(workflowId,nodeId){
  const deadline=new Date(Date.now()+60_000).toISOString(),input={request:'Synthetic'},signal=new AbortController().signal;
  const args={context:JSON.stringify({workflowId,nodeId,input,candidateValues:[{id:'first'}]}),candidates:[{id:'first'}]};
  const original={toolName:'decision.choose_candidate',toolVersion:'1.0.0',arguments:args,argumentsDigest:'a'.repeat(64),deadline};
  const proposal={...original,operationId:'operation',nodeId};
  const parent={taskId:'graph',operationId:'operation'},intent={taskId:'graph',workflowId,sessionId:'session',proposal,deadline};
  const edge={localTaskId:'child',request:{...original,commandId:'operation'}};
  const binding={input,deadline,configurationVersion:'Synthetic-v1',configurationDigest:'b'.repeat(64)};
  const graph={state:'running',cancelRequested:false};
  const application={runtime:{getTask:()=>graph,loadCheckpoint:(_task,key)=>key==='coding-repair:parent'?parent
    :key==='owned-workflow:intent:operation'?intent:key==='coding-repair:host:operation'?edge:undefined},
    readAuthorizationQuestionInvocation:()=>original,readHostToolTask:()=>({...original,commandId:'operation'}),
    readConfiguredWorkflowBinding:()=>binding};
  const scope={taskId:'child',runId:'host-tool-child',...original,signal};
  return {application,scope,parent,intent,edge,binding,graph,original};
}

for(const [workflowId,nodeId] of [['F06','F06_N02'],['F06','F06_N03'],['F07','F07_N03'],['F17','F17_N02']])
  test(`${nodeId} original candidate choice only adds a revocable source fence`,()=>{
    const f=fixture(workflowId,nodeId),proof=readConfiguredWorkflowDecisionScope(f.application,f.scope);let fence;
    assert.equal(proof.workflowId,workflowId);assert.equal(Object.isFrozen(proof),true);
    assert.deepEqual(prepareConfiguredWorkflowDecisionQuestion({...f,question:{prepare:(scope,options)=>{
      assert.equal(scope,f.scope);assert.deepEqual(Object.keys(options),['assertCurrent']);fence=options.assertCurrent;
    }}}),proof);
    assert.equal(fence(),true);f.binding.configurationDigest='c'.repeat(64);assert.equal(fence(),false);
  });

for(const [name,mutate] of [
  ['other child',f=>{f.edge.localTaskId='foreign';}],
  ['other arguments',f=>{f.scope.argumentsDigest='f'.repeat(64);}],
  ['other input',f=>{f.binding.input={request:'foreign'};}],
  ['cancelled graph',f=>{f.graph.cancelRequested=true;}],
  ['expired deadline',f=>{f.scope.deadline='2000-01-01T00:00:00.000Z';}],
  ['non-executing input node',f=>{f.intent.proposal.nodeId='F06_N01';}],
])test(`configured source rejects ${name}`,()=>{
  const f=fixture('F06','F06_N03');mutate(f);
  assert.throws(()=>readConfiguredWorkflowDecisionScope(f.application,f.scope),{code:'UNAUTHORIZED'});
});

test('dedicated F15/F20 decisions and unrelated tools retain their original preparation',()=>{
  for(const workflow of ['F15','F20']){
    const f=fixture(workflow,workflow+'_N02');assert.equal(readConfiguredWorkflowDecisionScope(f.application,f.scope),undefined);
  }
  const f=fixture('F06','F06_N02');f.original.toolName='todo.create';
  assert.equal(readConfiguredWorkflowDecisionScope(f.application,f.scope),undefined);
});
