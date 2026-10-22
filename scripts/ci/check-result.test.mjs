import test from 'node:test';
import assert from 'node:assert/strict';
import {matrixFor} from './pr-route.mjs';
import {verifySelectedJobs,readAttemptJobs,waitForSelectedJobs,selectExpectedHeadSha,readExpectedHeadSha} from './check-result.mjs';

const HEAD_SHA='a'.repeat(40);
const MERGE_SHA='f'.repeat(40);

function fixture(mode='both') {
  const matrix=matrixFor(mode,{number:427});
  return {routeResult:'success',ciResult:'success',matrix,jobs:matrix.include.map(job=>({
    name:job.name,status:'completed',conclusion:'success',run_id:123,run_attempt:2,head_sha:HEAD_SHA,
    runner_name:job.kind==='windows'?'ecs-windows-fixture':'ecs-linux-fixture',labels:job.runner,html_url:'https://example.invalid/job'
  }))};
}

function page(jobs) {
  return {ok:true,json:async()=>({total_count:jobs.length,jobs})};
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
test('selected jobs must belong to the current run attempt and head when identity is supplied',()=>{
  const state=fixture('windows');
  assert.doesNotThrow(()=>verifySelectedJobs({...state,expectedRunId:123,expectedAttempt:2,expectedHeadSha:HEAD_SHA}));
  for(const field of ['run_id','run_attempt','head_sha']) {
    const mismatch=fixture('windows');
    mismatch.jobs[0][field]=field==='head_sha'?'b'.repeat(40):999;
    assert.throws(()=>verifySelectedJobs({...mismatch,expectedRunId:123,expectedAttempt:2,expectedHeadSha:HEAD_SHA}),/Job identity mismatch/);
  }
});
test('PR gates use the event PR head instead of the synthetic merge SHA',async()=>{
  const expectedHeadSha=await readExpectedHeadSha({eventName:'pull_request',eventPath:'event.json',githubSha:MERGE_SHA,
    readFileImpl:async()=>JSON.stringify({pull_request:{head:{sha:HEAD_SHA}}})});
  assert.equal(expectedHeadSha,HEAD_SHA);
  assert.equal(selectExpectedHeadSha({eventName:'workflow_dispatch',eventPayload:{pull_request:{head:{sha:HEAD_SHA}}},githubSha:MERGE_SHA}),MERGE_SHA);
  const state=fixture('windows');
  const receipts=await waitForSelectedJobs({...state,repository:'owner/repo',runId:123,attempt:2,token:'fixture',expectedHeadSha,
    fetchImpl:async()=>page(state.jobs)});
  assert.deepEqual(receipts.map(item=>item.platform),['windows']);
  assert.throws(()=>verifySelectedJobs({...state,expectedRunId:123,expectedAttempt:2,expectedHeadSha:MERGE_SHA}),/Job identity mismatch/);
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
test('pagination shares the overall deadline instead of resetting it per page',async()=>{
  let clock=0;
  await assert.rejects(readAttemptJobs({repository:'owner/repo',runId:123,attempt:2,token:'fixture',deadline:100,now:()=>clock,fetchImpl:async()=>{
    clock=150;
    return {ok:true,json:async()=>({total_count:101,jobs:Array.from({length:100},(_,id)=>({id}))})};
  }}),/deadline exceeded/);
});
test('unreadable and incomplete job receipts cannot pass',async()=>{
  const args={repository:'owner/repo',runId:123,attempt:2,token:'fixture'};
  await assert.rejects(readAttemptJobs({...args,fetchImpl:async()=>({ok:false,status:403})}),/Cannot read/);
  await assert.rejects(readAttemptJobs({...args,fetchImpl:async()=>({ok:true,json:async()=>({jobs:[],total_count:2})})}),/Incomplete/);
});

test('transient API failure and nonterminal state are retried until the same selected job succeeds',async()=>{
  const state=fixture('windows');
  const pending={...state.jobs[0],status:'in_progress',conclusion:null,runner_name:null,labels:[]};
  const urls=[];
  const delays=[];
  let clock=0;
  let calls=0;
  const receipts=await waitForSelectedJobs({...state,repository:'owner/repo',runId:123,attempt:2,token:'fixture',expectedHeadSha:HEAD_SHA,
    timeoutMs:5000,retryDelayMs:100,now:()=>clock,sleep:async milliseconds=>{delays.push(milliseconds);clock+=milliseconds},
    fetchImpl:async url=>{
      urls.push(url);
      calls++;
      if(calls===1) return {ok:false,status:502};
      return page([calls===2?pending:state.jobs[0]]);
    }});
  assert.deepEqual(receipts.map(item=>item.platform),['windows']);
  assert.equal(calls,3);
  assert.deepEqual(delays,[100,100]);
  assert.ok(urls.every(url=>url.includes('/runs/123/attempts/2/jobs?')));
});

test('terminal failure and runner evidence mismatch fail without waiting',async()=>{
  for(const mutate of [state=>state.jobs[0].conclusion='failure',state=>state.jobs[0].labels=['wrong-runner']]) {
    const state=fixture('windows');
    mutate(state);
    let calls=0;
    let slept=false;
    await assert.rejects(waitForSelectedJobs({...state,repository:'owner/repo',runId:123,attempt:2,token:'fixture',expectedHeadSha:HEAD_SHA,
      sleep:async()=>{slept=true},fetchImpl:async()=>{calls++;return page(state.jobs)}}),/Selected job did not pass|Runner evidence missing or mismatched/);
    assert.equal(calls,1);
    assert.equal(slept,false);
  }
});

test('authorization failures do not enter the bounded retry loop',async()=>{
  let calls=0;
  let slept=false;
  const state=fixture('windows');
  await assert.rejects(waitForSelectedJobs({...state,repository:'owner/repo',runId:123,attempt:2,token:'fixture',expectedHeadSha:HEAD_SHA,
    sleep:async()=>{slept=true},fetchImpl:async()=>{calls++;return {ok:false,status:403}}}),/Cannot read actual CI jobs \(403\)/);
  assert.equal(calls,1);
  assert.equal(slept,false);
});

test('deadline reports the selected job that remains nonterminal',async()=>{
  const state=fixture('windows');
  state.jobs[0].status='in_progress';
  state.jobs[0].conclusion=null;
  let clock=0;
  let calls=0;
  const delays=[];
  await assert.rejects(waitForSelectedJobs({...state,repository:'owner/repo',runId:123,attempt:2,token:'fixture',expectedHeadSha:HEAD_SHA,
    timeoutMs:200,retryDelayMs:100,now:()=>clock,sleep:async milliseconds=>{delays.push(milliseconds);clock+=milliseconds},
    fetchImpl:async()=>{calls++;return page(state.jobs)}}),/Timed out waiting for selected CI jobs.*Windows CI.*status=in_progress/);
  assert.equal(calls,2);
  assert.deepEqual(delays,[100,100]);
});
