import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createGitHubF18F19Tools} from '@personal-agent/github';
import {createWorkspaceCommandTool} from '@personal-agent/coding-tools';
import {createF19IssueConfiguration,createConfiguredDesktopF19IssueRepairPorts} from '../electron/f19-issue-config-host.js';
import {createDesktopF18F19WorkflowPorts} from '../electron/f18-f19-workflow-ports.js';

async function fixture(t){
  const cache=resolve('.cache/f19-config');await mkdir(cache,{recursive:true});const root=await realpath(await mkdtemp(join(cache,'selection-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const userData=join(root,'settings'),workspace=join(root,'workspace'),regression=join(root,'regression'),checkers=join(root,'checkers');
  for(const directory of [userData,workspace,regression,checkers])await mkdir(directory);
  const checker=join(checkers,'original-bug.cjs');await writeFile(checker,'throw Error("Config fixture must never execute");\n');
  let bindingId='original',encrypted=true,selected,repository='synthetic/f19';
  const readWorkspace=()=>({bindingId,rootPath:workspace,command:{recipeIds:['node-check']},assertCurrent(){}});
  const options={userData,readWorkspace,readRepositoryBinding:()=>({repository,bindingId}),selectFile:()=>selected,
    safeStorage:{isEncryptionAvailable:()=>encrypted,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}}; // Explicit Fake safeStorage.
  const configuration={selection:{repo:repository,issueId:19,expectedUpdatedAt:'2026-11-01T00:00:00Z',allowedPaths:['feature.cjs'],
    headSha:'a'.repeat(40),verificationRecipeId:'node-check',publication:{branch:'codex/f19-fixture',base:'main'}},
    regression:{rootPath:regression,sourceBranch:'f19-regression',checkerPath:checker,checkerSha256:createHash('sha256').update(await readFile(checker)).digest('hex')}};
  const git={repository,rootPath:workspace,sourceBranch:'codex/f19-fixture',remoteUrl:'https://github.com/synthetic/f19.git',
    allowedPaths:['feature.cjs'],authorName:'Synthetic',authorEmail:'fixture@example.invalid'};
  let capturedOptions,configuredPublication,commands=0,appReads=0,application;
  const native={createCommandTool(input){commands++;assert.equal(typeof input.readF19Binding,'function');return createWorkspaceCommandTool(input);}}; // No execution in configuration tests.
  const host={createF18F19Tools(policy){capturedOptions=policy;return createGitHubF18F19Tools({runner:{run(){assert.fail('No HTTP in configuration');}},
    readToken:async()=> 'synthetic-unused',repositories:[repository],beforeWrite(){assert.fail('No write');},...policy});},
    readF16PublicationConfiguration:()=>git,configureF19Publication:port=>{configuredPublication=port;}};
  const deployment={snapshot:()=>({configured:true,state:'configured',repository}),host};
  const codingWorkspace={readDeveloperConfiguration:readWorkspace,readWorkspaceBinding:()=>({rootPath:workspace,nodeExecutable:process.execPath,bindingId})};
  const assembly={getApplication:()=>{appReads++;return application;},codingWorkspace,developerDeployment:deployment,nativeExecutionHost:native,
    authorizeExport:async()=>false,requestPresence:async()=>{assert.fail('No gesture in configuration');}};
  const scope={taskId:'original-task',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal};
  const attach=()=>{application={runtime:{getTask:()=>({state:'running',cancelRequested:false}),loadCheckpoint:()=>scope.deadline},readToolConversation:()=> 'original-conversation'};};
  return {root,workspace,checker,options,configuration,git,host,deployment,assembly,scope,attach,
    get capturedOptions(){return capturedOptions;},get configuredPublication(){return configuredPublication;},get commands(){return commands;},get appReads(){return appReads;},
    set bindingId(value){bindingId=value;},set repository(value){repository=value;},set encrypted(value){encrypted=value;},set selected(value){selected=value;}};
}

test('F19 native configuration lazily composes original developer/native ports with a fixed checker and no authority',async t=>{
  const f=await fixture(t),config=createF19IssueConfiguration(f.options);t.after(()=>config.close());
  assert.deepEqual(config.snapshot(),{configured:false});
  assert.deepEqual(createConfiguredDesktopF19IssueRepairPorts({...f.assembly,issueConfiguration:config}).tools,[]);
  const saved=config.configureFromNativeSelection(f.configuration);assert.equal(saved.configured,true);
  assert.deepEqual(createF19IssueConfiguration(f.options).snapshot(),saved);
  const envelope=JSON.parse(await readFile(join(f.options.userData,'f19-issue-selection.json'),'utf8'));
  assert.deepEqual(Object.keys(envelope).sort(),['encrypted','version']);
  const ports=createConfiguredDesktopF19IssueRepairPorts({...f.assembly,issueConfiguration:config});
  assert.equal(f.appReads,0,'constructing ports must not prematurely inspect the future Runtime');
  assert.equal(f.commands,1);assert.equal(f.capturedOptions.enableIssueClose,true);assert.equal(typeof f.capturedOptions.beforeWrite,'function');
  assert.equal(f.capturedOptions.issueRepairOnly,true);
  assert.equal(f.configuredPublication,ports.publication);assert.equal(ports.configuredWorkflowWorkerPorts[0].available(),true);
  for(const name of ['preparePublicationQuestion','confirmPublicationPresence','prepareRegressionQuestion','confirmRegressionPresence','prepareCloseQuestion','confirmClosePresence'])
    assert.equal(typeof ports[name],'function');
  f.attach();const worker=ports.configuredWorkflowWorkerPorts[0],input=await worker.resolveInput(f.configuration.selection,f.scope);
  assert.deepEqual(input.allowedPaths,['feature.cjs']);assert.equal(input.issueId,19);assert.ok(f.appReads>0);
  for(const value of [{...f.configuration,approved:true},{...f.configuration,taskId:'foreign'},
    {...f.configuration,regression:{...f.configuration.regression,executable:process.execPath}},
    {...f.configuration,regression:{...f.configuration.regression,args:['--eval','bad']}},
    {...f.configuration,selection:{...f.configuration.selection,verified:true}}])assert.throws(()=>config.configureFromNativeSelection(value));
  assert.throws(()=>config.configureFromNativeSelection({...f.configuration,selection:{...f.configuration.selection,verificationRecipeId:'arbitrary-command'}}));
  assert.throws(()=>config.configureFromNativeSelection({...f.configuration,regression:{...f.configuration.regression,rootPath:f.workspace}}));
  config.configureFromNativeSelection(f.configuration);assert.throws(()=>worker.assertCurrent(f.scope),{code:'UNAUTHORIZED'});
  f.bindingId='changed';assert.deepEqual(config.snapshot(),{configured:false});f.bindingId='original';
  f.repository='foreign/repo';assert.deepEqual(config.snapshot(),{configured:false});f.repository='synthetic/f19';
  f.encrypted=false;assert.deepEqual(config.snapshot(),{configured:false});
});

test('F19 native picker rejects malformed, linked, oversized and stale JSON without replacing prior selection',async t=>{
  const f=await fixture(t),config=createF19IssueConfiguration(f.options);t.after(()=>config.close());
  const selected=join(f.root,'selected.json');f.selected=selected;await writeFile(selected,JSON.stringify(f.configuration));
  const saved=await config.selectFromNativeDialog();assert.equal(saved.configured,true);assert.equal('regression' in saved,false);
  for(const bytes of [Buffer.from([0xff]),' '.repeat(65537),JSON.stringify({...f.configuration,receipt:{verified:true}})]){
    await writeFile(selected,bytes);await assert.rejects(config.selectFromNativeDialog());assert.deepEqual(config.snapshot(),saved);
  }
  await writeFile(selected,JSON.stringify(f.configuration));
  f.selected=undefined;assert.deepEqual(await config.selectFromNativeDialog(),{cancelled:true});
  const alias=join(f.root,'linked-settings');await symlink(f.options.userData,alias,process.platform==='win32'?'junction':'dir');
  const linked=createF19IssueConfiguration({...f.options,userData:alias});assert.deepEqual(linked.snapshot(),{configured:false});
  assert.throws(()=>linked.configureFromNativeSelection(f.configuration),{code:'UNAUTHORIZED'});linked.close();
  let finish;f.selected=new Promise(resolve=>{finish=resolve;});const pending=config.selectFromNativeDialog();
  f.bindingId='changed';finish(selected);await assert.rejects(pending,{code:'UNAUTHORIZED'});f.bindingId='original';
  f.selected=new Promise(resolve=>{finish=resolve;});const stale=config.selectFromNativeDialog();
  config.configureFromNativeSelection(f.configuration);finish(selected);await assert.rejects(stale,{code:'UNAUTHORIZED'});
  await writeFile(f.checker,'process.exit(0);\n');assert.deepEqual(config.snapshot(),{configured:false});
  assert.deepEqual(createConfiguredDesktopF19IssueRepairPorts({...f.assembly,issueConfiguration:config}).tools,[]);
});

test('F19 configured adapter refuses missing original providers and revokes when the captured deployment is replaced',async t=>{
  const f=await fixture(t),config=createF19IssueConfiguration(f.options);t.after(()=>config.close());config.configureFromNativeSelection(f.configuration);
  for(const patch of [{nativeExecutionHost:undefined},{getApplication:undefined},{authorizeExport:undefined},{requestPresence:undefined},
    {codingWorkspace:{readDeveloperConfiguration:()=>undefined}},{developerDeployment:{snapshot:()=>({configured:false})}}])
    assert.deepEqual(createConfiguredDesktopF19IssueRepairPorts({...f.assembly,issueConfiguration:config,...patch}).tools,[]);
  const ports=createConfiguredDesktopF19IssueRepairPorts({...f.assembly,issueConfiguration:config});f.attach();
  const worker=ports.configuredWorkflowWorkerPorts[0];worker.assertCurrent(f.scope);
  f.deployment.host={...f.host};assert.throws(()=>worker.assertCurrent(f.scope),{code:'UNAUTHORIZED'});f.deployment.host=f.host;
  const abort=new AbortController();abort.abort();assert.throws(()=>worker.assertCurrent({...f.scope,signal:abort.signal}));
  assert.throws(()=>worker.assertCurrent({...f.scope,deadline:'2020-01-01T00:00:00Z'}));
  config.close();assert.deepEqual(config.snapshot(),{configured:false});assert.throws(()=>worker.assertCurrent(f.scope));
});

test('same configured deployment composes F18 and F19 with only their three identical read tools deduplicated',async t=>{
  const f=await fixture(t),config=createF19IssueConfiguration(f.options);t.after(()=>config.close());config.configureFromNativeSelection(f.configuration);
  const f19=createConfiguredDesktopF19IssueRepairPorts({...f.assembly,issueConfiguration:config}),closeGuard=f.capturedOptions.beforeWrite;
  let underlying;
  const f18=createDesktopF18F19WorkflowPorts({getApplication:f.assembly.getApplication,
    github:{available:async()=>true,assertCurrent(){},createTools:options=>(underlying=f.host.createF18F19Tools(options))},
    selection:{configurationRef:'a'.repeat(64),assertCurrent(){},readSelection:async()=>({})},
    requiredChecks:['technical-ci'],eligibleReviewers:['reviewer'],authorizeExport:async()=>false,requestPresence:async()=>false});
  assert.equal(f18.configuredWorkflowWorkerPorts.length,1);assert.notEqual(f.capturedOptions.beforeWrite,closeGuard);
  const common=new Set(['github.issue_snapshot','github.merged_pr_readback','github.issue_close_readback']);
  for(const name of common){
    const left=f18.tools.find(tool=>tool.descriptor.name===name),right=f19.tools.find(tool=>tool.descriptor.name===name);
    assert.deepEqual(left.descriptor,right.descriptor);assert.equal(left.descriptor.sideEffect,'read');
    assert.equal(left,underlying.find(tool=>tool.descriptor.name===name),'The F18 factory preserves the original deployment read implementation');
  }
  const combined=[...f18.tools,...f19.tools.filter(tool=>!common.has(tool.descriptor.name))];
  assert.equal(new Set(combined.map(tool=>tool.descriptor.name)).size,combined.length);
  for(const name of ['github.registered_merge','github.registered_close_issue','github.current_head_merge_gate'])
    assert.equal(combined.filter(tool=>tool.descriptor.name===name).length,1);
  assert.equal(combined.find(tool=>tool.descriptor.name==='github.registered_close_issue'),f19.tools.find(tool=>tool.descriptor.name==='github.registered_close_issue'));
  assert.equal(f.appReads,0,'Combining configured tools still does not inspect an uninitialized Runtime');
});
