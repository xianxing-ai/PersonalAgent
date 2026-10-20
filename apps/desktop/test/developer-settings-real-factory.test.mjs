import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {TaskRuntime} from '@personal-agent/runtime';
import {createDeveloperSettingsHost} from '../electron/developer-settings-host.js';
import {projectDeveloperConversationStatus} from '../electron/developer-deployment-config.js';
import {createDesktopDeveloperToolsHost} from '../electron/developer-tools-host.js';
import {createConversationToolSurface} from '../electron/conversation-tool-surface.js';
import {RuntimeCompetitionToolCatalog} from '../../runtime/dist/application/tool-catalog.js';
import {githubRepairCheckName,registerGitHubRepairLinks} from '@personal-agent/github';

test('same registered H4 proxy exposes opt-in repair tools to the real model catalog and retains original gates',async t=>{
  const base=path.resolve('.cache');mkdirSync(base,{recursive:true});const root=mkdtempSync(path.join(base,'repair-catalog-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const workspaceRoot=path.join(root,'workspace'),cacheRootPath=path.join(root,'cache');mkdirSync(workspaceRoot);mkdirSync(cacheRootPath);
  writeFileSync(path.join(workspaceRoot,'source.txt'),'Synthetic source');
  const executable=path.join(root,'synthetic-gh.exe');writeFileSync(executable,'never executed');chmodSync(executable,0o700);
  const runtime=new TaskRuntime(':memory:');let calls=0,consents=0;
  const identity={repo:'synthetic/repository',runId:31,expectedRunAttempt:2,sourceSha:'a'.repeat(40),repairPrNumber:9,
    repairHeadSha:'b'.repeat(40),workflowExecutionId:'c'.repeat(64)};
  const receipt={...identity,checkRunId:101,externalId:'101',url:'https://github.com/synthetic/repository/runs/101',
    name:githubRepairCheckName(identity),detailsUrl:'https://github.com/synthetic/repository/pull/9',status:'completed',conclusion:'neutral',evidenceRefs:[]};
  const settings=createDeveloperSettingsHost({userData:path.join(root,'user'),
    safeStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v).reverse(),decryptString:v=>Buffer.from(v).reverse().toString()},
    readWorkspace:()=>({bindingId:'original',rootPath:workspaceRoot,available:()=>true,assertCurrent(){}})});
  t.after(()=>{settings.close();runtime.close();});
  const deployment=await settings.createDeployment({cacheRootPath,confirmExport:async()=>{consents++;return true;},
    createHost:options=>{
      const original=options.github.provider;
      try{return createDesktopDeveloperToolsHost({...options,github:{...options.github,
        provider:{verification:'conditional',dispose(){original.dispose();},async execute(op){calls++;assert.equal(op,'actions.repair.get');return structuredClone(receipt);}}}});}
      catch(error){original.dispose();throw error;}
    }});
  deployment.host.bind({runtime});
  const tools={list:()=>deployment.host.tools.map(t=>t.descriptor),invoke:async()=>assert.fail('Catalog cannot execute tools')};
  const catalog=new RuntimeCompetitionToolCatalog(runtime,tools,deployment.host.competitionToolExports,
    createConversationToolSurface({profile:'huawei_ict_agentarts',tools:deployment.host.tools,
      competitionToolAvailability:deployment.host.competitionToolAvailability}),[],()=>true);
  const scope=label=>{
    const task=runtime.submitTask({goal:'Synthetic '+label,conversationId:'repair-catalog',idempotencyKey:label});
    runtime.transitionTask(task.taskId,'planning');runtime.transitionTask(task.taskId,'running');
    const value={taskId:task.taskId,signal:new AbortController().signal,deadline:new Date(Date.now()+30000).toISOString(),
      authorizationRef:'explicit-original-grant',scopes:['github:read']};
    runtime.saveCheckpoint(value.taskId,'application-profile','huawei_ict_agentarts');runtime.saveCheckpoint(value.taskId,'application-deadline',value.deadline);return value;
  };
  const repairNames=['github.actions.repair.link','github.actions.repair.get'];
  const upstream=[];
  const unregister=registerGitHubRepairLinks({register(tool){upstream.push(structuredClone(tool.descriptor));return ()=>{};}},
    {provider:{verification:'conditional',execute:async()=>assert.fail('Metadata collection cannot execute'),dispose(){}}});
  unregister();
  for(const descriptor of upstream)assert.deepEqual(tools.list().find(tool=>tool.name===descriptor.name),descriptor,
    'proxy preserves the entire public descriptor, including schema, version, scopes and side effects');
  const configuration={version:1,repository:identity.repo,github:{executable},git:{sourceBranch:'work',remoteName:'origin',
    remoteUrl:'https://github.com/'+identity.repo+'.git',allowedPaths:['source.txt'],authorName:'Synthetic',authorEmail:'synthetic@example.invalid'}};
  assert.equal((await catalog.prepare(scope('unconfigured'))).some(t=>repairNames.includes(t.name)),false);
  await settings.configure({enabled:true,configuration,token:'synthetic-private-token'});
  const old=scope('default-off');assert.equal((await catalog.prepare(old)).some(t=>repairNames.includes(t.name)),false);
  await settings.configure({enabled:true,configuration:{...configuration,github:{executable,repairLinks:true}}});
  const active=scope('enabled'),visible=await catalog.prepare(active);
  for(const name of repairNames){const entry=visible.find(t=>t.name===name),original=tools.list().find(t=>t.name===name);
    assert.ok(entry,name+' appears in actual model catalog');assert.equal(entry.version,original.version);assert.ok(entry.inputSchema);}
  const tool=deployment.host.tools.find(t=>t.descriptor.name==='github.actions.repair.get'),args={...identity,checkRunId:101};
  await assert.rejects(tool.execute(args,{...active,authorizationRef:undefined}),{code:'SCOPE_DENIED'});
  await assert.rejects(tool.execute(args,{...active,scopes:[]}),{code:'SCOPE_DENIED'});assert.equal(calls,0);
  assert.deepEqual(await tool.execute(args,active),receipt);assert.equal(calls,1);
  await assert.rejects(tool.execute(args,old),{code:'UNSUPPORTED_CAPABILITY'});
  await settings.configure({enabled:true,configuration:{...configuration,github:{executable,repairLinks:false}}});
  assert.equal((await catalog.prepare(scope('disabled-option'))).some(t=>repairNames.includes(t.name)),false);
  await assert.rejects(tool.execute(args,active),{code:'UNSUPPORTED_CAPABILITY'});
  await settings.setEnabled({enabled:false});await assert.rejects(tool.execute(args,scope('revoked')),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(calls,1);assert.equal(consents,0,'catalog and direct scope checks cannot grant external export');
});

test('encrypted settings round-trip through the original deployment factory without executing external tools',async t=>{
  const cache=path.resolve('.cache');mkdirSync(cache,{recursive:true});
  const root=mkdtempSync(path.join(cache,'developer-real-factory-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const userData=path.join(root,'user'),workspaceRoot=path.join(root,'workspace'),toolCache=path.join(root,'tool-cache');
  for(const directory of [userData,workspaceRoot,toolCache])mkdirSync(directory);
  writeFileSync(path.join(workspaceRoot,'source.txt'),'Synthetic source\n');
  // A bound, executable-shaped fixture only. Calling it is never part of this test.
  const executable=path.join(root,'Synthetic-gh.exe');writeFileSync(executable,'synthetic non-executable contents');chmodSync(executable,0o700);
  const token='synthetic-encrypted-credential-only';
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),
    decryptString:value=>Buffer.from(value).reverse().toString()};
  let bindingId='workspace-v1',configurationRef='model-config-v1';
  const readWorkspace=()=>({bindingId,rootPath:workspaceRoot,available:async()=>true,assertCurrent(){}});
  const createSettings=()=>createDeveloperSettingsHost({userData,safeStorage,readWorkspace,
    readModels:()=>[{enabled:true,id:'original-model',configurationRef}]});
  const options={cacheRootPath:toolCache,readModelGateway:()=>({deployment:{id:'synthetic-model'},
    complete(){assert.fail('Configuration must not call a model');}}),
    confirmExport(){assert.fail('Configuration must not request an external export');}};
  const runtime=new TaskRuntime(':memory:'),application={runtime};
  const scope=label=>({taskId:runtime.submitTask({goal:'Synthetic '+label,conversationId:'real-factory-fixture',idempotencyKey:label}).taskId,
    signal:new AbortController().signal,deadline:new Date(Date.now()+60_000).toISOString(),
    authorizationRef:'synthetic-original-grant',scopes:['github:read']});
  let settings=createSettings();t.after(()=>{settings.close();runtime.close();});
  let deployment=await settings.createDeployment(options);
  // The product binds the original Runtime before task-scoped tools are used.
  // Without this lifecycle step the durable-binding gate correctly rejects
  // unavailable capability before the tool's exact scope checks are reached.
  deployment.host.bind(application);
  const names=deployment.host.tools.map(tool=>tool.descriptor.name);
  const repositoryTool=deployment.host.tools.find(tool=>tool.descriptor.name==='developer.repository_context');
  assert.ok(repositoryTool);assert.equal(settings.snapshot().available,false);
  await assert.rejects(repositoryTool.execute({},scope('before-save')),{code:'UNSUPPORTED_CAPABILITY'});
  const configuration={version:1,repository:'synthetic/repository',github:{executable},
    git:{sourceBranch:'work',remoteName:'origin',remoteUrl:'https://github.com/synthetic/repository.git',
      allowedPaths:['source.txt'],authorName:'Synthetic Author',authorEmail:'synthetic@example.invalid'},
    workflows:{modelId:'original-model',configurationRef,maxSteps:3,maxTokens:1000,reviewRules:[{id:'rule',text:'Synthetic rule'}]}};
  await assert.rejects(settings.configure({enabled:true,configuration:{...configuration,github:{executable,tokenFile:'forbidden'}},token}));
  const saved=await settings.configure({enabled:true,configuration,token});
  assert.equal(saved.available,true);assert.equal(saved.tokenConfigured,true);
  assert.deepEqual(deployment.host.tools.map(tool=>tool.descriptor.name),names);
  assert.equal(deployment.host.tools.find(tool=>tool.descriptor.name==='developer.repository_context'),repositoryTool);
  await assert.rejects(repositoryTool.execute({},{...scope('missing-grant'),authorizationRef:undefined}),{code:'SCOPE_DENIED'});
  await assert.rejects(repositoryTool.execute({},{...scope('missing-scope'),scopes:[]}),{code:'SCOPE_DENIED'});
  const originalScope=scope('original-task');
  assert.deepEqual(await repositoryTool.execute({},originalScope),{repository:'synthetic/repository'});
  assert.ok(settings.readDeveloperWorkflows(scope('workflow-task'))?.model);
  for(const value of [settings.snapshot(),deployment.snapshot(),projectDeveloperConversationStatus(deployment.snapshot())])
    assert.equal(JSON.stringify(value).includes(token),false);
  const envelope=JSON.parse(readFileSync(path.join(userData,'developer-settings.json'),'utf8'));
  assert.deepEqual(Object.keys(envelope).sort(),['encrypted','version']);
  assert.equal(JSON.stringify(envelope).includes(token),false);
  settings.close();settings=createSettings();deployment=await settings.createDeployment(options);
  deployment.host.bind(application);
  assert.equal(settings.snapshot().available,true,'the original factory restores the encrypted configuration');
  assert.deepEqual(await deployment.host.tools.find(tool=>tool.descriptor.name==='developer.repository_context')
    .execute({},originalScope),{repository:'synthetic/repository'},'the same original task keeps its persisted checkpoint across settings-host reconstruction');
  assert.deepEqual(await deployment.host.tools.find(tool=>tool.descriptor.name==='developer.repository_context')
    .execute({},scope('restored-task')),{repository:'synthetic/repository'});
  const workflow=settings.readDeveloperWorkflows(scope('pinned-task'));assert.ok(workflow);
  await settings.setEnabled({enabled:false});
  assert.equal(settings.readDeveloperWorkflows(scope('pinned-task')),undefined);
  assert.throws(()=>workflow.assertCurrent(scope('pinned-task')),{code:'UNAUTHORIZED'});
  await settings.setEnabled({enabled:true});
  assert.equal(settings.readDeveloperWorkflows(scope('pinned-task')),undefined,'a stopped task cannot borrow a reactivated revision');
  configurationRef='model-config-v2';
  assert.equal(settings.snapshot().available,false);assert.equal(settings.readDeveloperWorkflows(scope('new-task')),undefined);
  configurationRef='model-config-v1';bindingId='workspace-v2';
  assert.equal(settings.snapshot().available,false,'workspace drift revokes the original deployment');
});
