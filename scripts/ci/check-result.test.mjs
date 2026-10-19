import test from 'node:test';
import assert from 'node:assert/strict';
import {matrixFor} from './pr-route.mjs';
import {verifySelectedJobs,readAttemptJobs} from './check-result.mjs';

function fixture(mode='both') {
  const matrix=matrixFor(mode,{number:421});
  return {routeResult:'success',ciResult:'success',matrix,jobs:matrix.include.map(job=>({
    name:job.name,status:'completed',conclusion:'success',runner_name:job.kind==='windows'?'ecs-windows-fixture':'ecs-linux-fixture',labels:job.runner,html_url:'https://example.invalid/job'
  }))};
}
for(const mode of ['windows','image','both'])test(`only selected ${mode} jobs count as platform evidence`,()=>{
  const state=fixture(mode);
  const receipts=verifySelectedJobs(state);
  assert.deepEqual(receipts.map(item=>item.platform),state.matrix.include.map(job=>job.kind));
});
for(const result of ['skipped','cancelled','failure','timed_out',undefined]) test(`a ${result} dependency or job is not a green gate`,()=>{
  for(const field of ['routeResult','ciResult']) assert.throws(()=>verifySelectedJobs({...fixture(),[field]:result}));
  const state=fixture();state.jobs[0].conclusion=result;
  assert.throws(()=>verifySelectedJobs(state));
});
test('missing, duplicate and pending actual jobs fail closed',()=>{
  for(const mutate of [s=>s.jobs.pop(),s=>s.jobs.push(s.jobs[0]),s=>s.jobs[0].status='in_progress',s=>s.matrix.include=[]]) {
    const state=fixture();mutate(state);assert.throws(()=>verifySelectedJobs(state));
  }
});
test('success without the selected runner identity and labels does not count',()=>{
  for(const mutate of [s=>s.jobs[0].runner_name='',s=>s.jobs[0].labels=['windows-latest']]) {
    const state=fixture();mutate(state);assert.throws(()=>verifySelectedJobs(state));
  }
});
test('job pagination is bound to this attempt and cannot reuse old attempt success',async()=>{
  const urls=[];
  const jobs=await readAttemptJobs({repository:'owner/repo',runId:123,attempt:2,token:'fixture',fetchImpl:async url=>{
    urls.push(url);return {ok:true,json:async()=>({total_count:101,jobs:url.endsWith('page=1')?Array.from({length:100},(_,id)=>({id})):[{id:100}]})};
  }});
  assert.equal(jobs.length,101);
  assert.equal(urls.length,2);
  assert.ok(urls.every(url=>url.includes('/runs/123/attempts/2/jobs?')));
});
test('unreadable and incomplete job receipts cannot pass',async()=>{
  const args={repository:'owner/repo',runId:123,attempt:2,token:'fixture'};
  await assert.rejects(readAttemptJobs({...args,fetchImpl:async()=>({ok:false,status:403})}),/Cannot read/);
  await assert.rejects(readAttemptJobs({...args,fetchImpl:async()=>({ok:true,json:async()=>({jobs:[],total_count:2})})}),/Incomplete/);
});
