import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMerge,mergeApproved,readMergeQueueState} from './auto-merge.mjs';

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
test('unstable queue admission uses latest concrete checks, not the aggregate state',async()=>{
  const snapshot=fixture(),calls=[],logs=[];
  snapshot.pr.mergeable_state='unstable';
  snapshot.checks.push({...snapshot.checks[0],id:3,name:'design-review-approval',conclusion:'failure'},
    {...snapshot.checks[0],id:4,name:'design-review-approval'});
  assert.ok(evaluateMerge(snapshot),'non-queue behavior stays fail-closed');
  assert.equal(evaluateMerge({...snapshot,mergeQueueEnabled:true}),null);
  snapshot.queue={isMergeQueueEnabled:true};
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),queueAdmissionImpl:async(...args)=>{
    calls.push(args);snapshot.queue.isInMergeQueue=true;
  },log:message=>logs.push(message)});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],[{repository,number:1,headSha:head}]);
  assert.match(logs.at(-1),/queued for protected merge; not merged yet/);
});

for(const [name,change] of [
  ['latest failure',s=>s.checks.push({...s.checks[0],id:5,conclusion:'failure'})],
  ['latest running',s=>s.checks.push({...s.checks[0],id:5,status:'in_progress',conclusion:null})],
  ['missing required check',s=>s.checks.pop()],
  ['other failed check',s=>s.checks.push({...s.checks[0],id:5,name:'other',conclusion:'failure'})],
  ['no approval',s=>s.reviews=[]],
  ['unknown mergeability',s=>s.pr.mergeable=null],
  ['conflict',s=>s.pr.mergeable=false],
  ['unknown state',s=>s.pr.mergeable_state='unknown'],
  ['dirty state',s=>s.pr.mergeable_state='dirty'],
  ['blocked state',s=>s.pr.mergeable_state='blocked']
]) test(`unstable queue eligibility still refuses ${name}`,async()=>{
  const snapshot=fixture(),calls=[],cliCalls=[];
  snapshot.pr.mergeable_state='unstable';
  snapshot.queue={isMergeQueueEnabled:true};
  change(snapshot);
  assert.ok(evaluateMerge({...snapshot,mergeQueueEnabled:true}));
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),queueAdmissionImpl:async()=>calls.push(1),executeImpl:async()=>cliCalls.push(1),log:()=>{}});
  assert.equal(calls.length,0);
  assert.equal(cliCalls.length,0);
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
  let mainReads=0,queueReads=0;
  return async (url,init={})=>{
    if(url==='https://api.github.com/graphql') {
      assert.equal(init.method,'POST');
      const query=JSON.parse(init.body);
      assert.ok(query.query.startsWith('query QueueState('),'only a read-only GraphQL query');
      assert.deepEqual(query.variables,{owner:'zemeng5208',name:'PersonalAgent',number:1});
      const queue=snapshot.queueSequence?.[queueReads++]??snapshot.queue??{};
      return {ok:true,status:200,json:async()=>({data:{repository:{pullRequest:{number:1,headRefOid:head,baseRefName:'main',isMergeQueueEnabled:false,isInMergeQueue:false,autoMergeRequest:null,...queue}}}})};
    }
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
test('default workflow never enqueues or reenqueues a user-removed PR',async()=>{
  const snapshot=fixture(),logs=[],calls=[];
  snapshot.queue={isMergeQueueEnabled:true,isInMergeQueue:false,autoMergeRequest:null};
  // The same empty queue state occurs both before first admission and after
  // cancellation. Repeated workflow triggers must not undo that cancellation.
  for(let i=0;i<2;i++) await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),executeImpl:async()=>calls.push(1),log:message=>logs.push(message)});
  assert.equal(calls.length,0);
  assert.equal(logs.length,2);
  assert.ok(logs.every(message=>message.includes('no request sent')));
});

for(const queueAdmissionImpl of [null,false,true,'verified-external',{}]) test('metadata is not a queue admission capability '+JSON.stringify(queueAdmissionImpl),async()=>{
  const snapshot=fixture(),logs=[],calls=[];snapshot.queue={isMergeQueueEnabled:true};
  await mergeApproved({repository,token:'fixture-token',queueAdmissionImpl,fetchImpl:fakeApi(snapshot),executeImpl:async()=>calls.push(1),log:message=>logs.push(message)});
  assert.equal(calls.length,0);
  assert.match(logs.at(-1),/no request sent/);
});
test('PR green CI and initial independent approval permit immediate protected merge',async()=>{
  const snapshot=fixture(),calls=[],requests=[];
  snapshot.reviews[0].commit_id='c'.repeat(40);
  snapshot.mainChecks=[];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async(...args)=>calls.push(args),log:()=>{}});
  assert.equal(requests.length,0);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(0,2),['gh',['pr','merge','1','--repo',repository,'--squash','--match-head-commit',head]]);
  assert.equal(calls[0][2].env.GH_TOKEN,'fixture-token');
});

for(const conclusion of [undefined,'failure','cancelled','skipped']) test('main checks do not enqueue another CI round: '+conclusion,async()=>{
  const snapshot=fixture(),calls=[],requests=[];
  snapshot.mainChecks=conclusion?[{...snapshot.mainChecks[0],conclusion}]:[];
  const fetchImpl=fakeApi(snapshot,requests);
  await mergeApproved({repository,token:'fixture-token',fetchImpl:async(url,init)=>{
    assert.ok(!url.includes('commits/'+base+'/check-runs'),'main test results must not be read');
    if(url!=='https://api.github.com/graphql') assert.notEqual(init?.method,'POST','no automatic postmerge CI dispatch');
    return fetchImpl(url,init);
  },executeImpl:async()=>calls.push(1),log:()=>{}});
  assert.equal(calls.length,1);
  assert.equal(requests.length,0);
});

test('main advancing before merge still prevents a stale merge request',async()=>{
  const snapshot=fixture(),calls=[];
  snapshot.mainSequence=[base,'c'.repeat(40)];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),executeImpl:async()=>calls.push(1),log:()=>{}});
  assert.equal(calls.length,0);
});

test('red current-head PR CI blocks even after the initial approval',async()=>{
  const snapshot=fixture(),calls=[];
  snapshot.reviews[0].commit_id='c'.repeat(40);
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

test('a confirmed merge never dispatches another main test round',async()=>{
  const snapshot=fixture(),calls=[],requests=[];
  const merged='c'.repeat(40);
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot,requests),executeImpl:async(...args)=>{
    calls.push(args);
    snapshot.pr={...snapshot.pr,merged:true,merge_commit_sha:merged};
    snapshot.mainSha=merged;
    snapshot.mainChecks=[];
  },log:()=>{}});
  assert.equal(calls.length,1);
  assert.equal(requests.length,0);
});

test('unreadable final merge state is not retried as another merge request',async()=>{
  const snapshot=fixture(),calls=[],logs=[];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),executeImpl:async()=>{calls.push(1);snapshot.unreadablePr=true;},log:message=>logs.push(message)});
  assert.equal(calls.length,1);
  assert.match(logs.at(-1),/outcome unconfirmed/);
});

test('unreadable repository evidence and invalid main SHA fail closed',async()=>{
  const bad=fixture();bad.mainSha='not-a-sha';
  await assert.rejects(mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(bad),executeImpl:async()=>assert.fail('merge'),log:()=>{}}),/Invalid main SHA/);
  await assert.rejects(mergeApproved({repository,token:'fixture-token',fetchImpl:async()=>({ok:false,status:503}),executeImpl:async()=>assert.fail('merge'),log:()=>{}}),/GitHub read failed/);
});

test('behind is eligible only for an enabled queue; main movement does not invalidate queue admission',async()=>{
  const snapshot=fixture(),calls=[],logs=[];
  snapshot.pr.mergeable_state='behind';
  snapshot.mainSha='c'.repeat(40);
  assert.ok(evaluateMerge(snapshot));
  assert.equal(evaluateMerge({...snapshot,mergeQueueEnabled:true}),null);
  snapshot.queue={isMergeQueueEnabled:true};
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),queueAdmissionImpl:async(...args)=>{
    calls.push(args);snapshot.queue.isInMergeQueue=true;
  },log:message=>logs.push(message)});
  assert.deepEqual(calls[0],[{repository,number:1,headSha:head}]);
  assert.match(logs.at(-1),/queued for protected merge; not merged yet/);
});

for(const [name,change] of [
  ['blocked',s=>s.pr.mergeable_state='blocked'],
  ['conflict',s=>s.pr.mergeable=false],
  ['unknown',s=>s.pr.mergeable_state='unknown'],
  ['no independent approval',s=>s.reviews=[]],
  ['red CI',s=>s.checks[0].conclusion='failure'],
  ['old head',s=>s.checks[0].head_sha=base],
  ['fork',s=>s.pr.head.repo.full_name='outside/fork']
]) test('queue does not bypass '+name,()=>{
  const snapshot=fixture();snapshot.mergeQueueEnabled=true;change(snapshot);
  assert.ok(evaluateMerge(snapshot));
});

for(const state of [
  {isMergeQueueEnabled:true,isInMergeQueue:true},
  {isMergeQueueEnabled:true,autoMergeRequest:{enabledAt:'2026-10-21T00:00:00Z'}}
]) test('already queued or auto-merge enabled does not submit twice '+JSON.stringify(state),async()=>{
  const snapshot=fixture(),calls=[];snapshot.queue=state;
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),queueAdmissionImpl:async()=>calls.push('queue'),executeImpl:async()=>calls.push('cli'),log:()=>{}});
  assert.deepEqual(calls,[]);
});

for(const next of [
  {isMergeQueueEnabled:false},
  {isMergeQueueEnabled:true,headRefOid:base},
  {isMergeQueueEnabled:true,isInMergeQueue:true}
]) test('changed preflight queue policy/head/request prevents command '+JSON.stringify(next),async()=>{
  const snapshot=fixture(),calls=[];snapshot.queueSequence=[{isMergeQueueEnabled:true},next];
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),queueAdmissionImpl:async()=>calls.push('queue'),executeImpl:async()=>calls.push('cli'),log:()=>{}});
  assert.deepEqual(calls,[]);
});

for(const outcome of ['auto','unknown','changed-head']) test('queue readback classifies '+outcome,async()=>{
  const snapshot=fixture(),logs=[];snapshot.queue={isMergeQueueEnabled:true};
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),queueAdmissionImpl:async()=>{
    if(outcome==='auto') snapshot.queue.autoMergeRequest={enabledAt:'2026-10-21T00:00:00Z'};
    if(outcome==='changed-head') snapshot.queue.headRefOid=base;
  },log:message=>logs.push(message)});
  assert.match(logs.at(-1),outcome==='auto'?/auto-merge enabled; waiting/:/unconfirmed/);
});

test('uncertain queue adapter outcome is never retried or sent through the CLI',async()=>{
  const snapshot=fixture(),logs=[];snapshot.queue={isMergeQueueEnabled:true};let calls=0,cliCalls=0;
  await mergeApproved({repository,token:'fixture-token',fetchImpl:fakeApi(snapshot),queueAdmissionImpl:async()=>{calls++;throw Error('timed out after possible submission');},executeImpl:async()=>{cliCalls++;},log:message=>logs.push(message)});
  assert.equal(calls,1);assert.equal(cliCalls,0);assert.match(logs.at(-1),/outcome unconfirmed/);
});

for(const result of [
  {},{errors:[{message:'forbidden'}]},
  {data:{repository:{pullRequest:{number:1,headRefOid:head,baseRefName:'main',isInMergeQueue:false,autoMergeRequest:null}}}},
  {data:{repository:{pullRequest:{number:1,headRefOid:head,baseRefName:'other',isMergeQueueEnabled:false,isInMergeQueue:false,autoMergeRequest:null}}}}
]) test('missing or invalid queue evidence fails closed '+JSON.stringify(result),async()=>{
  await assert.rejects(readMergeQueueState({repository,number:1,headSha:head,token:'fixture-token',fetchImpl:async()=>({ok:true,json:async()=>result})}),/Incomplete or stale/);
});
