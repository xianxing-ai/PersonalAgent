import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {createAgentArtsConfig} from '../electron/agentarts-config.js';
import {createDesktopEgressHost} from '../electron/egress-host.js';

test('AgentArts production configuration gates actual fixed endpoint/body for ordinary and paired invocations',async()=>{
  const base=new URL('../../../.cache/egress-agentarts/',import.meta.url);mkdirSync(base,{recursive:true});const sent=[],seen=[];
  const config=createAgentArtsConfig({userData:mkdtempSync(base),environment:{},
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()},
    fetchImpl:async(url,init)=>{sent.push({url,body:init.body});return {status:200};}});
  config.configure({gatewayUrl:'https://agentarts.example.test',runtimeName:'fixture',authorization:'Bearer fixture-outer',transport:'https',deploymentVersion:'fixed-v1'});
  const binding=config.binding(),transport=config.transportConfig(binding),url=binding.gatewayUrl+'/runtimes/fixture/invocations';
  const init=payload=>({method:'POST',redirect:'error',body:JSON.stringify({query:JSON.stringify(payload)}),signal:new AbortController().signal,
    headers:{Authorization:'Bearer fixture-outer','X-Request-Id':'fixture-request','X-PA-Deadline':new Date(Date.now()+60000).toISOString()}});
  await assert.rejects(transport.fetchImpl(url,init({goal:'public'})),error=>error.code==='UNSUPPORTED_CAPABILITY');assert.equal(sent.length,0);
  config.setEgressHost(createDesktopEgressHost({classifyLocally:scope=>{seen.push(scope);return 'public';}}));
  await transport.fetchImpl(url,init({goal:'public fixture'}));
  await transport.fetchImpl(url+'?endpoint=fixed-v1',init({evaluationVersion:1,samples:[{input:'public fixture'}]}));
  assert.equal(sent.length,2);assert.equal(seen.length,2);
  for(let index=0;index<2;index++){assert.equal(seen[index].destination,url+'?endpoint=fixed-v1');assert.equal(seen[index].payload,sent[index].body);assert.equal(seen[index].payload.includes('Bearer'),false);}
  await assert.rejects(transport.fetchImpl(url,init({goal:'person@example.test'})),error=>error.code==='UNAUTHORIZED');assert.equal(sent.length,2);
  let active=true;const original=init({goal:'original source'});
  const source={requestId:original.headers['X-Request-Id'],destination:url,payload:original.body,deadline:original.headers['X-PA-Deadline'],
    signal:original.signal,isCurrent:()=>active};
  const lease=await transport.preparePayload(source);lease.assertBeforeSend({destination:url,payload:original.body});
  assert.equal(seen.at(-1).destination,url+'?endpoint=fixed-v1');
  active=false;
  await assert.rejects(transport.fetchImpl(url,original),error=>error.code==='UNAUTHORIZED');assert.equal(sent.length,2);
});
