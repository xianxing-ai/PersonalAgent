import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {SyntheticWebSocket} from '../../../packages/coordination/test/fixtures/websocket.mjs';
import {createAgentArtsTransportConfig, agentArtsTransportNotice} from '../electron/agentarts-transport-config.js';

const source = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let composition;
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'createAgentArtsRuntimeApplication') {
    assert.equal(composition, undefined, 'Desktop has one Competition composition');
    composition = node.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(composition && ts.isObjectLiteralExpression(composition));
const propertyName = property => property.name?.getText(ast);
// Evaluate the actual transport properties from main's AST. Other Desktop hosts
// are omitted; Runtime, Coordination, contracts and Client are the real consumers.
const transportProperties = composition.properties.filter(property =>
  ['onTransportState','authorizationProvider'].includes(propertyName(property))
  || (ts.isSpreadAssignment(property) && /cloudBinding|createAgentArtsTransportConfig|agentArtsTransportConfig|onTransportState/.test(property.getText(ast))));
let statements = composition.parent;
while (statements && !ts.isBlock(statements)) statements = statements.parent;
const setup = ts.isBlock(statements) ? statements.statements.filter(statement => {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(declaration =>
    declaration.initializer && ts.isCallExpression(declaration.initializer)
    && declaration.initializer.expression.getText(ast) === 'agentArtsConfig.transportConfig');
  return ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
    && statement.expression.left.getText(ast) === 'cloudTransportNotice';
}).map(statement => statement.getText(ast)).join('\n') : '';

function desktopOptions(environment = {}, previousNotice = '',configuration = {},fetchImpl,overrideBinding) {
  let published = 0;
  const binding = overrideBinding??{gatewayUrl:'https://agentarts.example.test', runtimeName:'synthetic'};
  const agentArtsConfig={readTransportPreferences:()=>({}),readTransportOptions:()=>({}),
    readAuthorization:()=> 'Bearer synthetic-outer-no-real-credential',
    transportConfig(binding){return createAgentArtsTransportConfig({binding,environment,
      transportPreferences:this.readTransportPreferences(),configurationProvider:{read:()=>this.readTransportOptions(binding)},
      ...(fetchImpl?{fetchImpl}:{})});},...configuration};
  const evaluate = new Function('cloudBinding','agentArtsTransportNotice','publish','previousNotice','agentArtsConfig',
    `let cloudTransportNotice = previousNotice; ${setup}\nconst options = {${transportProperties.map(property => property.getText(ast)).join(',\n')}}; return {options, notice: () => cloudTransportNotice};`);
  const result=evaluate(binding,agentArtsTransportNotice,()=>{published++;},previousNotice,agentArtsConfig);
  return {...result,published:()=>published};
}
const outer = {read:async () => 'Bearer synthetic-outer-no-real-credential'};
const events = text => [{event:'message',data:{text}},{event:'task_end'},{event:'end'}];
async function runTask(app,idempotencyKey='synthetic-composition') {
  const client = new Client(app);
  await client.connect();
  const {taskId} = await client.call('task.submit', {goal:'Synthetic transport analysis',conversationId:'synthetic-composition'},
    {idempotencyKey});
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = app.runtime.getTask(taskId);
    if (['succeeded','failed','waiting_reconciliation'].includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Synthetic task did not settle');
}
for (const environment of [{}, {PA_AGENTARTS_TRANSPORT:'https'}]) {
  test(`actual Desktop ${environment.PA_AGENTARTS_TRANSPORT ?? 'default'} configuration runs the public HTTPS factory`, async () => {
    const desktop = desktopOptions(environment, 'Previous WSS failure');
    let fetches = 0;
    const app = createAgentArtsRuntimeApplication({...desktop.options, path:':memory:', authorizationProvider:outer,
      fetchImpl:async () => {fetches++; return new Response(JSON.stringify(events('Synthetic HTTPS result')),
        {headers:{'content-type':'application/json'}});}});
    try {
      assert.equal(desktop.options.onTransportState, undefined);
      assert.equal(desktop.notice(), '', 'A new binding clears its previous transport notice');
      const task = await runTask(app);
      assert.equal(task.state,'succeeded');
      assert.match(task.resultSummary,/Synthetic HTTPS result/);
      assert.equal(fetches,1);
    } finally {app.close();}
  });
}
const wssEnvironment = {PA_AGENTARTS_TRANSPORT:'wss',
  PA_AGENTARTS_WSS_URL:'wss://agentarts.example.test/runtimes/synthetic/ws',
  PA_AGENTARTS_APP_TOKEN:'synthetic-inner-no-real-credential'};

test('actual Desktop main closure feeds encrypted config token/version refresh into real Runtime HTTPS and blocks revoke',async t=>{
  const {createAgentArtsConfig}=await import('../electron/agentarts-config.js');
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const userData=await mkdtemp(join(tmpdir(),'pa-main-cloud-config-'));t.after(()=>rm(userData,{recursive:true,force:true}));
  const calls=[];
  const config=createAgentArtsConfig({userData,environment:{},safeStorage:{isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()},
    fetchImpl:async(url,init)=>{
      calls.push({url,headers:new Headers(init.headers),redirect:init.redirect});
      return new Response(JSON.stringify(events('Explicit offline fixture through actual Desktop main composition')),
        {headers:{'content-type':'application/json'}});
    }});
  const destination={gatewayUrl:'https://synthetic.huaweicloud-agentarts.com',runtimeName:'synthetic'};
  const token='explicit-public-desktop-app-token-123456789';
  config.configure({...destination,authorization:'Bearer explicit-public-desktop-outer',appToken:token,deploymentVersion:'arm64-v4-e38ef23d-r2'});
  const binding=config.binding();
  const desktop=desktopOptions({},'',config,undefined,binding);
  const app=createAgentArtsRuntimeApplication({...desktop.options,path:':memory:'});
  try {
    assert.equal((await runTask(app,'versioned-desktop-first')).state,'succeeded');assert.equal(calls.length,1);
    assert.equal(calls[0].url,destination.gatewayUrl+'/runtimes/synthetic/invocations?endpoint=arm64-v4-e38ef23d-r2');
    assert.equal(calls[0].headers.get('X-PA-Agent-Token'),'Bearer '+token);assert.equal(calls[0].redirect,'error');
    config.configure({...destination,appToken:token+'-rotated',deploymentVersion:'arm64-v4-e38ef23d-r2'});
    assert.equal((await runTask(app,'versioned-desktop-second')).state,'succeeded');assert.equal(calls.length,2);
    assert.equal(calls[1].url,destination.gatewayUrl+'/runtimes/synthetic/invocations?endpoint=arm64-v4-e38ef23d-r2');
    assert.equal(calls[1].headers.get('X-PA-Agent-Token'),'Bearer '+token+'-rotated');
    config.configure({...destination,appToken:token+'-rotated',deploymentVersion:'v4-next'});
    assert.equal((await runTask(app,'versioned-desktop-changed')).state,'failed');assert.equal(calls.length,2);
    config.revoke();assert.equal((await runTask(app,'versioned-desktop-revoked')).state,'failed');assert.equal(calls.length,2);
    assert.doesNotMatch(JSON.stringify(desktop.options),/desktop-app-token|Bearer/);
  }finally{app.close();}
});

test('actual Desktop auth provider rejects a stale saved WSS route and revoke',async t=>{
  const {createAgentArtsConfig}=await import('../electron/agentarts-config.js');
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const userData=await mkdtemp(join(tmpdir(),'pa-main-wss-route-'));t.after(()=>rm(userData,{recursive:true,force:true}));
  const config=createAgentArtsConfig({userData,environment:{PA_AGENTARTS_TRANSPORT:'https'},safeStorage:{isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value).reverse(),decryptString:value=>Buffer.from(value).reverse().toString()}});
  const input={gatewayUrl:'https://synthetic.huaweicloud-agentarts.com',runtimeName:'synthetic',authorization:'Bearer synthetic-outer',
    transport:'wss',websocketUrl:'wss://synthetic.huaweicloud-agentarts.com/runtimes/synthetic/invocations/ws',
    appToken:'synthetic-inner-no-real-secret-at-least-32',allowHttpsFallback:false};
  config.configure(input);const binding=config.binding();
  const desktop=desktopOptions({PA_AGENTARTS_TRANSPORT:'https'},'',config,undefined,binding);
  assert.equal(desktop.options.transport,'wss');
  assert.equal(await desktop.options.authorizationProvider.read(),input.authorization);
  config.configure({...input,websocketUrl:input.websocketUrl.replace('/invocations/ws','/ws'),authorization:'',appToken:''});
  await assert.rejects(desktop.options.authorizationProvider.read(),/已改变/);
  await assert.rejects(desktop.options.websocketAuthorizationProvider.read(),/已改变/);
  config.revoke();
  await assert.rejects(desktop.options.authorizationProvider.read(),/已改变|撤销/);
});

test('actual Desktop main pins WSS and original Runtime rejects a changed deployment before any new send',async()=>{
  let current={appToken:'explicit-public-versioned-wss-token-123456789',deploymentVersion:'arm64-v4-e38ef23d-r2'};
  const sockets=[],connections=[],http=[];
  const desktop=desktopOptions(wssEnvironment,'',{readTransportOptions:()=>current},async(url,init)=>{http.push({url,init});throw Error('No HTTP expected');});
  const app=createAgentArtsRuntimeApplication({...desktop.options,path:':memory:',authorizationProvider:outer,
    websocketFactory:(url,options)=>{
      connections.push({url,options});const socket=new SyntheticWebSocket((frame,socket)=>{
        if(frame.type==='invoke'){socket.accepted(frame);socket.result(frame,'Pinned explicit offline WSS fixture');}
      });sockets.push(socket);return socket;
    }});
  try {
    assert.equal((await runTask(app,'pinned-wss-first')).state,'succeeded');
    assert.equal(connections[0].url,wssEnvironment.PA_AGENTARTS_WSS_URL+'?endpoint=arm64-v4-e38ef23d-r2');
    assert.equal(connections[0].options.headers['X-PA-Agent-Token'],'Bearer '+current.appToken);
    current={...current,appToken:current.appToken+'-rotated'};
    assert.equal((await runTask(app,'pinned-wss-refreshed')).state,'succeeded');assert.equal(connections.length,2);
    assert.equal(connections[1].options.headers['X-PA-Agent-Token'],'Bearer '+current.appToken);
    current={...current,deploymentVersion:'new-version'};
    assert.equal((await runTask(app,'pinned-wss-stale')).state,'failed');assert.equal(connections.length,2);assert.equal(http.length,0);
    assert.equal(sockets.reduce((sum,socket)=>sum+socket.sent.filter(frame=>frame.type==='invoke').length,0),2);
  }finally{app.close();}
});

test('actual Desktop WSS callback projects fixed notices and the real factory consumes Fake socket events', async () => {
  const desktop = desktopOptions(wssEnvironment, 'Previous WSS failure');
  assert.equal(typeof desktop.options.onTransportState,'function');
  assert.equal(desktop.notice(),'');
  desktop.options.onTransportState({state:'result_unknown',requestId:'private-frame-data'});
  assert.match(desktop.notice(),/停止自动重发/);
  assert.doesNotMatch(desktop.notice(),/private-frame-data/);
  assert.equal(desktop.published(),1);
  const app = createAgentArtsRuntimeApplication({...desktop.options,path:':memory:',authorizationProvider:outer,
    websocketFactory:() => new SyntheticWebSocket((frame,socket) => {
      if (frame.type === 'invoke') {socket.accepted(frame);socket.result(frame,'Synthetic WSS result');}
    }),fetchImpl:async () => {throw Error('Unexpected HTTPS fallback');}});
  try {assert.equal((await runTask(app)).state,'succeeded');} finally {app.close();}
});
test('HTTPS fallback remains explicit and cannot bypass the final host send guard', async () => {
  const desktop = desktopOptions({...wssEnvironment,PA_AGENTARTS_HTTPS_FALLBACK:'1'});
  let guards = 0, fetches = 0;
  const app = createAgentArtsRuntimeApplication({...desktop.options,path:':memory:',authorizationProvider:outer,
    websocketFactory:() => {throw Error('Synthetic before-invoke connection failure');},
    beforeCompetitionSend:() => {guards++;throw Error('Synthetic current export denied');},
    fetchImpl:async () => {fetches++;throw Error('Unexpected export');}});
  try {
    assert.equal((await runTask(app)).state,'failed');
    assert.equal(guards,1);
    assert.equal(fetches,0);
    assert.match(desktop.notice(),/HTTPS 备用/);
  } finally {app.close();}
  assert.throws(() => desktopOptions({PA_AGENTARTS_TRANSPORT:'https',PA_AGENTARTS_HTTPS_FALLBACK:'1'}),/wss/);
});

test('an actual accepted WSS disconnect retains its unknown notice and original Runtime reconciliation hold', async () => {
  const desktop = desktopOptions(wssEnvironment), states = [];
  let invokes = 0, fetches = 0;
  const app = createAgentArtsRuntimeApplication({...desktop.options,path:':memory:',authorizationProvider:outer,
    onTransportState:state => {states.push(state.state);desktop.options.onTransportState(state);},
    websocketFactory:() => new SyntheticWebSocket((frame,socket) => {
      if (frame.type === 'invoke') {invokes++;socket.accepted(frame);socket.disconnect();}
    }),fetchImpl:async () => {fetches++;throw Error('Unexpected unknown replay');}});
  try {
    const task = await runTask(app);
    assert.equal(task.state,'waiting_reconciliation');
    assert.deepEqual(states,['connecting','wss_ready','result_unknown','closed']);
    assert.match(desktop.notice(),/停止自动重发/);
    assert.equal(app.runtime.loadCheckpoint(task.taskId,'competition-cloud-unknown').accepted,true);
    assert.throws(() => app.resumeTask(task.taskId),{code:'RESULT_UNKNOWN'});
    assert.equal(invokes,1);
    assert.equal(fetches,0);
    desktop.options.onTransportState({state:'connecting'});
    assert.equal(desktop.notice(),'');
    desktop.options.onTransportState({state:'result_unknown'});
    desktop.options.onTransportState({state:'wss_ready'});
    assert.equal(desktop.notice(),'');
  } finally {app.close();}
});
for (const [statusCode,diagnostic,notice] of [[401,'auth_required',/认证失败/],[404,'unsupported',/尚未提供/]]) {
  test(`an actual ${diagnostic} handshake retains its diagnostic through socket close`, async () => {
    const desktop = desktopOptions(wssEnvironment), states = [];
    let fetches = 0, invokes = 0;
    const app = createAgentArtsRuntimeApplication({...desktop.options,path:':memory:',authorizationProvider:outer,
      onTransportState:state => {states.push(state.state);desktop.options.onTransportState(state);},
      websocketFactory:() => {
        const socket = new SyntheticWebSocket(() => {invokes++;},{autoReady:false});
        queueMicrotask(() => socket.emit('unexpected-response',undefined,{statusCode,resume(){}}));
        return socket;
      },fetchImpl:async () => {fetches++;throw Error('Unexpected handshake fallback');}});
    try {
      assert.equal((await runTask(app)).state,'failed');
      assert.deepEqual(states,['connecting',diagnostic,'closed']);
      assert.match(desktop.notice(),notice);
      assert.equal(invokes,0);
      assert.equal(fetches,0);
      desktop.options.onTransportState({state:'connecting'});
      assert.equal(desktop.notice(),'');
    } finally {app.close();}
  });
}
