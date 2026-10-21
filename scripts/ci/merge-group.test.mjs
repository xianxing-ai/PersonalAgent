import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveRoute,matrixFor} from './pr-route.mjs';
import {readExpectedHeadSha,verifySelectedJobs,waitForSelectedJobs} from './check-result.mjs';

const repository='xianxing-ai/PersonalAgent',sha='b'.repeat(40),ref='refs/heads/gh-readonly-queue/main/pr-464-abcdef';
const payload=()=>({action:'checks_requested',repository:{full_name:repository},
  merge_group:{base_ref:'refs/heads/main',base_sha:'a'.repeat(40),head_ref:ref,head_sha:sha}});
const context=()=>({event:payload(),eventName:'merge_group',repository,ref,sha,token:'fixture',
  fetchImpl:async()=>{throw Error('Queue must not request one PR file list');}});
const expected=event=>readExpectedHeadSha({eventName:'merge_group',eventPath:'fixture.json',githubSha:sha,repository,ref,
  readFileImpl:async()=>JSON.stringify(event)});
test('queue always selects both hosted platforms, independent of file paths and ECS overrides',async()=>{
  const result=await resolveRoute({...context(),imageRunner:'ecs',windowsRunner:'ecs',windowsOverrides:'{"464":"ecs"}'});
  assert.equal(result.selection.mode,'both');
  assert.deepEqual(result.matrix.include.map(job=>job.runner),[['windows-latest'],['ubuntu-24.04']]);
  assert.equal(await expected(payload()),sha);
});
for(const [label,mutate] of [
  ['action',e=>e.action='destroyed'],['repository',e=>e.repository.full_name='attacker/repo'],
  ['base',e=>e.merge_group.base_ref='refs/heads/release'],['base SHA',e=>e.merge_group.base_sha='invalid'],
  ['head SHA',e=>e.merge_group.head_sha='c'.repeat(40)],['missing group',e=>delete e.merge_group],
  ['head ref',e=>e.merge_group.head_ref='refs/heads/main'],['PR payload',e=>e.pull_request={number:464}],
]) test(`router and aggregate reject invalid queue ${label}`,async()=>{
  const event=payload();mutate(event);
  await assert.rejects(resolveRoute({...context(),event}),/Invalid merge group context/);
  await assert.rejects(expected(event),/Invalid merge group context/);
});
test('matching nonqueue head refs cannot masquerade as merge groups',async()=>{
  const event=payload();event.merge_group.head_ref='refs/heads/main';
  await assert.rejects(resolveRoute({...context(),event,ref:'refs/heads/main'}),/Invalid merge group context/);
});
test('unsupported events and missing PR payload cannot fall through to manual ECS routing',async()=>{
  for(const eventName of ['workflow_run','pull_request_target','schedule','unknown']) {
    await assert.rejects(resolveRoute({...context(),eventName,event:{}}),/Unsupported CI event/);
  }
  await assert.rejects(resolveRoute({...context(),eventName:'pull_request',event:{}}),/Missing PR event/);
});
function receiptFixture() {
  const matrix=matrixFor('both',{windowsRunner:'github',imageRunner:'github'});
  return {eventName:'merge_group',routeResult:'success',ciResult:'success',matrix,
    expectedRunId:123,expectedAttempt:2,expectedHeadSha:sha,jobs:matrix.include.map(job=>({
      name:job.name,status:'completed',conclusion:'success',run_id:123,run_attempt:2,head_sha:sha,
      runner_name:'GitHub fixture',labels:job.runner,html_url:'https://example.invalid/job'
    }))};
}
test('queue receipts are bound to both hosted jobs and exact group SHA/run/attempt',()=>{
  assert.equal(verifySelectedJobs(receiptFixture()).length,2);
  for(const mutate of [s=>s.matrix.include.pop(),s=>s.jobs.pop(),s=>s.jobs[0].head_sha='a'.repeat(40),
    s=>s.jobs[0].run_id=124,s=>s.jobs[0].run_attempt=1,s=>s.jobs[0].conclusion='skipped',
    s=>s.jobs[0].conclusion='cancelled',s=>s.jobs[0].labels=['self-hosted'],
    s=>{s.matrix.include[0].runner=['self-hosted'];s.jobs[0].labels=['self-hosted'];}]) {
    const fixture=receiptFixture();mutate(fixture);assert.throws(()=>verifySelectedJobs(fixture));
  }
});
test('queue wait rejects a one-platform route before any API read',async()=>{
  let reads=0;const fixture=receiptFixture();fixture.matrix.include.pop();
  await assert.rejects(waitForSelectedJobs({...fixture,repository,runId:123,attempt:2,token:'fixture',
    fetchImpl:async()=>{reads++;}}),/both GitHub-hosted platforms/);
  assert.equal(reads,0);
});
test('Foundation subscribes to checks_requested without enabling post-merge push CI',async()=>{
  const workflow=await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  assert.match(workflow,/\n  merge_group:\n    types: \[checks_requested\]/);
  assert.doesNotMatch(workflow,/\n  push:/);
});
