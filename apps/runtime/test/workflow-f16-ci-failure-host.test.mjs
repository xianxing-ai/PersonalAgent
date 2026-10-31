import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeF16CiFailureHost} from '../dist/application/workflow-f16-ci-failure-host.js';

function fixture(){
  const now=Date.now(),deadline=new Date(now+60000).toISOString(),signal=new AbortController().signal,head='a'.repeat(40);
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'grant',scopes:['ci:read'],deadline,signal};
  const checkpoints=new Map(),put=(id,key,value)=>checkpoints.set(id+'|'+key,value);
  put('child','coding-repair:parent',{taskId:'parent',operationId:'op'});
  put('child','host-tool-intent',{commandId:'op',toolName:'workflow.host.f16_n01',arguments:{},deadline});
  put('parent','owned-workflow:intent:op',{taskId:'parent',workflowId:'F16',sessionId:'session',deadline,
    proposal:{nodeId:'F16_N01',operationId:'op',toolName:'workflow.host.f16_n01',arguments:{}}});
  const names=['github.actions.run.list','github.actions.job.list','github.actions.log.read'];
  const args=[{repo:'owner/repo',page:1,status:'failure'},{repo:'owner/repo',runId:7},{repo:'owner/repo',runId:7,jobId:8}];
  const records=names.map((toolName,i)=>({taskId:'source',evidenceId:`read${i}`,toolName,toolVersion:'1',policyDecision:'allow',executionStarted:true,state:'confirmed'}));
  const sources=args.map((arguments_,i)=>({taskId:'source',runId:`read${i}`,toolVersion:'1',scopeRef:'grant',arguments:arguments_}));
  put('source','tool-result-read0',{result:{items:[{id:7,status:'completed',conclusion:'failure',headSha:head}]}});
  put('source','tool-result-read1',{result:{items:[{id:8,runId:7,conclusion:'failure'}]}});
  put('source','tool-result-read2',{result:{text:'synthetic test failure',truncated:false}});
  const runtime={getTask:id=>id==='parent'?{state:'running'}:{evidenceRefs:['read0','read1','read2']},
    loadCheckpoint:(id,key)=>checkpoints.get(id+'|'+key),readToolExecutions:()=>records,
    matchesToolExecutionInput:(record,input)=>input.scopeRef==='grant'&&input.arguments===args[Number(record.evidenceId.at(-1))]};
  const binding={repo:'owner/repo',headSha:head,runId:7,jobId:8,runList:sources[0],jobList:sources[1],logRead:sources[2]};
  let saved,currentHead=head,allowed=true;
  const options={application:{runtime,readHostToolTask:()=>({commandId:'op',toolName:'workflow.host.f16_n01',task:{state:saved?'succeeded':'running'},
    confirmed:saved?{runId:context.runId,evidenceRefs:[context.runId],result:saved}:undefined})},requiredScopes:['ci:read'],now:()=>new Date(now),
    assertCurrent:()=>{},resolveFailure:async()=>binding,readCurrentHead:async()=>currentHead,authorizeExport:async()=>allowed};
  return {context,options,binding,records,put,complete:value=>saved=value,head:value=>currentHead=value,deny:()=>allowed=false};
}
test('F16 host does not register without original source and export ports',()=>{
  const f=fixture();for(const key of ['resolveFailure','readCurrentHead','authorizeExport','assertCurrent']){
    const missing={...f.options};delete missing[key];assert.equal(createRuntimeF16CiFailureHost(missing).tools.length,0);
  }
});
test('F16 exports only a confirmed failed run and exact host receipt',async()=>{
  const f=fixture(),host=createRuntimeF16CiFailureHost(f.options),result=await host.tools[0].execute({},f.context);
  assert.equal(result.errorClass,'unknown');assert.equal(result.logSnippet,'synthetic test failure');
  await assert.rejects(host.authorizeReceipt({context:f.context,result}),{code:'UNAUTHORIZED'});
  f.complete(result);await host.authorizeReceipt({context:f.context,result});
  await assert.rejects(host.authorizeReceipt({context:f.context,result:{...result,logSnippet:'forged'}}),{code:'UNAUTHORIZED'});
});
test('F16 rejects changed head, unauthorized source and denied log egress',async()=>{
  const f=fixture(),host=createRuntimeF16CiFailureHost(f.options);f.head('b'.repeat(40));
  await assert.rejects(host.tools[0].execute({},f.context),{code:'REVISION_CONFLICT'});
  f.head(f.binding.headSha);f.records[2].policyDecision='deny';await assert.rejects(host.tools[0].execute({},f.context),{code:'UNAUTHORIZED'});
  f.records[2].policyDecision='allow';f.deny();await assert.rejects(host.tools[0].execute({},f.context),{code:'UNAUTHORIZED'});
});
test('F16 rejects nonfailed runs, unrelated jobs and missing logs',async()=>{
  const f=fixture(),host=createRuntimeF16CiFailureHost(f.options);
  f.put('source','tool-result-read0',{result:{items:[{id:7,status:'completed',conclusion:'success',headSha:f.binding.headSha}]}});
  await assert.rejects(host.tools[0].execute({},f.context),{code:'UNSUPPORTED_CAPABILITY'});
  f.put('source','tool-result-read0',{result:{items:[{id:7,status:'completed',conclusion:'failure',headSha:f.binding.headSha}]}});
  f.put('source','tool-result-read1',{result:{items:[{id:8,runId:9,conclusion:'failure'}]}});
  await assert.rejects(host.tools[0].execute({},f.context),{code:'UNSUPPORTED_CAPABILITY'});
});
