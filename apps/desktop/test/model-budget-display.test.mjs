import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createConfiguredSubagentModelGateway} from '@personal-agent/runtime/application';
import {createModelApiConfig} from '../electron/model-api-config.js';

const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
const input={id:'fixture',provider:'openai-compatible',model:'synthetic',baseUrl:'https://synthetic.invalid/v1',displayName:'Synthetic',apiKey:'synthetic-private-key'};
const request=()=>({messages:[{role:'user',content:'合成 😀'}],tools:[],signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString()});
const binding={scope:'provider-body',model:'synthetic',tokenizerRef:'fixture:v1',configurationRef:'fixture-config:v1',contextTokens:100,reservedOutputTokens:20};
const measured=(inputTokens=80)=>({...binding,state:'measured',hiddenContext:'unknown',inputTokens});
function fixture(createGateway) {
  const base=new URL('../../../.cache/model-budget-display/',import.meta.url);mkdirSync(base,{recursive:true});
  const options={userData:mkdtempSync(base),safeStorage,createGateway};const host=createModelApiConfig(options);
  host.configure(input);return {host,options};
}

test('actual Provider budget reaches the native snapshot without persisting counts or private response data', async()=>{
  let calls=0;
  const {host,options}=fixture(config=>createConfiguredSubagentModelGateway({...config,contextLimitTokens:100,
    requestTokenBudget:{model:binding.model,tokenizerRef:binding.tokenizerRef,configurationRef:binding.configurationRef,
      reservedOutputTokens:20,countInputTokens:()=>80},fetch:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'Synthetic answer'}}]}));}}));
  let restored;
  try {
    const first=host.snapshot().models[0];assert.equal(first.requestBudget.state,'unmeasured');assert.equal(calls,0);
    await host.getModelGateway('fixture').complete(request());
    const sample=host.snapshot().models[0].requestBudget;
    assert.deepEqual(sample,{state:'measured',scope:'provider-body',hiddenContext:'unknown',configurationRef:first.configurationRef,
      inputTokens:80,contextTokens:100,reservedOutputTokens:20});
    sample.inputTokens=999;assert.equal(host.snapshot().models[0].requestBudget.inputTokens,80);
    const encrypted=JSON.parse(readFileSync(path.join(options.userData,'model-api-config.json'),'utf8'));
    const data=safeStorage.decryptString(Buffer.from(encrypted.encrypted,'base64'));
    assert.doesNotMatch(data,/requestBudget|inputTokens/);
    assert.doesNotMatch(JSON.stringify(host.snapshot()),/synthetic-private-key|Synthetic answer|tokenizerRef/);
    restored=createModelApiConfig(options);assert.equal(restored.snapshot().models[0].requestBudget.state,'unmeasured');
    host.configure({...input,apiKey:''});assert.equal(host.snapshot().models[0].requestBudget.state,'unmeasured');
  } finally {host.dispose();restored?.dispose();}
});

test('only the newest started request can update the budget; failures and revoked calls cannot restore stale counts', async()=>{
  const pending=[];
  const {host}=fixture(()=>({deployment:{capabilities:{requestTokenBudget:binding}},
    complete:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}));
  try {
    const gateway=host.getModelGateway('fixture');
    const old=gateway.complete(request()),latest=gateway.complete(request());
    pending[1].resolve({requestBudget:measured(79)});await latest;
    pending[0].resolve({requestBudget:measured(78)});await old;
    assert.equal(host.snapshot().models[0].requestBudget.inputTokens,79);
    const failed=gateway.complete(request());assert.equal(host.snapshot().models[0].requestBudget.state,'unmeasured');
    pending[2].reject(Error('private provider error'));await assert.rejects(failed);
    assert.equal(host.snapshot().models[0].requestBudget.state,'unmeasured');
    for (const value of [measured(81),{...measured(),tokenizerRef:'other'},
      {...measured(),contextTokens:101},{...measured(),reservedOutputTokens:21},undefined]) {
      const next=gateway.complete(request());pending.at(-1).resolve({requestBudget:value});await next;
      assert.equal(host.snapshot().models[0].requestBudget.state,'unmeasured');
    }
    const controller=new AbortController();
    const cancelled=gateway.complete({...request(),signal:controller.signal});controller.abort();
    pending.at(-1).resolve({requestBudget:measured()});await cancelled;
    assert.equal(host.snapshot().models[0].requestBudget.state,'unmeasured');
    const revoked=gateway.complete(request());host.configure({...input,apiKey:''});
    pending.at(-1).resolve({requestBudget:measured()});await assert.rejects(revoked,/撤销/);
    assert.equal(host.snapshot().models[0].requestBudget.state,'unmeasured');
  } finally {host.dispose();}
});
