import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
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
  const records=names.map((toolName,i)=>({taskId:'source'+i,evidenceId:`host-tool-source${i}`,toolName,toolVersion:'1',policyDecision:'allow',executionStarted:true,state:'confirmed'}));
  const sources=args.map((arguments_,i)=>({taskId:'source'+i,runId:`host-tool-source${i}`,toolVersion:'1',scopeRef:`host-tool-source${i}`,arguments:arguments_}));
  for(let i=0;i<3;i++){
    const request={commandId:'read'+i,toolName:names[i],toolVersion:'1',arguments:args[i],deadline};
    put('source'+i,'coding-repair:parent',{taskId:'parent',operationId:'read'+i});
    put('source'+i,'host-tool-intent',request);
    put('parent','coding-repair:host:read'+i,{localTaskId:'source'+i,request});
  }
  put('source0','tool-result-host-tool-source0',{result:{items:[{id:7,status:'completed',conclusion:'failure',headSha:head}]}});
  put('source1','tool-result-host-tool-source1',{result:{items:[{id:8,runId:7,status:'completed',conclusion:'failure'}]}});
  put('source2','tool-result-host-tool-source2',{result:{text:'synthetic test failure',truncated:false}});
  const runtime={getTask:id=>id==='parent'?{state:'running'}:{evidenceRefs:['host-tool-'+id]},
    saveCheckpointOnce:(id,key,value)=>{if(!checkpoints.has(id+'|'+key))put(id,key,structuredClone(value));},
    loadCheckpoint:(id,key)=>checkpoints.get(id+'|'+key),readToolExecutions:()=>records,
    matchesToolExecutionInput:(record,input)=>input.scopeRef===record.evidenceId&&isDeepStrictEqual(input.arguments,args[Number(record.evidenceId.at(-1))])};
  const binding={repo:'owner/repo',headSha:head,runId:7,jobId:8,runList:sources[0],jobList:sources[1],logRead:sources[2]};
  let saved,currentHead=head,allowed=true;
  const options={application:{runtime,readHostToolTask:id=>id.startsWith('source')?{
    commandId:'read'+id.at(-1),toolName:names[Number(id.at(-1))],toolVersion:'1',task:{taskId:id,state:'succeeded',evidenceRefs:['host-tool-'+id]},
    confirmed:{runId:'host-tool-'+id,evidenceRefs:['host-tool-'+id],result:runtime.loadCheckpoint(id,'tool-result-host-tool-'+id).result}}:
    ({commandId:'op',toolName:'workflow.host.f16_n01',toolVersion:'1.0.0',task:{taskId:'child',state:saved?'succeeded':'running'},
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
  f.put('source0','tool-result-host-tool-source0',{result:{items:[{id:7,status:'completed',conclusion:'success',headSha:f.binding.headSha}]}});
  await assert.rejects(host.tools[0].execute({},f.context),{code:'UNSUPPORTED_CAPABILITY'});
  f.put('source0','tool-result-host-tool-source0',{result:{items:[{id:7,status:'completed',conclusion:'failure',headSha:f.binding.headSha}]}});
  f.put('source1','tool-result-host-tool-source1',{result:{items:[{id:8,runId:9,status:'completed',conclusion:'failure'}]}});
  await assert.rejects(host.tools[0].execute({},f.context),{code:'UNSUPPORTED_CAPABILITY'});
});
