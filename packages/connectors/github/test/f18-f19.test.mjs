import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubF18F19Tools} from '../dist/index.js';

const headSha='a'.repeat(40),baseSha='b'.repeat(40),mergedSha='c'.repeat(40);
const input={repo:'synthetic/repository',prNumber:42,headSha,baseSha};
const context=()=>({taskId:'synthetic-task',runId:'synthetic-run',authorizationRef:'synthetic-only',
  scopes:['github:read','github:write'],deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal});
function fixture({mutateGate,unknown=false,moveHead=false,record=()=>{},postReadFailure=false}={}){
  const calls=[];let merged=false;
  const gate={number:42,state:'OPEN',isDraft:false,headRefOid:headSha,baseRefOid:baseSha,mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',
    reviewDecision:'APPROVED',author:{login:'author',__typename:'User'},baseRepository:{nameWithOwner:input.repo},headRepository:{nameWithOwner:input.repo},
    latestReviews:{pageInfo:{hasNextPage:false},nodes:[{state:'APPROVED',author:{login:'reviewer',__typename:'User'},commit:{oid:headSha}}]},
    reviewThreads:{pageInfo:{hasNextPage:false},nodes:[{isResolved:true}]},
    commits:{nodes:[{commit:{oid:headSha,statusCheckRollup:{state:'SUCCESS',contexts:{pageInfo:{hasNextPage:false},nodes:[
      {__typename:'CheckRun',name:'technical-ci',status:'COMPLETED',conclusion:'SUCCESS',checkSuite:{commit:{oid:headSha}}}]}}}}]}};
  mutateGate?.(gate);
  const runner={async run(request){
    calls.push({args:request.args,...(request.stdin?{payload:JSON.parse(request.stdin)}:{})});
    assert.equal(request.token,'synthetic-credential');assert.ok(!request.args.includes('synthetic-credential'));
    const endpoint=request.args[5],method=request.args[4];let value;
    if(endpoint==='graphql')value={data:{repository:{nameWithOwner:input.repo,pullRequest:gate}}};
    else if(endpoint.endsWith('/merge')){assert.equal(method,'PUT');merged=true;if(unknown)throw Error('synthetic lost response');value={merged:true,sha:mergedSha};}
    else if(endpoint.endsWith('/pulls/42')){
      if(merged&&postReadFailure)throw Error('synthetic post-read failure');
      if(request.args.includes('Accept: application/vnd.github.diff'))value='diff --git a/example b/example\n+synthetic change\n';
      else value={number:42,state:merged?'closed':'open',merged,head:{sha:moveHead?'d'.repeat(40):headSha,repo:{full_name:input.repo}},
        base:{sha:merged?mergedSha:baseSha,repo:{full_name:input.repo}},merge_commit_sha:merged?mergedSha:null,changed_files:1,additions:1,deletions:0};
    }else if(endpoint.endsWith('/issues/7'))value={number:7,state:'open',html_url:`https://github.com/${input.repo}/issues/7`,
      updated_at:'2026-10-31T00:00:00Z',title:'Synthetic original bug',body:'Synthetic original reproduction'};
    else throw Error('Unexpected synthetic request '+endpoint);
    return {exitCode:0,stdout:typeof value==='string'?value:JSON.stringify(value),stderr:''};
  }};
  const configuration={runner,readToken:async()=> 'synthetic-credential',repositories:[input.repo],
    requiredChecks:['technical-ci'],eligibleReviewers:['reviewer'],beforeWrite:record};
  const tools=createGitHubF18F19Tools(configuration);
  return {tools,calls,configuration,invoke:(name,args=input,ctx=context())=>tools.find(tool=>tool.descriptor.name==='github.'+name).execute(args,ctx)};
}

test('F18 production adapter reads complete current diff and real current gate, then conditionally merges exact SHA',async()=>{
  let recorded=0;const f=fixture({record:(op,args,ctx)=>{recorded++;assert.equal(op,'registered_merge');assert.equal(args.headSha,headSha);assert.ok(ctx.authorizationRef);}});
  assert.equal((await f.invoke('bound_pr_diff')).filesChanged,1);
  assert.deepEqual(await f.invoke('current_head_merge_gate'),{headSha,mergeRequirementsSatisfied:true});
  assert.deepEqual(await f.invoke('registered_merge',{...input,mergeMethod:'squash'}),{mergedSha,prClosed:true});
  assert.equal(recorded,1);assert.deepEqual(f.calls.find(call=>call.args[4]==='PUT').payload,{sha:headSha,merge_method:'squash'});
  assert.equal((await f.invoke('merged_pr_readback')).merged,true);
});

for(const [name,mutateGate] of [
  ['author approval',gate=>{gate.latestReviews.nodes[0].author.login='author';}],
  ['missing PR author',gate=>{gate.author=null;}],
  ['bot approval',gate=>{gate.latestReviews.nodes[0].author.__typename='Bot';}],
  ['old head approval',gate=>{gate.latestReviews.nodes[0].commit.oid=baseSha;}],
  ['pending technical check',gate=>{gate.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].status='IN_PROGRESS';}],
  ['skipped technical check',gate=>{gate.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].conclusion='SKIPPED';}],
  ['foreign commit check',gate=>{gate.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].checkSuite.commit.oid=baseSha;}],
  ['missing required check',gate=>{gate.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].name='unrelated';}],
  ['unresolved discussion',gate=>{gate.reviewThreads.nodes[0].isResolved=false;}],
  ['draft',gate=>{gate.isDraft=true;}],
  ['behind main',gate=>{gate.mergeStateStatus='BEHIND';}],
  ['changes requested',gate=>{gate.latestReviews.nodes.push({state:'CHANGES_REQUESTED',author:{login:'another'},commit:{oid:headSha}});}],
])test('F18 rejects '+name+' without dispatching merge',async()=>{
  const f=fixture({mutateGate});assert.equal((await f.invoke('current_head_merge_gate')).mergeRequirementsSatisfied,false);
  await assert.rejects(f.invoke('registered_merge',{...input,mergeMethod:'merge'}),{code:'UNAUTHORIZED'});
  assert.equal(f.calls.filter(call=>call.args[4]==='PUT').length,0);
});

test('F18 rejects truncated gate evidence, changed head and denied original authorization',async()=>{
  const f=fixture({mutateGate:gate=>{gate.reviewThreads.pageInfo.hasNextPage=true;}});
  await assert.rejects(f.invoke('registered_merge',{...input,mergeMethod:'merge'}),{code:'UNSUPPORTED_CAPABILITY'});
  await assert.rejects(fixture({moveHead:true}).invoke('bound_pr_diff'),{code:'REVISION_CONFLICT'});
  const denied=fixture();await assert.rejects(denied.invoke('bound_pr_diff',input,{...context(),authorizationRef:''}),{code:'SCOPE_DENIED'});
  assert.equal(denied.calls.length,0);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(denied.invoke('registered_merge',{...input,mergeMethod:'merge'},{...context(),signal:aborted.signal}),{code:'CANCELLED'});
  await assert.rejects(denied.invoke('registered_merge',{...input,mergeMethod:'merge'},{...context(),deadline:'2026-01-01T00:00:00Z'}),{code:'TIMEOUT'});
  assert.equal(denied.calls.length,0);
});

test('F18 lost write response and failed external readback stay unknown; subsequent inspection is read only',async()=>{
  for(const options of [{unknown:true},{postReadFailure:true}]){
    const f=fixture(options);await assert.rejects(f.invoke('registered_merge',{...input,mergeMethod:'merge'}),{code:'RESULT_UNKNOWN'});
    assert.equal(f.calls.filter(call=>call.args[4]==='PUT').length,1);
    if(options.unknown)assert.equal((await f.invoke('merged_pr_readback')).merged,true);
    assert.equal(f.calls.filter(call=>call.args[4]==='PUT').length,1);
  }
});

test('F19 exact Issue snapshot and close-state inspection never publish a close tool',async()=>{
  const f=fixture(),value=await f.invoke('issue_snapshot',{repo:input.repo,issueId:7,expectedUpdatedAt:'2026-10-31T00:00:00Z'});
  assert.equal(value.count,1);assert.equal(value.issueId,7);
  await assert.rejects(f.invoke('issue_snapshot',{repo:input.repo,issueId:7,expectedUpdatedAt:'2026-10-30T00:00:00Z'}),{code:'REVISION_CONFLICT'});
  assert.equal((await f.invoke('issue_close_readback',{repo:input.repo,issueId:7})).closed,false);
  assert.equal(f.tools.some(tool=>tool.descriptor.name==='github.registered_close_issue'),false);
  assert.ok(f.calls.every(call=>call.args[4]==='GET'));
});

test('F18 copies trusted policy so caller mutation cannot widen repositories, required CI or eligible reviewers',async()=>{
  const f=fixture({mutateGate:gate=>{gate.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].name='fake-ci';}});
  f.configuration.requiredChecks.splice(0,1,'fake-ci');
  assert.equal((await f.invoke('current_head_merge_gate')).mergeRequirementsSatisfied,false);
  f.configuration.repositories.push('foreign/repository');
  await assert.rejects(f.invoke('bound_pr_diff',{...input,repo:'foreign/repository'}),{code:'SCOPE_DENIED'});
  const other=fixture({mutateGate:gate=>{gate.latestReviews.nodes[0].author.login='unapproved-reviewer';}});
  other.configuration.eligibleReviewers.push('unapproved-reviewer');
  assert.equal((await other.invoke('current_head_merge_gate')).mergeRequirementsSatisfied,false);
  const replacement=fixture();replacement.configuration.readToken=async()=>{throw Error('Changed caller callback');};
  assert.equal((await replacement.invoke('current_head_merge_gate')).mergeRequirementsSatisfied,true);
});
