import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createRuntimeOwnedWorkflowImageAdapter} from '../dist/application.js';
import {AGENTARTS_TRANSPORT_VERSION} from '@personal-agent/contracts/agentarts-transport';
import {createAgentArtsTransportConfig} from '../../desktop/electron/agentarts-transport-config.js';
import {deriveOwnedWorkflowKeys} from '@personal-agent/agentarts';
const result={workflowVersion:'1.0.0',workflowId:'F15',state:'progress',verification:'unverified',checkpoint:'synthetic-seal',nodes:{},proposals:[],unavailable:[],feedback:[]};
const response=()=>new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(result)}},{event:'task_end'},{event:'end'}]),{headers:{'content-type':'application/json'}});
const original={gatewayUrl:'https://fixture.invalid',runtimeName:'fixture-runtime',deploymentVersion:'v-fixed',
  authorizationProvider:{read:async()=> 'Bearer synthetic-platform-key'},websocketAuthorizationProvider:{read:async()=> 'Bearer synthetic-app-key-with-more-than-32-characters'}};
const request=()=>({workflowId:'F15',taskId:'fixture-task',sessionId:'fixture-session',controlRevision:1,requestId:'fixture-request',input:{goal:'Public synthetic fixture'},availableTools:[],
  deadline:new Date(Date.now()+10000).toISOString(),signal:new AbortController().signal});

test('actual Desktop HTTPS configuration supplies host-only receipt identity before isolation start',async()=>{
  const token='synthetic-desktop-https-host-credential-more-than-32';
  let configuration={appToken:token,deploymentVersion:'v-fixed'};const calls=[];
  const desktop=createAgentArtsTransportConfig({binding:original,environment:{},configurationProvider:{read:()=>configuration},
    fetchImpl:async(url,init)=>{calls.push({url,init});return response();}});
  assert.equal(desktop.websocketAuthorizationProvider,undefined);
  const adapter=createRuntimeOwnedWorkflowImageAdapter({...original,websocketAuthorizationProvider:undefined,...desktop,
    readReceiptSecret:desktop.readOwnedWorkflowReceiptSecret});
  try {
    const secret=await adapter.receiptSecret(new AbortController().signal);
    assert.equal(secret,deriveOwnedWorkflowKeys({transportToken:token}).receiptSecret);
    assert.deepEqual(await adapter.advance(request()),result);assert.equal(calls.length,1);
    assert.equal(calls[0].init.headers['x-pa-agent-token'],'Bearer '+token);
    assert.ok(!calls[0].init.body.includes(token));assert.ok(!calls[0].init.body.includes(secret));
    assert.ok(!JSON.stringify(desktop).includes(token));assert.ok(!JSON.stringify(desktop).includes(secret));
    configuration={...configuration,deploymentVersion:'changed'};
    await assert.rejects(adapter.receiptSecret(new AbortController().signal),/固定部署版本/);
    assert.equal(calls.length,1);
  }finally{adapter.close();}
});
test('owned HTTP invocation independently pins the exact deployment and only trusted wrapper marker suppresses its host header',async()=>{
  for(const marker of [undefined,true]){
    const calls=[];const adapter=createRuntimeOwnedWorkflowImageAdapter({...original,fetchHandlesHostAuthorization:marker,
      fetchImpl:async(url,init)=>{calls.push({url,init});return response();}});
    try{assert.deepEqual(await adapter.advance(request()),result);
      assert.equal(calls[0].url,'https://fixture.invalid/runtimes/fixture-runtime/invocations?endpoint=v-fixed');
      assert.equal(calls[0].init.headers['X-PA-Agent-Token'],marker?undefined:await original.websocketAuthorizationProvider.read());
      const query=JSON.parse(JSON.parse(calls[0].init.body).query);assert.equal(query.workflowVersion,'1.0.0');assert.equal(query.operation,'advance');
      assert.equal(Object.hasOwn(query,'signal'),false);assert.equal(Object.hasOwn(query,'requestId'),false);
    }finally{adapter.close();}
  }
});
test('owned WSS accepts both original Runtime paths but rejects another version or another Runtime',()=>{
  for(const path of ['/runtimes/fixture-runtime/ws','/runtimes/fixture-runtime/invocations/ws']){
    const adapter=createRuntimeOwnedWorkflowImageAdapter({...original,transport:'wss',websocketUrl:'wss://fixture.invalid'+path+'?endpoint=v-fixed'});adapter.close();
  }
  for(const url of ['wss://fixture.invalid/runtimes/fixture-runtime/ws?endpoint=other','wss://fixture.invalid/runtimes/other/ws?endpoint=v-fixed'])
    assert.throws(()=>createRuntimeOwnedWorkflowImageAdapter({...original,transport:'wss',websocketUrl:url}),{code:'REVISION_CONFLICT'});
});
test('owned WSS pre-send fallback preserves exact fixed HTTP version and original trusted wrapper marker',async()=>{
  let calls=0;const adapter=createRuntimeOwnedWorkflowImageAdapter({...original,transport:'wss',websocketUrl:'wss://fixture.invalid/runtimes/fixture-runtime/ws?endpoint=v-fixed',
    allowHttpsFallback:true,fetchHandlesHostAuthorization:true,websocketFactory:()=>{throw Error('Explicit Fake never-connected socket');},
    fetchImpl:async(url,init)=>{calls++;assert.equal(url,'https://fixture.invalid/runtimes/fixture-runtime/invocations?endpoint=v-fixed');assert.equal(init.headers['X-PA-Agent-Token'],undefined);return response();}});
  try{assert.deepEqual(await adapter.advance(request()),result);assert.equal(calls,1);}finally{adapter.close();}
});
class AcceptedThenLost extends EventEmitter {
  readyState=0;
  constructor(){super();queueMicrotask(()=>{this.readyState=1;this.emit('open');this.emit('message',Buffer.from(JSON.stringify({protocolVersion:AGENTARTS_TRANSPORT_VERSION,type:'ready',
    serverInstanceId:'explicit-fake-server',capabilities:['invoke','status','cancel','ephemeral-replay'],restartRecovery:false,heartbeatMs:30000})),false);});}
  send(text,callback){const frame=JSON.parse(text);callback?.();if(frame.type==='invoke'){
    this.emit('message',Buffer.from(JSON.stringify({protocolVersion:AGENTARTS_TRANSPORT_VERSION,type:'accepted',serverInstanceId:'explicit-fake-server',sessionId:frame.sessionId,
      requestId:frame.requestId,idempotencyKey:frame.idempotencyKey,payloadDigest:frame.payloadDigest,deadline:frame.deadline})),false);
    this.readyState=3;this.emit('close');}}
  close(){this.readyState=3;this.emit('close');}terminate(){this.close();}
}
test('an accepted owned WSS invocation with a lost result is unknown and is never resent via HTTP',async()=>{
  let calls=0;const adapter=createRuntimeOwnedWorkflowImageAdapter({...original,transport:'wss',websocketUrl:'wss://fixture.invalid/runtimes/fixture-runtime/ws?endpoint=v-fixed',
    allowHttpsFallback:true,websocketFactory:()=>new AcceptedThenLost(),fetchImpl:async()=>{calls++;return response();}});
  try{await assert.rejects(adapter.advance(request()),error=>error.receipt?.accepted===true);assert.equal(calls,0);}finally{adapter.close();}
});
