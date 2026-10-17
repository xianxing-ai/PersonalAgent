import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionModelRegistry,loadExecutionModelConfiguration} from '../src/model-catalog.mjs';
import {createAgentServer} from '../src/server.mjs';
import {createAgentArtsModelFetch} from '../src/model-proxy.mjs';
const entry=(id='a')=>({id,displayName:id,reasoningEfforts:['none','high'],requestProfile:'deepseek-native-v1',route:'agentarts-proxy'});
const config=()=>({version:'1.0',defaultModelId:'a',models:[entry()]});
const provider={deployment:{model:'a'},complete:async request=>request};
const registry=configuration=>createExecutionModelRegistry({configuration,createProvider:()=>provider});
test('trusted catalog file is exclusive, read only at startup, and failures hide path and content',async()=>{
 assert.equal(await loadExecutionModelConfiguration({}),undefined);
 assert.equal(await loadExecutionModelConfiguration({PA_AGENT_MODEL_CATALOG:'inline'}),'inline');
 const path='/trusted/default-model-catalog.json';let reads=0;
 const result=await loadExecutionModelConfiguration({PA_AGENT_MODEL_CATALOG_FILE:path},{read:async(file,encoding)=>{reads++;assert.equal(file,path);assert.equal(encoding,'utf8');return JSON.stringify(config());}});
 assert.deepEqual(result,config());assert.equal(reads,1);
 await assert.rejects(loadExecutionModelConfiguration({PA_AGENT_MODEL_CATALOG:'x',PA_AGENT_MODEL_CATALOG_FILE:path}),{code:'INVALID_ARGUMENT'});
 for(const read of [async()=>{throw Error('private-path-and-key');},async()=>'{invalid-private-content']){
  await assert.rejects(loadExecutionModelConfiguration({PA_AGENT_MODEL_CATALOG_FILE:path},{read}),error=>error.code==='INVALID_ARGUMENT'&&!error.message.includes('private')&&!error.message.includes(path));
 }
 await assert.rejects(loadExecutionModelConfiguration({PA_AGENT_MODEL_CATALOG_FILE:''}),{code:'INVALID_ARGUMENT'});
});
test('existing invocation reads catalog only with inner credential and never dispatches a task',async t=>{
 const token='c'.repeat(32),executionModels=registry(config());let calls=0;
 const server=createAgentServer({mode:'standalone-validation',wssAuthToken:token,executionModels,orchestrator:{invoke:async()=>{calls++;}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const url=`http://127.0.0.1:${server.address().port}/invocations`;
 const send=(query,headers={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({query:JSON.stringify(query)})});
 const query={modelCatalogVersion:'1.0',action:'list'};
 assert.equal((await send(query)).status,401);
 const response=await send(query,{'x-pa-agent-token':`Bearer ${token}`});assert.equal(response.status,200);
 assert.deepEqual(JSON.parse((await response.json())[0].data.text),executionModels.catalog());
 assert.equal((await send({...query,prompt:'forged'},{'x-pa-agent-token':`Bearer ${token}`})).status,400);assert.equal(calls,0);
});
test('explicit Beijing route validates fixed origin and logs binding without payload or key',async()=>{
 const endpoint='https://workspace-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';let record;
 const options={endpoint,model:'a',route:'runtime-bailian',authentication:{kind:'api_key',headerName:'Authorization',keyPrefix:'Bearer',readSecret:()=> 'fixture-key'},onRecord:value=>{if(value.event==='model_proxy_response')record=value;},
  fetch:async(url,init)=>{assert.equal(url,endpoint+'/chat/completions');assert.equal(init.headers.get('authorization'),'Bearer fixture-key');return Response.json({model:'returned-a'});}};
 const fetchModel=createAgentArtsModelFetch(options);
 await fetchModel(endpoint+'/chat/completions',{method:'POST',headers:{},body:JSON.stringify({model:'a',stream:false,reasoning_effort:'high',messages:[{role:'user',content:'private-fixture-prompt'}]}),signal:new AbortController().signal});
 assert.equal(record.route,'runtime-bailian');assert.equal(record.reasoningEffort,'high');assert.equal(record.responseModel,'returned-a');
 assert.equal(JSON.stringify(record).includes('fixture-key'),false);assert.equal(JSON.stringify(record).includes('private-fixture-prompt'),false);
 for(const badEndpoint of ['https://example.com/compatible-mode/v1','https://workspace-test.cn-shanghai.maas.aliyuncs.com/compatible-mode/v1',endpoint+ '?key=bad'])assert.throws(()=>createAgentArtsModelFetch({...options,endpoint:badEndpoint}),{code:'INVALID_ARGUMENT'});
});
test('directory canonical digest binds metadata and clone cannot mutate trusted routing',()=>{
 const first=config();first.models.push(entry('b'));const second=structuredClone(first);second.models.reverse();second.models[0].reasoningEfforts.reverse();
 const a=registry(first),b=registry(JSON.stringify(second));assert.equal(a.catalog().revision,b.catalog().revision);
 const publicValue=a.catalog();assert.match(publicValue.revision,/^[a-f0-9]{64}$/u);publicValue.models[0].id='changed';assert.equal(a.catalog().models[0].id,'a');
 second.models[0].displayName='new';assert.notEqual(a.catalog().revision,registry(second).catalog().revision);
});
test('selection resolves selected provider and native effort without altering messages',async()=>{
 const calls=[];const value=config();value.models.push(entry('b'));
 const r=createExecutionModelRegistry({configuration:value,createProvider:e=>({deployment:{model:e.id},complete:async request=>{calls.push(e.id);return request;}})});
 const messages=[{role:'user',content:'public fixture'}];const selected=r.resolve({catalogRevision:r.catalog().revision,modelId:'b',reasoningEffort:'high'});
 const result=await selected.complete({messages,reasoningEffort:'none'});assert.equal(result.reasoningEffort,'high');assert.equal(result.messages,messages);assert.deepEqual(calls,['b']);
 assert.equal((await r.resolve().complete({messages,reasoningEffort:'high'})).reasoningEffort,undefined);
});
test('unknown schema fields, revision, id and unsupported efforts are rejected',()=>{
 for(const change of [v=>v.key='secret',v=>v.models[0].url='https://bad.invalid',v=>v.models.push(entry()),v=>v.models[0].reasoningEfforts=['fake'],v=>v.defaultModelId='missing']){
  const value=config();change(value);assert.throws(()=>registry(value),{code:'INVALID_ARGUMENT'});
 }
 const r=registry(config()),base={catalogRevision:r.catalog().revision,modelId:'a'};
 for(const value of [{...base,extra:true},{...base,catalogRevision:'old'},{...base,modelId:'missing'},{...base,reasoningEffort:'ultra'}])assert.throws(()=>r.resolve(value),{code:'INVALID_ARGUMENT'});
 assert.throws(()=>r.resolve({...base,reasoningEffort:'low'}),{code:'UNSUPPORTED_CAPABILITY'});
});
test('large catalogs expose non-text and unavailable entries without treating them as thought models',()=>{
 const value=config();value.models.push(...Array.from({length:176},(_,i)=>({...entry('model-'+i),type:i===0?'audio':'text',availability:i===1?'unavailable':'unverified',route:'runtime-bailian'})));
 const r=registry(value);assert.equal(r.catalog().models.length,177);
 for(const modelId of ['model-0','model-1'])assert.throws(()=>r.resolve({catalogRevision:r.catalog().revision,modelId}),{code:'UNSUPPORTED_CAPABILITY'});
 assert.equal(r.resolve({catalogRevision:r.catalog().revision,modelId:'model-175'}).deployment.model,'a');
});
