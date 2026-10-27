import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileFunction,constants} from 'node:vm';
import ts from 'typescript';
import {adminAuxiliaryDocument,recordFollowingNodes} from '../test-support/admin-history-dom.mjs';
import {readCapabilityDirectory} from '../electron/capability-directory.js';
import {register} from '../electron/runtime.js';
import {EventCursor} from '@personal-agent/client';
import {createConversationDelivery} from '../electron/conversation-delivery.js';

test('actual local authorization startup loads its directory and projects original task cancellation without executing tools',async t=>{
  const mainFile=fileURLToPath(new URL('../electron/main.js',import.meta.url)),source=readFileSync(mainFile,'utf8');
  const ast=ts.createSourceFile(mainFile,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),functions=new Map();
  for(const node of ast.statements)if(ts.isFunctionDeclaration(node)&&['syncCapabilities','initializeLocalAuthorizationControlPlane',
    'syncRuntimeSnapshots','pumpEvents','applyEvent','refresh','clearInactiveTaskExitWarning','observeTextTaskOutput'].includes(node.name?.text))
    functions.set(node.name.text,node.getText(ast));
  assert.equal(functions.size,8);
  const base=resolve('.cache/capability-startup-tests');mkdirSync(base,{recursive:true});
  const database=join(mkdtempSync(join(base,'run-')),'runtime.sqlite');let executions=0;const polls=[],loadedSurfaces=[];
  const schema={type:'object',additionalProperties:false,properties:{}},descriptor={name:'synthetic.authorization',version:'1.0.0',
    inputSchema:schema,outputSchema:schema,sideEffect:'read',requiredScopes:['synthetic:read'],requiresPresence:false,
    idempotencySupport:true,recoverySupport:false};
  const context={runtimeApplication:undefined,runtime:undefined,runtimeConnection:undefined,client:undefined,eventCursor:undefined,
    localAuthorizationOnly:false,capabilityReadRevision:0,capabilityDirectory:{state:'loading'},capabilities:[],health:[],
    runtimeClosed:false,eventBusy:false,taskReadbackAt:0,eventPoll:undefined,eventSubscriptionConnection:undefined,eventThroughSequence:undefined,eventContinuation:undefined,
    tasks:new Map(),approvals:new Map(),notifications:new Map(),terminalTaskStates:new Set(['succeeded','failed','cancelled']),runtimeError:'',
    historyPages:{clear(){loadedSurfaces.length=0;},load(surface){loadedSurfaces.push(surface);}},
    rememberTaskGoal(){},fakeMode:false,connectorChangeHost:undefined,harnessEventsHost:undefined,
    conversationDelivery:createConversationDelivery(new Set()),liveVoice:undefined,
    p5DeviceTelemetrySubscription:undefined,syntheticRepairHost:undefined,repairCandidateVersion:undefined,
    dispatchKnowledgeFeedCheckTask(){},dispatchKnowledgeRecheckTask(){},structuredClone,setImmediate,
    setInterval(callback,interval){assert.equal(interval,120);polls.push(callback);return polls.length;},
    dataPaths:{runtime:database},desktopHost:{userNamespace:'synthetic-first-start-directory'},
    initializeAuthorizationHosts(){},authorizationIntentHost:{tool:{descriptor,async execute(){executions++;assert.fail('Reading the directory must not execute a tool');}},
      prepareQuestion(){assert.fail('Reading the directory must not request tool authorization');}},
    authorizationQuestionHost:{requestToolAuthorization(){assert.fail('Reading the directory must not create an approval');}},
    AUTHORIZATION_INTENT_TOOL:descriptor.name,register,readCapabilityDirectory,publish(){},EventCursor};
  t.after(()=>{context.runtimeConnection?.dispose();context.runtimeApplication?.close();});
  const start=compileFunction('return (async()=>{with(context){'+[...functions.values()].join('\n')
    +'\nawait initializeLocalAuthorizationControlPlane();await initializeLocalAuthorizationControlPlane();return {pumpEvents};}})();',['context'],
    {filename:mainFile,importModuleDynamically:constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
  const projection=await start(context);
  assert.equal(context.localAuthorizationOnly,true);assert.equal(context.runtimeApplication.activeTaskCount,0);
  assert.equal(context.capabilityDirectory.state,'loaded');
  assert.deepEqual(context.capabilities.map(manifest=>manifest.name),[descriptor.name]);
  assert.equal(context.capabilityReadRevision,1,'Repeated initialization reuses the original authoritative application and directory');
  assert.deepEqual(loadedSurfaces,['panel','workspace',undefined]);assert.equal(polls.length,1);
  // UI caches are explicit projection fixtures; these tasks and their events are from the real SQLite Runtime.
  const original=context.runtime.submitTask({goal:'Synthetic projection only',conversationId:'synthetic-projection',idempotencyKey:'projection-original'});
  await projection.pumpEvents();assert.equal(context.tasks.get(original.taskId).state,'created');
  context.runtime.requestCancel(original.taskId,'Synthetic projection cancellation');
  await projection.pumpEvents();assert.equal(context.tasks.get(original.taskId).state,'cancelling','cancellation acceptance is not completion');
  context.runtime.transitionTask(original.taskId,'cancelled');
  await projection.pumpEvents();assert.equal(context.tasks.get(original.taskId).state,'cancelled');
  assert.equal(context.runtime.getTask(original.taskId).state,'cancelled');assert.equal(context.runtimeError,'');
  assert.equal(executions,0);
});

test('capability read distinguishes an empty directory from an unavailable or failed operation', async () => {
  const empty = await readCapabilityDirectory({call: async () => ({manifests: [], health: []})});
  assert.equal(empty.status.state, 'loaded');
  assert.deepEqual(empty.manifests, []);

  const unavailable = await readCapabilityDirectory({call: async () => {
    throw Object.assign(new Error('not negotiated'), {code: 'UNSUPPORTED_CAPABILITY'});
  }});
  assert.equal(unavailable.status.state, 'unavailable');
  assert.match(unavailable.status.reason, /未公布/);

  const failed = await readCapabilityDirectory({call: async () => {
    throw Object.assign(new Error('secret-canary'), {code: 'TIMEOUT'});
  }});
  assert.equal(failed.status.state, 'error');
  assert.match(failed.status.reason, /TIMEOUT/);
  assert.doesNotMatch(failed.status.reason, /secret-canary/);
});

test('admin shows only reported capability health and preserves unavailable and error states', async t => {
  const original = new Map(['window', 'document', 'matchMedia'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const element = () => ({dataset: {}, textContent: '', addEventListener() {},
    setAttribute() {}, insertBefore() {},after:recordFollowingNodes});
  globalThis.window = {addEventListener() {}};
  globalThis.document = adminAuxiliaryDocument();
  globalThis.matchMedia = () => ({matches: false, addEventListener() {}});
  const {mountAdmin} = await import('../src/features/admin/view.js');
  const nodes = new Map(['.admin-bar', '#admin-close', 'nav', '#admin-search',
    '.main', '#page-title', '#connection', '#content', '#error'].map(key => [key, element()]));
  const root = {innerHTML: '', querySelector: key => nodes.get(key) ?? null,
    querySelectorAll: () => []};
  const escape = value => String(value).replace(/[&<>"']/g,
    char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const render = mountAdmin(root, async () => {}, escape);
  const base = {tasks: [], approvals: [], capabilities: [], health: [], connection: 'fixture'};
  const html = () => nodes.get('#content').innerHTML;

  render({...base, capabilityDirectory: {state: 'unavailable', reason: '未公布'},
    adminNavigation: {page: 'capabilities', revision: 1}});
  assert.match(html(), /未公布/);
  assert.doesNotMatch(html(), /Runtime 已确认返回空能力目录/);
  assert.match(html(), /data-jump="models"/);

  render({...base, capabilityDirectory: {state: 'loaded', reason: 'Runtime 已返回空能力目录'},
    adminNavigation: {page: 'capabilities', revision: 2}});
  assert.match(html(), /Runtime 已确认返回空能力目录/);

  render({...base, capabilities: [{name: 'fixture.read', version: '1', sideEffect: 'read',
    requiredScopes: ['fixture:read']}], health: [{id: 'fixture.read', state: 'degraded',
    reason: '<not-ready>'}], capabilityDirectory: {state: 'loaded', reason: '已公布 1 项'},
    adminNavigation: {page: 'capabilities', revision: 3}});
  assert.match(html(), /降级/);
  assert.match(html(), /&lt;not-ready&gt;/);
  assert.doesNotMatch(html(), /data-tone="ready"/);

  render({...base, capabilities: [{name: 'fixture.read', version: '1'}],
    health: [{id: 'fixture.read', state: 'ready'}],
    capabilityDirectory: {state: 'loaded', reason: '已公布 1 项'},
    adminNavigation: {page: 'capabilities', revision: 4}});
  assert.match(html(), /Runtime 报告就绪/);
  assert.match(html(), /不代表外部服务已经验收/);

  render({...base, capabilityDirectory: {state: 'error', reason: '能力目录读取失败（TIMEOUT）'},
    adminNavigation: {page: 'connections', revision: 5}});
  assert.match(html(), /role="alert"/);
  assert.match(html(), /能力目录读取失败/);
  assert.doesNotMatch(html(), /Runtime 未报告连接健康项/);
});
