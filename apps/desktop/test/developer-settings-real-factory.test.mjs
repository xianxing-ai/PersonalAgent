import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {TaskRuntime} from '@personal-agent/runtime';
import {createDeveloperSettingsHost} from '../electron/developer-settings-host.js';
import {projectDeveloperConversationStatus} from '../electron/developer-deployment-config.js';

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
