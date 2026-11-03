import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {createModelApiConfig} from '../electron/model-api-config.js';
import {createDesktopEgressHost} from '../electron/egress-host.js';

const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()};
const request=content=>({messages:[{role:'user',content}],tools:[],signal:new AbortController().signal,deadline:new Date(Date.now()+60000).toISOString()});
function fixture(){
  const base=new URL('../../../.cache/egress-model-api/',import.meta.url);mkdirSync(base,{recursive:true});
  const sent=[];
  const createGateway=config=>({deployment:{provider:'fixture',deployment:config.deployment,model:config.model},
    complete:input=>config.fetch(config.baseUrl+'/chat/completions',{method:'POST',body:JSON.stringify({messages:input.messages}),signal:input.signal})});
  const host=createModelApiConfig({userData:mkdtempSync(base),safeStorage,createGateway,createGuardedGateway:createGateway,
    fetchImpl:async(url,init)=>{sent.push({url,body:init.body});return {response:{kind:'final',text:'explicit fake response'}};}});
  const model=host.configure({id:'fixture',provider:'openai-compatible',baseUrl:'https://model.example.test/v1',model:'fixture',displayName:'Fixture',apiKey:'fake-credential'}).models[0];
  return {host,sent,model,gateway:host.getModelGateway(model.id,model.configurationRef)};
}

test('production Model API fetch requires a local gate and blocks forbidden body before the provider',async t=>{
  const {host,sent,gateway}=fixture();t.after(()=>host.dispose());
  await assert.rejects(gateway.complete(request('public fixture')),error=>error.code==='UNSUPPORTED_CAPABILITY');
  host.setEgressHost(createDesktopEgressHost({classifyLocally:()=> 'public'}));
  await assert.rejects(gateway.complete(request('person@example.test')),error=>error.code==='UNAUTHORIZED');
  assert.equal(sent.length,0);
  await gateway.complete(request('public fixture'));assert.equal(sent.length,1);
});

test('concurrent model requests keep their own payload, deadline and cancellation scope',async t=>{
  const {host,sent,gateway}=fixture();t.after(()=>host.dispose());const seen=[];
  host.setEgressHost(createDesktopEgressHost({classifyLocally:async scope=>{seen.push(scope);await new Promise(setImmediate);return 'public';}}));
  const first=request('public first'),second={...request('public second'),deadline:new Date(Date.now()+30000).toISOString()};
  await Promise.all([gateway.complete(first),gateway.complete(second)]);
  assert.equal(sent.length,2);assert.equal(new Set(seen.map(item=>item.requestId)).size,2);
  assert.deepEqual(seen.map(item=>item.deadline),[first.deadline,second.deadline]);assert.notEqual(seen[0].signal,seen[1].signal);
});

test('replacing the gate while local classification waits prevents the original provider send',async t=>{
  const {host,sent,model}=fixture();t.after(()=>host.dispose());let finalChecks=0;
  host.setEgressHost(createDesktopEgressHost({classifyLocally:()=>{host.setEgressHost(createDesktopEgressHost({classifyLocally:()=> 'public'}));return 'public';}}));
  const gateway=host.getGuardedModelGateway(model.id,model.configurationRef,()=>{finalChecks++;});
  await assert.rejects(gateway.complete(request('public fixture')),error=>error.code==='UNAUTHORIZED');
  assert.equal(sent.length,0);assert.equal(finalChecks,0);
});
