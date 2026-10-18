import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentArtsTransportConfig,agentArtsTransportNotice} from '../electron/agentarts-transport-config.js';

const binding={gatewayUrl:'https://synthetic.huaweicloud-agentarts.com',runtimeName:'owned-preview'};
const token='synthetic-inner-credential-no-real-secret';
const directUrl='wss://synthetic.huaweicloud-agentarts.com/runtimes/owned-preview/ws';
const prefixUrl='wss://synthetic.huaweicloud-agentarts.com/runtimes/owned-preview/invocations/ws';
test('WSS host credentials remain separate, re-readable and absent from serialized options',async()=>{
  const environment={PA_AGENTARTS_TRANSPORT:'wss',PA_AGENTARTS_WSS_URL:directUrl,PA_AGENTARTS_APP_TOKEN:token};
  const options=createAgentArtsTransportConfig({binding,environment});
  assert.equal(options.websocketUrl,'wss://synthetic.huaweicloud-agentarts.com/runtimes/owned-preview/ws');
  assert.equal(options.allowHttpsFallback,false);
  assert.doesNotMatch(JSON.stringify(options),/synthetic-inner|Bearer/);
  assert.equal(await options.websocketAuthorizationProvider.read(),`Bearer ${token}`);
  environment.PA_AGENTARTS_APP_TOKEN=token+'-rotated';
  assert.equal(await options.websocketAuthorizationProvider.read(),`Bearer ${token}-rotated`);
  delete environment.PA_AGENTARTS_APP_TOKEN;
  await assert.rejects(options.websocketAuthorizationProvider.read(),/入站凭据/);
});
test('Legacy configuration is retained, while WSS fallback needs explicit opt-in and destination binding',()=>{
  assert.deepEqual(createAgentArtsTransportConfig({binding,environment:{}}),{transport:'https'});
  const environment={PA_AGENTARTS_TRANSPORT:'wss',PA_AGENTARTS_WSS_URL:directUrl,
    PA_AGENTARTS_APP_TOKEN:token,PA_AGENTARTS_HTTPS_FALLBACK:'1'};
  assert.equal(createAgentArtsTransportConfig({binding,environment}).allowHttpsFallback,true);
  for (const url of ['ws://synthetic.huaweicloud-agentarts.com/runtimes/owned-preview/ws',
    'wss://other.huaweicloud-agentarts.com/runtimes/owned-preview/ws',
    'wss://synthetic.huaweicloud-agentarts.com/runtimes/other/ws',
    'wss://synthetic.huaweicloud-agentarts.com/runtimes/owned-preview/invocations/other/ws',
    'wss://synthetic.huaweicloud-agentarts.com/runtimes/owned-preview/ws/',
    'wss://synthetic.huaweicloud-agentarts.com/runtimes/other/../owned-preview/ws',
    'wss://user:private@synthetic.huaweicloud-agentarts.com/runtimes/owned-preview/ws']) {
    assert.throws(()=>createAgentArtsTransportConfig({binding,environment:{...environment,PA_AGENTARTS_WSS_URL:url}}),/同一网关/);
  }
  for (const invalid of [{PA_AGENTARTS_TRANSPORT:'ws'},{PA_AGENTARTS_HTTPS_FALLBACK:'yes'},
    {PA_AGENTARTS_HTTPS_FALLBACK:'1'},{PA_AGENTARTS_WSS_URL:'wss://synthetic.test/ws'},
    {PA_AGENTARTS_TRANSPORT:'wss'},
    {PA_AGENTARTS_TRANSPORT:'wss',PA_AGENTARTS_APP_TOKEN:token+'\n'}]) {
    assert.throws(()=>createAgentArtsTransportConfig({binding,environment:invalid}));
  }
});
test('WSS requires an explicit URL and never derives or probes a public gateway address',()=>{
  for (const url of [undefined,null,'',' ',directUrl+'?',directUrl+'#',directUrl+'?token=private',
    directUrl+'#fragment',directUrl+'\n']) {
    assert.throws(()=>createAgentArtsTransportConfig({binding,environment:{PA_AGENTARTS_TRANSPORT:'wss',
      PA_AGENTARTS_APP_TOKEN:token,...(url===undefined?{}:{PA_AGENTARTS_WSS_URL:url})}}),/WSS|PA_AGENTARTS_WSS_URL/);
  }
});
test('both exact runtime-bound paths are supported only when explicitly configured',async()=>{
  for (const url of [directUrl,prefixUrl]) {
    const options=createAgentArtsTransportConfig({binding,environment:{PA_AGENTARTS_TRANSPORT:'wss',
      PA_AGENTARTS_WSS_URL:url,PA_AGENTARTS_APP_TOKEN:token}});
    assert.equal(options.websocketUrl,url);assert.equal(options.allowHttpsFallback,false);
    assert.equal(await options.websocketAuthorizationProvider.read(),`Bearer ${token}`);
    assert.equal('factory' in options,false);
  }
});
test('Transport notices make fallback and unknown outcomes visible without forwarding frame data',()=>{
  assert.match(agentArtsTransportNotice({state:'https_fallback'}),/备用/);
  assert.match(agentArtsTransportNotice({state:'result_unknown',requestId:'private'}),/停止自动重发/);
  assert.doesNotMatch(agentArtsTransportNotice({state:'result_unknown',requestId:'private'}),/private/);
  assert.equal(agentArtsTransportNotice({state:'wss_ready'}),'');
});

const invocationUrl=binding.gatewayUrl+'/runtimes/'+binding.runtimeName+'/invocations';
const requestInit=()=>({method:'POST',redirect:'error',headers:{Authorization:'Bearer public-outer'},body:'{"query":"public fixture"}',signal:new AbortController().signal});
test('HTTPS attaches current host token and exact version only at its original destination and never serializes credentials',async()=>{
  let current={appToken:token,deploymentVersion:'arm64-v4-e38ef23d-r2'};const calls=[];
  const options=createAgentArtsTransportConfig({binding,environment:{},configurationProvider:{read:()=>current},
    fetchImpl:async(url,init)=>{calls.push({url,init});return {status:200};}});
  assert.doesNotMatch(JSON.stringify(options),/synthetic-inner|Bearer/);
  const original=requestInit();await options.fetchImpl(invocationUrl,original);
  assert.equal(calls[0].url,invocationUrl+'?endpoint=arm64-v4-e38ef23d-r2');assert.equal(calls[0].init.redirect,'error');
  assert.equal(new Headers(calls[0].init.headers).get('X-PA-Agent-Token'),'Bearer '+token);
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'),'Bearer public-outer');
  assert.equal(new Headers(original.headers).has('X-PA-Agent-Token'),false,'caller input is never mutated');
  current={appToken:token+'-rotated',deploymentVersion:'arm64-v4-e38ef23d-r2'};await options.fetchImpl(invocationUrl,requestInit());
  assert.equal(calls[1].url,invocationUrl+'?endpoint=arm64-v4-e38ef23d-r2');assert.equal(new Headers(calls[1].init.headers).get('X-PA-Agent-Token'),'Bearer '+token+'-rotated');
  current={appToken:token,deploymentVersion:'v4-next'};
  assert.throws(()=>options.fetchImpl(invocationUrl,requestInit()),/固定部署版本/);
  current={};assert.throws(()=>options.fetchImpl(invocationUrl,requestInit()),/固定部署版本/);
  assert.equal(calls.length,2);
});
test('HTTPS rejects another destination, query, redirect, forged token and cancellation before any network send',async()=>{
  let reads=0,sends=0;const options=createAgentArtsTransportConfig({binding,environment:{},
    configurationProvider:{read:()=>{reads++;return {appToken:token,deploymentVersion:'v4'};}},fetchImpl:async()=>{sends++;}});
  for(const url of [invocationUrl.replace('synthetic.','other.'),invocationUrl.replace('owned-preview','other-runtime'),
    invocationUrl+'?endpoint=other',invocationUrl+'?endpoint=v4&endpoint=v4',invocationUrl+'?endpoint=v4&token=private',invocationUrl+'#fragment',invocationUrl+'/',invocationUrl.replace('/owned-preview/','/other/../owned-preview/'),
    invocationUrl.replace('https:','http:'),invocationUrl.replace('https://','https://user:pass@')]) {
    assert.throws(()=>options.fetchImpl(url,requestInit()),/目的地/);
  }
  assert.equal(reads,1,'only construction reads the fixed version');assert.equal(sends,0);
  for(const init of [{...requestInit(),method:'GET'},{...requestInit(),redirect:'follow'},
    {...requestInit(),headers:{'x-pa-agent-token':'Bearer forged-public-fixture'}},
    {...requestInit(),signal:AbortSignal.abort()}])assert.throws(()=>options.fetchImpl(invocationUrl,init));
  assert.equal(sends,0);
});
test('explicit HTTPS graph URL keeps the host-selected version and original header rejection',async()=>{
  const calls=[];let current={appToken:token,deploymentVersion:'v-next'};
  const options=createAgentArtsTransportConfig({binding,environment:{},configurationProvider:{read:()=>current},
    fetchImpl:async(url,init)=>{calls.push({url,init});return {status:200};}});
  await options.fetchImpl(invocationUrl+'?endpoint=v-next',requestInit());
  assert.equal(options.fetchHandlesHostAuthorization,true,'only the trusted fetch closure owns HTTP host authentication');
  assert.equal(calls[0].url,invocationUrl+'?endpoint=v-next');
  assert.equal(new Headers(calls[0].init.headers).get('X-PA-Agent-Token'),'Bearer '+token);
  for(const supplied of ['Bearer '+token,'Bearer forged'])assert.throws(()=>options.fetchImpl(invocationUrl+'?endpoint=v-next',
    {...requestInit(),headers:{'X-PA-Agent-Token':supplied}}),/受信配置/);
  current={appToken:token,deploymentVersion:'other'};
  assert.throws(()=>options.fetchImpl(invocationUrl+'?endpoint=v-next',requestInit()),/固定部署版本/);
  assert.equal(calls.length,1);
});

test('current configuration failure, removal or invalid values stop sending and cannot silently use an old token',async()=>{
  let current={appToken:token,deploymentVersion:'v4'},failure=false,sends=0;
  const options=createAgentArtsTransportConfig({binding,environment:{},configurationProvider:{read:()=>{
    if(failure)throw Error('Current binding revoked');return current;}},fetchImpl:async()=>{sends++;}});
  await options.fetchImpl(invocationUrl,requestInit());assert.equal(sends,1);
  failure=true;assert.throws(()=>options.fetchImpl(invocationUrl,requestInit()),/revoked/);assert.equal(sends,1);failure=false;
  for(const invalid of [null,undefined,{appToken:'short'},{appToken:token+'\n'},{deploymentVersion:'v4?token=x'},Promise.resolve({appToken:token}),{unknown:true}]) {
    current=invalid;assert.throws(()=>options.fetchImpl(invocationUrl,requestInit()),/无效/);assert.equal(sends,1);
  }
});
test('WSS binds a trusted deployment to the explicit base, refreshes its token and rejects a changed version',async()=>{
  let current={appToken:token,deploymentVersion:'arm64-v4-e38ef23d-r2'};
  const environment={PA_AGENTARTS_TRANSPORT:'wss',PA_AGENTARTS_WSS_URL:directUrl};
  const options=createAgentArtsTransportConfig({binding,environment,configurationProvider:{read:()=>current}});
  assert.equal(options.websocketUrl,directUrl+'?endpoint=arm64-v4-e38ef23d-r2');
  assert.equal(await options.websocketAuthorizationProvider.read(),'Bearer '+token);
  current={...current,appToken:token+'-refreshed'};
  assert.equal(await options.websocketAuthorizationProvider.read(),'Bearer '+token+'-refreshed');
  current={appToken:token,deploymentVersion:'different-version'};
  await assert.rejects(options.websocketAuthorizationProvider.read(),/固定部署版本/);
  assert.throws(()=>options.fetchImpl(invocationUrl,requestInit()),/固定部署版本/);
  assert.doesNotMatch(JSON.stringify(options),/synthetic-inner|Bearer/);
});
test('WSS endpoint query must exactly match the independent trusted deployment and never carry another parameter',()=>{
  const version='arm64-v4-e38ef23d-r2',configurationProvider={read:()=>({appToken:token,deploymentVersion:version})};
  for(const base of [directUrl,prefixUrl]) {
    const environment={PA_AGENTARTS_TRANSPORT:'wss',PA_AGENTARTS_WSS_URL:base+'?endpoint='+version};
    assert.equal(createAgentArtsTransportConfig({binding,environment,configurationProvider}).websocketUrl,base+'?endpoint='+version);
    for(const query of ['?endpoint=forged','?endpoint='+version+'&endpoint='+version,'?endpoint='+version+'&token=private',
      '?token=private','?endpoint=','?endpoint='+version+'&','?%65ndpoint='+version,'?endpoint=arm64%2Dv4','?',
      '?endpoint='+('x'.repeat(129))]) {
      assert.throws(()=>createAgentArtsTransportConfig({binding,configurationProvider,environment:{...environment,PA_AGENTARTS_WSS_URL:base+query}}));
    }
    assert.throws(()=>createAgentArtsTransportConfig({binding,environment:{...environment,PA_AGENTARTS_APP_TOKEN:token}}),/受信部署版本/);
  }
});
test('explicit WSS HTTPS fallback preserves its bound version and accepts only the original current host credential',async()=>{
  const version='arm64-v4-e38ef23d-r2',calls=[];let current={appToken:token,deploymentVersion:version};
  const options=createAgentArtsTransportConfig({binding,environment:{PA_AGENTARTS_TRANSPORT:'wss',PA_AGENTARTS_WSS_URL:directUrl,PA_AGENTARTS_HTTPS_FALLBACK:'1'},
    configurationProvider:{read:()=>current},fetchImpl:async(url,init)=>{calls.push({url,init});return {status:200};}});
  const init={...requestInit(),headers:{Authorization:'Bearer public-outer','X-PA-Agent-Token':'Bearer '+token}};
  await options.fetchImpl(invocationUrl+'?endpoint='+version,init);
  assert.equal(calls[0].url,invocationUrl+'?endpoint='+version);assert.equal(new Headers(calls[0].init.headers).get('X-PA-Agent-Token'),'Bearer '+token);
  assert.throws(()=>options.fetchImpl(invocationUrl+'?endpoint=forged',init),/目的地/);
  assert.throws(()=>options.fetchImpl(invocationUrl+'?endpoint='+version,{...init,headers:{'X-PA-Agent-Token':'Bearer forged'}}),/受信配置/);
  for(const input of [undefined,null,1])assert.throws(()=>options.fetchImpl(input,init),/目的地/);
  current={...current,deploymentVersion:'new-version'};
  assert.throws(()=>options.fetchImpl(invocationUrl+'?endpoint='+version,init),/固定部署版本/);assert.equal(calls.length,1);
});
