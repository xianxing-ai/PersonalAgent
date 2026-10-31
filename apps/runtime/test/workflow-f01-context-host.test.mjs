import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeF01ContextHost} from '../dist/application/workflow-f01-context-host.js';
import {createF01QueryBinding} from '../dist/application/workflow-f01-query-binding.js';
import {TaskRuntime} from '../dist/index.js';

// Synthetic host ports: no real user memory, model, cloud, or Policy grant.
function fixture(){
  const now=Date.now(),deadline=new Date(now+60_000).toISOString(),signal=new AbortController().signal;
  let allowed=true,version=1,exportAllowed=true,changeDuringExport=false,result,ownerState='running';
  const original={ref:{id:'synthetic-fact',revision:1},summary:'Synthetic public fact',sourceRef:'synthetic-source',
    observedAt:new Date(now-1000).toISOString(),validFrom:new Date(now-1000).toISOString(),validUntil:new Date(now+60_000).toISOString(),
    sensitivity:'public',state:'active',confirmation:'user_confirmed'};
  const checkpoints=new Map(),put=(id,key,value)=>checkpoints.set(id+'|'+key,value);
  put('child','coding-repair:parent',{taskId:'parent',operationId:'operation'});
  put('child','host-tool-intent',{commandId:'operation',toolName:'workflow.host.f01_n02',arguments:{},deadline});
  put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F01',sessionId:'session',deadline,
    proposal:{nodeId:'F01_N02',operationId:'operation',toolName:'workflow.host.f01_n02',arguments:{}}});
  const app={runtime:{loadCheckpoint:(id,key)=>checkpoints.get(id+'|'+key),getTask:()=>({state:ownerState,cancelRequested:false})},
    readHostToolTask:()=>({commandId:'operation',toolName:'workflow.host.f01_n02',task:{state:'succeeded'},
      confirmed:{runId:'host-tool-child',result,evidenceRefs:['host-tool-child']}})};
  const memory={listCurrent:async()=>({snapshot:'synthetic-snapshot',facts:[{...original,ref:{...original.ref,revision:version}}]}),
    getVersion:async()=>original};
  const context={taskId:'child',runId:'host-tool-child',authorizationRef:'synthetic-grant',scopes:['synthetic:read'],deadline,signal};
  const options={application:app,memory,requiredScopes:['synthetic:read'],now:()=>new Date(now),
    assertCurrent:()=>{if(!allowed)throw Error('Synthetic revoked');},resolveQuery:async()=>({factId:'synthetic-fact',limit:5}),
    readResponsibilities:async()=>({revision:'synthetic-responsibilities',items:[{id:'synthetic-responsibility',revision:1,
      authority:'explicit_instruction',sourceQuotes:[{conversationId:'synthetic',messageId:'synthetic',quoteRef:'synthetic',sha256:'a'.repeat(64)}]}]}),
    readModels:async()=>({revision:'synthetic-models',models:[{id:'synthetic-model',verification:'conditional',
      capabilities:{text:true,streaming:false,toolCalling:false,structuredOutput:false,vision:false}}]}),
    authorizeExport:async()=>{if(changeDuringExport)version++;return exportAllowed;}};
  const host=createRuntimeF01ContextHost(options),tool=host.tools[0];
  return {host,tool,context,options,put,setResult:value=>{result=value;},revoke:()=>{allowed=false;},
    update:()=>{version++;},denyExport:()=>{exportAllowed=false;},changeDuringExport:()=>{changeDuringExport=true;},
    waitReconciliation:()=>{ownerState='waiting_reconciliation';}};
}

test('F01 context is unavailable when any real composition port is missing',()=>{
  const f=fixture();for(const key of ['memory','readResponsibilities','readModels','resolveQuery','authorizeExport','assertCurrent']){
    const options={...f.options};delete options[key];assert.deepEqual(createRuntimeF01ContextHost(options).tools,[]);
  }
});
test('F01 reads only the bound original HostTask and exports only its confirmed result',async()=>{
  const f=fixture(),value=await f.tool.execute({},f.context);f.setResult(value);
  assert.equal(value.memory.facts[0].ref.id,'synthetic-fact');assert.equal(value.models.models[0].verification,'conditional');
  await f.host.authorizeReceipt({context:f.context,result:value});
  await assert.rejects(f.tool.execute({factId:'cloud-selected'},f.context));
  await assert.rejects(f.host.authorizeReceipt({context:f.context,result:{...value,extra:'forged'}}));
  f.revoke();await assert.rejects(f.host.authorizeReceipt({context:f.context,result:value}));
});
test('F01 refuses foreign graph, missing scopes, stale facts and change during export consent',async()=>{
  const f=fixture(),value=await f.tool.execute({},f.context);f.setResult(value);
  await assert.rejects(f.tool.execute({}, {...f.context,scopes:[]}));
  await assert.rejects(f.tool.execute({}, {...f.context,deadline:'invalid'}),{code:'TIMEOUT'});
  f.put('parent','owned-workflow:intent:operation',{taskId:'parent',workflowId:'F02'});
  await assert.rejects(f.tool.execute({},f.context));
  const g=fixture(),stale=await g.tool.execute({},g.context);g.setResult(stale);g.update();
  await assert.rejects(g.host.authorizeReceipt({context:g.context,result:stale}),{code:'REVISION_CONFLICT'});
  const h=fixture(),late=await h.tool.execute({},h.context);h.setResult(late);h.changeDuringExport();
  await assert.rejects(h.host.authorizeReceipt({context:h.context,result:late}),{code:'REVISION_CONFLICT'});
  const unknown=fixture();unknown.waitReconciliation();await assert.rejects(unknown.tool.execute({},unknown.context));
});
test('F01 refuses non-public memory and missing or denied export',async()=>{
  const f=fixture();f.options.memory.listCurrent=async()=>({snapshot:'s',facts:[{ref:{id:'x',revision:1},sensitivity:'private'}]});
  await assert.rejects(f.tool.execute({},f.context));
  const g=fixture(),value=await g.tool.execute({},g.context);g.setResult(value);g.denyExport();
  await assert.rejects(g.host.authorizeReceipt({context:g.context,result:value}),{code:'UNAUTHORIZED'});
});

test('F01 host consumes the original selected query and refuses mismatched source results',async()=>{
  const f=fixture(),runtime=new TaskRuntime(':memory:');
  try {
    const user=runtime.submitTask({goal:'Synthetic user-selected source',conversationId:'fixture',idempotencyKey:'f01-selection-user'});
    const selection={selectionId:'native-fixture',parentTaskId:'parent',sessionId:'session',userTaskId:user.taskId,
      factId:'synthetic-fact',sourceRef:'synthetic-source',limit:1};
    let allowed=true;
    const binding=createF01QueryBinding({application:{runtime,readDelegatedUserTaskParent:id=>id==='parent'
      ?{taskId:user.taskId,conversationId:'fixture',deadline:f.context.deadline}:undefined},now:()=>new Date(),
      verifyOriginalSelection:value=>allowed&&JSON.stringify(value)===JSON.stringify(selection)});
    const host=createRuntimeF01ContextHost({...f.options,resolveQuery:binding.resolveQuery});
    await assert.rejects(host.tools[0].execute({},f.context),{code:'UNSUPPORTED_CAPABILITY',message:'F01 trusted source unavailable'});
    binding.recordSelection(selection,undefined,f.context);
    const result=await host.tools[0].execute({},f.context);f.setResult(result);
    await host.authorizeReceipt({context:f.context,result});
    allowed=false;await assert.rejects(host.authorizeReceipt({context:f.context,result}));
    allowed=true;
    const mismatched=createRuntimeF01ContextHost({...f.options,resolveQuery:binding.resolveQuery,
      memory:{...f.options.memory,listCurrent:async()=>({snapshot:'fixture',facts:[{...result.memory.facts[0],sourceRef:'other-source'}]})}});
    await assert.rejects(mismatched.tools[0].execute({},f.context),{code:'EXTERNAL_FAILURE'});
  } finally {runtime.close();}
});

test('F01 preserves unavailable without exposing a trusted source error message',async()=>{
  const f=fixture();
  const {ProtocolError}=await import('@personal-agent/contracts');
  const host=createRuntimeF01ContextHost({...f.options,resolveQuery:async()=>{
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','sensitive fixture source details');
  }});
  await assert.rejects(host.tools[0].execute({},f.context),{code:'UNSUPPORTED_CAPABILITY',message:'F01 trusted source unavailable'});
});
