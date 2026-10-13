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
