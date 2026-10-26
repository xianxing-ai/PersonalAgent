import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createConfiguredSubagentModelGateway} from '@personal-agent/runtime/application';
import {createComputerVisionConfig} from '../electron/computer-vision-config.js';

// Explicit synthetic safeStorage/fetch; these tests prove no real cloud or encryption platform acceptance.
const storage={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text).reverse(),decryptString:bytes=>Buffer.from(bytes).reverse().toString()};
const destination={source:'agentarts-proxy',baseUrl:'https://synthetic.huaweicloud-agentarts.com/inference/v1',model:'synthetic-vision'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
const request=(extra={})=>({messages:[{role:'user',content:'Synthetic inspection'}],tools:[],
  images:[{mediaType:'image/png',dataBase64:png.toString('base64'),sha256:createHash('sha256').update(png).digest('hex')}],
  deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal,...extra});
function fixture(t,extra={}){
  const base=new URL('../../../.cache/computer-vision-config-tests/',import.meta.url);mkdirSync(base,{recursive:true});
  const userData=mkdtempSync(base),sends=[],factories=[];
  const options={userData,safeStorage:storage,createGateway:config=>{factories.push(config);return createConfiguredSubagentModelGateway(config);},
    fetchImpl:async(url,init)=>{sends.push({url,init});return new Response(JSON.stringify({choices:[{message:{content:'Synthetic observation'}}]}));},...extra};
  const host=createComputerVisionConfig(options);t.after(()=>host.dispose());
  return {host,options,sends,factories,save:(patch={})=>host.configure({expectedRevision:host.snapshot().revision,enabled:true,...destination,apiKey:'synthetic-private-key',...patch})};
}
// Inject only the serialization step to exercise the exact final transport boundary,
// independently of the model gateway's separate message/image validation limits.
function wireFixture(t,body,{source='agentarts-proxy',onInit=()=>{}}={}){
  const f=fixture(t,{createGateway:config=>({deployment:{provider:'synthetic-wire'},async complete(input){
    const init={method:'POST',headers:{'content-type':'application/json'},body,signal:input.signal};onInit(init);
    await config.fetch(config.baseUrl+'/chat/completions',init);
    return {response:{kind:'final',text:'Synthetic observation'}};
  }})});
  const binding=f.save(source==='agentarts-proxy'?{}:{source,baseUrl:'https://custom.example/v1'});
  return {...f,binding};
}
function paddedWireBody(bytes,text='Synthetic private observation'){
  const encode=content=>JSON.stringify({model:destination.model,messages:[{role:'user',content:[
    {type:'text',text:content},{type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}},
  ]}],stream:false});
  const initial=encode(text),padding=bytes-Buffer.byteLength(initial,'utf8');assert.ok(padding>=0);
  return encode(text+'x'.repeat(padding));
}

test('default optional vision is disabled, encrypted saves use random CAS and snapshots never reveal keys',t=>{
  const f=fixture(t),initial=f.host.snapshot();
  assert.equal(initial.source,'agentarts-proxy');assert.equal(initial.enabled,false);assert.equal(initial.configured,false);assert.equal(initial.available,false);
  assert.equal(f.host.isCurrent(initial),false);assert.equal(f.host.isCurrent(undefined),false);
  const saved=f.save();assert.notEqual(saved.revision,initial.revision);assert.equal(saved.available,true);
  assert.doesNotMatch(JSON.stringify(saved),/synthetic-private-key|apiKey/);
  const disk=readFileSync(path.join(f.options.userData,'computer-vision-config.json'),'utf8');assert.doesNotMatch(disk,/synthetic-private-key|synthetic-vision/);
  const restored=createComputerVisionConfig(f.options);t.after(()=>restored.dispose());assert.deepEqual(restored.snapshot(),saved);
  assert.throws(()=>f.host.configure({expectedRevision:initial.revision,enabled:false,...destination,apiKey:''}),{code:'REVISION_CONFLICT'});
  const same=f.save({apiKey:''});assert.notEqual(same.revision,saved.revision);assert.equal(same.keyConfigured,true);
  assert.equal(f.sends.length,0);assert.equal(f.factories.length,0);
});

test('strict AgentArts and explicit custom endpoint validation never silently changes source or reuses a key',t=>{
  const f=fixture(t);f.save();
  for(const baseUrl of ['http://synthetic.huaweicloud-agentarts.com/inference/v1','https://huaweicloud-agentarts.com/inference/v1',
    'https://synthetic.huaweicloud-agentarts.com.evil.test/inference/v1','https://synthetic.huaweicloud-agentarts.com/v1',
    'https://user:password@synthetic.huaweicloud-agentarts.com/inference/v1','https://synthetic.huaweicloud-agentarts.com/inference/v1?token=private'])
    assert.throws(()=>f.save({baseUrl}),{code:'INVALID_ARGUMENT'});
  for(const patch of [{model:'other',apiKey:''},{source:'openai-compatible',apiKey:''},{baseUrl:'https://other.huaweicloud-agentarts.com/inference/v1',apiKey:''}])
    assert.throws(()=>f.save(patch),{code:'INVALID_ARGUMENT'});
  for(const baseUrl of ['http://remote.example/v1','file:///private/model','https://custom.example/v1#secret'])
    assert.throws(()=>f.save({source:'openai-compatible',baseUrl}),{code:'INVALID_ARGUMENT'});
  for(const baseUrl of ['https://custom.example/v1','http://localhost:8080/v1','http://127.0.0.1:8080/v1','http://[::1]:8080/v1'])
    assert.equal(f.save({source:'openai-compatible',baseUrl}).source,'openai-compatible');
  assert.equal(f.sends.length,0);
});

test('real Runtime public factory is vision-only configured and guarded image wire preserves original bytes',async t=>{
  const f=fixture(t),binding=f.save();let guards=0;
  const gateway=f.host.readGateway(binding,async context=>{guards++;assert.equal(context.binding.revision,binding.revision);assert.equal(context.signal.aborted,false);});
  const result=await gateway.complete(request());
  assert.equal(result.response.text,'Synthetic observation');assert.equal(guards,1);assert.equal(f.factories.length,1);
  assert.equal(f.factories[0].vision,true);assert.equal(f.factories[0].provider,'openai-compatible');
  assert.equal(f.sends.length,1);assert.equal(f.sends[0].init.redirect,'error');
  const body=JSON.parse(f.sends[0].init.body);assert.equal(body.messages[0].content[1].image_url.url,`data:image/png;base64,${png.toString('base64')}`);
  assert.equal(f.host.isCurrent({...binding,model:'other'}),false);
  assert.throws(()=>f.host.readGateway({...binding,revision:'old'},()=>{}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>f.host.readGateway(binding),{code:'INVALID_ARGUMENT'});
});

test('AgentArts accepts the exact conservative 5,000,000-byte encoded JSON body unchanged',async t=>{
  const body=paddedWireBody(5_000_000),f=wireFixture(t,body);let guards=0;
  await f.host.readGateway(f.binding,async()=>{guards++;}).complete(request());
  assert.equal(Buffer.byteLength(body,'utf8'),5_000_000);assert.equal(guards,1);assert.equal(f.sends.length,1);
  assert.equal(f.sends[0].init.body,body);assert.equal(f.sends[0].init.redirect,'error');
});

test('AgentArts rejects one byte over the whole-body limit before export authorization or fetch',async t=>{
  const body=paddedWireBody(5_000_001,'Synthetic private observation synthetic-private-key'),f=wireFixture(t,body);let guards=0;
  await assert.rejects(f.host.readGateway(f.binding,async()=>{guards++;}).complete(request()),error=>{
    assert.equal(error.code,'INVALID_ARGUMENT');assert.match(error.message,/5000001.*5000000/u);
    assert.doesNotMatch(error.message,/Synthetic private observation|synthetic-private-key|data:image|AAAA/u);return true;
  });
  assert.equal(guards,0);assert.equal(f.sends.length,0);
});

test('AgentArts counts multibyte Unicode as UTF-8 bytes instead of JavaScript string length',async t=>{
  const body=paddedWireBody(5_000_001,'私人观察😀'),f=wireFixture(t,body);let guards=0;
  assert.ok(body.length<5_000_000);assert.equal(Buffer.byteLength(body,'utf8'),5_000_001);
  await assert.rejects(f.host.readGateway(f.binding,async()=>{guards++;}).complete(request()),{code:'INVALID_ARGUMENT'});
  assert.equal(guards,0);assert.equal(f.sends.length,0);
});

test('explicit custom vision endpoints do not inherit the AgentArts request-body cap',async t=>{
  const body=paddedWireBody(5_242_881,'私人观察😀'),f=wireFixture(t,body,{source:'openai-compatible'});let guards=0;
  await f.host.readGateway(f.binding,async()=>{guards++;}).complete(request());
  assert.equal(guards,1);assert.equal(f.sends.length,1);assert.equal(f.sends[0].init.body,body);
});

test('AgentArts rejects invalid or non-serialized JSON before export authorization without echoing it',async t=>{
  for(const body of [undefined,Buffer.from('{}'),{private:'synthetic-private-key'},'null','[]','{"private":"synthetic-private-key" invalid}']){
    const f=wireFixture(t,body);let guards=0;
    await assert.rejects(f.host.readGateway(f.binding,async()=>{guards++;}).complete(request()),error=>{
      assert.equal(error.code,'INVALID_ARGUMENT');assert.match(error.message,/JSON/u);
      assert.doesNotMatch(error.message,/synthetic-private-key|private|invalid/u);return true;
    });
    assert.equal(guards,0);assert.equal(f.sends.length,0);
  }
});

test('the measured AgentArts body remains fixed if caller init changes during the final async guard',async t=>{
  const body=paddedWireBody(5_000_000);let mutableInit;
  const f=wireFixture(t,body,{onInit:init=>{mutableInit=init;}});
  await f.host.readGateway(f.binding,async()=>{await Promise.resolve();mutableInit.body=paddedWireBody(5_000_001);}).complete(request());
  assert.equal(f.sends.length,1);assert.equal(f.sends[0].init.body,body);
});

test('configuration change revokes a request waiting in async final guard and prevents a late new send',async t=>{
  const f=fixture(t),binding=f.save(),entered=deferred(),resume=deferred();
  const gateway=f.host.readGateway(binding,async()=>{entered.resolve();await resume.promise;});
  const pending=gateway.complete(request());await entered.promise;
  f.save({enabled:false,apiKey:''});
  await assert.rejects(pending,{code:'CANCELLED'});resume.resolve();await new Promise(done=>setImmediate(done));
  assert.equal(f.sends.length,0);assert.equal(f.host.isCurrent(binding),false);
  await assert.rejects(gateway.complete(request()),{code:'REVISION_CONFLICT'});
});

test('parallel gateway calls keep independent cancellation contexts; dispose seals all remaining calls',async t=>{
  const f=fixture(t),binding=f.save(),both=deferred(),resume=deferred(),contexts=[];
  const gateway=f.host.readGateway(binding,async context=>{contexts.push(context);if(contexts.length===2)both.resolve();await resume.promise;});
  const cancel=new AbortController(),first=gateway.complete(request({signal:cancel.signal})),second=gateway.complete(request());
  await both.promise;cancel.abort();await assert.rejects(first,{code:'CANCELLED'});resume.resolve();await second;
  assert.notEqual(contexts[0].signal,contexts[1].signal);assert.equal(f.sends.length,1);
  const entered=deferred(),held=deferred(),next=f.host.readGateway(binding,async()=>{entered.resolve();await held.promise;});
  const pending=next.complete(request());await entered.promise;f.host.dispose();await assert.rejects(pending,{code:'CANCELLED'});
  held.resolve();await new Promise(done=>setImmediate(done));assert.equal(f.sends.length,1);assert.equal(f.host.snapshot().keyConfigured,false);
});

test('deadline bounds a final guard that ignores cancellation, and late continuation cannot transmit',async t=>{
  const f=fixture(t),binding=f.save(),entered=deferred(),resume=deferred();
  const gateway=f.host.readGateway(binding,async()=>{entered.resolve();await resume.promise;});
  const pending=gateway.complete(request({deadline:new Date(Date.now()+40).toISOString()}));await entered.promise;
  await assert.rejects(pending,{code:'TIMEOUT'});resume.resolve();await new Promise(done=>setImmediate(done));assert.equal(f.sends.length,0);
});

test('late fetch resolution after an already sent request cannot revive a cancelled visual call',async t=>{
  for(const change of [
    {name:'configuration',apply:f=>f.save({enabled:false,apiKey:''}),code:'CANCELLED'},
    {name:'dispose',apply:f=>f.host.dispose(),code:'CANCELLED'},
    {name:'original signal',apply:(_f,controller)=>controller.abort(),code:'CANCELLED'},
    {name:'deadline',apply:()=>{},code:'TIMEOUT',deadlineMs:40},
  ]){
    const entered=deferred(),release=deferred(),controller=new AbortController();let sends=0;
    const f=fixture(t,{fetchImpl:async()=>{sends++;entered.resolve();return release.promise;}}),binding=f.save();
    const pending=f.host.readGateway(binding,async()=>{}).complete(request({signal:controller.signal,
      deadline:new Date(Date.now()+(change.deadlineMs??60_000)).toISOString()}));
    await entered.promise;change.apply(f,controller);
    await assert.rejects(pending,{code:change.code},change.name);
    release.resolve(new Response(JSON.stringify({choices:[{message:{content:'Late synthetic observation'}}]})));
    await new Promise(done=>setImmediate(done));
    assert.equal(sends,1,`${change.name}: one request had already reached the fake transport`);
    assert.equal(f.host.isCurrent(binding),['original signal','deadline'].includes(change.name));
  }
});

test('read and save faults preserve safe code/stage/detail and fail closed without showing keys or private paths',async t=>{
  const f=fixture(t),binding=f.save();
  f.options.safeStorage={...storage,encryptString:()=>{throw Object.assign(Error('disk write failed; secret=synthetic-private-key; C:\\Users\\private\\vision.json'),{code:'ENOSPC'});}};
  const broken=createComputerVisionConfig(f.options);t.after(()=>broken.dispose());
  assert.throws(()=>broken.configure({expectedRevision:binding.revision,enabled:false,...destination,apiKey:''}),error=>
    error.code==='ENOSPC'&&error.stage==='computer.vision.configure'&&/disk write failed/u.test(error.message)&&!/synthetic-private-key|Users|private\\vision/u.test(error.message));
  assert.equal(broken.snapshot().available,false);assert.equal(broken.isCurrent(binding),false);
  assert.equal(broken.snapshot().failure.code,'ENOSPC');
  writeFileSync(path.join(f.options.userData,'computer-vision-config.json'),'not JSON with token=synthetic-private-key');
  const corrupt=createComputerVisionConfig(f.options);t.after(()=>corrupt.dispose());
  assert.equal(corrupt.snapshot().failure.code,'PROTOCOL_MISMATCH');assert.equal(corrupt.snapshot().failure.stage,'computer.vision.restore');
  assert.doesNotMatch(JSON.stringify(corrupt.snapshot()),/synthetic-private-key/);
});

test('missing safeStorage fails explicitly and saving a disabled empty preference makes no model request',t=>{
  const f=fixture(t,{safeStorage:{isEncryptionAvailable:()=>false}});
  assert.throws(()=>f.save(),{code:'UNSUPPORTED_CAPABILITY'});assert.match(f.host.snapshot().reason,/安全存储/u);assert.equal(f.sends.length,0);
  const ready=fixture(t);const saved=ready.save({enabled:false,baseUrl:'',model:'',apiKey:''});
  assert.equal(saved.configured,false);assert.equal(saved.enabled,false);assert.equal(saved.source,'agentarts-proxy');
});
