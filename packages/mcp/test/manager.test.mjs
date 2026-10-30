import assert from 'node:assert/strict';
import test from 'node:test';
import {createMcpConnectionManager,remoteMcpDirectoryDigest,remoteMcpArgumentsDigest} from '../dist/index.js';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {fixture,endpoint,descriptor,directory} from './remote-http-fixture.mjs';

test('two independently managed servers still require original Policy and release separately',async()=>{
  const a=await fixture(),b=await fixture(),policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});
  const manager=createMcpConnectionManager(gateway),receipts=new Map();
  const options=(id,f)=>{const binding={configurationRef:'config-'+id,revision:1,directoryDigest:remoteMcpDirectoryDigest(directory())};
    return {endpoint,server:{name:'synthetic-reference',version:'1.0.0'},
      tool:{remoteName:'reference',descriptor:{...descriptor,name:'mcp.remote.'+id}},binding,
      readCurrentBinding:()=>binding,readRunReceipt:query=>receipts.get(JSON.stringify([query.taskId,query.runId])),fetch:f.fetch};};
  const deadline=()=>new Date(Date.now()+20000).toISOString();const signal=()=>new AbortController().signal;
  try{
    await manager.add('a',options('a',a));await manager.add('b',options('b',b));
    await assert.rejects(manager.add('a',options('a',a)),{code:'INVALID_ARGUMENT'});
    await assert.rejects(manager.add('duplicate-tool',options('a',a)),{code:'REVISION_CONFLICT'});
    assert.deepEqual(manager.list(),['a','b']);
    await assert.rejects(manager.add('missing-reader',{...options('c',a),readRunReceipt:undefined}),{code:'INVALID_ARGUMENT'});
    await manager.connect('a',{signal:signal(),deadline:deadline()});await manager.connect('b',{signal:signal(),deadline:deadline()});
    assert.deepEqual(manager.list(),['a','b']);assert.equal(a.calls().length+b.calls().length,0);
    const args={bindingRef:manager.currentConfigurationRef('a'),arguments:{key:'public'}};
    const invocation={taskId:'task-a',runId:'run-a',authorizationRef:'run-a',toolName:'mcp.remote.a',toolVersion:'1.0.0',
      arguments:args,deadline:deadline(),signal:signal()};
    await assert.rejects(gateway.invoke(invocation),{code:'UNAUTHORIZED'});assert.equal(a.calls().length,0);
    policy.grant({authorizationRef:'run-a',taskId:'task-a',toolName:'mcp.remote.a',scopes:descriptor.requiredScopes,
      argumentsDigest:toolArgumentsDigest(args),maxUses:1,expiresAt:invocation.deadline});
    assert.deepEqual(await gateway.invoke(invocation),{text:'public synthetic reference'});
    assert.equal(a.calls().length,1);assert.equal(b.calls().length,0);
    await manager.remove('a');assert.equal(manager.health('b').connected,true);
    assert.deepEqual(gateway.list().map(value=>value.name),['mcp.remote.b']);
    await assert.rejects(gateway.invoke(invocation),{code:'UNSUPPORTED_CAPABILITY'});
    await manager.disconnect('b');assert.equal(manager.health('b').connected,false);
  }finally{await manager.dispose();await a.close();await b.close();}
  assert.deepEqual(gateway.list(),[]);
});

test('recreated service honors an original unknown Runtime receipt and never resends its run',async()=>{
  const f=await fixture({drop:true}),policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});
  const manager=createMcpConnectionManager(gateway),binding={configurationRef:'config-a',revision:1,directoryDigest:remoteMcpDirectoryDigest(directory())};
  let receipt;
  const options={endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor},binding,
    readCurrentBinding:()=>binding,readRunReceipt:()=>receipt,fetch:f.fetch};
  const deadline=()=>new Date(Date.now()+20000).toISOString(),signal=()=>new AbortController().signal;
  try{
    await manager.add('a',options);await manager.connect('a',{signal:signal(),deadline:deadline()});
    const args={bindingRef:manager.currentConfigurationRef('a'),arguments:{key:'public'}};
    const call={taskId:'original-task',runId:'original-run',authorizationRef:'grant-1',toolName:descriptor.name,toolVersion:descriptor.version,
      arguments:args,deadline:deadline(),signal:signal()};
    const grant=ref=>policy.grant({authorizationRef:ref,taskId:call.taskId,toolName:call.toolName,scopes:descriptor.requiredScopes,
      argumentsDigest:toolArgumentsDigest(args),maxUses:1,expiresAt:call.deadline});
    grant('grant-1');await assert.rejects(gateway.invoke(call));assert.equal(f.calls().length,1);
    receipt={argumentsDigest:remoteMcpArgumentsDigest(args.arguments),state:'unknown'};
    await manager.remove('a');delete f.mode.drop;
    await manager.add('a',options);await manager.connect('a',{signal:signal(),deadline:deadline()});
    grant('grant-2');await assert.rejects(gateway.invoke({...call,authorizationRef:'grant-2'}),{code:'RESULT_UNKNOWN'});
    assert.equal(f.calls().length,1);
  }finally{await manager.dispose();await f.close();}
});

test('changing a managed server identity cannot reuse its previous approval binding',async()=>{
  const f=await fixture(),policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy}),manager=createMcpConnectionManager(gateway);
  const binding={configurationRef:'same-config',revision:1,directoryDigest:remoteMcpDirectoryDigest(directory())};
  const options={endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor},binding,
    readCurrentBinding:()=>binding,readRunReceipt:()=>undefined,fetch:f.fetch};
  const deadline=()=>new Date(Date.now()+20000).toISOString(),signal=()=>new AbortController().signal;
  try{
    await manager.add('server-a',options);await manager.connect('server-a',{signal:signal(),deadline:deadline()});
    const old={bindingRef:manager.currentConfigurationRef('server-a'),arguments:{key:'public'}};
    const call={taskId:'task',runId:'run',authorizationRef:'old-grant',toolName:descriptor.name,toolVersion:descriptor.version,
      arguments:old,deadline:deadline(),signal:signal()};
    policy.grant({authorizationRef:call.authorizationRef,taskId:call.taskId,toolName:call.toolName,scopes:descriptor.requiredScopes,
      argumentsDigest:toolArgumentsDigest(old),maxUses:1,expiresAt:call.deadline});
    await manager.remove('server-a');await manager.add('server-b',options);
    await manager.connect('server-b',{signal:signal(),deadline:deadline()});
    assert.notEqual(manager.currentConfigurationRef('server-b'),old.bindingRef);
    await assert.rejects(gateway.invoke(call),{code:'INVALID_ARGUMENT'});
    assert.equal(policy.get(call.authorizationRef).usesRemaining,1);assert.equal(f.calls().length,0);
  }finally{await manager.dispose();await f.close();}
});
