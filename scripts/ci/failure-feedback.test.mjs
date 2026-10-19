import test from 'node:test';
import assert from 'node:assert/strict';
import {notifyFailure} from './failure-feedback.mjs';

const repository='owner/repo',head='a'.repeat(40);
function fixture() {
  return {
    run:{id:10,name:'Foundation',path:'.github/workflows/ci.yml',event:'pull_request',status:'completed',conclusion:'failure',head_sha:head,run_attempt:2},
    pr:{number:7,state:'open',head:{sha:head},base:{ref:'main',repo:{full_name:repository}},user:{login:'original-author'}},
    jobs:[{id:12,name:'Windows CI (ECS)',conclusion:'failure'},{id:13,name:'check',conclusion:'failure'}],comments:[],writes:[]
  };
}
function client(s) {
  let reads=0;
  return async (url,options)=>{
    const route=url.split(`/repos/${repository}/`)[1];
    let value;
    if(options.method==='POST') {
      assert.equal(route,'issues/7/comments');
      s.writes.push(JSON.parse(options.body));
      if(s.postFailure) return {ok:false,status:503};
      value={id:99};
    } else if(route==='actions/runs/10') value=s.run;
    else if(route.startsWith(`commits/${head}/pulls?`)) value=[s.pr];
    else if(route==='pulls/7') value=s.moveHead&&++reads>1?{...s.pr,head:{sha:'b'.repeat(40)}}:s.pr;
    else if(route.startsWith('actions/runs/10/attempts/2/jobs?')) value={jobs:s.jobs};
    else if(route.startsWith('issues/7/comments?')) value=s.comments;
    else throw Error('Unexpected read: '+route);
    return {ok:true,status:200,json:async()=>value};
  };
}
const run=s=>notifyFailure({repository,runId:10,token:'fixture',fetchImpl:client(s),log:()=>{}});

test('failed current PR CI notifies only its original author with exact job links',async()=>{
  const s=fixture();await run(s);
  assert.equal(s.writes.length,1);
  assert.match(s.writes[0].body,/@original-author/);
  assert.match(s.writes[0].body,/actions\/runs\/10\/job\/12/);
  assert.doesNotMatch(s.writes[0].body,/job\/13/);
  assert.match(s.writes[0].body,/personalagent-ci-failure:10:2/);
});
for(const conclusion of ['success','cancelled','skipped']) test(conclusion+' is not a failure notification',async()=>{
  const s=fixture();s.run.conclusion=conclusion;await run(s);assert.equal(s.writes.length,0);
});
for(const event of ['push','workflow_dispatch']) test(event+' does not notify a PR author',async()=>{
  const s=fixture();s.run.event=event;await run(s);assert.equal(s.writes.length,0);
});
test('the same failed attempt is notified once, but an older attempt marker is distinct',async()=>{
  const s=fixture();s.comments=[{user:{login:'github-actions[bot]'},body:'<!-- personalagent-ci-failure:10:2 -->'}];
  await run(s);assert.equal(s.writes.length,0);
  s.comments[0].body='<!-- personalagent-ci-failure:10:1 -->';await run(s);assert.equal(s.writes.length,1);
});
test('old results and a PR moving during comment read do not notify the latest revision',async()=>{
  const s=fixture();s.pr.head.sha='b'.repeat(40);await run(s);assert.equal(s.writes.length,0);
  const moved=fixture();moved.moveHead=true;await run(moved);assert.equal(moved.writes.length,0);
});
test('closed PRs and missing failed-job evidence cannot produce a comment',async()=>{
  const s=fixture();s.pr.state='closed';await run(s);assert.equal(s.writes.length,0);
  s.jobs=[];await assert.rejects(run(s),/no failed job evidence/);assert.equal(s.writes.length,0);
});
test('unknown comment write outcome is never blindly retried',async()=>{
  const s=fixture();s.postFailure=true;await assert.rejects(run(s),/do not blindly retry/);assert.equal(s.writes.length,1);
});
