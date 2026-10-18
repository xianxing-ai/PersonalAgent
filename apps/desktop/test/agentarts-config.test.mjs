import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAgentArtsConfig} from '../electron/agentarts-config.js';
import {agentArtsModelSnapshot} from '../electron/agentarts-model-state.js';
import {createDeferredRuntimeStartup} from '../electron/runtime-startup.js';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {Client} from '@personal-agent/client';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';

function wssFixture(t,environment={}) {
  const userData=mkdtempSync(path.join(os.tmpdir(),'pa-cloud-wss-'));
  t.after(()=>rmSync(userData,{recursive:true,force:true}));
  const options={userData,environment,safeStorage:{isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()}};
  const input={gatewayUrl:'https://synthetic.huaweicloud-agentarts.com',runtimeName:'owned-runtime',
    authorization:'Bearer synthetic-outer-no-real-secret',transport:'wss',
    websocketUrl:'wss://synthetic.huaweicloud-agentarts.com/runtimes/owned-runtime/invocations/ws',
    appToken:'synthetic-inner-no-real-secret-at-least-32',allowHttpsFallback:false};
  return {options,input,file:path.join(userData,'agentarts-config.json'),config:createAgentArtsConfig(options)};
}

test('saved WSS restores both private credentials and overrides stale transport environment',async t=>{
  const f=wssFixture(t,{PA_AGENTARTS_TRANSPORT:'https'});
  assert.equal(f.config.snapshot().transport,'https');
  f.config.configure(f.input);
  const config=createAgentArtsConfig(f.options),binding=config.binding(),transport=config.transportConfig(binding);
  assert.equal(config.snapshot().transport,'wss');
  assert.equal(config.snapshot().effectiveTransport,'wss');
  assert.equal(config.snapshot().transportSource,'saved');
  assert.equal(config.snapshot().websocketUrl,f.input.websocketUrl);
  assert.equal(transport.allowHttpsFallback,false);
  assert.equal(config.readAuthorization(binding,transport),f.input.authorization);
  assert.equal(await transport.websocketAuthorizationProvider.read(),`Bearer ${f.input.appToken}`);
  for(const serialized of [JSON.stringify(config.snapshot()),JSON.stringify(transport),readFileSync(f.file,'utf8')]) {
    assert.doesNotMatch(serialized,/synthetic-inner|synthetic-outer|Bearer/);
  }
  config.configure({...f.input,authorization:'',appToken:''});
  assert.equal(await transport.websocketAuthorizationProvider.read(),`Bearer ${f.input.appToken}`);
  config.configure({...f.input,authorization:'Bearer rotated-synthetic-outer',appToken:f.input.appToken+'-rotated'});
  assert.equal(config.readAuthorization(binding,transport),'Bearer rotated-synthetic-outer');
  assert.equal(await transport.websocketAuthorizationProvider.read(),`Bearer ${f.input.appToken}-rotated`);
});

test('new settings offer WSS while legacy disk records require explicit migration',async t=>{
  const f=wssFixture(t);
  assert.equal(f.config.snapshot().transport,'wss');
  const {gatewayUrl,runtimeName,authorization}=f.input;
  f.config.configure({gatewayUrl,runtimeName,authorization});
  let config=createAgentArtsConfig(f.options);
  assert.equal(config.snapshot().transport,'https');
  const binding=config.binding(),old=config.transportConfig(binding);
  assert.equal(old.transport,'https');
  assert.equal(typeof old.fetchImpl,'function');
  assert.throws(()=>old.fetchImpl('https://evil.example/runtimes/owned-runtime/invocations',{method:'POST',redirect:'error',headers:{}}),/已绑定目的地/);
  config.configure({...f.input,authorization:''});
  assert.equal(config.isTransportCurrent(old),false);
  assert.throws(()=>config.readAuthorization(binding,old),/已改变/);
  config=createAgentArtsConfig(f.options);
  const wss=config.transportConfig(config.binding());
  assert.equal(await wss.websocketAuthorizationProvider.read(),`Bearer ${f.input.appToken}`);
  config.configure({gatewayUrl,runtimeName,authorization:'',transport:'https'});
  assert.equal(config.snapshot().transport,'https');
  await assert.rejects(wss.websocketAuthorizationProvider.read(),/已改变/);
});

test('invalid WSS updates fail before persistence; destination and transport changes invalidate both providers',async t=>{
  const f=wssFixture(t);f.config.configure(f.input);
  const binding=f.config.binding(),transport=f.config.transportConfig(binding),record=readFileSync(f.file,'utf8');
  for(const input of [
    {websocketUrl:f.input.websocketUrl+'?token=private'}, {websocketUrl:f.input.websocketUrl.replace('owned-runtime','other')},
    {appToken:'short'}, {appToken:f.input.appToken+'\r\n'}, {appToken:null},
    {allowHttpsFallback:'1'}, {allowHttpsFallback:null}, {transport:null},
    {runtimeName:'other',authorization:'',appToken:''},
    {gatewayUrl:'https://other.huaweicloud-agentarts.com',authorization:'',appToken:''},
  ]) {
    assert.throws(()=>f.config.configure({...f.input,...input}));
    assert.equal(readFileSync(f.file,'utf8'),record);
    assert.equal(f.config.readAuthorization(binding,transport),f.input.authorization);
  }
  f.config.configure({...f.input,allowHttpsFallback:true});
  assert.equal(f.config.isTransportCurrent(transport),false);
  assert.throws(()=>f.config.readAuthorization(binding,transport),/已改变/);
  await assert.rejects(transport.websocketAuthorizationProvider.read(),/已改变/);
});

test('failed WSS disk revoke disables both in-memory credentials and retries remove the encrypted record',async t=>{
  const f=wssFixture(t);f.config.configure(f.input);
  const binding=f.config.binding(),transport=f.config.transportConfig(binding);
  renameSync(f.file,f.file+'.retained');mkdirSync(f.file);
  assert.throws(()=>f.config.revoke(),/未能删除/);
  assert.equal(f.config.snapshot().configured,false);
  assert.throws(()=>f.config.readAuthorization(binding,transport));
  await assert.rejects(transport.websocketAuthorizationProvider.read());
  rmSync(f.file,{recursive:true});renameSync(f.file+'.retained',f.file);
  assert.equal(createAgentArtsConfig(f.options).snapshot().configured,true);
  f.config.revoke();assert.equal(existsSync(f.file),false);
  assert.equal(createAgentArtsConfig(f.options).snapshot().configured,false);
});

test('failed WSS encryption or persistence preserves the previously usable configuration',async t=>{
  const f=wssFixture(t);f.config.configure(f.input);
  const binding=f.config.binding(),transport=f.config.transportConfig(binding),record=readFileSync(f.file,'utf8');
  f.options.safeStorage.isEncryptionAvailable=()=>false;
  assert.throws(()=>f.config.configure({...f.input,appToken:f.input.appToken+'-new'}),/安全存储不可用/);
  assert.equal(readFileSync(f.file,'utf8'),record);
  f.options.safeStorage.isEncryptionAvailable=()=>true;
  mkdirSync(f.file+'.tmp');
  assert.throws(()=>f.config.configure({...f.input,appToken:f.input.appToken+'-new'}));
  assert.equal(readFileSync(f.file,'utf8'),record);
  assert.equal(f.config.readAuthorization(binding,transport),f.input.authorization);
  assert.equal(await transport.websocketAuthorizationProvider.read(),`Bearer ${f.input.appToken}`);
});

test('restored Desktop WSS configuration drives the real Runtime factory with distinct headers and zero HTTP calls',async t=>{
  const f=wssFixture(t);f.config.configure(f.input);
  const config=createAgentArtsConfig(f.options),binding=config.binding(),transport=config.transportConfig(binding);
  let sockets=0,http=0;
  const app=createAgentArtsRuntimeApplication({...binding,...transport,path:':memory:',
    authorizationProvider:{read:async()=>config.readAuthorization(binding,transport)},
    websocketFactory:(url,init)=>{
      sockets++;assert.equal(url,f.input.websocketUrl);
      assert.equal(init.headers.Authorization,f.input.authorization);
      assert.equal(init.headers['X-PA-Agent-Token'],`Bearer ${f.input.appToken}`);
      return new SyntheticWebSocket((frame,socket)=>{if(frame.type==='invoke'){socket.accepted(frame);socket.result(frame,'Synthetic saved WSS result');}});
    },fetchImpl:async()=>{http++;throw Error('Unexpected fallback');}});
  try {
    const client=new Client(app);await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'Synthetic configured desktop task',conversationId:'desktop-panel'},{idempotencyKey:'saved-wss'});
    for(let i=0;i<100 && !['failed','succeeded'].includes(app.runtime.getTask(taskId).state);i++) await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(app.runtime.getTask(taskId).state,'succeeded');
    assert.match(app.runtime.getTask(taskId).resultSummary,/Synthetic saved WSS/);
    assert.equal(sockets,1);assert.equal(http,0);
  } finally {app.close();}
});

const invalidRuntimeNames=[
  ['missing',{}],['undefined',{runtimeName:undefined}],['null',{runtimeName:null}],
  ['number',{runtimeName:17}],['array',{runtimeName:['synthetic-runtime']}],['object',{runtimeName:{}}],
];

test('AgentArts runtime name must be a string before encryption or persistence',async t=>{
  for(const [name,invalid] of invalidRuntimeNames) {
    await t.test(name,t=>{
      const userData=mkdtempSync(path.join(os.tmpdir(),'pa-cloud-invalid-name-'));
      t.after(()=>rmSync(userData,{recursive:true,force:true}));
      let encryptionCalls=0;
      const config=createAgentArtsConfig({userData,environment:{},safeStorage:{
        isEncryptionAvailable:()=>true,encryptString:value=>{encryptionCalls++;return Buffer.from(value);},
        decryptString:value=>value.toString(),
      }});
      assert.throws(()=>config.configure({gatewayUrl:'https://example.huaweicloud-agentarts.com',
        authorization:'Bearer synthetic-only',...invalid}),/运行时实例名称/);
      assert.equal(encryptionCalls,0,'invalid destinations never reach credential encryption');
      for(const file of ['agentarts-config.json','agentarts-config.json.tmp']) {
        assert.equal(existsSync(path.join(userData,file)),false,'invalid destinations never create persisted configuration');
      }
      assert.equal(config.snapshot().configured,false);
      assert.equal(config.snapshot().runtimeReady,false);
    });
  }
});

test('AgentArts stored non-string runtime name remains unavailable without rewriting the file',async t=>{
  for(const [name,invalid] of invalidRuntimeNames) {
    await t.test(name,t=>{
      const userData=mkdtempSync(path.join(os.tmpdir(),'pa-cloud-invalid-stored-name-'));
      t.after(()=>rmSync(userData,{recursive:true,force:true}));
      const file=path.join(userData,'agentarts-config.json');
      const record=JSON.stringify({version:1,encrypted:Buffer.from(JSON.stringify({
        gatewayUrl:'https://example.huaweicloud-agentarts.com',authorization:'Bearer synthetic-only',...invalid,
      })).toString('base64')});
      writeFileSync(file,record);
      let encryptionCalls=0;
      const config=createAgentArtsConfig({userData,environment:{},safeStorage:{
        isEncryptionAvailable:()=>true,decryptString:value=>value.toString(),
        encryptString:value=>{encryptionCalls++;return Buffer.from(value);},
      }});
      assert.equal(config.snapshot().configured,false);
      assert.equal(config.snapshot().runtimeReady,false);
      assert.equal(config.runtimeBinding(),undefined);
      assert.throws(()=>config.binding());
      assert.throws(()=>config.readAuthorization({gatewayUrl:'https://example.huaweicloud-agentarts.com',runtimeName:'synthetic-runtime'}));
      assert.doesNotMatch(JSON.stringify(config.snapshot()),/synthetic-only|Bearer/);
      assert.equal(encryptionCalls,0);
      assert.equal(readFileSync(file,'utf8'),record,'reading an invalid record never repairs or overwrites it');
    });
  }
});

test('AgentArts revoke reports a failed disk deletion and can be retried after repair',()=>{
  const userData=mkdtempSync(path.join(os.tmpdir(),'pa-cloud-revoke-'));
  const safeStorage={isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
  const options={userData,safeStorage,environment:{}};
  const config=createAgentArtsConfig(options);
  const file=path.join(userData,'agentarts-config.json');
  try {
    config.configure({gatewayUrl:'https://example.huaweicloud-agentarts.com',runtimeName:'synthetic-runtime',authorization:'Bearer synthetic-only'});
    const binding=config.binding();
    const cachedModel=agentArtsModelSnapshot({},config.snapshot());
    assert.equal(cachedModel.configured,true);
    renameSync(file,file+'.retained');
    mkdirSync(file);
    assert.throws(()=>config.revoke(),/未能删除/);
    assert.equal(config.snapshot().configured,false,'in-memory access is revoked even when disk deletion fails');
    const projected=agentArtsModelSnapshot(cachedModel,config.snapshot());
    assert.equal(projected.configured,false);assert.match(projected.reason,/未能删除/);
    assert.throws(()=>config.readAuthorization(binding));
    assert.throws(()=>config.readTransportOptions(binding));
    assert.doesNotMatch(JSON.stringify(config.snapshot()),/synthetic-only|Bearer|pa-cloud-revoke/);
    rmSync(file,{recursive:true});
    renameSync(file+'.retained',file);
    assert.equal(createAgentArtsConfig(options).snapshot().configured,true,'retained persisted credentials still matter after restart');
    assert.equal(config.revoke().configured,false);
    assert.equal(existsSync(file),false);
    assert.equal(createAgentArtsConfig(options).snapshot().configured,false);
    assert.doesNotMatch(config.snapshot().reason,/未能删除/);
  } finally {rmSync(userData,{recursive:true,force:true});}
});

test('AgentArts credential persists through host storage without snapshot disclosure or destination reuse',()=>{
  const userData=mkdtempSync(path.join(os.tmpdir(),'pa-cloud-config-'));
  const safeStorage={isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
  const options={userData,safeStorage,environment:{}};
  let config=createAgentArtsConfig(options);
  const input={gatewayUrl:'https://example.cn-southwest-2.huaweicloud-agentarts.com',runtimeName:'test-runtime',authorization:'Bearer synthetic-only'};
  assert.equal(config.snapshot().configured,false);
  const snapshot=config.configure(input);
  assert.doesNotMatch(JSON.stringify(snapshot),/synthetic-only|Bearer/);
  assert.doesNotMatch(readFileSync(path.join(userData,'agentarts-config.json'),'utf8'),/synthetic-only|Bearer/);
  config=createAgentArtsConfig(options);
  const binding=config.binding();
  assert.equal(config.readAuthorization(binding),input.authorization);
  assert.throws(()=>config.configure({...input,authorization:'',gatewayUrl:'https://different.huaweicloud-agentarts.com'}));
  assert.throws(()=>config.configure({...input,gatewayUrl:'https://untrusted.example.com'}));
  assert.throws(()=>config.configure({...input,authorization:'x\r\nAuthorization: y'}));
  config.configure({...input,authorization:'Bearer replacement',runtimeName:'other-runtime'});
  assert.throws(()=>config.readAuthorization(binding));
  const revoked = config.revoke();
  assert.equal(revoked.configured, false);
  assert.equal(existsSync(path.join(userData,'agentarts-config.json')), false);
  assert.throws(()=>config.binding());
});

test('AgentArts blank credential reuse compares canonical destinations and preserves rejects',t=>{
  const userData=mkdtempSync(path.join(os.tmpdir(),'pa-cloud-canonical-binding-'));
  t.after(()=>rmSync(userData,{recursive:true,force:true}));
  let encryptionCalls=0;
  const options={userData,environment:{},safeStorage:{isEncryptionAvailable:()=>true,
    encryptString:value=>{encryptionCalls++;return Buffer.from(value).reverse();},
    decryptString:value=>Buffer.from(value).reverse().toString()}};
  let config=createAgentArtsConfig(options);
  const initial={gatewayUrl:'https://example.huaweicloud-agentarts.com',runtimeName:'same-runtime',
    authorization:'Bearer synthetic-only'};
  config.configure(initial);
  const binding=config.binding();
  for(const gatewayUrl of ['https://example.huaweicloud-agentarts.com/',
    'https://EXAMPLE.HUAWEICLOUD-AGENTARTS.COM',
    'https://example.huaweicloud-agentarts.com:443/']) {
    const result=config.configure({gatewayUrl,runtimeName:initial.runtimeName,authorization:''});
    assert.equal(result.configured,true);
    assert.deepEqual(config.binding(),binding);
    assert.equal(result.gatewayUrl,initial.gatewayUrl);
    assert.equal(config.readAuthorization(binding),initial.authorization);
    assert.doesNotMatch(JSON.stringify(result),/synthetic-only|Bearer/);
    config=createAgentArtsConfig(options);
    assert.equal(config.readAuthorization(binding),initial.authorization,'canonical updates survive restart');
  }
  const file=path.join(userData,'agentarts-config.json'),record=readFileSync(file,'utf8');
  const previousCalls=encryptionCalls;
  for(const invalid of [
    {gatewayUrl:'https://different.huaweicloud-agentarts.com/'},{runtimeName:'different-runtime'},
    {runtimeName:initial.runtimeName.toUpperCase()},
    {gatewayUrl:'https://example.huaweicloud-agentarts.com:444/'},
    {gatewayUrl:'https://example.huaweicloud-agentarts.com/api'},
    {gatewayUrl:'https://example.huaweicloud-agentarts.com/?secret=1'},
    {gatewayUrl:'https://example.huaweicloud-agentarts.com/#fragment'},
    {gatewayUrl:'https://user:pass@example.huaweicloud-agentarts.com/'},
    {gatewayUrl:'http://example.huaweicloud-agentarts.com/'},
    {gatewayUrl:'https://example.huaweicloud-agentarts.com.untrusted.example/'},
    ...[null,false,0,[],{}].map(authorization=>({authorization})),
  ]) {
    assert.throws(()=>config.configure({...initial,authorization:'',...invalid}));
    assert.equal(encryptionCalls,previousCalls,'rejected updates never encrypt or persist');
    assert.equal(readFileSync(file,'utf8'),record);
    assert.equal(config.readAuthorization(binding),initial.authorization);
  }
  assert.throws(()=>config.readAuthorization({...binding,gatewayUrl:`${binding.gatewayUrl}/`}),/已改变/);
});

test('known AgentArts destination permits Runtime and Live construction without inventing or overwriting a credential',async()=>{
  const cache=new URL('../../../.cache/agentarts-config-tests/',import.meta.url);
  mkdirSync(cache,{recursive:true});
  const userData=mkdtempSync(new URL('missing-credential-',cache));
  const config=createAgentArtsConfig({userData,safeStorage:{isEncryptionAvailable:()=>true},environment:{
    PA_AGENTARTS_GATEWAY_URL:'https://example.cn-southwest-2.huaweicloud-agentarts.com',
    PA_AGENTARTS_RUNTIME_NAME:'synthetic-runtime'}});
  assert.equal(config.snapshot().configured,false);assert.equal(config.snapshot().runtimeReady,true);
  const binding=config.runtimeBinding();assert.ok(binding);
  assert.deepEqual(config.readTransportOptions(binding),{});
  assert.throws(()=>config.readTransportOptions({...binding,runtimeName:'another-runtime'}));
  assert.throws(()=>config.readAuthorization(binding));
  let application,requests=0;
  const startup=createDeferredRuntimeStartup({isConfigured:()=>config.snapshot().runtimeReady,
    initialize:async()=>{application=createAgentArtsRuntimeApplication({path:path.join(userData,'runtime.sqlite'),
      ...binding,authorizationProvider:{read:async()=>config.readAuthorization(binding)},
      fetchImpl:async()=>{requests++;throw Error('No cloud call is expected without credentials');}});}});
  try {
    assert.equal((await startup.start()).state,'ready');
    assert.equal(typeof application.createLiveVoiceModel({workspaceId:'synthetic',apiKey:'synthetic-only'}).connect,'function');
    const client=new Client(application,Date.now);await client.connect();
    const receipt=await client.call('task.submit',{goal:'Synthetic missing-credential check',conversationId:'desktop-panel'},{idempotencyKey:'missing-credential'});
    for(let i=0;i<50 && !['failed','succeeded'].includes(application.runtime.getTask(receipt.taskId).state);i++) {
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(application.runtime.getTask(receipt.taskId).state,'failed');
    assert.equal(requests,0);
    assert.equal(existsSync(path.join(userData,'agentarts-config.json')),false);
    assert.equal(config.snapshot().configured,false);
  } finally {application?.close();}
  const missing=createAgentArtsConfig({userData,safeStorage:{},environment:{}});
  assert.equal(missing.snapshot().runtimeReady,false);assert.equal(missing.runtimeBinding(),undefined);
});

test('optional inner credential and exact deployment version persist encrypted, refresh, and never enter snapshots',t=>{
  const userData=mkdtempSync(path.join(os.tmpdir(),'pa-cloud-versioned-'));t.after(()=>rmSync(userData,{recursive:true,force:true}));
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
    decryptString:value=>Buffer.from(value).reverse().toString()};
  const options={userData,safeStorage,environment:{}},destination={gatewayUrl:'https://example.huaweicloud-agentarts.com',runtimeName:'versioned-runtime'};
  const appToken='explicit-public-fixture-app-token-123456789';
  let config=createAgentArtsConfig(options);
  const snapshot=config.configure({...destination,authorization:'Bearer explicit-public-outer',appToken,deploymentVersion:'arm64-v4-e38ef23d-r2'});
  assert.equal(snapshot.appTokenConfigured,true);assert.equal(snapshot.deploymentVersion,'arm64-v4-e38ef23d-r2');
  assert.doesNotMatch(JSON.stringify(snapshot),/fixture-app-token|Bearer/);assert.doesNotMatch(JSON.stringify(config),/fixture-app-token|Bearer/);
  const file=path.join(userData,'agentarts-config.json'),record=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(record.version,1);assert.doesNotMatch(readFileSync(file,'utf8'),/fixture-app-token|Bearer/);
  config=createAgentArtsConfig(options);const binding=config.binding(),first=config.readTransportOptions(binding);
  assert.deepEqual(first,{appToken,deploymentVersion:'arm64-v4-e38ef23d-r2'});
  first.appToken='caller mutation';assert.equal(config.readTransportOptions(binding).appToken,appToken);
  config.configure({...destination,gatewayUrl:destination.gatewayUrl+'/',authorization:'',appToken:''});
  assert.equal(config.readAuthorization(binding),'Bearer explicit-public-outer');assert.equal(config.readTransportOptions(binding).appToken,appToken);
  config.configure({...destination,appToken:appToken+'-rotated',deploymentVersion:'arm64-next'});
  assert.deepEqual(config.readTransportOptions(binding),{appToken:appToken+'-rotated',deploymentVersion:'arm64-next'});
  config.configure({...destination,deploymentVersion:''});assert.deepEqual(config.readTransportOptions(binding),{appToken:appToken+'-rotated'});
  config.configure({...destination,runtimeName:'different-runtime',authorization:'Bearer new-destination'});
  assert.throws(()=>config.readTransportOptions(binding),/已改变/);
  assert.deepEqual(config.readTransportOptions(config.binding()),{},'a different destination cannot inherit either optional value');
  const other=config.binding();config.revoke();assert.throws(()=>config.readAuthorization(other));assert.throws(()=>config.readTransportOptions(other));
});
test('invalid optional credentials and version pins never encrypt, persist or replace current configuration',t=>{
  const userData=mkdtempSync(path.join(os.tmpdir(),'pa-cloud-reject-version-'));t.after(()=>rmSync(userData,{recursive:true,force:true}));
  let encrypted=0;const config=createAgentArtsConfig({userData,environment:{},safeStorage:{isEncryptionAvailable:()=>true,
    encryptString:value=>{encrypted++;return Buffer.from(value).reverse();},decryptString:value=>Buffer.from(value).reverse().toString()}});
  const destination={gatewayUrl:'https://example.huaweicloud-agentarts.com',runtimeName:'fixture'};
  config.configure({...destination,authorization:'Bearer public-fixture',appToken:'explicit-public-fixture-app-token-123456789',deploymentVersion:'v4'});
  const binding=config.binding(),before=readFileSync(path.join(userData,'agentarts-config.json'),'utf8'),calls=encrypted;
  for(const invalid of [
    ...[null,0,false,[],{},'short','Bearer token with spaces','x'.repeat(32)+'\r\n'].map(appToken=>({appToken})),
    ...[null,0,false,[],{},'with spaces','v4?token=other','v4\n','x'.repeat(129)].map(deploymentVersion=>({deploymentVersion})),
    {token:'unknown-field'},
  ]) {
    assert.throws(()=>config.configure({...destination,...invalid}));assert.equal(encrypted,calls);
    assert.equal(readFileSync(path.join(userData,'agentarts-config.json'),'utf8'),before);assert.equal(config.readTransportOptions(binding).deploymentVersion,'v4');
  }
});
test('legacy encrypted version 1 three-field records remain valid without inventing an inner credential or version',t=>{
  const userData=mkdtempSync(path.join(os.tmpdir(),'pa-cloud-old-v1-'));t.after(()=>rmSync(userData,{recursive:true,force:true}));
  const value={gatewayUrl:'https://example.huaweicloud-agentarts.com',runtimeName:'old-runtime',authorization:'Bearer public-old-outer'};
  const file=path.join(userData,'agentarts-config.json'),record=JSON.stringify({version:1,encrypted:Buffer.from(JSON.stringify(value)).toString('base64')});
  writeFileSync(file,record);const config=createAgentArtsConfig({userData,environment:{},safeStorage:{isEncryptionAvailable:()=>true,decryptString:bytes=>bytes.toString()}});
  assert.equal(config.snapshot().configured,true);assert.equal(config.snapshot().appTokenConfigured,false);assert.equal(config.snapshot().deploymentVersion,'');
  assert.equal(config.readAuthorization(config.binding()),value.authorization);assert.deepEqual(config.readTransportOptions(config.binding()),{});
  assert.equal(readFileSync(file,'utf8'),record);
});
