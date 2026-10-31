import assert from 'node:assert/strict';
import test from 'node:test';
import {createBoundRemoteReadonlyMcpHost,remoteMcpDirectoryDigest} from '../dist/index.js';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {fixture,endpoint,descriptor,directory} from './remote-http-fixture.mjs';

const token='synthetic-access-token-only';
const future=(ms=20000)=>new Date(Date.now()+ms).toISOString();
const signal=()=>new AbortController().signal;
const errorCode=code=>error=>error.code===code && !/synthetic-access-token|synthetic-secret|provider private/.test(error.message);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const context=runId=>({taskId:'synthetic-bound-task',runId,authorizationRef:runId,signal:signal(),deadline:future(),scopes:descriptor.requiredScopes});

test('missing output schema policy changes the task binding and requires a pinned directory',async()=>{
  const s=await setup({anonymous:true});
  const compatible=createBoundRemoteReadonlyMcpHost({...s.options,allowMissingOutputSchema:true});
  try{
    assert.notEqual(s.envelope().bindingRef,s.envelope(compatible).bindingRef);
    await assert.rejects(compatible.tools[0].execute(s.envelope(),context('old-binding')),errorCode('INVALID_ARGUMENT'));
    assert.equal(s.f.calls().length,0);
  }finally{await compatible.dispose();await s.close();}
});

async function setup({anonymous=false,secret=token,mode={},expiresAt=future(60000)}={}){
  const f=await fixture({...mode,...(anonymous?{}:{requiredAuthorization:`Bearer ${token}`})});
  const revoked=new AbortController();
  let current={configurationRef:'synthetic-config',revision:1,directoryDigest:remoteMcpDirectoryDigest(directory()),
    ...(anonymous?{}:{credential:{secretRef:'synthetic-secret',revision:1,resource:endpoint,expiresAt}})};
  let reads=0,reader=()=>secret;
  const options={endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor:{...descriptor,version:'2.0.0'}},
    binding:structuredClone(current),readCurrentBinding:()=>current,revocationSignal:revoked.signal,
    secretStore:{read(ref,readSignal){reads++;assert.equal(ref,'synthetic-secret');return reader(readSignal);}},enabled:true,fetch:f.fetch};
  const host=createBoundRemoteReadonlyMcpHost(options);
  const envelope=(target=host)=>({bindingRef:target.tools[0].descriptor.inputSchema.properties.bindingRef.const,arguments:{key:'public'}});
  return {f,host,options,revoked,envelope,reads:()=>reads,current:()=>current,setCurrent:value=>{current=value;},setReader:value=>{reader=value;},
    async start(){await host.start({signal:signal(),deadline:future()});await new Promise(resolve=>setTimeout(resolve,20));},
    async close(){await host.dispose();await f.close();}};
}

test('bound host authenticates every HTTP request through SecretStore and existing one-use Policy',async()=>{
  const s=await setup();const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});s.host.register(gateway);
  try{
    await s.start();const args=s.envelope(),run={...context('allowed'),toolName:descriptor.name,toolVersion:'2.0.0',arguments:args};
    const reads=s.reads(),requests=s.f.requests.length;
    await assert.rejects(gateway.invoke({...run,authorizationRef:'missing'}),errorCode('UNAUTHORIZED'));
    assert.equal(s.reads(),reads);assert.equal(s.f.requests.length,requests);
    policy.grant({authorizationRef:run.runId,taskId:run.taskId,toolName:run.toolName,scopes:descriptor.requiredScopes,argumentsDigest:toolArgumentsDigest(args),maxUses:1,expiresAt:run.deadline});
    assert.deepEqual(await gateway.invoke(run),{text:'public synthetic reference'});
    assert.equal(policy.get(run.runId).usesRemaining,0);
    assert.equal(s.f.calls().length,1);assert.deepEqual(s.f.calls()[0].message.params,{name:'reference',arguments:{key:'public'}});
    assert.ok(s.f.requests.every(r=>r.headers.authorization===`Bearer ${token}`));
    assert.equal(s.host.currentConfigurationRef(),args.bindingRef);
    assert.doesNotMatch(JSON.stringify([s.host.health(),s.host.tools[0].descriptor]),/synthetic-access-token|synthetic-secret|synthetic-config/);
    assert.doesNotMatch(JSON.stringify(s.f.requests.map(r=>r.message)),new RegExp(`synthetic-secret|synthetic-config|${args.bindingRef}`));
  }finally{await s.close();}
  assert.deepEqual(gateway.list(),[]);
});

test('new configuration cannot use the old envelope/grant, even with the same tool name and arguments',async()=>{
  const s=await setup();const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});const release=s.host.register(gateway);let replacement;
  try{
    await s.start();const old=s.envelope();
    const run={...context('old-grant'),toolName:descriptor.name,toolVersion:'2.0.0',arguments:old};
    policy.grant({authorizationRef:run.runId,taskId:run.taskId,toolName:run.toolName,scopes:descriptor.requiredScopes,argumentsDigest:toolArgumentsDigest(old),maxUses:1,expiresAt:run.deadline});
    release();await s.host.dispose();s.setCurrent({...s.current(),revision:2});
    replacement=createBoundRemoteReadonlyMcpHost({...s.options,binding:s.current()});replacement.register(gateway);
    await replacement.start({signal:signal(),deadline:future()});await new Promise(resolve=>setTimeout(resolve,20));
    const reads=s.reads(),requests=s.f.requests.length;
    await assert.rejects(gateway.invoke(run),errorCode('INVALID_ARGUMENT'));
    await assert.rejects(gateway.invoke({...run,arguments:s.envelope(replacement)}),errorCode('SCOPE_DENIED'));
    assert.equal(policy.get(run.runId).usesRemaining,1);assert.equal(s.reads(),reads);assert.equal(s.f.requests.length,requests);assert.equal(s.f.calls().length,0);
  }finally{await replacement?.dispose();await s.close();}
});

test('silent remote directory drift is detected before tools/call; the changed session cannot revive',async()=>{
  const s=await setup();
  try{
    await s.start();s.f.mode.schema={type:'object'};
    await assert.rejects(s.host.tools[0].execute(s.envelope(),context('drift')),errorCode('REVISION_CONFLICT'));
    assert.equal(s.f.calls().length,0);assert.equal(s.host.health().connected,false);
    delete s.f.mode.schema;
    await assert.rejects(s.host.start({signal:signal(),deadline:future()}),errorCode('REVISION_CONFLICT'));
    assert.equal(s.f.calls().length,0);
  }finally{await s.close();}
});

test('local run conflicts do not revoke an unchanged bound host or cancel another call',async()=>{
  for(const overlap of ['same-run','different-run']){
    const s=await setup(),waiting=deferred(),started=deferred();let first;
    try{
      await s.start();const tool=s.host.tools[0],args=s.envelope();
      s.setReader(()=>{started.resolve();return waiting.promise;});
      first=tool.execute(args,context('A')).then(value=>({value}),error=>({error}));
      await Promise.race([started.promise,first.then(result=>assert.fail('first call ended before preflight: '+JSON.stringify(result)))]);
      await assert.rejects(tool.execute(args,context(overlap==='same-run'?'A':'B')),errorCode('REVISION_CONFLICT'));
      assert.equal(s.host.health().connected,true);
      assert.equal(s.host.currentConfigurationRef(),args.bindingRef);
      assert.equal(s.f.calls().length,0);
      s.setReader(()=>token);waiting.resolve(token);
      assert.deepEqual(await first,{value:{text:'public synthetic reference'}});
      assert.deepEqual(await tool.execute(args,context('C')),{text:'public synthetic reference'});
      await assert.rejects(tool.execute({...args,arguments:{key:'changed'}},context('A')),errorCode('REVISION_CONFLICT'));
      assert.equal(s.host.health().connected,true);
      assert.deepEqual(await tool.execute(args,context('D')),{text:'public synthetic reference'});
      assert.equal(s.f.calls().length,3);
    }finally{waiting.resolve(token);await first;await s.close();}
  }
});

test('native config/revocation changes reject before credentials and invalidate confirmed-result replay',async()=>{
  for(const change of ['revision','credential','remove','signal']){
    const s=await setup();
    try{
      await s.start();const args=s.envelope();await s.host.tools[0].execute(args,context('confirmed'));
      const reads=s.reads(),requests=s.f.requests.length;
      if(change==='revision')s.setCurrent({...s.current(),revision:2});
      if(change==='credential')s.setCurrent({...s.current(),credential:{...s.current().credential,revision:2}});
      if(change==='remove')s.setCurrent(undefined);
      if(change==='signal')s.revoked.abort();
      await assert.rejects(s.host.tools[0].execute(args,context('confirmed')),errorCode(change==='remove'?'UNAUTHORIZED':'REVISION_CONFLICT'));
      assert.equal(s.reads(),reads);assert.equal(s.f.requests.length,requests);assert.equal(s.host.currentConfigurationRef(),undefined);
    }finally{await s.close();}
  }
});

test('late credential completion after config change/cancel/deadline/revocation cannot send HTTP',async()=>{
  for(const reason of ['config','cancel','deadline','revoke']){
    const s=await setup(),waiting=deferred(),started=deferred(),controller=new AbortController();
    try{
      await s.start();const baseline=s.f.requests.length;
      s.setReader(()=>{started.resolve();return waiting.promise;});
      const pending=assert.rejects(s.host.tools[0].execute(s.envelope(),{...context('race'),signal:controller.signal,deadline:future(reason==='deadline'?150:20000)}),errorCode(reason==='cancel'?'CANCELLED':reason==='deadline'?'TIMEOUT':'REVISION_CONFLICT'));
      await Promise.race([started.promise,pending.then(()=>assert.fail('request ended before credential read'))]);
      if(reason==='config')s.setCurrent({...s.current(),revision:2});
      if(reason==='cancel')controller.abort();
      if(reason==='revoke')s.revoked.abort();
      if(reason==='config')waiting.resolve(token);
      await pending;waiting.resolve(token);await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(s.f.requests.length,baseline,JSON.stringify({reason,extra:s.f.requests.slice(baseline).map(item=>({method:item.message?.method,id:item.message?.id,requestId:item.message?.params?.requestId}))}));assert.equal(s.f.calls().length,0);
    }finally{waiting.resolve(token);await s.close();}
  }
});

test('credential expiry is rechecked after an asynchronous read without sending the late token',async t=>{
  const s=await setup(),waiting=deferred(),started=deferred();
  try{
    await s.start();const baseline=s.f.requests.length;
    s.setReader(()=>{started.resolve();return waiting.promise;});
    const pending=assert.rejects(s.host.tools[0].execute(s.envelope(),{...context('expired'),deadline:future(300000)}),errorCode('UNAUTHORIZED'));
    await Promise.race([started.promise,pending.then(()=>assert.fail('request ended before credential read'))]);
    t.mock.timers.enable({apis:['Date'],now:Date.now()+120000});
    waiting.resolve(token);await pending;
    assert.equal(s.f.requests.length,baseline);assert.equal(s.f.calls().length,0);
  }finally{t.mock.timers.reset();waiting.resolve(token);await s.close();}
});

test('invalid/missing/expired credentials and resource mismatch fail without leaking or following auth discovery',async()=>{
  for(const secret of [undefined,'', 'bad\r\nheader', 'x'.repeat(8193)]){
    const s=await setup({secret});
    // setup's default token is deliberately overridden for the undefined case.
    s.setReader(()=>secret);
    try{await assert.rejects(s.start(),errorCode('UNAUTHORIZED'));assert.equal(s.f.requests.length,0);}
    finally{await s.close();}
  }
  const expired=await setup({expiresAt:future(-1)});
  try{await assert.rejects(expired.start(),errorCode('UNAUTHORIZED'));assert.equal(expired.reads(),0);assert.equal(expired.f.requests.length,0);}
  finally{await expired.close();}
  const s=await setup();
  try{
    assert.throws(()=>createBoundRemoteReadonlyMcpHost({...s.options,binding:{...s.current(),credential:{...s.current().credential,resource:'https://other.example/mcp'}}}),errorCode('INVALID_ARGUMENT'));
    s.setReader(()=>{throw new Error('provider private diagnostic '+token);});
    await assert.rejects(s.start(),errorCode('UNAUTHORIZED'));assert.equal(s.f.requests.length,0);
  }finally{await s.close();}
});

test('public bound host needs no credentials; missing config is unavailable and 401 is not retried',async()=>{
  const empty=createBoundRemoteReadonlyMcpHost();assert.equal(empty.health().state,'unavailable');await empty.dispose();
  const s=await setup({anonymous:true});
  try{await s.start();assert.deepEqual(await s.host.tools[0].execute(s.envelope(),context('public')),{text:'public synthetic reference'});assert.equal(s.reads(),0);}
  finally{await s.close();}
  for(const status of [401,403,302]){
    const denied=await setup({mode:{status}});
    try{await assert.rejects(denied.start(),errorCode(status===302?'EXTERNAL_FAILURE':'UNAUTHORIZED'));assert.equal(denied.f.requests.filter(r=>r.method==='POST').length,1);assert.equal(denied.f.calls().length,0);}
    finally{await denied.close();}
  }
});
