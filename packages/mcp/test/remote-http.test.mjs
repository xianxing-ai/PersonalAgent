import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createRemoteReadonlyMcpHost} from '../dist/index.js';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {fixture,endpoint,descriptor} from './remote-http-fixture.mjs';

const future=(ms=5000)=>new Date(Date.now()+ms).toISOString();
const signal=()=>new AbortController().signal;
const context=runId=>({taskId:'synthetic-remote-task',runId,authorizationRef:runId,signal:signal(),deadline:future(),scopes:descriptor.requiredScopes});
const invocation=(runId,key='public')=>({...context(runId),toolName:descriptor.name,toolVersion:descriptor.version,arguments:{key}});
const denied=code=>error=>error.code===code && !/private diagnostic|Bearer|synthetic-session/.test(error.message);

test('SDK sends queued before cancellation cannot issue HTTP after the operation has ended',async()=>{
  const {StreamableHTTPClientTransport}=createRequire(import.meta.url)('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const original=StreamableHTTPClientTransport.prototype.send,headers=StreamableHTTPClientTransport.prototype._commonHeaders,queued=[];
  let paused=false;
  let release,reached;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{reached=resolve;});
  // Explicit fixture delays the SDK's existing asynchronous header boundary.
  StreamableHTTPClientTransport.prototype._commonHeaders=function(){
    if(!paused)return headers.call(this);
    reached();return gate.then(()=>headers.call(this));
  };
  StreamableHTTPClientTransport.prototype.send=function(message,options){
    const waiting=original.call(this,message,options);if(paused)queued.push(waiting);return waiting;
  };
  const f=await fixture(),controller=new AbortController();
  try{
    await f.host.start({signal:signal(),deadline:future()});
    const before=f.requests.length;
    paused=true;
    const pending=assert.rejects(f.host.tools[0].execute({key:'public'},{...context('queued-after-cancel'),signal:controller.signal}),denied('CANCELLED'));
    await started;controller.abort();await pending;
    release();await Promise.allSettled(queued);
    assert.equal(f.requests.length,before,JSON.stringify(f.requests.slice(before).map(item=>item.message?.method)));
    assert.equal(f.calls().length,0);
  }finally{release();StreamableHTTPClientTransport.prototype.send=original;StreamableHTTPClientTransport.prototype._commonHeaders=headers;await f.close();}
});

test('remote JSON and SSE reads use existing Gateway/Policy; discovery never registers write tools',async()=>{
  for(const sse of [false,true]){
    const f=await fixture({sse});const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});
    f.host.register(gateway);
    try{
      await f.host.start({signal:signal(),deadline:future()});
      assert.equal(f.host.health().connected,true);assert.equal(f.host.health().protocolVersion,'2025-11-25');
      assert.equal(f.host.health().discoveredTools,2);
      assert.deepEqual(gateway.list().map(x=>x.name),[descriptor.name]);
      await assert.rejects(gateway.invoke(invocation('no-grant')),denied('UNAUTHORIZED'));
      assert.equal(f.calls().length,0);
      const run=invocation('approved');
      policy.grant({authorizationRef:run.runId,taskId:run.taskId,toolName:run.toolName,scopes:descriptor.requiredScopes,argumentsDigest:toolArgumentsDigest(run.arguments),maxUses:1,expiresAt:run.deadline});
      assert.deepEqual(await gateway.invoke(run),{text:'public synthetic reference'});
      assert.equal(policy.get(run.runId).usesRemaining,0);
      await assert.rejects(gateway.invoke(run),denied('UNAUTHORIZED'));
      await assert.rejects(gateway.invoke({...run,toolName:'delete_everything'}),denied('UNSUPPORTED_CAPABILITY'));
      assert.equal(f.calls().length,1);
      assert.equal(f.calls()[0].headers['mcp-session-id'],'synthetic-session');
      assert.equal(f.calls()[0].headers['mcp-protocol-version'],'2025-11-25');
      assert.deepEqual(f.calls()[0].message.params,{name:'reference',arguments:{key:'public'}});
      assert.doesNotMatch(JSON.stringify(f.host.health()),/https:|synthetic-session|synthetic-reference/);
    }finally{await f.close();}
    assert.deepEqual(gateway.list(),[]);
  }
});

test('missing/disabled/unsafe configuration cannot open a connection',async()=>{
  const missing=createRemoteReadonlyMcpHost();assert.equal(missing.health().state,'unavailable');
  await assert.rejects(missing.start({signal:signal(),deadline:future()}),denied('UNSUPPORTED_CAPABILITY'));
  await missing.dispose();
  for(const bad of ['http://remote.example/mcp','https://user:secret@remote.example/mcp','https://remote.example/mcp?token=secret','https://remote.example/mcp#secret']){
    assert.throws(()=>createRemoteReadonlyMcpHost({endpoint:bad,server:{name:'n',version:'v'},tool:{remoteName:'r',descriptor}}),denied('INVALID_ARGUMENT'));
  }
  const disabled=createRemoteReadonlyMcpHost({endpoint,server:{name:'n',version:'v'},tool:{remoteName:'r',descriptor},fetch:()=>assert.fail('unexpected network')});
  assert.equal(disabled.health().state,'disabled');
  await assert.rejects(disabled.start({signal:signal(),deadline:future()}),denied('UNSUPPORTED_CAPABILITY'));await disabled.dispose();
});

test('authentication, redirect, identity and schema drift fail closed without leaking remote diagnostics',async()=>{
  for(const [mode,code] of [[{status:401},'UNAUTHORIZED'],[{status:403},'UNAUTHORIZED'],[{status:302},'EXTERNAL_FAILURE'],[{identity:'impostor'},'PROTOCOL_MISMATCH'],[{schema:{type:'object'}},'PROTOCOL_MISMATCH'],[{cursor:true},'PROTOCOL_MISMATCH']]){
    const f=await fixture(mode);
    try{
      await assert.rejects(f.host.start({signal:signal(),deadline:future()}),error=>{assert.equal(error.code,code,JSON.stringify(mode));return denied(code)(error);});
      assert.equal(f.host.health().connected,false);assert.deepEqual(f.host.health().exposedTools,[]);assert.equal(f.calls().length,0);
    }finally{await f.close();}
  }
});

test('results are schema checked; a failed/unknown run cannot be resent or rebound',async()=>{
  for(const mode of [{drop:true},{result:{content:[],isError:true}},{result:{content:[],structuredContent:{text:3}}}]){
    const f=await fixture(mode);
    try{
      await f.host.start({signal:signal(),deadline:future()});const tool=f.host.tools[0];
      await assert.rejects(tool.execute({key:'public'},context('unknown')));
      assert.equal(f.calls().length,1);
      await f.host.stop();delete f.mode.drop;delete f.mode.result;
      await f.host.start({signal:signal(),deadline:future()});
      await assert.rejects(tool.execute({key:'public'},context('unknown')),denied('RESULT_UNKNOWN'));
      await assert.rejects(tool.execute({key:'changed'},context('unknown')),denied('REVISION_CONFLICT'));
      assert.equal(f.calls().length,1);
      assert.deepEqual(await tool.execute({key:'public'},context('new-run')),{text:'public synthetic reference'});
      assert.equal(f.calls().length,2);
    }finally{await f.close();}
  }
});

test('invalid input, scope, cancellation and expired deadlines send no tool request; oversized replies fail',async()=>{
  const f=await fixture();
  try{
    await f.host.start({signal:signal(),deadline:future()});const tool=f.host.tools[0];
    await assert.rejects(tool.execute({key:'public',shell:'forbidden'},context('invalid')),denied('INVALID_ARGUMENT'));
    await assert.rejects(tool.execute({key:'public'},{...context('scope'),scopes:[]}),denied('UNAUTHORIZED'));
    const aborted=new AbortController();aborted.abort();
    await assert.rejects(tool.execute({key:'public'},{...context('aborted'),signal:aborted.signal}),denied('CANCELLED'));
    await assert.rejects(tool.execute({key:'public'},{...context('expired'),deadline:future(-1000)}),denied('TIMEOUT'));
    assert.equal(f.calls().length,0);
    const first=await tool.execute({key:'public'},context('cache'));
    first.text='caller mutation';
    assert.deepEqual(await tool.execute({key:'public'},context('cache')),{text:'public synthetic reference'});
    assert.equal(f.calls().length,1);
    f.mode.result={content:[],structuredContent:{text:'x'.repeat(1024*1024)}};
    await assert.rejects(tool.execute({key:'public'},context('oversized')));
    assert.equal(f.calls().length,2);
  }finally{await f.close();}
});

test('host lifetime run limit bounds retained results and cannot be reset by reconnecting',async()=>{
  const f=await fixture();
  try{
    await f.host.start({signal:signal(),deadline:future()});const tool=f.host.tools[0];
    for(let i=0;i<63;i++)await tool.execute({key:'public'},context('bounded-'+i));
    f.mode.result={content:[],isError:true};
    await assert.rejects(tool.execute({key:'public'},context('unknown-at-limit')));
    delete f.mode.result;
    assert.equal(f.calls().length,64);
    const before=f.requests.length;
    assert.deepEqual(await tool.execute({key:'public'},context('bounded-0')),{text:'public synthetic reference'});
    await assert.rejects(tool.execute({key:'public'},context('over-limit')),denied('EXTERNAL_FAILURE'));
    await assert.rejects(tool.execute({key:'changed'},context('bounded-0')),denied('REVISION_CONFLICT'));
    assert.equal(f.requests.length,before,'a full cache must reject before network I/O');
    for(let i=0;i<2;i++){
      await f.host.stop();await f.host.start({signal:signal(),deadline:future()});
      const reconnected=f.requests.length;
      await assert.rejects(tool.execute({key:'public'},context('bounded-0')),denied('RESULT_UNKNOWN'));
      await assert.rejects(tool.execute({key:'public'},context('unknown-at-limit')),denied('RESULT_UNKNOWN'));
      await assert.rejects(tool.execute({key:'public'},context('over-limit')),denied('EXTERNAL_FAILURE'));
      await assert.rejects(tool.execute({key:'changed'},context('bounded-0')),denied('REVISION_CONFLICT'));
      assert.equal(f.requests.length,reconnected,'reconnect cannot clear the lifetime limit or replay old runs');
    }
    assert.equal(f.calls().length,64);
  }finally{await f.close();}
});

test('directory revocation on the final retained run preserves its error and disables the connection',async()=>{
  const f=await fixture();
  try{
    await f.host.start({signal:signal(),deadline:future()});
    for(let i=0;i<63;i++)await f.host.tools[0].execute({key:'public'},context('revocation-'+i));
    f.mode.sse=true;f.mode.changed=true;
    await assert.rejects(f.host.tools[0].execute({key:'public'},context('last-revoked')),denied('REVISION_CONFLICT'));
    assert.equal(f.host.health().errorCode,'REVISION_CONFLICT');assert.equal(f.host.health().connected,false);
    assert.equal(f.calls().length,64);
  }finally{await f.close();}
});

test('cancellation, deadline and stop abort active HTTP and do not retry',async()=>{
  for(const reason of ['cancel','deadline','stop']){
    const f=await fixture({delay:300});const controller=new AbortController();
    try{
      await f.host.start({signal:signal(),deadline:future()});
      const pending=assert.rejects(f.host.tools[0].execute({key:'public'},{...context('interrupted'),signal:controller.signal,deadline:future(reason==='deadline'?80:5000)}),denied(reason==='deadline'?'TIMEOUT':'CANCELLED'));
      const observedUntil=Date.now()+2000;
      while(f.calls().length===0 && Date.now()<observedUntil)await new Promise(resolve=>setTimeout(resolve,5));
      assert.equal(f.calls().length,1,'fixture must observe the request before interruption');
      if(reason==='cancel')controller.abort();
      if(reason==='stop')await f.host.stop();
      await pending;assert.equal(f.calls().length,1);
      await f.host.stop();f.mode.delay=0;await f.host.start({signal:signal(),deadline:future()});
      await assert.rejects(f.host.tools[0].execute({key:'public'},context('interrupted')),denied('RESULT_UNKNOWN'));
      assert.equal(f.calls().length,1);
    }finally{await f.close();}
  }
});

test('directory change invalidates the session; concurrent startup is refused; disable/dispose release registrations',async()=>{
  const f=await fixture({sse:true,changed:true});const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});f.host.register(gateway);
  try{
    const starting=f.host.start({signal:signal(),deadline:future()});
    await assert.rejects(f.host.start({signal:signal(),deadline:future()}),denied('REVISION_CONFLICT'));await starting;
    await assert.rejects(f.host.tools[0].execute({key:'public'},context('directory-changed')));
    assert.equal(f.host.health().connected,false);assert.deepEqual(f.host.health().exposedTools,[]);
    await f.host.setEnabled(false);assert.equal(f.host.health().state,'disabled');
    await assert.rejects(f.host.start({signal:signal(),deadline:future()}),denied('UNSUPPORTED_CAPABILITY'));
    await f.host.setEnabled(true);f.mode.changed=false;await f.host.start({signal:signal(),deadline:future()});
    assert.equal(f.host.health().connected,true);
  }finally{await f.close();}
  assert.equal(f.host.health().state,'disposed');assert.deepEqual(gateway.list(),[]);
  await assert.rejects(f.host.start({signal:signal(),deadline:future()}),denied('UNSUPPORTED_CAPABILITY'));
});
