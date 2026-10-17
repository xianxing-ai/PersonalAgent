import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRemoteMcpConfig} from '../electron/remote-mcp-config.js';
import {createDesktopRemoteMcpHost} from '../electron/remote-mcp-host.js';
import {remoteMcpDirectoryDigest} from '@personal-agent/mcp';
import {fixture,endpoint,descriptor,directory} from '../../../packages/mcp/test/remote-http-fixture.mjs';

const token='synthetic-access-token-only';
const future=(ms=20000)=>new Date(Date.now()+ms).toISOString();
const signal=()=>new AbortController().signal;
const input=()=>({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},tool:{remoteName:'reference',descriptor:{...descriptor,version:'2.0.0'}},
  directoryDigest:remoteMcpDirectoryDigest(directory()),credential:{token,expiresAt:future(60000)}});
const rejected=code=>error=>error.code===code && !/synthetic-access-token|provider private/.test(error.message);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function setup(t){
  const parent=fileURLToPath(new URL('../../../.cache/mcp-config/',import.meta.url));mkdirSync(parent,{recursive:true});
  const userData=mkdtempSync(path.join(parent,'case-'));
  let broken=false;
  const safeStorage={isEncryptionAvailable:()=>true,
    encryptString(value){if(broken)throw Error('provider private '+token);return Buffer.from(value).reverse();},
    decryptString:value=>Buffer.from(value).reverse().toString()}; // Explicit Fake encryption port.
  const options={userData,safeStorage},config=createRemoteMcpConfig(options);t.after(()=>config.dispose());
  return {config,options,target:path.join(userData,'remote-mcp-config.json'),breakEncryption:()=>{broken=true;}};
}

test('encrypted configuration reloads disconnected with a fresh session binding and no public secrets',t=>{
  const s=setup(t);assert.equal(s.config.snapshot().status,'unconfigured');
  const saved=s.config.configure(input()),binding=s.config.binding();
  assert.equal(saved.status,'saved_disconnected');assert.equal(saved.toolAvailable,false);assert.equal(saved.remoteVerified,false);
  const raw=readFileSync(s.target,'utf8');
  for(const privateValue of [token,endpoint,binding.configurationRef,binding.credential.secretRef]){
    assert.equal(raw.includes(privateValue),false);assert.equal(JSON.stringify(saved).includes(privateValue),false);
  }
  s.config.dispose();const restored=createRemoteMcpConfig(s.options);t.after(()=>restored.dispose());
  assert.deepEqual(restored.snapshot(),saved);assert.notEqual(restored.binding().configurationRef,binding.configurationRef);
  assert.equal(restored.binding().revision,binding.revision);assert.equal(restored.binding().credential.secretRef,binding.credential.secretRef);
  assert.equal(restored.secretStore.read(binding.credential.secretRef,signal()),token);
});

test('invalid input and failed encryption preserve the prior file, binding and revocation signal',t=>{
  const s=setup(t);s.config.configure(input());const raw=readFileSync(s.target,'utf8'),before=s.config.binding(),priorSignal=s.config.revocationSignal();
  for(const change of [{enabled:true},{endpoint:'http://other.example/mcp'},{endpoint:'https://user:password@other.example/mcp'},
    {endpoint:'https://other.example/mcp?token=secret'},{directoryDigest:'wrong'},{credential:null},
    {credential:{token:'bad\r\nheader',expiresAt:future()}},{credential:{token,expiresAt:future(-1)}},
    {tool:{...input().tool,descriptor:{...descriptor,sideEffect:'write'}}}]){
    assert.throws(()=>s.config.configure({...input(),...change}),rejected('INVALID_ARGUMENT'));
  }
  assert.equal(readFileSync(s.target,'utf8'),raw);assert.deepEqual(s.config.binding(),before);assert.equal(priorSignal.aborted,false);
  s.breakEncryption();assert.throws(()=>s.config.configure(input()),rejected('EXTERNAL_FAILURE'));
  assert.equal(readFileSync(s.target,'utf8'),raw);assert.deepEqual(s.config.binding(),before);assert.equal(priorSignal.aborted,false);
});

test('rotation revokes old references; revoke removes the ciphertext and clears memory access',t=>{
  const s=setup(t);s.config.configure(input());const before=s.config.binding(),priorSignal=s.config.revocationSignal();
  s.config.configure(input());const next=s.config.binding();
  assert.equal(priorSignal.aborted,true);assert.equal(next.revision,before.revision+1);assert.notEqual(next.credential.secretRef,before.credential.secretRef);
  assert.throws(()=>s.config.secretStore.read(before.credential.secretRef,signal()),rejected('UNAUTHORIZED'));
  const active=s.config.revocationSignal();assert.equal(s.config.revoke().status,'unconfigured');assert.equal(active.aborted,true);assert.equal(existsSync(s.target),false);
  assert.throws(()=>s.config.secretStore.read(next.credential.secretRef,signal()),rejected('UNAUTHORIZED'));
});

test('corrupt/encryption-unavailable records are preserved; failed deletion reports incomplete revocation',t=>{
  const s=setup(t);s.config.configure(input());const raw=readFileSync(s.target,'utf8');s.config.dispose();
  const unavailable=createRemoteMcpConfig({...s.options,safeStorage:{isEncryptionAvailable:()=>false}});t.after(()=>unavailable.dispose());
  assert.equal(unavailable.snapshot().status,'unavailable');assert.equal(unavailable.binding(),undefined);assert.equal(readFileSync(s.target,'utf8'),raw);
  writeFileSync(s.target,'{"version":99,"encrypted":"invalid"}');const corrupted=createRemoteMcpConfig(s.options);t.after(()=>corrupted.dispose());
  assert.equal(corrupted.snapshot().status,'unavailable');assert.equal(readFileSync(s.target,'utf8'),'{"version":99,"encrypted":"invalid"}');
  corrupted.configure(input());const prior=corrupted.revocationSignal();
  renameSync(s.target,s.target+'.synthetic-retained');mkdirSync(s.target);
  assert.throws(()=>corrupted.revoke(),rejected('EXTERNAL_FAILURE'));
  assert.equal(corrupted.snapshot().status,'revoke_pending');assert.equal(prior.aborted,true);assert.equal(corrupted.binding(),undefined);
  assert.equal(existsSync(s.target+'.synthetic-retained'),true);
});

test('native connection confirmation reveals no token, starts no tool and is renewed after disconnect',async t=>{
  const s=setup(t),f=await fixture({requiredAuthorization:`Bearer ${token}`});s.config.configure(input());let confirmations=0;
  const host=createDesktopRemoteMcpHost({config:s.config,fetch:f.fetch,confirmConnection:async value=>{
    confirmations++;assert.ok(Object.isFrozen(value));assert.equal(value.endpoint,endpoint);assert.equal(value.hasCredentials,true);
    assert.doesNotMatch(JSON.stringify(value),/synthetic-access-token|secretRef|configurationRef/);return true;
  }});
  try{
    assert.equal(host.snapshot().connected,false);assert.equal(f.requests.length,0);
    assert.throws(()=>host.arguments({key:'public'}),rejected('UNSUPPORTED_CAPABILITY'));
    assert.equal((await host.connect({signal:signal(),deadline:future()})).connected,true);assert.equal(f.calls().length,0);
    assert.match(host.arguments({key:'public'}).bindingRef,/^[a-f0-9]{64}$/);
    await host.connect({signal:signal(),deadline:future()});assert.equal(confirmations,1);
    await host.disconnect();assert.equal(host.snapshot().connected,false);
    await host.connect({signal:signal(),deadline:future()});assert.equal(confirmations,2);
    s.config.configure(input());assert.equal(host.snapshot().connected,false);assert.equal(host.snapshot().requiresReassembly,true);
    assert.throws(()=>host.arguments({key:'public'}),rejected('REVISION_CONFLICT'));
  }finally{await host.dispose();await f.close();}
});

test('delayed native confirmation cannot connect after deny/change/cancel/deadline/disconnect/dispose',async t=>{
  for(const reason of ['deny','change','cancel','deadline','disconnect','dispose']){
    const s=setup(t),f=await fixture({requiredAuthorization:`Bearer ${token}`}),waiting=deferred(),started=deferred(),controller=new AbortController();
    s.config.configure(input());
    const host=createDesktopRemoteMcpHost({config:s.config,fetch:f.fetch,confirmConnection:()=>{started.resolve();return waiting.promise;}});
    try{
      const code=reason==='deny'?'UNAUTHORIZED':reason==='change'?'REVISION_CONFLICT':reason==='deadline'?'TIMEOUT':'CANCELLED';
      const pending=assert.rejects(host.connect({signal:controller.signal,deadline:future(reason==='deadline'?100:20000)}),rejected(code));
      await Promise.race([started.promise,pending.then(()=>assert.fail('confirmation must start before interruption'))]);
      if(reason==='change')s.config.configure(input());
      if(reason==='cancel')controller.abort();
      if(reason==='disconnect')await host.disconnect();
      if(reason==='dispose')await host.dispose();
      if(reason==='deny')waiting.resolve(false);
      await pending;waiting.resolve(true);await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(f.requests.length,0);assert.equal(host.snapshot().connected,false);
    }finally{waiting.resolve(false);await host.dispose();await f.close();}
  }
});
