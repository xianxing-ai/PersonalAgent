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
function fakeApi(snapshot) {
  return async url=>{
    const route=url.split(`/repos/${repository}/`)[1];
    let result;
    if(route.startsWith('pulls?'))result=[snapshot.pr];
    else if(route==='pulls/1')result=snapshot.pr;
    else if(route==='branches/main')result={commit:{sha:snapshot.mainSha}};
    else if(route.startsWith('pulls/1/reviews?'))result=snapshot.reviews;
    else if(route.includes('/check-runs?'))result={check_runs:snapshot.checks};
    else if(route.includes('/statuses?'))result=snapshot.statuses;
    else throw Error('Unexpected API route');
    return {ok:true,json:async()=>result};
  };
}
test('real entry point binds gh to the exact approved head without admin bypass',async()=>{
  const calls=[];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(fixture()),executeImpl:async(...args)=>calls.push(args),log:()=>{}});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(0,2),['gh',['pr','merge','1','--repo',repository,'--auto','--squash','--match-head-commit',head]]);
  assert.equal(calls[0][2].env.GH_TOKEN,'fixture-token');
});
test('real entry point never invokes merge for failed CI or unreadable evidence',async()=>{
  for(const invalid of [false,true]) {
    const snapshot=fixture();snapshot.checks[1].conclusion='failure';
    let writes=0;
    await mergeApproved({repository,token:'fixture-token',fetchImpl:invalid?async()=>({ok:false,status:503}):fakeApi(snapshot),executeImpl:async()=>writes++,log:()=>{}}).catch(()=>{});
    assert.equal(writes,0);
  }
});
