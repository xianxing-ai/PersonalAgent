import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TaskRuntime} from '@personal-agent/runtime';
import {ToolGateway} from '@personal-agent/tool-gateway';
import {ProtocolError} from '@personal-agent/contracts';
import {errorDisplay} from '../src/shared/error-display.js';

const secret='SYNTHETIC_PRIVATE_GETTER';
const future=()=>new Date(Date.now()+60000).toISOString();
const cases=[
  ...['code','status','message','retryable','retryAfterMs'].map(key=>[`${key} getter`,touch=>Object.defineProperty(new ProtocolError('RATE_LIMITED','private body',true,2000),key,{get(){touch();throw Error(secret);}})]),
  ...['get','has','getOwnPropertyDescriptor','getPrototypeOf'].map(trap=>[`${trap} proxy`,touch=>new Proxy(new ProtocolError('RATE_LIMITED','private body',true,2000),{[trap](){touch();throw Error(secret);}})]),
  ['revoked proxy',()=>{const {proxy,revoke}=Proxy.revocable({},{});revoke();return proxy;}],
  ['hostile prototype',touch=>Object.create(new Proxy({},{getPrototypeOf(){touch();throw Error(secret);}}))],
];
const descriptor={name:'synthetic.hostile',version:'1',inputSchema:{type:'object'},outputSchema:{type:'object'},requiredScopes:['synthetic:invoke'],idempotencySupport:true,recoverySupport:true,requiresPresence:false};

test('hostile thrown diagnostics cross real Gateway and SQLite Runtime without changing unknown writes into failed executions',async t=>{
  const root=fileURLToPath(new URL('../../../.cache/hostile-tool-errors/',import.meta.url));mkdirSync(root,{recursive:true});
  for(const [label,create]of cases)for(const sideEffect of ['read','external_write'])await t.test(`${label}/${sideEffect}`,async()=>{
    let calls=0,touches=0;const cause=create(()=>touches++);
    const runtime=new TaskRuntime(join(mkdtempSync(join(root,'case-')),'runtime.sqlite'),{createToolGateway:policy=>{
      const gateway=new ToolGateway({policy});gateway.register({descriptor:{...descriptor,sideEffect},execute:async()=>{calls++;throw cause;}});return gateway;
    }});
    try{
      const task=runtime.submitTask({goal:'Synthetic hostile exception',conversationId:'synthetic',idempotencyKey:'task'});
      runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
      runtime.policy.grant({authorizationRef:'grant',taskId:task.taskId,toolName:descriptor.name,scopes:descriptor.requiredScopes,expiresAt:future(),maxUses:1});
      const request={kind:'request',protocolVersion:'1.0.0',requestId:crypto.randomUUID(),taskId:task.taskId,idempotencyKey:'original-operation',deadline:future(),operation:'tool.invoke',payload:{toolName:descriptor.name,toolVersion:'1',arguments:{},scopeRef:'grant'}};
      const response=await runtime.send(request,new AbortController().signal);
      const execution=runtime.readToolExecutions(task.taskId)[0];
      assert.equal(calls,1);assert.equal(execution.errorCode,sideEffect==='read'?'EXTERNAL_FAILURE':'RESULT_UNKNOWN');
      if(sideEffect==='external_write'){
        assert.equal(execution.state,'unknown');assert.equal(runtime.getTask(task.taskId).state,'waiting_reconciliation');
        assert.equal(runtime.getTask(task.taskId).error.retryable,false);
        await runtime.send({...request,requestId:crypto.randomUUID()},new AbortController().signal);assert.equal(calls,1);
      }else{assert.equal(response.outcome,'error');assert.equal(response.error.code,'EXTERNAL_FAILURE');assert.equal(response.error.retryable,false);}
      assert.doesNotMatch(JSON.stringify({response,task:runtime.getTask(task.taskId),execution,evidence:runtime.readEvidence(task.taskId)}),/SYNTHETIC_PRIVATE_GETTER|private body/);
      if(label!=='hostile prototype')assert.equal(touches,0,'accessors and proxy traps must never run');
    }finally{runtime.close();}
  });
});

test('Desktop formatter never invokes exception getters or property/prototype lookups',()=>{
  for(const [label,create]of cases){
    let touches=0;const cause=create(()=>touches++);let result;
    assert.doesNotThrow(()=>{result=errorDisplay(cause,'ipc');},label);
    assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE_GETTER|private body/);
    if(label!=='getOwnPropertyDescriptor proxy')assert.equal(touches,0,label);
  }
  let touches=0;
  const error=Object.defineProperty({code:'RATE_LIMITED'},'errorId',{get(){touches++;throw Error(secret);}});
  assert.equal(errorDisplay(error,'ipc').code,'EXTERNAL_FAILURE');assert.equal(touches,0);
});
