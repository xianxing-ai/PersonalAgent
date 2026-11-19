import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGitHubF18F19Tools} from '../dist/index.js';

const snapshot={repo:'synthetic/f19',issueId:19,updatedAt:'2026-11-01T00:00:00Z',title:'Original public bug',body:'Original reproduction'};
const input={repo:snapshot.repo,issueId:19,prNumber:93,headSha:'a'.repeat(40),baseSha:'b'.repeat(40),mergedSha:'c'.repeat(40),
  expectedUpdatedAt:snapshot.updatedAt,snapshotDigest:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
const context=()=>({taskId:'original-close',runId:'original-close-run',authorizationRef:'original-policy',scopes:['github:write'],
  deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal});
function fixture({mutateBefore,mutateAfter,unmerged=false,unknown=false,beforeWrite=()=>{}}={}){
  const calls=[];let patched=false,recorded=0;
  const issue={number:19,state:'open',state_reason:null,updated_at:snapshot.updatedAt,title:snapshot.title,body:snapshot.body,
    html_url:'https://github.com/synthetic/f19/issues/19'};mutateBefore?.(issue);
  const tools=createGitHubF18F19Tools({repositories:[snapshot.repo],requiredChecks:['unused-close'],eligibleReviewers:['unused-close'],
    enableIssueClose:true,readToken:async()=> 'synthetic-only',beforeWrite(operation,args,ctx){
      recorded++;assert.equal(operation,'registered_close_issue');assert.deepEqual(args,input);assert.equal(ctx.runId,'original-close-run');beforeWrite();},
    runner:{async run(request){
      const method=request.args[4],endpoint=request.args[5];calls.push({method,endpoint});let value;
      if(endpoint.endsWith('/pulls/93'))value={number:93,state:unmerged?'open':'closed',merged:!unmerged,merge_commit_sha:input.mergedSha,
        head:{sha:input.headSha,repo:{full_name:input.repo}},base:{sha:input.mergedSha,repo:{full_name:input.repo}}};
      else if(endpoint.endsWith('/issues/19')){
        if(method==='PATCH'){
          assert.equal(recorded,1);assert.deepEqual(JSON.parse(request.stdin),{state:'closed',state_reason:'completed'});
          patched=true;Object.assign(issue,{state:'closed',state_reason:'completed',updated_at:'2026-11-01T01:00:00Z'});
          if(unknown)throw Error('Synthetic lost PATCH response');
        }else if(patched)mutateAfter?.(issue);
        value=issue;
      }else assert.fail(endpoint);
      return {exitCode:0,stderr:'',stdout:JSON.stringify(value)};
    }}});
  const tool=tools.find(value=>value.descriptor.name==='github.registered_close_issue');
  return {tool,calls,get recorded(){return recorded;},run:(args=input,ctx=context())=>tool.execute(args,ctx)};
}

test('F19 opt-in close records one exact original PATCH and verifies the returned Issue revision',async()=>{
  const f=fixture();assert.equal(f.tool.descriptor.requiresPresence,true);assert.equal(f.tool.descriptor.idempotencySupport,false);
  assert.deepEqual(await f.run(),{issueId:19,closed:true,updatedAt:'2026-11-01T01:00:00Z',mergedSha:input.mergedSha});
  assert.equal(f.recorded,1);assert.deepEqual(f.calls.map(value=>value.method),['GET','GET','PATCH','GET']);
});
for(const [name,options] of [['unmerged original PR',{unmerged:true}],['changed original Issue version',{mutateBefore:value=>{value.updated_at='2026-11-01T00:01:00Z';}}],
  ['changed original Issue content',{mutateBefore:value=>{value.body='changed';}}],['foreign Issue identity',{mutateBefore:value=>{value.number=20;}}]])
test('F19 '+name+' refuses close before dispatch',async()=>{
  const f=fixture(options);await assert.rejects(f.run(),{code:'REVISION_CONFLICT'});assert.equal(f.recorded,0);
  assert.equal(f.calls.some(value=>value.method==='PATCH'),false);
});
for(const [name,options] of [['lost original PATCH response',{unknown:true}],['changed close readback version',{mutateAfter:value=>{value.updated_at='2026-11-01T02:00:00Z';}}],
  ['changed close readback content',{mutateAfter:value=>{value.title='changed';}}]])
test('F19 '+name+' remains unknown without retry',async()=>{
  const f=fixture(options);await assert.rejects(f.run(),{code:'RESULT_UNKNOWN'});assert.equal(f.recorded,1);
  assert.equal(f.calls.filter(value=>value.method==='PATCH').length,1);
});
test('F19 denied scope, cancellation and expiry cannot dispatch close',async()=>{
  const f=fixture();await assert.rejects(f.run(input,{...context(),scopes:['github:read']}),{code:'SCOPE_DENIED'});
  const controller=new AbortController();controller.abort();await assert.rejects(f.run(input,{...context(),signal:controller.signal}),{code:'CANCELLED'});
  await assert.rejects(f.run(input,{...context(),deadline:'2020-01-01T00:00:00Z'}),{code:'TIMEOUT'});
  assert.equal(f.calls.length,0);
});
test('F19 original write recorder rejection prevents the only PATCH',async()=>{
  const f=fixture({beforeWrite(){throw Error('Original attempt already exists');}});
  await assert.rejects(f.run());assert.equal(f.recorded,1);assert.equal(f.calls.some(value=>value.method==='PATCH'),false);
});

test('F19 issue-only registration never borrows fake F18 gates or enables close implicitly',()=>{
  const options={runner:{run(){assert.fail('No request during registration');}},readToken:async()=> 'synthetic-only',
    repositories:['synthetic/f19'],beforeWrite(){assert.fail('No write during registration');}};
  assert.throws(()=>createGitHubF18F19Tools(options),{code:'INVALID_ARGUMENT'});
  const names=extra=>createGitHubF18F19Tools({...options,issueRepairOnly:true,...extra}).map(tool=>tool.descriptor.name).sort();
  assert.deepEqual(names({}),['github.issue_close_readback','github.issue_snapshot','github.merged_pr_readback']);
  assert.deepEqual(names({enableIssueClose:true}),['github.issue_close_readback','github.issue_snapshot','github.merged_pr_readback','github.registered_close_issue']);
  assert.throws(()=>createGitHubF18F19Tools({...options,issueRepairOnly:true,requiredChecks:42}),{code:'INVALID_ARGUMENT'});
});
