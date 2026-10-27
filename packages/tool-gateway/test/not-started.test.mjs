import assert from 'node:assert/strict';
import test from 'node:test';
import {ProtocolError,ToolNotStartedError,isToolNotStartedError} from '@personal-agent/contracts';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {ToolGateway,toolArgumentsDigest} from '../dist/index.js';

function fixture(execute){
  const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});
  const descriptor={name:'fixture.desktop.write',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'},
    sideEffect:'external_write',requiredScopes:['fixture:control'],requiresPresence:false,idempotencySupport:false,recoverySupport:false};
  gateway.register({descriptor,execute});
  policy.grant({authorizationRef:'grant',taskId:'task',toolName:descriptor.name,scopes:['fixture:control'],
    argumentsDigest:toolArgumentsDigest({}),expiresAt:new Date(Date.now()+60000).toISOString(),maxUses:1});
  return {gateway,input:{taskId:'task',runId:'run',toolName:descriptor.name,toolVersion:'1.0.0',arguments:{},authorizationRef:'grant',
    signal:new AbortController().signal,deadline:new Date(Date.now()+30000).toISOString()}};
}
test('trusted preflight proof propagates without claiming an unknown external write',async()=>{
  const refusal=new ToolNotStartedError('UNAUTHORIZED','Target changed before device dispatch');const f=fixture(async()=>{throw refusal;});
  await assert.rejects(f.gateway.invoke(f.input),error=>error===refusal);
});
test('ordinary error and wire-like objects cannot forge a not-started proof',async()=>{
  for(const error of [new ProtocolError('UNAUTHORIZED','looks like preflight'),{name:'ToolNotStartedError',code:'UNAUTHORIZED',dispatched:false},
    Object.assign(Object.create(ToolNotStartedError.prototype),{code:'UNAUTHORIZED',message:'forged prototype'})]){
    const f=fixture(async()=>{throw error;});await assert.rejects(f.gateway.invoke(f.input),{code:'RESULT_UNKNOWN'});
  }
});

test('a not-started proof is identity-bound and never inspects a hostile prototype',async()=>{
  let traps=0;
  const hostile=new Proxy({},{getPrototypeOf(){traps++;throw Error('private prototype trap');}});
  const revoked=Proxy.revocable({},{});revoked.revoke();
  for(const error of [hostile,revoked.proxy,Object.create(hostile)]){
    assert.equal(isToolNotStartedError(error),false);
    const f=fixture(async()=>{throw error;});await assert.rejects(f.gateway.invoke(f.input),{code:'RESULT_UNKNOWN'});
  }
  assert.equal(traps,0);
  assert.equal(isToolNotStartedError(new ToolNotStartedError('UNAUTHORIZED','trusted executor refusal')),true);
});
test('cancellation wins over a late not-started claim',async()=>{
  const controller=new AbortController(),f=fixture(async()=>{controller.abort();throw new ToolNotStartedError('CANCELLED','late refusal');});
  await assert.rejects(f.gateway.invoke({...f.input,signal:controller.signal}),{code:'RESULT_UNKNOWN'});
});
