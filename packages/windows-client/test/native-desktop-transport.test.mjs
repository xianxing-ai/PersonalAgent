import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {ProtocolError,isToolNotStartedError,parseResponse} from '@personal-agent/contracts';
import {AuthorizationPolicy} from '@personal-agent/policy';
import {TaskRuntime} from '@personal-agent/runtime';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createWindowsNativeDesktopControlHost} from '../dist/index.js';
import {nativeDesktopResponseError} from '../dist/native-desktop-transport.js';

const responseFor=error=>({kind:'response',protocolVersion:'1.0.0',requestId:'synthetic-error',outcome:'error',
  error:{code:error.code,message:error.message,retryable:false},evidenceRefs:[]});

test('synthetic stdio refusals map only allowlisted native codes into the public Error schema',()=>{
  const expected={USER_TAKEOVER:'REVISION_CONFLICT',TARGET_STALE:'REVISION_CONFLICT',TARGET_AMBIGUOUS:'REVISION_CONFLICT',
    RESOURCE_BUSY:'REVISION_CONFLICT',REVISION_CONFLICT:'REVISION_CONFLICT',UNAUTHORIZED:'UNAUTHORIZED',
    UNSUPPORTED_CAPABILITY:'UNSUPPORTED_CAPABILITY',INVALID_ARGUMENT:'INVALID_ARGUMENT',PROTOCOL_MISMATCH:'PROTOCOL_MISMATCH',
    CANCELLED:'CANCELLED',TIMEOUT:'TIMEOUT',EXTERNAL_FAILURE:'EXTERNAL_FAILURE'};
  for(const [native,code]of Object.entries(expected)){
    const error=nativeDesktopResponseError({code:native,dispatched:false,message:'synthetic-private-path-and-secret'});
    assert.equal(error.code,code);assert.equal(isToolNotStartedError(error),true);
    assert(error.message.includes('[native='+native+']'));assert.doesNotMatch(error.message,/synthetic-private/);
    assert.deepEqual(parseResponse(responseFor(error),'tool.invoke','synthetic-error'),responseFor(error));
  }
  for(const code of ['UNKNOWN_INTERNAL','__proto__','constructor','PRIVATE_PATH synthetic-private',null,17,undefined]){
    const error=nativeDesktopResponseError({code,dispatched:false,message:'synthetic-private'});
    assert.equal(error.code,'PROTOCOL_MISMATCH');assert.equal(isToolNotStartedError(error),true);
    assert.match(error.message,/native=UNRECOGNIZED/);assert.doesNotMatch(error.message,/synthetic-private|UNKNOWN_INTERNAL|__proto__|constructor/);
    parseResponse(responseFor(error),'tool.invoke','synthetic-error');
  }
});

test('a dispatched, ambiguous or contradictory native response never produces zero-dispatch proof',()=>{
  for(const dispatched of [true,undefined,null,0,'false']){
    const error=nativeDesktopResponseError({code:'USER_TAKEOVER',dispatched,message:'synthetic-private'});
    assert.equal(error.code,'RESULT_UNKNOWN');assert.equal(isToolNotStartedError(error),false);
    assert.doesNotMatch(error.message,/synthetic-private/);parseResponse(responseFor(error),'tool.invoke','synthetic-error');
  }
  const contradiction=nativeDesktopResponseError({code:'RESULT_UNKNOWN',dispatched:false});
  assert.equal(contradiction.code,'RESULT_UNKNOWN');assert.equal(isToolNotStartedError(contradiction),false);
});

// Native stdio is an explicit synthetic seam; Gateway, SQLite Policy, TaskRuntime,
// public response parsing and persisted execution records below are the actual implementations.
test('mapped native refusal survives real Gateway and SQLite Runtime without a second INVALID_ARGUMENT',async()=>{
  const base=fileURLToPath(new URL('../../../.cache/native-error-contract/',import.meta.url));await mkdir(base,{recursive:true});
  for(const dispatched of [false,true,undefined]){
    const database=path.join(await mkdtemp(path.join(base,'case-')),'runtime.sqlite');
    const windowRef=randomUUID(),deadline=new Date(Date.now()+60000).toISOString();let ready=false,activateCalls=0,gateway,runtime;
    const transport={async start(){ready=true;},isReady:()=>ready,async stop(){ready=false;},async close(){ready=false;},
      async request(method){
        if(method==='list_windows')return {windows:[{windowRef,title:'Synthetic fixture',processName:'SyntheticFixture'}]};
        assert.equal(method,'activate');activateCalls++;
        throw nativeDesktopResponseError({code:'USER_TAKEOVER',dispatched,message:'synthetic-private-provider-message'});
      }};
    const host=createWindowsNativeDesktopControlHost({transport,authorizePresence:async()=>true,attempts:{async record(identity,execution){
      const run=runtime.readToolExecutions(identity.taskId).find(item=>item.evidenceId===identity.runId);
      assert(run&&run.state==='started'&&run.policyDecision==='allow'&&run.executionStarted);
      assert(runtime.matchesToolExecutionInput(run,{arguments:execution.arguments,scopeRef:identity.authorizationRef}));
      assert(runtime.saveCheckpointOnce(identity.taskId,'synthetic-native-attempt:'+identity.runId,identity));
    }}});
    runtime=new TaskRuntime(database,{createToolGateway:policy=>{
      assert(policy instanceof AuthorizationPolicy);gateway=new ToolGateway({policy});
      for(const tool of host.tools)gateway.register(tool);
      // Trusted synthetic host presence injection, identical to Runtime Application composition.
      return {list:()=>gateway.list(),invoke:input=>gateway.invoke({...input,userPresent:true})};
    }});
    let id,records,task;
    try{
      await host.start({signal:new AbortController().signal,deadline});
      id=runtime.submitTask({goal:'Synthetic native refusal contract',conversationId:'synthetic-native-error',idempotencyKey:randomUUID()}).taskId;
      const invoke=async(name,args,signal)=>{
        const toolName='computer.desktop.'+name,grant='synthetic-grant-'+name,requestId='synthetic-request-'+name;
        runtime.policy.grant({authorizationRef:grant,taskId:id,toolName,scopes:['computer:desktop:control'],
          expiresAt:deadline,maxUses:1,argumentsDigest:toolArgumentsDigest(args)});
        const response=await runtime.send({kind:'request',protocolVersion:'1.0.0',requestId,taskId:id,idempotencyKey:'synthetic-run-'+name,
          deadline,operation:'tool.invoke',payload:{toolName,toolVersion:'1.0.0',arguments:args,scopeRef:grant}},signal);
        assert.deepEqual(parseResponse(response,'tool.invoke',requestId),response);
        if(response.outcome==='error')throw new ProtocolError(response.error.code,response.error.message);
        return response.data;
      };
      task=await runtime.runTask(id,async context=>{
        context.declareRuntimeToolTracking();
        const listed=await invoke('list_windows',{},context.signal);assert.equal(listed.result.windows[0].windowRef,windowRef);
        const activation=await invoke('activate',{windowRef},context.signal);
        assert.equal(activation.state,'unknown');return {resultSummary:'Synthetic unknown requires reconciliation'};
      },{deadline,sideEffect:'external_write'});
      records=runtime.readToolExecutions(id);assert.equal(records.length,2);assert(gateway instanceof ToolGateway);
      const run=records.find(item=>item.toolName==='computer.desktop.activate');assert.equal(activateCalls,1);
      assert.equal(run.executionStarted,dispatched!==false);assert.equal(run.state,dispatched===false?'failed':'unknown');
      assert.equal(run.policyDecision,dispatched===false?'deny':'allow');assert.equal(run.errorCode,dispatched===false?'REVISION_CONFLICT':'RESULT_UNKNOWN');
      assert.equal(task.state,dispatched===false?'failed':'waiting_reconciliation');
      if(dispatched===false){
        assert.equal(task.error.code,'REVISION_CONFLICT');assert.match(task.error.message,/native=USER_TAKEOVER/);
        assert.match(task.error.message,/非本组件的输入变化/);assert.doesNotMatch(task.error.message,/synthetic-private|public schema/);
        assert.equal(host.health().state,'ready');
      }else assert.equal(host.health().state,'blocked');
    }finally{await host.dispose();runtime.close();}
    const reopened=new TaskRuntime(database);
    try{assert.deepEqual(reopened.readToolExecutions(id),records);assert.equal(reopened.getTask(id).state,task.state);}
    finally{reopened.close();}
  }
});
