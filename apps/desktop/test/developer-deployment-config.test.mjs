import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createDesktopDeveloperDeployment,projectDeveloperConversationStatus} from '../electron/developer-deployment-config.js';
// During an isolated fence this test-only override points at the other agent's
// unchanged public host. The integrated worktree uses the normal sibling module.
const {createDesktopDeveloperToolsHost}=await import(process.env.PA_SYNTHETIC_DEVELOPER_HOST_MODULE??'../electron/developer-tools-host.js');
const base=process.env.PA_WIRING_TEST_CACHE??path.resolve('.cache/wiring-20261018/voice/deployment-tests');
mkdirSync(base,{recursive:true});
const context=()=>({taskId:'synthetic-task',runId:'synthetic-run',authorizationRef:'synthetic-run',scopes:['github:read','workspace:read'],
  deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal});
function fixture(t,patch={}) {
  const directory=mkdtempSync(path.join(base,'case-')),root=path.join(directory,'workspace'),cache=path.join(directory,'parser-cache');
  mkdirSync(root);mkdirSync(cache);writeFileSync(path.join(root,'source.js'),'export const fixture = true;\n');
  const token='synthetic-private-token-20261018',tokenFile=path.join(directory,'token'),binary=path.join(directory,'synthetic-gh');
  writeFileSync(tokenFile,token,{mode:0o600});
  writeFileSync(binary,`#!${process.execPath}\nif(process.env.GH_TOKEN!==${JSON.stringify(token)}||process.env.AMBIENT_FIXTURE_SECRET)process.exit(2);\nprocess.stdout.write(JSON.stringify({full_name:'fixture/repo',default_branch:'codex/fixture',private:true,html_url:'https://github.com/fixture/repo'}));\n`,{mode:0o755});
  const config={version:1,repository:'fixture/repo',workspaceRoot:root,github:{executable:binary,tokenFile},
    git:{sourceBranch:'codex/fixture',remoteName:'origin',remoteUrl:'https://github.com/fixture/repo.git',allowedPaths:['source.js'],authorName:'Synthetic Developer',authorEmail:'synthetic@example.invalid'},...patch};
  const configPath=path.join(directory,'config.json');writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  const workspace={rootPath:root,bindingId:'synthetic-selection',available:()=>true,assertCurrent(){},
    command:{rootPath:root,recipeIds:['node-check'],publicEnumPaths:['/recipeId'],available:()=>true,
      tool:{descriptor:{name:'workspace.run_allowed_command',version:'1.0.0',inputSchema:{type:'object',properties:{recipeId:{type:'string',enum:['node-check']}},required:['recipeId'],additionalProperties:false},
        outputSchema:{type:'object'},sideEffect:'local_write',requiredScopes:['workspace:execute'],requiresPresence:false,idempotencySupport:false,recoverySupport:false},execute:async()=>({exitCode:0})}}};
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  return {directory,root,cache,token,tokenFile,binary,config,configPath,workspace,
    rewrite(){writeFileSync(configPath,JSON.stringify(config),{mode:0o600});},
    options:{configPath,workspace,cacheRootPath:cache,createHost:createDesktopDeveloperToolsHost}};
}

test('Local/Synthetic absent configuration is explicit unavailable with no ambient GitHub fallback',async()=>{
  const deployment=await createDesktopDeveloperDeployment({createHost:createDesktopDeveloperToolsHost});
  assert.equal(deployment.snapshot().state,'unavailable');assert.deepEqual(deployment.host.tools,[]);
  assert.ok(deployment.host.unavailable.some(item=>item.capability==='github'));deployment.close();
});

test('Local/Synthetic conversation status excludes private repository, paths, branches and future credential fields',()=>{
  const projected=projectDeveloperConversationStatus({configured:true,state:'configured',workflowsConfigured:true,modelConfigured:false,
    exportConfirmationConfigured:true,repository:'private-owner/private-project',rootPath:'/private/workspace',branch:'private-topic',
    tokenFile:'/private/token',futureCredential:{token:'SYNTHETIC_PRIVATE_CREDENTIAL'},reason:'private-owner/private-project',
    unavailable:[{capability:'github',reason:'trusted_provider_repository_credentials_required',futureToken:'SYNTHETIC_PRIVATE_CREDENTIAL'},
      {capability:'future.private.capability',reason:'SYNTHETIC_PRIVATE_CREDENTIAL'},
      {capability:'developer.model',reason:'private-owner/private-project'}]});
  assert.deepEqual(projected,{configured:true,workflowsConfigured:true,modelConfigured:false,exportConfirmationConfigured:true,state:'configured',
    unavailable:[{capability:'github',reason:'trusted_provider_repository_credentials_required'}]});
  assert.doesNotMatch(JSON.stringify(projected),/private-owner|private-project|private-topic|\/private|CREDENTIAL|futureCredential|tokenFile/);
  assert.equal(projectDeveloperConversationStatus({state:'private-owner/private-project'}).state,'unavailable');
});

test('Local/Synthetic no GitHub configuration retains original selected commands/parser and exact export consent',async t=>{
  const f=fixture(t),consents=[];
  const deployment=await createDesktopDeveloperDeployment({...f.options,configPath:undefined,
    confirmExport:async input=>{consents.push(input.kind);return true;}});t.after(()=>deployment.close());
  assert.equal(deployment.snapshot().state,'partial');
  assert.ok(deployment.host.tools.some(tool=>tool.descriptor.name==='workspace.run_allowed_command'));
  assert.ok(deployment.host.tools.some(tool=>tool.descriptor.name==='workspace.locate_test_failures'));
  assert.ok(deployment.host.unavailable.some(item=>item.capability==='github'));
  assert.equal(deployment.host.tools.some(tool=>tool.descriptor.name.startsWith('github.')),false);
  const tool=deployment.host.tools.find(tool=>tool.descriptor.name==='workspace.locate_test_failures');
  const scope={...context(),phase:'preflight',proposal:{proposalId:'parse-original',toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:{output:'Synthetic no failures'}}};
  await deployment.prepareExport(scope);
  const policy=deployment.host.competitionToolExports.find(item=>item.toolName===tool.descriptor.name);
  const result=await tool.execute(scope.proposal.arguments,scope);
  assert.deepEqual(await policy.project({taskId:scope.taskId,proposalId:'parse-original',result,signal:scope.signal}),result);
  assert.deepEqual(consents,['developer_tool_metadata','developer_tool_result']);
});

test('Local/Synthetic parser without a workspace requires explicit original-task scope and exposes no source',async t=>{
  const f=fixture(t),deployment=await createDesktopDeveloperDeployment({cacheRootPath:f.cache,createHost:createDesktopDeveloperToolsHost,
    available:scope=>scope.taskId==='original-task'});t.after(()=>deployment.close());
  const tool=deployment.host.tools.find(item=>item.descriptor.name==='workspace.locate_test_failures');
  await assert.rejects(tool.execute({output:''},context()),{code:'UNSUPPORTED_CAPABILITY'});
  const result=await tool.execute({output:'Synthetic empty report'},{...context(),taskId:'original-task'});
  assert.equal(result.totalFailures,0);assert.equal(deployment.host.competitionToolExports.length,0);
});

test('Local/Synthetic explicit config composes public gh provider, original command and safe parser without exporting by default',async t=>{
  const f=fixture(t),deployment=await createDesktopDeveloperDeployment(f.options);t.after(()=>deployment.close());
  assert.equal(deployment.snapshot().repository,'fixture/repo');assert.equal(deployment.snapshot().exportConfirmationConfigured,false);
  assert.equal(deployment.host.competitionToolExports.length,0);
  assert.ok(deployment.host.tools.some(tool=>tool.descriptor.name==='workspace.run_allowed_command'));
  const parser=deployment.host.tools.find(tool=>tool.descriptor.name==='workspace.locate_test_failures');
  const report=await parser.execute({output:`not ok 1 - Synthetic test\n  ---\n  error: fixture failure\n  stack: |-\n    TestContext.<anonymous> (${f.root}/source.js:1:1)\n  ...\n`},context());
  assert.equal(JSON.stringify(report).includes('export const fixture'),false);
  const tool=deployment.host.tools.find(tool=>tool.descriptor.name==='github.repo.get');
  process.env.AMBIENT_FIXTURE_SECRET='must-not-inherit';
  try{const result=await tool.execute({repo:'fixture/repo'},context());assert.equal(result.fullName,'fixture/repo');}
  finally{delete process.env.AMBIENT_FIXTURE_SECRET;}
  await assert.rejects(tool.execute({repo:'other/repo'},context()),{code:'SCOPE_DENIED'});
  assert.equal(JSON.stringify(deployment.snapshot()).includes(f.token),false);assert.equal(JSON.stringify(deployment.snapshot()).includes(f.tokenFile),false);
});

test('Local/Synthetic exact metadata and result permissions bind one proposal and reject credential leakage',async t=>{
  const f=fixture(t),requests=[];
  const deployment=await createDesktopDeveloperDeployment({...f.options,confirmExport:async value=>{requests.push(value);return true;}});t.after(()=>deployment.close());
  const tool=deployment.host.tools.find(tool=>tool.descriptor.name==='github.repo.get'),policy=deployment.host.competitionToolExports.find(policy=>policy.toolName===tool.descriptor.name);
  const scope={...context(),phase:'preflight',proposal:{proposalId:'original-proposal',toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:{repo:'fixture/repo'}}};
  const selected={taskId:scope.taskId,proposalId:scope.proposal.proposalId,arguments:scope.proposal.arguments};
  assert.equal(policy.accepts(selected),false);await deployment.prepareExport(scope);assert.equal(policy.accepts(selected),true);
  assert.equal(policy.accepts({...selected,arguments:{repo:'other/repo'}}),false);
  const result=await tool.execute(scope.proposal.arguments,scope),projected=await policy.project({...selected,result,signal:scope.signal});
  assert.deepEqual(projected,result);assert.equal(policy.accepts({...selected,phase:'final',projection:projected}),true);
  assert.equal(policy.accepts({...selected,phase:'final',projection:{...projected,fullName:'substituted'}}),false);
  assert.equal(policy.accepts({...selected,phase:'final',projection:JSON.stringify(projected)}),false);
  assert.deepEqual(requests.map(item=>item.kind),['developer_tool_metadata','developer_tool_result']);
  assert.deepEqual(requests[1].payload.result,result);
  await assert.rejects(policy.project({...selected,result:{body:f.token},signal:scope.signal}),{code:'UNAUTHORIZED'});
  assert.equal(requests.length,2);deployment.close();assert.equal(policy.accepts(selected),false);
});

test('Local/Synthetic configured repository context remains local until exact permission and rejects bad inputs or revoked config',async t=>{
  const f=fixture(t),consents=[],deployment=await createDesktopDeveloperDeployment({...f.options,confirmExport:async input=>{
    consents.push(input);return true;
  }});t.after(()=>deployment.close());
  const tool=deployment.host.tools.find(item=>item.descriptor.name==='developer.repository_context');
  assert.ok(tool);assert.equal(tool.descriptor.sideEffect,'read');assert.equal(JSON.stringify(tool.descriptor).includes('fixture/repo'),false);
  const policy=deployment.host.competitionToolExports.find(item=>item.toolName===tool.descriptor.name),scope={...context(),phase:'preflight',
    proposal:{proposalId:'repository-original',toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:{}}};
  const binding={taskId:scope.taskId,proposalId:scope.proposal.proposalId,arguments:{}};
  assert.equal(policy.accepts(binding),false);
  await assert.rejects(policy.project({...binding,result:{repository:'fixture/repo'},signal:scope.signal}),{code:'UNAUTHORIZED'});
  await assert.rejects(tool.execute({repository:'other/repo'},scope),{code:'INVALID_ARGUMENT'});
  await assert.rejects(tool.execute({},{...scope,scopes:[]}),{code:'SCOPE_DENIED'});
  const result=await tool.execute({},scope);assert.deepEqual(result,{repository:'fixture/repo'});assert.equal(consents.length,0);
  await deployment.prepareExport(scope);
  assert.deepEqual(await policy.project({...binding,result,signal:scope.signal}),{repository:'fixture/repo'});
  assert.deepEqual(consents.map(item=>item.kind),['developer_tool_metadata','developer_tool_result']);
  assert.equal(JSON.stringify(consents).includes(f.token),false);assert.equal(JSON.stringify(consents).includes(f.tokenFile),false);
  assert.equal(JSON.stringify(projectDeveloperConversationStatus(deployment.snapshot())).includes('fixture/repo'),false);
  f.config.git.sourceBranch='changed';f.rewrite();
  await assert.rejects(tool.execute({},scope),{code:'UNSUPPORTED_CAPABILITY'});assert.equal(policy.accepts({...binding,phase:'final',projection:result}),false);
  const absent=await createDesktopDeveloperDeployment({createHost:createDesktopDeveloperToolsHost});
  assert.equal(absent.host.tools.some(item=>item.descriptor.name==='developer.repository_context'),false);absent.close();
});

test('Local/Synthetic repository context uses the original Runtime ToolGateway, scope and execution Evidence',async t=>{
  const f=fixture(t),consents=[],deployment=await createDesktopDeveloperDeployment({...f.options,confirmExport:async input=>{consents.push(input.kind);return true;}});
  const tool=deployment.host.tools.find(item=>item.descriptor.name==='developer.repository_context');
  const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:deployment.host.tools,
    competitionToolAvailability:deployment.host.competitionToolAvailability,competitionToolExports:deployment.host.competitionToolExports,
    prepareCompetitionToolExport:deployment.prepareExport,automaticTools:[{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version}],
    coordination:{async execute(input){if(input.continuation){assert.deepEqual(input.continuation.result,{repository:'fixture/repo'});
      return {kind:'text',text:'Synthetic configured repository readback',verification:'unverified'};}
      return {kind:'tool_proposal',proposalId:'configured-repository',toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:{},verification:'unverified'};}}});
  deployment.host.bind(app);t.after(async()=>{for(let i=0;i<200&&app.activeTaskCount;i++)await new Promise(resolve=>setTimeout(resolve,5));deployment.close();app.close();});
  const client=new Client(app,Date.now);await client.connect();
  const task=await client.call('task.submit',{goal:'Synthetic current repository',conversationId:'synthetic-deployment-ui'},{idempotencyKey:'repository-context-runtime'});
  for(let i=0;i<200&&!['succeeded','failed'].includes(app.runtime.getTask(task.taskId).state);i++)await new Promise(resolve=>setTimeout(resolve,5));
  const completed=app.runtime.getTask(task.taskId);assert.equal(completed.state,'succeeded');assert.equal(completed.evidenceRefs.length,1);
  const records=app.runtime.readToolExecutions(task.taskId);assert.equal(records.length,1);assert.equal(records[0].toolName,tool.descriptor.name);
  assert.equal(records[0].policyDecision,'allow');assert.equal(records[0].executionStarted,true);assert.equal(records[0].state,'confirmed');
  assert.deepEqual(consents,['developer_tool_metadata','developer_tool_result']);
});

test('Local/Synthetic explicit workflow model configuration uses only the injected original gateway and exact egress callbacks',async t=>{
  const f=fixture(t),events=[];
  f.config.workflows={bindingId:'fixture-workflows',modelId:'fixture-model',configurationRef:'fixture-ref',maxSteps:8,maxTokens:2000,
    reviewRules:[{id:'fixture-rule',text:'Review only the selected files'}],issueTriage:{labels:['bug'],minConfidence:0.8},
    ciFix:{verifyRecipeId:'node-check',baseBranch:'main'}};f.rewrite();
  const deployment=await createDesktopDeveloperDeployment({...f.options,readModelGateway:(modelId,ref)=>{
    assert.equal(modelId,'fixture-model');assert.equal(ref,'fixture-ref');return {deployment:{id:'fixture'},complete:async request=>{events.push('original-gateway');return {response:{kind:'text',text:'Synthetic answer'}};}};
  },confirmExport:async input=>{events.push(input.kind);return true;}});t.after(()=>deployment.close());
  const workflow=deployment.host.runtimeOptions.developerWorkflows,request={messages:[{role:'user',content:'Synthetic exact diff'}],tools:[],deadline:context().deadline,signal:context().signal};
  await workflow.authorizeModelRequest(request,context());await workflow.model.complete(request);
  assert.deepEqual(events,['developer_model_request','original-gateway']);
  assert.deepEqual(await workflow.projectResult({kind:'Synthetic report'},context()),{kind:'Synthetic report'});
  assert.equal(workflow.ciFix.headBranch,'codex/fixture');assert.deepEqual(workflow.ciFix.sourcePaths,['source.js']);
});

test('Local/Synthetic wrong paths, branch/remote scope and exposed private token files fail without leaking values',async t=>{
  for(const kind of ['workspace-mismatch','branch','remote','allowed-path','binary-relative','token-world-readable','token-symlink','unknown-field'])await t.test(kind,async t=>{
    const f=fixture(t);
    if(kind==='workspace-mismatch')f.config.workspaceRoot=f.cache;
    if(kind==='branch')f.config.git.sourceBranch='../other';
    if(kind==='remote')f.config.git.remoteUrl='https://github.com/another/repository.git';
    if(kind==='allowed-path')f.config.git.allowedPaths=['../token'];
    if(kind==='binary-relative')f.config.github.executable='gh';
    if(kind==='token-world-readable')chmodSync(f.tokenFile,0o644);
    if(kind==='token-symlink'){const link=path.join(f.directory,'token-link');symlinkSync(f.tokenFile,link);f.config.github.tokenFile=link;}
    if(kind==='unknown-field')f.config.github.token=f.token;
    f.rewrite();await assert.rejects(createDesktopDeveloperDeployment(f.options),error=>{
      assert.equal(error.code,'UNSUPPORTED_CAPABILITY');assert.equal(error.message.includes(f.token),false);assert.equal(error.message.includes(f.configPath),false);return true;
    });
  });
});

test('Local/Synthetic config or credential changes revoke the original deployment lease',async t=>{
  const f=fixture(t),deployment=await createDesktopDeveloperDeployment(f.options);t.after(()=>deployment.close());
  const item=deployment.host.competitionToolAvailability.find(item=>item.toolName==='github.repo.get');
  assert.equal(await item.available(context()),true);
  writeFileSync(f.tokenFile,'different-synthetic-token',{mode:0o600});assert.equal(await item.available(context()),false);
  writeFileSync(f.tokenFile,f.token,{mode:0o600});f.config.git.sourceBranch='another';f.rewrite();assert.equal(await item.available(context()),false);
  assert.equal(readFileSync(f.tokenFile,'utf8'),f.token);
});

test('Local/Synthetic denied or cancelled exact confirmation cannot publish a metadata permit',async t=>{
  for(const cancel of [false,true])await t.test(cancel?'cancelled callback':'explicit denial',async t=>{
    const f=fixture(t),controller=new AbortController();let started;
    const invoked=new Promise(resolve=>{started=resolve;});
    const deployment=await createDesktopDeveloperDeployment({...f.options,confirmExport:async()=>{
      started();return cancel?new Promise(()=>{}):false;
    }});t.after(()=>deployment.close());
    const tool=deployment.host.tools.find(tool=>tool.descriptor.name==='github.repo.get'),scope={...context(),signal:controller.signal,phase:'preflight',
      proposal:{proposalId:'denied',toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,arguments:{repo:'fixture/repo'}}};
    const result=deployment.prepareExport(scope);await invoked;if(cancel)controller.abort();
    await assert.rejects(result,{code:'UNAUTHORIZED'});
    const policy=deployment.host.competitionToolExports.find(policy=>policy.toolName===tool.descriptor.name);
    assert.equal(policy.accepts({taskId:scope.taskId,proposalId:'denied',arguments:{repo:'fixture/repo'}}),false);
  });
});
