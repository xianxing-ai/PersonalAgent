import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import ts from 'typescript';
import {ProtocolError} from '@personal-agent/contracts';

const mainUrl=process.env.MAIN_COMPOSITION_SOURCE?pathToFileURL(process.env.MAIN_COMPOSITION_SOURCE):new URL('../electron/main.js',import.meta.url);
const {createDesktopHarnessEventsHost}=await import(new URL('./harness-events-host.js',mainUrl));
const {createDesktopProactiveWorkflowApplication}=await import(new URL('./proactive-workflow-host.js',mainUrl));
const {createHarnessExperienceAdminHost}=await import(new URL('./harness-experience-host.js',mainUrl));
const {withNativeReadbackScope}=await import(new URL('./native-readback-scope.js',mainUrl));
const source=readFileSync(mainUrl,'utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=name=>{const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
  assert.ok(node,`actual Main function ${name}`);return node.getText(ast);};
function property(name) {
  const nodes=[];function visit(node){if(ts.isPropertyAssignment(node)&&node.name.getText(ast)===name)nodes.push(node);ts.forEachChild(node,visit);}visit(ast);
  assert.equal(nodes.length,1,`unique actual Main property ${name}`);return nodes[0].initializer.getText(ast);
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('actual Main constructs original workflow/event hosts without acquiring or dispatching and shares live configuration',async()=>{
  let acquisitions=0,descriptions=0,dispatches=0,configurationReads=0,revision='v1',workflowOptions,eventOptions;
  const runtime={getTask(){throw Error('No startup task requested');}};
  const application={runtime,coordinationConfigurationRef:'original-config',startProactiveTask(){dispatches++;assert.fail('No dispatch at construction');}};
  const context=vm.createContext({competitionMode:true,runtimeApplication:application,
    proactiveWorkflowApplication:undefined,proactiveSourceRouter:undefined,harnessEventsHost:undefined,
    createDesktopProactiveWorkflowApplication(options){workflowOptions=options;
      const host=createDesktopProactiveWorkflowApplication({...options,createAdapter(){descriptions++;assert.fail('No describe at construction');}});
      const acquire=host.acquireMaintenance;host.acquireMaintenance=(...args)=>{acquisitions++;return acquire(...args);};return host;},
    createDesktopProactiveControllerHost(){return {consume:async()=>assert.fail('No controller consume at construction'),
      readReceipt:async()=>undefined};},
    createDesktopHarnessEventsHost(options){eventOptions=options;return createDesktopHarnessEventsHost(options);},
    createDesktopProactiveConfirmedSourceRouter(){return {readHarnessSourceOrigin:()=>undefined,readHarnessSourceAuthorization:()=>undefined};},
    readDesktopDeveloperHarnessConfiguration:()=>({workspaceRef:'original',configurationRef:revision}),
    readProactiveWorkflowConfiguration(){configurationReads++;return {contractRef:'original',adapter:{config:{deploymentVersion:revision}}};},
    conversationToolAccess:{resolveConversation:()=>undefined},notificationApplicationHost:undefined,
    app:{isQuitting:false},publish(){},createDesktopProactiveContextPorts(){assert.fail('No context acquisition at construction');},
    proactiveHost:undefined,obsidianPairing:undefined,knowledgeSourceConfig:undefined,
    desktopHost:{userNamespace:'original-namespace'},modelApiHost:{readHarnessConfiguration:()=>({revision,enabled:true,events:{enabled:true,quiet:false}})},
    feedsHost:undefined});
  vm.runInContext(declaration('initializeHarnessEventPorts'),context);
  const readPersistedRuntimeProactiveWorkflow=()=>{assert.fail('No persisted workflow read at construction');};
  const readPersistedHarnessOriginalDelivery=()=>{assert.fail('No persisted delivery read at construction');};
  context.initializeHarnessEventPorts({readPersistedRuntimeProactiveWorkflow,readPersistedHarnessOriginalDelivery});
  assert.equal(configurationReads,0);assert.equal(acquisitions,0);assert.equal(descriptions,0);assert.equal(dispatches,0);
  assert.equal(workflowOptions.readConfiguration,eventOptions.readWorkflowConfiguration);
  assert.equal(eventOptions.readPersistedWorkflow,readPersistedRuntimeProactiveWorkflow);
  assert.equal(eventOptions.readPersistedDelivery,readPersistedHarnessOriginalDelivery);
  assert.equal(eventOptions.readSourceOrigin('original',{}),undefined);
  assert.equal(eventOptions.readSourceAuthorization('original',{}),undefined);
  assert.equal(eventOptions.readWorkflowConfiguration().adapter.config.deploymentVersion,'v1');revision='v2';
  assert.equal(workflowOptions.readConfiguration().adapter.config.deploymentVersion,'v2');
  assert.equal(eventOptions.readNativeConfiguration().revision,'v2');
  // Execute the original startup statement sequence, including the policy bind.
  let startupBlock;
  function visit(node){if(ts.isBlock(node)&&node.statements.some(statement=>ts.isExpressionStatement(statement)
    &&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='initializeHarnessEventPorts'))startupBlock=node;
    ts.forEachChild(node,visit);}visit(ast);assert.ok(startupBlock);
  const index=startupBlock.statements.findIndex(statement=>ts.isExpressionStatement(statement)
    &&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='initializeHarnessEventPorts');
  const sequence=startupBlock.statements.slice(index-1,index+3).map(statement=>statement.getText(ast)).join('\n');
  let policyBound=false,recoveries=0;
  context.notificationApplicationHost={bindApplication(value){assert.equal(value,application);policyBound=true;}};
  context.runtimeModule={readPersistedRuntimeProactiveWorkflow,readPersistedHarnessOriginalDelivery};
  context.ownsDesktopInstance=true;context.agentArtsTransportConfig={transport:'wss'};
  context.startupRecoveryStatus=undefined;application.resumeStartupTask=()=>assert.fail('No startup dispatch');
  context.runtimeRoot={createRuntimeStartupRecovery(options){assert.equal(policyBound,true,'native notification policy must bind before classification');
    assert.ok(context.harnessEventsHost);return {async recover(){recoveries++;assert.equal(options.canResumeHarnessEvent({}),undefined);return {items:[]};}};}};
  await vm.runInContext(`(async()=>{${sequence}})()`,context);assert.equal(recoveries,1);
  assert.equal(acquisitions,0);assert.equal(descriptions,0);assert.equal(dispatches,0);
  const guard=vm.runInContext(`(${property('assertHarnessEventCurrent')})`,context);
  const flush=vm.runInContext(`(${property('onHarnessEventProgress')})`,context);
  assert.throws(()=>guard('missing-root',{deliveryId:'original'}));
  await flush();assert.equal(dispatches,0);assert.equal(acquisitions,0);
  await context.harnessEventsHost.close();assert.equal(context.harnessEventsHost.snapshot().state,'closed');
});

test('actual Main forwards original event identity and progress to its current native host',async()=>{
  const calls=[],origin={deliveryId:'original'};
  const context=vm.createContext({ProtocolError,harnessEventsHost:{
    assertHarnessEventCurrent:(taskId,value)=>{calls.push([taskId,value]);return 'checked';},
    flush:async()=>{calls.push('flush');}}});
  const guard=vm.runInContext(`(${property('assertHarnessEventCurrent')})`,context);
  const progress=vm.runInContext(`(${property('onHarnessEventProgress')})`,context);
  guard('original-root',origin);await progress();assert.equal(calls[0][0],'original-root');assert.equal(calls[0][1],origin);assert.equal(calls[1],'flush');
  context.harnessEventsHost=undefined;assert.throws(()=>guard('original-root',origin));
});

test('actual Main experience card confirmation rejects expired or revoked answers without another modal',async()=>{
  let now=1000,requested=0;const lifetime=new AbortController(),pending=deferred();
  let decide=async()=>{requested++;await pending.promise;return true;};
  const context=vm.createContext({harnessExperienceLifetime:lifetime,Date:{now:()=>now,parse:Date.parse},ProtocolError,
    admin:{isDestroyed:()=>false},confirmApplicationAuthorization:async(action,_payload,options)=>{
      assert.equal(action,'experience.activate');assert.equal(options.isCurrent(),true);return decide();
    },dialog:{showMessageBox:()=>assert.fail('experience permission must use the original conversation card')}});
  vm.runInContext(declaration('confirmHarnessExperienceActivation'),context);
  const signal=new AbortController().signal,version={workflowId:'original',revision:1};
  await assert.rejects(context.confirmHarnessExperienceActivation(version,{signal,deadline:new Date(999).toISOString()}),/开发经验确认已失效/);assert.equal(requested,0);
  const expired=context.confirmHarnessExperienceActivation(version,{signal,deadline:new Date(2000).toISOString()});
  now=2000;pending.resolve({response:0});await assert.rejects(expired,/开发经验确认已失效/);
  now=1000;decide=async()=>true;
  assert.equal(await context.confirmHarnessExperienceActivation(version,{signal,deadline:new Date(3000).toISOString()}),true);
  const replacement=deferred(),originalOwner=context.admin;decide=async()=>{await replacement.promise;return true;};
  const oldOwner=context.confirmHarnessExperienceActivation(version,{signal,deadline:new Date(3000).toISOString()});
  context.admin={isDestroyed:()=>false};replacement.resolve({response:0});await assert.rejects(oldOwner,/开发经验确认已失效/);context.admin=originalOwner;
  const second=deferred();decide=async()=>{await second.promise;return true;};
  const revoked=context.confirmHarnessExperienceActivation(version,{signal,deadline:new Date(3000).toISOString()});
  // Execute the actual Main quit branch: invalidate native answers before awaiting consumer release.
  let quitBranch;function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(ast)==='harnessEventsHost&&!harnessEventsClosed')quitBranch=node;
    ts.forEachChild(node,visit);}visit(ast);assert.ok(quitBranch);
  const closing=deferred();let quits=0,prevented=0;
  Object.assign(context,{harnessEventsHost:{close:()=>closing.promise},harnessEventsClosed:false,harnessEventsClosing:undefined,
    app:{quit(){quits++;}},publish(){},runtimeError:''});
  const beforeQuit=vm.runInContext(`(function(event){${quitBranch.getText(ast)}})`,context);
  beforeQuit({preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(quits,0);assert.equal(lifetime.signal.aborted,true);
  second.resolve({response:0});await assert.rejects(revoked,/开发经验确认已失效/);closing.resolve();await context.harnessEventsClosing;
  assert.equal(quits,1);assert.equal(context.harnessEventsClosed,true);
});

test('actual Main admin gate and original admin helper reject foreign frames and keep host-owned operation context',async()=>{
  const lifetime=new AbortController(),mainFrame={},admin=Object.assign(new EventEmitter(),{webContents:{mainFrame},isDestroyed:()=>false}),
    panel={webContents:{mainFrame:{}},isDestroyed:()=>false};let validations=0;
  const contexts=[];
  const app={listCandidates:()=>[],readActive:()=>null,async validate(id,revision,context){
    validations++;assert.equal(id,'original');assert.equal(revision,1);assert.equal(context.signal.aborted,false);
    assert.ok(Date.parse(context.deadline)>Date.now());assert.ok(Date.parse(context.deadline)<=Date.now()+60000);contexts.push(context);}};
  const host=createHarnessExperienceAdminHost({getApplication:()=>app,context:()=>assert.fail('Main must supply a per-invocation native scope')});
  const context=vm.createContext({subagentListWindow:undefined,subagentWindows:new Map(),orb:undefined,panel,admin,workspace:undefined,
    competitionMode:true,harnessExperienceAdminHost:host,harnessExperienceLifetime:lifetime,
    runtimeApplication:{harnessExperience:app},createHarnessExperienceAdminHost,withNativeReadbackScope,publish(){}});
  vm.runInContext(declaration('action'),context);
  const event={sender:admin.webContents,senderFrame:mainFrame};
  await assert.rejects(context.action({...event,senderFrame:{}},'harness.experience.validate',{workflowId:'original',revision:1}));
  await assert.rejects(context.action({sender:panel.webContents,senderFrame:panel.webContents.mainFrame},'harness.experience.validate',{workflowId:'original',revision:1}));
  await assert.rejects(context.action(event,'harness.experience.validate',{workflowId:'original',revision:1,deadline:'2099-01-01'}));
  await assert.rejects(context.action(event,'harness.experience.list',{unexpected:true}));
  assert.equal(validations,0);await context.action(event,'harness.experience.validate',{workflowId:'original',revision:1});assert.equal(validations,1);
  assert.equal(contexts[0].signal.aborted,true,'the original native scope ends with its operation');
  assert.equal(admin.listenerCount('closed'),0,'the original window listener is released');
  lifetime.abort();await assert.rejects(context.action(event,'harness.experience.list'));assert.equal(validations,1);
});

test('actual Main rejects unconfigured compaction and a steer request cannot interrupt work to compact',async()=>{
  const panel={webContents:{mainFrame:{}},isDestroyed:()=>false};let interrupted=0;
  const context=vm.createContext({subagentListWindow:undefined,subagentWindows:new Map(),orb:undefined,panel,admin:undefined,workspace:undefined,
    competitionMode:true,fakeMode:false,model:{enabled:true},harnessContextHost:undefined,client:{},
    agentArtsConfig:{snapshot:()=>({configured:true})},conversations:{activeConversationId:()=> 'original'},
    submitting:new Set(['original']),conversationDelivery:{interruptPending(){interrupted++;}},ProtocolError});
  vm.runInContext(declaration('action'),context);
  const event={sender:panel.webContents,senderFrame:panel.webContents.mainFrame};
  await assert.rejects(context.action(event,'task.submit',{text:'/压缩',conversationId:'original'}),/摘要模型/);
  context.harnessContextHost={runtimeHooks:{}};
  await assert.rejects(context.action(event,'task.submit',{text:'/compact',conversationId:'original',delivery:'steer'}),/请等待/);
  assert.equal(interrupted,0);
});
