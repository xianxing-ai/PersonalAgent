import test from 'node:test';
import assert from 'node:assert/strict';
import {createF20WorkflowWorkerPorts} from '../electron/f20-workflow-worker-ports.js';
import {f20TrialProjectionSchema} from '../electron/f20-workflow-projection.js';
import {validateToolValue} from '@personal-agent/contracts';

test('F20 ports require a current deployment, local reviewer, exact source frontier and explicit export grant',async()=>{
  const checkpoints=new Map(),input={schemaFile:'contract.ts',codeFile:'api.ts',recipeId:'f20-typescript-sample',docTemplate:'template',targetDoc:'api.md',sourceVersion:'v1'};
  const scope={taskId:'original-task',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  let reviewer,sourceCurrent=true,allowed=false;
  const state={sessionId:'original-session',confirmedOperations:{read:{nodeId:'F20_N01',toolName:'workspace.read_text',result:{path:'contract.ts',content:'original'}}}};
  const app={runtime:{getTask:()=>({state:'running'}),loadCheckpoint:(_,key)=>checkpoints.get(key),saveCheckpointOnce:(_,key,value)=>{if(!checkpoints.has(key))checkpoints.set(key,value);}},
    readF20WorkflowBinding:()=>({input,state}),readF20HarnessContext:()=>({binding:{taskId:scope.taskId}})};
  const ports=createF20WorkflowWorkerPorts({getApplication:()=>app,readHarnessVersions:()=>({workflowVersion:'agentarts-deployment:pinned',executionKind:'real_host'}),
    readReviewerIdentity:()=>reviewer,codingWorkspace:{assertF20Current(){if(!sourceCurrent)throw Error('Source changed');},
      f20Available:()=>true,resolveF20Case:()=>input,authorizeF20Export:async()=>allowed},
    runtimeModule:{verifyF20ReviewCompletion:()=>true,verifyF20HarnessCompletion:()=>({additionalSourceTaskIds:[]})}});
  assert.equal(ports.available(scope),false);reviewer={id:'fixed-reviewer'};assert.equal(ports.available(scope),true);
  assert.deepEqual(await ports.resolveInput('case',scope),input);
  assert.equal(await ports.authorizeExport({...scope,stage:'initial',inputRef:'case',value:input}),false);
  allowed=true;assert.equal(await ports.authorizeExport({...scope,stage:'initial',inputRef:'case',value:input}),true);
  const request={...scope,input,state,proposal:{toolName:'decision.choose_candidate',nodeId:'F20_N02',arguments:{context:JSON.stringify({workflowId:'F20',nodeId:'F20_N02',input,
    predecessors:{F20_N01:state.confirmedOperations.read.result},candidateValues:[{id:'candidate',value:{version:1,docMarkdown:'doc',sampleSnippet:'sample'}}]})}}};
  assert.equal(ports.assertFrontier(request),true);
  const forged=JSON.parse(request.proposal.arguments.context);forged.predecessors.F20_N01.content='forged';
  assert.throws(()=>ports.assertFrontier({...request,proposal:{...request.proposal,arguments:{context:JSON.stringify(forged)}}}),{code:'UNAUTHORIZED'});
  sourceCurrent=false;assert.equal(ports.available(scope),false);sourceCurrent=true;
  reviewer={id:'different-reviewer'};assert.throws(()=>ports.assertCurrent(scope),{code:'UNAUTHORIZED'});
});

test('F20 trial projection excludes source content, extra diagnostics and synthetic execution claims',()=>{
  const schema=f20TrialProjectionSchema();
  assert.equal(schema.properties.binding.properties.executionKind.const,'real_host');
  assert.equal(schema.properties.checkReadback.properties.snapshot.properties.files.items.additionalProperties,false);
  assert.equal(schema.properties.checkReadback.properties.snapshot.properties.files.items.properties.content,undefined);
  assert.throws(()=>validateToolValue(schema,{binding:{executionKind:'synthetic'}}));
});
