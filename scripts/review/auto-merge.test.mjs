import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMerge,mergeApproved} from './auto-merge.mjs';

const head='a'.repeat(40),base='b'.repeat(40),repository='zemeng5208/PersonalAgent';
function fixture() {
  return {
    repository,mainSha:base,
    pr:{number:1,state:'open',draft:false,merged:false,user:{login:'zemeng5208'},
      head:{sha:head,repo:{full_name:repository}},base:{ref:'main',sha:base,repo:{full_name:repository}},mergeable:true,mergeable_state:'clean'},
    reviews:[{id:1,user:{login:'goo122'},state:'APPROVED',commit_id:head}],
    checks:['check','ecs-linux-check'].map((name,index)=>({id:index+1,name,head_sha:head,app:{id:15368},status:'completed',conclusion:'success'})),
    mainChecks:['check','ecs-linux-check'].map((name,index)=>({id:index+10,name,head_sha:base,app:{id:15368},status:'completed',conclusion:'success'})),
    statuses:[]
  };
}
test('two current-head CI checks and an eligible independent approval permit the request',()=>{
  assert.equal(evaluateMerge(fixture()),null);
});
for(const [name,change] of [
  ['missing ECS CI',s=>s.checks.pop()],
  ['pending CI',s=>s.checks[1].status='in_progress'],
  ['red CI',s=>s.checks[1].conclusion='failure'],
  ['skipped CI',s=>s.checks[1].conclusion='skipped'],
  ['wrong app',s=>s.checks[1].app.id=1],
  ['old head CI',s=>s.checks[1].head_sha=base],
  ['self approval',s=>s.reviews[0].user.login='zemeng5208'],
  ['outsider approval',s=>s.reviews[0].user.login='outsider'],
  ['stale approval',s=>s.reviews[0].commit_id=base],
  ['dismissed approval',s=>s.reviews.push({...s.reviews[0],id:2,state:'DISMISSED'})],
  ['changes requested',s=>s.reviews.push({id:2,user:{login:'Potatos498'},state:'CHANGES_REQUESTED',commit_id:head})],
  ['unresolved protection',s=>s.pr.mergeable_state='blocked'],
  ['unknown mergeability',s=>s.pr.mergeable=null],
  ['main advanced',s=>s.mainSha='c'.repeat(40)],
  ['draft',s=>s.pr.draft=true],
  ['fork',s=>s.pr.head.repo.full_name='outside/fork'],
  ['another red check',s=>s.checks.push({...s.checks[0],id:3,name:'other',conclusion:'failure'})],
  ['red status',s=>s.statuses.push({id:1,context:'external',state:'failure'})],
  ['latest rerun failed',s=>s.checks.push({...s.checks[1],id:3,conclusion:'failure'})]
]) test(`refuses ${name}`,()=>{
  const snapshot=fixture();change(snapshot);assert.ok(evaluateMerge(snapshot));
});
test('a later successful rerun and latest status supersede old failures',()=>{
  const snapshot=fixture();
  snapshot.checks.unshift({...snapshot.checks[1],id:0,conclusion:'failure'});
  snapshot.statuses=[{id:2,context:'external',state:'success'},{id:1,context:'external',state:'failure'}];
  assert.equal(evaluateMerge(snapshot),null);
});
function fakeApi(snapshot,requests=[]) {
  let mainReads=0;
  return async (url,init={})=>{
    const route=url.split('/repos/'+repository+'/')[1];
    if(init.method==='POST') {
      if(route!=='dispatches') throw Error('Unexpected write');
      requests.push({route,init});
      const status=snapshot.dispatchStatus??204;
      return {ok:status===204,status,json:async()=>{throw Error('204 body must not be parsed')}};
    }
    let result;
    if(route.startsWith('pulls?')) result=[snapshot.pr];
    else if(route==='pulls/1') {
      if(snapshot.unreadablePr) return {ok:false,status:503};
      result=snapshot.pr;
    }
    else if(route==='branches/main') result={commit:{sha:snapshot.mainSequence?.[mainReads++]??snapshot.mainSha}};
    else if(route.startsWith('pulls/1/reviews?')) result=snapshot.reviews;
    else if(route.startsWith('commits/'+snapshot.mainSha+'/check-runs?')) result={check_runs:snapshot.mainChecks};
    else if(route.startsWith('commits/'+head+'/check-runs?')) result={check_runs:snapshot.checks};
    else if(route.includes('/check-runs?')) result={check_runs:[]};
    else if(route.includes('/statuses?')) result=snapshot.statuses;
    else throw Error('Unexpected API route: '+route);
    return {ok:true,status:200,json:async()=>result};
  };
}
test('entry point requires green main and reviewed PR before immediate protected merge',async()=>{
  const snapshot=fixture(),calls=[],requests=[];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async(...args)=>calls.push(args),log:()=>{}});
  assert.equal(requests.length,0);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(0,2),['gh',['pr','merge','1','--repo',repository,'--squash','--match-head-commit',head]]);
  assert.equal(calls[0][2].env.GH_TOKEN,'fixture-token');
});
test('missing main checks dispatch one routed run at the exact current SHA without merging',async()=>{
  const snapshot=fixture(),calls=[],requests=[];
  snapshot.mainChecks=[];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async()=>calls.push(1),log:()=>{}});
  assert.equal(calls.length,0);
  assert.deepEqual(requests.map(r=>JSON.parse(r.init.body)),[
    {event_type:'post_merge_foundation_ci',client_payload:{target_sha:base}}
  ]);
  assert.ok(requests.every(r=>r.init.method==='POST'&&r.init.headers.Authorization==='Bearer fixture-token'));
});
test('one missing main check dispatches the workflow that now owns both contexts',async()=>{
  const snapshot=fixture(),requests=[];
  snapshot.mainChecks.pop();
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async()=>assert.fail('merge'),log:()=>{}});
  assert.deepEqual(requests.map(r=>JSON.parse(r.init.body).event_type),['post_merge_foundation_ci']);
});
for(const [name,change,expectedPosts] of [
  ['pending',s=>s.mainChecks[0].status='in_progress',0],
  ['failed',s=>s.mainChecks[0].conclusion='failure',0],
  ['timed out',s=>s.mainChecks[0].conclusion='timed_out',0],
  ['skipped',s=>s.mainChecks[0].conclusion='skipped',1],
  ['cancelled',s=>s.mainChecks[0].conclusion='cancelled',1],
  ['wrong app',s=>s.mainChecks[0].app.id=1,1],
  ['old SHA',s=>s.mainChecks[0].head_sha=head,1]
]) test('main '+name+' does not allow merge',async()=>{
  const snapshot=fixture(),requests=[];change(snapshot);
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async()=>assert.fail('merge'),log:()=>{}});
  assert.equal(requests.length,expectedPosts);
});
test('newer failed main check supersedes earlier success',async()=>{
  const snapshot=fixture(),requests=[];
  snapshot.mainChecks.push({...snapshot.mainChecks[0],id:99,conclusion:'failure'});
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async()=>assert.fail('merge'),log:()=>{}});
  assert.equal(requests.length,0);
});
test('main SHA change before dispatch prevents stale request',async()=>{
  const snapshot=fixture(),requests=[];
  snapshot.mainChecks=[];
  snapshot.mainSequence=[base,'c'.repeat(40)];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async()=>assert.fail('merge'),log:()=>{}});
  assert.equal(requests.length,0);
});
test('a single routed dispatch cannot enqueue a second stale workflow',async()=>{
  const snapshot=fixture(),requests=[];
  snapshot.mainChecks=[];
  snapshot.mainSequence=[base,base,'c'.repeat(40)];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async()=>assert.fail('merge'),log:()=>{}});
  assert.equal(requests.length,1);
});
test('dispatch error propagates and cannot be mistaken for a green check',async()=>{
  const snapshot=fixture();snapshot.mainChecks=[];snapshot.dispatchStatus=403;
  await assert.rejects(mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),executeImpl:async()=>assert.fail('merge'),log:()=>{}}),/dispatch failed \(403\)/);
});
test('main advancing before the merge call prevents a stale merge request',async()=>{
  const snapshot=fixture(),calls=[];
  snapshot.mainSequence=[base,base,'c'.repeat(40),'c'.repeat(40)];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),executeImpl:async()=>calls.push(1),log:()=>{}});
  assert.equal(calls.length,0);
});
test('red PR-head CI still blocks when main checks are green',async()=>{
  const snapshot=fixture(),calls=[];
  snapshot.checks[1].conclusion='failure';
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),executeImpl:async()=>calls.push(1),log:()=>{}});
  assert.equal(calls.length,0);
});
test('existing auto-merge candidate is skipped without changing other requests',async()=>{
  const snapshot=fixture(),calls=[];
  snapshot.pr.auto_merge={enabled_by:{login:'goo122'}};
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),executeImpl:async()=>calls.push(1),log:()=>{}});
  assert.equal(calls.length,0);
});
test('confirmed immediate merge dispatches checks for new main before another merge',async()=>{
  const snapshot=fixture(),calls=[],requests=[];
  const merged='c'.repeat(40);
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async(...args)=>{
    calls.push(args);
    snapshot.pr={...snapshot.pr,merged:true,merge_commit_sha:merged};
    snapshot.mainSha=merged;
    snapshot.mainChecks=[];
  },log:()=>{}});
  assert.equal(calls.length,1);
  assert.deepEqual(requests.map(r=>JSON.parse(r.init.body).client_payload.target_sha),[merged]);
});
test('unreadable final merge state is not retried as another merge request',async()=>{
  const snapshot=fixture(),calls=[];
  await assert.rejects(mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),executeImpl:async()=>{calls.push(1);snapshot.unreadablePr=true;},log:()=>{}}),/GitHub read failed/);
  assert.equal(calls.length,1);
});
test('unreadable main evidence and invalid main SHA fail closed',async()=>{
  const bad=fixture();bad.mainSha='not-a-sha';
  await assert.rejects(mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(bad),executeImpl:async()=>assert.fail('merge'),log:()=>{}}),/Invalid main SHA/);
  await assert.rejects(mergeApproved({repository,token:'fixture-token',fetchImpl:async()=>({ok:false,status:503}),executeImpl:async()=>assert.fail('merge'),log:()=>{}}),/GitHub read failed/);
});
