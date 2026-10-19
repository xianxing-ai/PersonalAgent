import test from 'node:test';
import assert from 'node:assert/strict';
import {matrixFor} from './pr-route.mjs';
import {verifySelectedJobs,readAttemptJobs,waitForSelectedJobs,expectedJobHead} from './check-result.mjs';

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

function pollingFixture() {
  const state=fixture('windows'),headSha='a'.repeat(40);
  state.jobs=state.jobs.map(job=>({...job,id:456,run_id:123,run_attempt:2,head_sha:headSha}));
  const logs=[],sleeps=[];let reads=0;
  return {state,logs,sleeps,args:{...state,headSha,runId:123,attempt:2,maxReads:3,
    readJobs:async()=>{reads++;return state.jobs;},sleep:async ms=>sleeps.push(ms),log:line=>logs.push(JSON.parse(line))},reads:()=>reads};
}
test('PR API head identity comes from its event head rather than the synthetic checkout merge',()=>{
  assert.equal(expectedJobHead({pull_request:{head:{sha:'a'.repeat(40)}}},'b'.repeat(40)),'a'.repeat(40));
  assert.equal(expectedJobHead({},'b'.repeat(40)),'b'.repeat(40));
});
test('same-attempt pending evidence can settle to success with bounded re-reads',async()=>{
  const f=pollingFixture(),complete=f.state.jobs;let reads=0;
  const receipts=await waitForSelectedJobs({...f.args,readJobs:async()=>++reads===1?[]:reads===2?complete.map(job=>({...job,status:'in_progress',conclusion:null})):complete});
  assert.equal(receipts[0].result,'success');assert.equal(reads,3);assert.equal(f.sleeps.length,2);
  assert.deepEqual(f.logs.map(row=>row.status),['missing','in_progress','completed']);
  assert.ok(f.logs.every(row=>row.runId==='123'&&row.attempt==='2'));
});
for(const conclusion of ['failure','cancelled','timed_out','skipped']) test(`terminal ${conclusion} is never retried`,async()=>{
  const f=pollingFixture();f.state.jobs[0].conclusion=conclusion;
  await assert.rejects(waitForSelectedJobs(f.args),/did not pass/);
  assert.equal(f.reads(),1);assert.equal(f.sleeps.length,0);
});
for(const status of ['missing','queued','in_progress']) test(`${status} evidence exhausts budget and fails closed`,async()=>{
  const f=pollingFixture();if(status==='missing')f.state.jobs=[];
  else Object.assign(f.state.jobs[0],{status,conclusion:null});
  await assert.rejects(waitForSelectedJobs(f.args),/bounded read budget/);
  assert.equal(f.reads(),3);assert.equal(f.sleeps.length,2);
});
for(const [field,value] of [['run_id',999],['run_attempt',1],['head_sha','b'.repeat(40)]]) test(`wrong ${field} cannot supply success`,async()=>{
  const f=pollingFixture();f.state.jobs[0][field]=value;
  await assert.rejects(waitForSelectedJobs(f.args),/context mismatch/);
  assert.equal(f.reads(),1);assert.equal(f.sleeps.length,0);
});
test('unsuccessful needs never reads or polls job evidence',async()=>{
  const f=pollingFixture();await assert.rejects(waitForSelectedJobs({...f.args,ciResult:'failure'}));
  assert.equal(f.reads(),0);
});
