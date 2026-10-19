import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPullRequest,matrixFor} from './pr-route.mjs';
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
  ['contract fixture gate',['tests/contracts/protocol.test.mjs'],'both'],
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
