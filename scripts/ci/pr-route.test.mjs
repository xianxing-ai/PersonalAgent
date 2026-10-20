import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPullRequest,matrixFor,selectWindowsRunner,resolveRoute,isHostedIntegrationPullRequest} from './pr-route.mjs';
for(const [name,files,mode] of [
  ['image Dockerfile',['apps/agentarts-runtime/Dockerfile'],'image'],
  ['image sources and tests',['apps/agentarts-runtime/src/server.mjs','apps/agentarts-runtime/test/server.test.mjs'],'image'],
  ['Windows desktop',['apps/desktop/electron/main.js'],'windows'],
  ['ordinary connector',['packages/connectors/weather/src/index.ts'],'windows'],
  ['documentation',['docs/PRD.md'],'windows'],
  ['mixed image and desktop',['apps/agentarts-runtime/Dockerfile','apps/desktop/package.json'],'both'],
  ['shared image transport',['packages/agentarts/src/index.ts'],'both'],
  ['shared contracts',['packages/contracts/schema/protocol.json'],'both'],
  ['root dependencies',['package-lock.json'],'both'],
  ['shared compiler configuration',['tsconfig.base.json'],'both'],
  ['Runtime host used by the owned image integration fixture',['apps/runtime/src/application.ts'],'both'],
  ['Client used by the owned image integration fixture',['packages/client/src/index.ts'],'both'],
  ['contract fixture gate',['tests/contracts/protocol.test.mjs'],'both'],
  ['image integration fixture',['tests/integration/owned-agentarts-image.test.mjs'],'both'],
  ['CI routing changes',['scripts/ci/pr-route.mjs'],'both'],
  ['image publisher workflow',['.github/workflows/owned-image-preview.yml'],'both'],
  ['PowerShell image release',['scripts/agentarts/release-owned-image.ps1'],'both']
]) test(`routes ${name}`,()=>assert.equal(classifyPullRequest(files.map(filename=>({filename})),files.length).mode,mode));
test('renames retain the previous Windows path in the routing decision',()=>{
  assert.equal(classifyPullRequest([{filename:'apps/agentarts-runtime/src/new.mjs',previous_filename:'apps/desktop/old.mjs'}],1).mode,'both');
});
test('deletions inside the image still require image validation',()=>{
  assert.equal(classifyPullRequest([{filename:'apps/agentarts-runtime/src/removed.mjs',status:'removed'}],1).mode,'image');
});
for(const files of [[],[null],[{}],[{filename:'apps/agentarts-runtime/../desktop/a'}],[{filename:'apps/agentarts-runtime/a',previous_filename:'C:\\old'}]])test('ambiguous paths never bypass either platform',()=>assert.equal(classifyPullRequest(files,files.length).mode,'both'));
test('truncated lists require both platforms',()=>assert.equal(classifyPullRequest([{filename:'apps/agentarts-runtime/Dockerfile'}],3001).mode,'both'));
test('exclusive routes contain exactly one actual CI job; mixed contains both',()=>{
  assert.deepEqual(matrixFor('image').include.map(job=>job.kind),['image']);
  assert.deepEqual(matrixFor('windows').include.map(job=>job.kind),['windows']);
  assert.deepEqual(matrixFor('both').include.map(job=>job.kind),['windows','image']);
});
test('forks and the explicit outage switch use hosted Linux',()=>{
  assert.deepEqual(matrixFor('image',{fork:true}).include[0].runner,['ubuntu-24.04']);
  assert.deepEqual(matrixFor('image',{imageRunner:'github'}).include[0].runner,['ubuntu-24.04']);
  assert.ok(matrixFor('image').include[0].runner.includes('personalagent-ecs'));
  assert.throws(()=>matrixFor('image',{imageRunner:'unknown'}));
});

test('different PRs share Windows work between hosted and the common ECS pool',()=>{
  assert.deepEqual(matrixFor('windows',{number:420}).include[0].runner,['windows-latest']);
  assert.deepEqual(matrixFor('windows',{number:421}).include[0].runner,['self-hosted','Windows','X64','personalagent-windows']);
  for(const number of [420,421,422,423]) assert.equal(matrixFor('both',{number}).include.filter(job=>job.kind==='windows').length,1);
  assert.equal(selectWindowsRunner().pool,'github');
});
test('explicit switches change the selected pool without duplicating Windows checks',()=>{
  assert.equal(selectWindowsRunner({number:421,windowsRunner:'github'}).pool,'github');
  assert.equal(selectWindowsRunner({number:420,windowsRunner:'ecs'}).pool,'ecs');
  assert.equal(selectWindowsRunner({number:421,windowsRunner:'ecs',windowsOverrides:'{"421":"github"}'}).pool,'github');
  assert.equal(selectWindowsRunner({number:423,windowsOverrides:'{"421":"github"}'}).pool,'ecs');
});
test('forks stay hosted even when both explicit switches request ECS',()=>{
  const matrix=matrixFor('both',{fork:true,number:421,windowsRunner:'ecs',windowsOverrides:'{"421":"ecs"}'});
  assert.deepEqual(matrix.include.map(job=>job.runner),[['windows-latest'],['ubuntu-24.04']]);
});
test('invalid overrides and selectors fail rather than silently changing coverage',()=>{
  for(const windowsOverrides of ['null','[]','{"421":"skip"}','{"bad":"github"}','{"0":"ecs"}','invalid']) {
    assert.throws(()=>selectWindowsRunner({number:421,windowsOverrides}));
  }
  assert.throws(()=>selectWindowsRunner({windowsRunner:'other'}));
  assert.throws(()=>selectWindowsRunner({number:0}));
});

const repository='owner/repo',head='a'.repeat(40),sha='b'.repeat(40);
const event={pull_request:{number:421,head:{sha:head}}};
function fakeFiles({files,count=files.length,finalHead=head,status=200}) {
  let reads=0;
  return async url=>({ok:status===200,status,json:async()=>{
    if(url.includes('/files?')) {
      const page=Number(new URL(url).searchParams.get('page'));
      return files.slice((page-1)*100,page*100);
    }
    return {head:{sha:reads++?finalHead:head,repo:{full_name:repository}},changed_files:count};
  }});
}
test('the CLI router includes the second file page before deciding image-only',async()=>{
  const files=Array.from({length:100},(_,i)=>({filename:`apps/agentarts-runtime/${i}.mjs`}));
  files.push({filename:'apps/desktop/main.js'});
  const result=await resolveRoute({event,repository,token:'fixture',fetchImpl:fakeFiles({files})});
  assert.equal(result.selection.mode,'both');
  assert.equal(result.matrix.include[0].name,'Windows CI (ECS)');
});
test('API failures and a moving PR head cannot produce a successful route',async()=>{
  const files=[{filename:'apps/agentarts-runtime/a.mjs'}];
  await assert.rejects(resolveRoute({event,repository,token:'fixture',fetchImpl:fakeFiles({files,status:403})}),/read failed/);
  await assert.rejects(resolveRoute({event,repository,token:'fixture',fetchImpl:fakeFiles({files,finalHead:sha})}),/head moved/);
  await assert.rejects(resolveRoute({event:{pull_request:{...event.pull_request,head:{sha}}},repository,token:'fixture',fetchImpl:fakeFiles({files})}),/head moved/);
});
test('incomplete file evidence requires both actual platforms',async()=>{
  const result=await resolveRoute({event,repository,token:'fixture',fetchImpl:fakeFiles({files:[{filename:'apps/agentarts-runtime/a'}],count:3001})});
  assert.equal(result.selection.mode,'both');
});
test('automatic main reruns are disabled; explicit manual validation still checks both platforms',async()=>{
  const args={event:{client_payload:{target_sha:sha}},eventName:'repository_dispatch',ref:'refs/heads/main',sha,repository,token:'fixture'};
  await assert.rejects(resolveRoute(args),/post-merge CI is disabled/);
  await assert.rejects(resolveRoute({...args,eventName:'push'}),/post-merge CI is disabled/);
  const result=await resolveRoute({...args,eventName:'workflow_dispatch'});
  assert.equal(result.selection.mode,'both');
  assert.equal(result.matrix.include[0].name,'Windows CI (GitHub)');
});


const integrationRepository='zemeng5208/PersonalAgent',integrationBranch='codex/pr-harness-big-batch-20261020';
function integrationPR({headRepository=integrationRepository,headRef=integrationBranch,baseRepository=integrationRepository,baseRef='main'}={}) {
  return {head:{sha:head,ref:headRef,repo:{full_name:headRepository}},base:{ref:baseRef,repo:{full_name:baseRepository}}};
}
function integrationRoute({pr=integrationPR(),files=[{filename:'package-lock.json'}],...options}={}) {
  return resolveRoute({event,eventName:'pull_request',repository:integrationRepository,token:'fixture',...options,
    fetchImpl:async url=>({ok:true,status:200,json:async()=>url.includes('/files?')?files:{...pr,changed_files:files.length}})});
}
test('the one-off hosted exception requires the exact trusted repository and source branch',()=>{
  assert.equal(isHostedIntegrationPullRequest({eventName:'pull_request',repository:integrationRepository,pr:integrationPR()}),true);
  assert.equal(isHostedIntegrationPullRequest(),false);
  for(const pr of [undefined,{}, {head:{}},integrationPR({headRepository:'fork/PersonalAgent'}),integrationPR({baseRepository:'other/repo'}),integrationPR({baseRef:'release'})]) {
    assert.equal(isHostedIntegrationPullRequest({eventName:'pull_request',repository:integrationRepository,pr}),false);
  }
  for(const eventName of [undefined,'workflow_dispatch','push','repository_dispatch','pull_request_target']) {
    assert.equal(isHostedIntegrationPullRequest({eventName,repository:integrationRepository,pr:integrationPR()}),false);
  }
  assert.equal(isHostedIntegrationPullRequest({eventName:'pull_request',repository:'other/repo',pr:integrationPR({headRepository:'other/repo',baseRepository:'other/repo'})}),false);
});
test('the exact integration branch uses the existing hosted jobs despite valid ECS selectors',async()=>{
  const result=await integrationRoute({imageRunner:'ecs',windowsRunner:'ecs',windowsOverrides:'{"421":"ecs"}'});
  assert.equal(result.selection.mode,'both');
  assert.deepEqual(result.matrix.include,[
    {kind:'windows',name:'Windows CI (GitHub)',runner:['windows-latest']},
    {kind:'image',name:'Linux image CI',runner:['ubuntu-24.04']}
  ]);
  assert.equal(result.windows.pool,'github');
  assert.match(result.windows.reason,/approved one-off integration branch/);
});
test('near-miss source branches preserve both original runner defaults even if the event claims the exact branch',async()=>{
  const claimedEvent={pull_request:{...event.pull_request,head:{...event.pull_request.head,ref:integrationBranch,repo:{full_name:integrationRepository}}}};
  for(const headRef of ['codex/another-batch',integrationBranch+'-extra',integrationBranch+'0',integrationBranch.toUpperCase(),'refs/heads/'+integrationBranch,undefined]) {
    const pr=integrationPR();
    pr.head.ref=headRef;
    assert.equal(isHostedIntegrationPullRequest({eventName:'pull_request',repository:integrationRepository,pr}),false);
    const result=await integrationRoute({pr,event:claimedEvent});
    assert.deepEqual(result.matrix,matrixFor('both',{number:event.pull_request.number}));
    assert.equal(result.windows.pool,'ecs');
  }
});
test('the same branch in another repository is ordinary routing and forks remain isolated',async()=>{
  const other=await integrationRoute({repository:'other/repo',pr:integrationPR({headRepository:'other/repo',baseRepository:'other/repo'})});
  assert.deepEqual(other.matrix,matrixFor('both',{number:event.pull_request.number}));
  const fork=await integrationRoute({pr:integrationPR({headRepository:'fork/PersonalAgent'}),imageRunner:'ecs',windowsRunner:'ecs',windowsOverrides:'{"421":"ecs"}'});
  assert.deepEqual(fork.matrix.include.map(job=>job.runner),[['windows-latest'],['ubuntu-24.04']]);
  assert.match(fork.windows.reason,/fork uses an isolated/);
  const otherBase=await integrationRoute({pr:integrationPR({baseRef:'release'})});
  assert.deepEqual(otherBase.matrix,matrixFor('both',{number:event.pull_request.number}));
});
test('the one-off hosted exception changes runners without adding or omitting selected platforms',async()=>{
  for(const [filename,mode,expected] of [
    ['apps/desktop/electron/main.js','windows',[{kind:'windows',name:'Windows CI (GitHub)',runner:['windows-latest']}]],
    ['apps/agentarts-runtime/Dockerfile','image',[{kind:'image',name:'Linux image CI',runner:['ubuntu-24.04']}]]
  ]) {
    const result=await integrationRoute({files:[{filename}]});
    assert.equal(result.selection.mode,mode);
    assert.deepEqual(result.matrix.include,expected);
  }
});
test('manual and non-PR event behavior is not broadened by the branch exception',async()=>{
  const manual=await resolveRoute({event:{},eventName:'workflow_dispatch',repository:integrationRepository,token:'fixture'});
  assert.deepEqual(manual.matrix,matrixFor('both'));
  assert.equal(manual.windows.pool,'github');
  const manualWithPR=await integrationRoute({eventName:'workflow_dispatch'});
  assert.deepEqual(manualWithPR.matrix,matrixFor('both',{number:event.pull_request.number}));
  for(const eventName of ['push','repository_dispatch']) await assert.rejects(integrationRoute({eventName}),/post-merge CI is disabled/);
});
test('the branch exception does not mask invalid existing runner configuration',async()=>{
  for(const options of [{windowsRunner:'other'},{imageRunner:'other'},{windowsOverrides:'invalid'},{windowsOverrides:'null'},{windowsOverrides:'{"421":"skip"}'},{windowsOverrides:'{"bad":"github"}'}]) {
    await assert.rejects(integrationRoute(options));
  }
});
