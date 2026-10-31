import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRemoteMcpRegistry} from '../electron/remote-mcp-registry.js';
import {createRemoteMcpConfig} from '../electron/remote-mcp-config.js';
import {createDesktopRemoteMcpHost} from '../electron/remote-mcp-host.js';
import {remoteMcpDirectoryDigest} from '@personal-agent/mcp';
import {ToolGateway,toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {descriptor,directory,endpoint,fixture} from '../../../packages/mcp/test/remote-http-fixture.mjs';

const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
const settings=(name)=>({endpoint,server:{name:'synthetic-reference',version:'1.0.0'},
  tool:{remoteName:'reference',descriptor:{...descriptor,name:`mcp.remote.${name}`}},directoryDigest:remoteMcpDirectoryDigest(directory()),
  credential:{token:'synthetic-secret-token',expiresAt:new Date(Date.now()+60000).toISOString()}});
function location(){const parent=fileURLToPath(new URL('../../../.cache/mcp-registry/',import.meta.url));mkdirSync(parent,{recursive:true});return mkdtempSync(path.join(parent,'case-'));}

test('encrypted legacy and two independent services survive restart without restoring session permission',()=>{
  const userData=location(),legacy=createRemoteMcpConfig({userData,safeStorage});legacy.configure(settings('legacy'));
  const old=readFileSync(path.join(userData,'remote-mcp-config.json'),'utf8');legacy.dispose();
  let registry=createRemoteMcpRegistry({userData,safeStorage});
  try{
    registry.add('a',settings('a'));registry.add('b',settings('b'));
    assert.deepEqual(registry.list().map(value=>value.id).sort(),['a','b','legacy']);
    const a=registry.get('a'),b=registry.get('b'),binding=a.binding(),other=b.binding(),signal=a.revocationSignal();
    a.configure(settings('a'));assert.equal(signal.aborted,true);assert.deepEqual(b.binding(),other);
    assert.notEqual(a.binding().revision,binding.revision);
    for(const id of ['a','b'])assert.doesNotMatch(readFileSync(path.join(userData,'remote-mcp-servers',id,'remote-mcp-config.json'),'utf8'),/synthetic-secret-token/);
    assert.equal(readFileSync(path.join(userData,'remote-mcp-config.json'),'utf8'),old);
    registry.dispose();registry=createRemoteMcpRegistry({userData,safeStorage});
    assert.deepEqual(registry.list().map(value=>value.id).sort(),['a','b','legacy']);
    assert.ok(registry.list().every(value=>value.status==='saved_disconnected'&&!value.connected&&!value.sessionAllowed));
    assert.notEqual(registry.get('a').binding().configurationRef,binding.configurationRef);
    registry.revoke('a');assert.deepEqual(registry.list().map(value=>value.id).sort(),['b','legacy']);
    assert.equal(readFileSync(path.join(userData,'remote-mcp-config.json'),'utf8'),old);
  }finally{registry.dispose();}
});

test('failed additions preserve legacy ciphertext and reject unsafe or duplicate service IDs',()=>{
  const userData=location(),legacy=createRemoteMcpConfig({userData,safeStorage});legacy.configure(settings('legacy'));legacy.dispose();
  const file=path.join(userData,'remote-mcp-config.json'),old=readFileSync(file,'utf8');
  const registry=createRemoteMcpRegistry({userData,safeStorage});
  try{
    for(const id of ['legacy','../a','A','a/b',''])assert.throws(()=>registry.add(id,settings('a')));
    registry.add('a',settings('a'));assert.throws(()=>registry.add('a',settings('a')));
    assert.throws(()=>registry.add('invalid',{...settings('bad'),endpoint:'http://synthetic.example'}));
    assert.equal(readFileSync(file,'utf8'),old);
  }finally{registry.dispose();}
  const unavailable=createRemoteMcpRegistry({userData,safeStorage:{...safeStorage,isEncryptionAvailable:()=>false}});
  try{assert.equal(unavailable.get('legacy').snapshot().status,'unavailable');assert.throws(()=>unavailable.add('new',settings('new')));
    assert.equal(readFileSync(file,'utf8'),old);}finally{unavailable.dispose();}
});

test('legacy migration copies only encrypted bytes and never removes the source or restores its session',()=>{
  const userData=location(),legacy=createRemoteMcpConfig({userData,safeStorage});legacy.configure(settings('legacy'));legacy.dispose();
  const file=path.join(userData,'remote-mcp-config.json'),old=readFileSync(file);
  let registry=createRemoteMcpRegistry({userData,safeStorage});
  try{
    const before=registry.get('legacy').binding(),migrated=registry.migrateLegacy('migrated');
    assert.equal(migrated.status,'saved_disconnected');assert.equal(migrated.sessionAllowed,false);
    assert.deepEqual(readFileSync(file),old);
    assert.deepEqual(readFileSync(path.join(userData,'remote-mcp-servers','migrated','remote-mcp-config.json')),old);
    assert.notEqual(registry.get('migrated').binding().configurationRef,before.configurationRef);
    assert.equal(registry.migrateLegacy('migrated').status,'saved_disconnected');assert.deepEqual(readFileSync(file),old);
    registry.dispose();registry=createRemoteMcpRegistry({userData,safeStorage});
    assert.deepEqual(registry.list().map(value=>value.id).sort(),['legacy','migrated']);
    assert.ok(registry.list().every(value=>!value.connected && !value.sessionAllowed));
  }finally{registry.dispose();}
});

test('interrupted legacy migration retains original ciphertext and is not loaded after restart',()=>{
  const userData=location(),legacy=createRemoteMcpConfig({userData,safeStorage});legacy.configure(settings('legacy'));legacy.dispose();
  const file=path.join(userData,'remote-mcp-config.json'),old=readFileSync(file);let reads=0;
  const failing={...safeStorage,decryptString:value=>{if(++reads>1)throw Error('synthetic failure');return safeStorage.decryptString(value);}};
  let registry=createRemoteMcpRegistry({userData,safeStorage:failing});
  try{assert.throws(()=>registry.migrateLegacy('incomplete'));assert.deepEqual(readFileSync(file),old);}
  finally{registry.dispose();}
  registry=createRemoteMcpRegistry({userData,safeStorage});
  try{assert.deepEqual(registry.list().map(value=>value.id),['legacy']);assert.deepEqual(readFileSync(file),old);
    assert.throws(()=>registry.add('incomplete',settings('new')));}finally{registry.dispose();}
});

test('two persisted service configurations connect and revoke independently through the existing gateway',async()=>{
  const userData=location(),registry=createRemoteMcpRegistry({userData,safeStorage});
  const a=await fixture({requiredAuthorization:'Bearer synthetic-secret-token'}),b=await fixture({requiredAuthorization:'Bearer synthetic-secret-token'});
  const policy=new InMemoryAuthorizationPolicy(),gateway=new ToolGateway({policy});
  registry.add('a',settings('a'));registry.add('b',settings('b'));
  const host=(id,f)=>createDesktopRemoteMcpHost({config:registry.get(id),fetch:f.fetch,confirmConnection:async()=>true});
  const first=host('a',a),second=host('b',b),releases=[first.register(gateway),second.register(gateway)];
  const deadline=()=>new Date(Date.now()+20000).toISOString(),signal=()=>new AbortController().signal;
  const invoke=async(id,active)=>{const args=active.arguments({key:'public'}),toolName=`mcp.remote.${id}`,runId=`run-${id}`,taskId=`task-${id}`;
    policy.grant({authorizationRef:runId,taskId,toolName,scopes:descriptor.requiredScopes,argumentsDigest:toolArgumentsDigest(args),maxUses:1,expiresAt:deadline()});
    return gateway.invoke({taskId,runId,authorizationRef:runId,toolName,toolVersion:descriptor.version,arguments:args,deadline:deadline(),signal:signal()});};
  try{
    await first.connect({signal:signal(),deadline:deadline()});await second.connect({signal:signal(),deadline:deadline()});
    assert.deepEqual(await invoke('a',first),{text:'public synthetic reference'});
    assert.deepEqual(await invoke('b',second),{text:'public synthetic reference'});
    assert.equal(a.calls().length,1);assert.equal(b.calls().length,1);
    registry.revoke('a');assert.equal(second.snapshot().connected,true);
    assert.throws(()=>first.arguments({key:'public'}));assert.equal(b.calls().length,1);
    await second.disconnect();assert.equal(second.snapshot().connected,false);
  }finally{for(const release of releases)release();await first.dispose();await second.dispose();registry.dispose();await a.close();await b.close();}
});
