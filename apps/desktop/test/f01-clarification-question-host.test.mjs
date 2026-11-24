import test from 'node:test';
import assert from 'node:assert/strict';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createF01ClarificationQuestionHost} from '../electron/f01-clarification-question-host.js';

// Explicit in-memory Runtime fixture: checks the original reply boundary, not native/cloud acceptance.
test('F01 answers only its original conversation and keeps one immutable reply without new execution',async t=>{
  const controller=new AbortController();t.after(()=>controller.abort());
  const deadline=new Date(Date.now()+60_000).toISOString(),map=new Map(),put=(id,key,value)=>map.set(id+'|'+key,value);
  const input={context:{fact:{id:'fact',revision:1}}};let current=true,writes=0;
  put('host','coding-repair:parent',{taskId:'graph',operationId:'operation'});
  put('host','host-tool-intent',{deadline,arguments:{}});
  put('graph','owned-workflow:intent:operation',{workflowId:'F01',sessionId:'session',deadline,
    proposal:{nodeId:'F01_N08',toolName:'workflow.host.f01_n08',operationId:'operation',arguments:{}}});
  put('choice','host-tool-intent',{arguments:{context:JSON.stringify({workflowId:'F01',nodeId:'F01_N03',input,
    candidateValues:[{id:'clarify',value:{action:'clarify',question:'这项责任何时结束？'}}]})}});
  const runtime={loadCheckpoint:(id,key)=>map.get(id+'|'+key),saveCheckpointOnce:(id,key,value)=>{
    if(map.has(id+'|'+key))return false;writes++;put(id,key,structuredClone(value));return true;},
    readToolExecutions:id=>id==='host'?[{evidenceId:'host-tool-host',executionStarted:true,policyDecision:'allow',state:'started'}]:[],
    matchesToolExecutionInput:(_record,value)=>value.scopeRef==='host-tool-host'&&Object.keys(value.arguments).length===0,
    policy:{get:()=>({taskId:'host',toolName:'workflow.host.f01_n08',argumentsDigest:toolArgumentsDigest({}),scopes:['memory:read'],expiresAt:deadline})}};
  const application={runtime,readHostToolTask:id=>{assert.equal(id,'host');return {task:{state:'running',cancelRequested:false},
    toolName:'workflow.host.f01_n08',commandId:'operation'};},readSubagentTasks:()=>[],readPendingOwnedWorkflowHostTask:()=>undefined,
    readF01ContextBinding:()=>current?{user:{taskId:'user',conversationId:'conversation'},destination:{deploymentVersion:'fixed-fixture'},
      binding:{deadline,input,configurationDigest:'original',confirmedOperations:[
        {nodeId:'F01_N03',toolName:'decision.choose_candidate',localTaskId:'choice',result:{selectedId:'clarify'}},
        {nodeId:'F01_N08',toolName:'workflow.guard.f01_n08',result:{state:'selected'}}]}}:undefined};
  const host=createF01ClarificationQuestionHost({getApplication:()=>application}),scope={parentTaskId:'graph',localTaskId:'host',
    sessionId:'session',deadline,signal:controller.signal};
  const waiting=host.requestReply(scope,{taskId:'host',signal:controller.signal});
  const question=host.readQuestion({taskId:'host',conversationId:'conversation'});assert.equal(question.prompt,'这项责任何时结束？');
  assert.equal(host.readQuestion({taskId:'host',conversationId:'other'}),undefined);
  const answer={taskId:'host',sourceTaskId:'user',questionId:question.questionId,expectedRevision:1,commandId:'answer-1',answer:'原报告交付后'};
  assert.throws(()=>host.submitReply(answer,{conversationId:'other'}));assert.equal(writes,2);
  const result=host.submitReply(answer,{conversationId:'conversation'});assert.equal(result.revision,2);assert.equal(writes,3);
  assert.deepEqual(host.submitReply(answer,{conversationId:'conversation'}),result);assert.equal(writes,3);
  assert.throws(()=>host.submitReply({...answer,answer:'替换回答'},{conversationId:'conversation'}));
  assert.equal((await waiting).answer,'原报告交付后');current=false;
  assert.throws(()=>host.readReply(scope));assert.equal(writes,3);
});
