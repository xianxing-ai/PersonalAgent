import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getEventListeners} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import {GhCliProvider, githubRepairCheckName} from '@personal-agent/github';
import {runCiFix, createCiFixWorkflow} from '@personal-agent/coding-tools';

const headSha = 'a'.repeat(40), fixedSha = 'b'.repeat(40), fileSha = 'c'.repeat(64);
test('old CI factory resumes pending identity through original ports while new factory uses replacements',async()=>{
  const f=fixture();let oldCalls=0,newCalls=0,newModel=0;
  const invoke=f.options.tools.invoke,complete=f.options.model.complete;
  const oldTools={list:f.options.tools.list,invoke:async input=>{oldCalls++;if(oldCalls===1){f.calls.push(input);return {state:'pending',evidenceRefs:[]};}return invoke(input);}};
  f.options.tools=oldTools;const old=createCiFixWorkflow(f.options);
  assert.equal((await old.run(f.context)).status,'waiting_approval');const original=f.calls[0];
  f.options.tools={list:oldTools.list,invoke:async input=>{newCalls++;return invoke(input);}};
  f.options.model={complete:async input=>{newModel++;return complete(input);}};
  const next=createCiFixWorkflow(f.options);
  assert.equal((await old.run(f.context)).status,'succeeded');
  assert.equal(f.calls[1].runId,original.runId);assert.deepEqual(f.calls[1].arguments,original.arguments);
  assert.equal(newCalls,0);assert.equal(newModel,0);
  const checkpoints=new Map(),context={...f.context,taskId:'new-ports-task',loadCheckpoint:key=>checkpoints.get(key),saveCheckpoint:(key,value)=>checkpoints.set(key,structuredClone(value))};
  assert.equal((await next.run(context)).status,'succeeded');assert.ok(newCalls>0);assert.equal(newModel,1);
});
test('CI factory bound port methods remain live and capability withdrawal blocks dispatch',async()=>{
  const f=fixture(),workflow=createCiFixWorkflow(f.options);
  const tools=f.options.tools,model=f.options.model,invoke=tools.invoke,complete=model.complete;let methods=0;
  tools.invoke=async input=>{methods++;return invoke(input);};model.complete=async input=>{methods++;return complete(input);};
  assert.equal((await workflow.run(f.context)).status,'succeeded');assert.ok(methods>1);
  tools.list=()=>[];const count=f.calls.length;
  assert.equal((await workflow.run(f.context)).status,'unsupported');assert.equal(f.calls.length,count);
});
function fixture() {
  const checkpoints = new Map(), calls = [];
  const context = {taskId: 'ci-task', deadline: '2099-01-01T00:00:00Z', signal: new AbortController().signal,
    saveCheckpoint(k,v) {checkpoints.set(k,structuredClone(v));}, loadCheckpoint(k) {return structuredClone(checkpoints.get(k));}, reportProgress() {throw Error('unused');}};
  const gitTools = {head: 'workspace.git.head', commit: 'workspace.git.commit', push: 'workspace.git.push', pullRequest: 'github.pr.create', backlink: 'github.pr.comment'};
  const names = [...Object.values(gitTools), 'github.actions.run.list', 'github.actions.job.list', 'github.actions.log.read', 'github.issue.get', 'github.issue.comment', 'workspace.read_text', 'workspace.apply_text_patch', 'workspace.run_allowed_command'];
  const responses = {
    'github.actions.run.list': {items: [{id: '42', conclusion: 'failure', headSha, url: 'https://github.test/runs/42'}]},
    'github.actions.job.list': {items: [{id:7,runId:42,conclusion:'failure'}]},
    'github.actions.log.read': {text: 'test failed',truncated:false},
    'workspace.git.head': {headSha,clean:true,workspaceClean:true},
    'workspace.read_text': {path:'src/a.ts',content:'bad',sha256:fileSha},
    'workspace.apply_text_patch': {path:'src/a.ts',beforeSha256:fileSha,afterSha256:'d'.repeat(64),applied:true,changed:true},
    'workspace.run_allowed_command': {recipeId:'test',exitCode:0,stdout:'passed',stderr:''},
    'workspace.git.commit': {headSha:fixedSha,parentSha:headSha},
    'workspace.git.push': {headSha:fixedSha,pushed:true},
    'github.pr.create': {state:'confirmed',externalId:'19',url:'https://github.test/pull/19'},
    'github.pr.comment': {state:'confirmed'},
    'github.issue.get': {number:4,title:'Bug',body:'fails',state:'open',labels:['bug'],url:'https://github.test/issues/4',updatedAt:'2026-10-03T00:00:00Z'},
    'github.issue.comment': {state:'confirmed'},
  };
  let modelCalls = 0;
  const model = {deployment: {}, async complete(request) {modelCalls++; assert.equal(request.tools.length,0); return {response:{kind:'final',text:JSON.stringify({diagnosis:'Fix failing assertion',patches:[{path:'src/a.ts',expectedSha256:fileSha,edits:[{oldText:'bad',newText:'good'}]}]})},usage:{promptTokens:10,completionTokens:10,totalTokens:20}};}};
  const localWrites=new Set(['workspace.apply_text_patch','workspace.run_allowed_command','workspace.git.commit']);
  const externalWrites=new Set(['workspace.git.push','github.pr.create','github.pr.comment','github.issue.comment']);
  const tools = {list:()=>names.map(name=>({name,version:'1.0.0',
    sideEffect:localWrites.has(name)?'local_write':externalWrites.has(name)?'external_write':'read'})), async invoke(input) {calls.push(input);return {state:'confirmed',result:structuredClone(responses[input.toolName]),evidenceRefs:[input.runId]};}};
  const options = {repository:'owner/repo',runId:'42',model,tools,gitTools,sourcePaths:['src/a.ts'],headBranch:'ci-fix',baseBranch:'main',verifyRecipeId:'test',maxSteps:32,maxTokens:4096,authorizationRefFor:()=> 'runtime-approved'};
  return {context,options,calls,responses,checkpoints,modelCalls:()=>modelCalls};
}

test('actual verify precedes commit, push, approved PR and original run backlink',async()=>{
  const f=fixture(); const r=await createCiFixWorkflow(f.options).run(f.context);
  assert.equal(r.status,'succeeded'); assert.ok(r.verificationRunId);
  const names=f.calls.map(c=>c.toolName);
  assert.ok(names.indexOf('workspace.run_allowed_command')<names.indexOf('workspace.git.commit'));
  assert.ok(names.indexOf('workspace.git.push')<names.indexOf('github.pr.create'));
  assert.match(f.calls.find(c=>c.toolName==='github.pr.create').arguments.body,/runs\/42/);
  assert.equal(f.calls.find(c=>c.toolName==='workspace.git.commit').arguments.verificationRunId,r.verificationRunId);
  const count=f.calls.length; await runCiFix(f.context,f.options); assert.equal(f.modelCalls(),1);
  assert.equal(f.calls.filter(c=>c.toolName==='workspace.git.commit').length,1); assert.equal(f.calls.length,count);
});
test('trusted repair goal reaches the model and the supplied PR body is retained with original backlinks',async()=>{
  const f=fixture();f.options.repairGoal='Preserve data while repairing the crash';
  f.options.pullRequestBody='Related issue: https://github.test/issues/4\n\nAutomatic close and merge are disabled.';
  let prompt;const complete=f.options.model.complete;
  f.options.model.complete=async request=>{prompt=JSON.parse(request.messages[1].content);return complete(request);};
  assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
  assert.equal(prompt.repairGoal,f.options.repairGoal);
  const body=f.calls.find(call=>call.toolName==='github.pr.create').arguments.body;
  assert.ok(body.includes(f.options.pullRequestBody));assert.match(body,/Repair source: https:\/\/github.test\/runs\/42/);
  assert.ok(body.length<=65536);
});
test('changed trusted goal or PR body cannot reuse an original unknown write or migrate a legacy journal',async()=>{
  for(const field of ['repairGoal','pullRequestBody']) for(const legacy of [false,true]) {
    const f=fixture(),issue=f.responses['github.issue.get'];delete f.options.runId;f.options.expectedHeadSha=headSha;
    f.options.issue={number:issue.number,url:issue.url,repository:'owner/repo',fingerprint:createHash('sha256').update(JSON.stringify(
      [issue.number,issue.title,issue.body,issue.state,[...issue.labels].sort(),issue.url,issue.updatedAt])).digest('hex')};
    if(!legacy)f.options[field]='Original trusted input';
    const invoke=f.options.tools.invoke;f.options.tools.invoke=async input=>{
      if(input.toolName==='workspace.git.push'){f.calls.push(input);return {state:'unknown',evidenceRefs:[]};}
      return invoke(input);
    };
    assert.equal((await runCiFix(f.context,f.options)).status,'waiting_reconciliation');
    const saved=f.context.loadCheckpoint('ci-fix-v1'),count=f.calls.length;
    assert.equal((await runCiFix(f.context,f.options)).status,'waiting_reconciliation');assert.equal(f.calls.length,count);
    f.options[field]='Changed trusted input';
    await assert.rejects(runCiFix(f.context,f.options),error=>error.code==='INVALID_ARGUMENT');
    assert.deepEqual(f.context.loadCheckpoint('ci-fix-v1'),saved);assert.equal(f.calls.length,count);
  }
});
test('final composed PR body exceeding the connector bound stops before commit and push',async()=>{
  const f=fixture();f.options.pullRequestBody='Host context';f.options.maxTokens=128000;
  f.responses['github.actions.run.list'].items[0].url='https://github.test/runs/'+ 'x'.repeat(65536);
  await assert.rejects(runCiFix(f.context,f.options),error=>error.code==='INVALID_ARGUMENT');
  for(const name of ['workspace.git.commit','workspace.git.push','github.pr.create'])assert.equal(f.calls.some(call=>call.toolName===name),false);
});
test('trusted repair fields reject invalid bounds before calls and snapshot strings across awaited ports',async()=>{
  for(const [field,max] of [['repairGoal',8000],['pullRequestBody',16000]]) {
    for(const value of [null,7,'','   ','x'.repeat(max+1)]) {
      const f=fixture();f.options[field]=value;
      await assert.rejects(runCiFix(f.context,f.options),error=>error.code==='INVALID_ARGUMENT');
      assert.equal(f.calls.length,0);assert.equal(f.modelCalls(),0);
    }
  }
  const f=fixture();f.options.repairGoal='Original goal';f.options.pullRequestBody='Original body';
  let prompt;const complete=f.options.model.complete,invoke=f.options.tools.invoke;
  f.options.model.complete=async request=>{prompt=JSON.parse(request.messages[1].content);return complete(request);};
  f.options.tools.invoke=async input=>{f.options.repairGoal='Replaced goal';f.options.pullRequestBody='Replaced body';return invoke(input);};
  assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
  assert.equal(prompt.repairGoal,'Original goal');
  const body=f.calls.find(call=>call.toolName==='github.pr.create').arguments.body;
  assert.ok(body.includes('Original body'));assert.ok(!body.includes('Replaced body'));
});
function sourceLinkFixture() {
  const f=fixture(),list=f.options.tools.list,invoke=f.options.tools.invoke;
  f.options.sourceRunBacklink={toolName:'github.actions.repair.link',runAttempt:3};
  f.responses['github.pr.create'].url='https://github.com/owner/repo/pull/19';
  f.options.tools.list=()=>[...list(),{name:'github.actions.repair.link',version:'1.0.0',sideEffect:'external_write'}];
  f.sourceReceipt=args=>({state:'confirmed',...args,checkRunId:88,externalId:'88',url:'https://github.com/owner/repo/runs/88',
    name:githubRepairCheckName(args),detailsUrl:'https://github.com/owner/repo/pull/19',status:'completed',conclusion:'neutral',evidenceRefs:['source-check']});
  f.options.tools.invoke=async input=>{
    if(input.toolName!=='github.actions.repair.link') return invoke(input);
    f.calls.push(input);return {state:'confirmed',result:f.sourceReceipt(input.arguments),evidenceRefs:[input.runId]};
  };
  return f;
}
test('optional source association binds the original attempt and execution to a new neutral check',async()=>{
  const f=sourceLinkFixture(),result=await runCiFix(f.context,f.options);
  assert.equal(result.status,'succeeded');assert.ok(result.sourceRunLink);
  const source=f.calls.find(c=>c.toolName==='github.actions.repair.link');
  assert.deepEqual(source.arguments,{repo:'owner/repo',runId:42,expectedRunAttempt:3,sourceSha:headSha,repairPrNumber:19,
    repairHeadSha:fixedSha,workflowExecutionId:createHash('sha256').update(source.runId).digest('hex')});
  assert.ok(f.calls.findIndex(c=>c.toolName==='github.pr.comment')<f.calls.indexOf(source));
  assert.equal(result.sourceRunLink.checkRunId,88);assert.equal(result.sourceRunLink.conclusion,'neutral');
  assert.match(result.reason,/neutral/i);assert.ok(!f.calls.some(c=>c.toolName==='github.actions.repair.get'));
  const count=f.calls.length;await runCiFix(f.context,f.options);assert.equal(f.calls.length,count);
});
test('a source association preserves the official Check focus URL without broadening its query scope',async()=>{
  const f=sourceLinkFixture(),receipt=f.sourceReceipt;f.sourceReceipt=args=>({...receipt(args),url:'https://github.com/owner/repo/runs/88?check_suite_focus=true'});
  const result=await runCiFix(f.context,f.options);assert.equal(result.sourceRunLink.url,'https://github.com/owner/repo/runs/88?check_suite_focus=true');
});
test('unconfigured repairs preserve their legacy identity and report only a PR reference to the source',async()=>{
  const f=fixture();await runCiFix(f.context,f.options);
  const o=f.options,identity=createHash('sha256').update(JSON.stringify({repository:o.repository,runId:o.runId,
    expectedHeadSha:o.expectedHeadSha,verify:o.verifyRecipeId,gitTools:o.gitTools,sourcePaths:o.sourcePaths,issue:o.issue,
    head:o.headBranch,base:o.baseBranch,maxSteps:o.maxSteps,maxTokens:o.maxTokens,limit:64*1024,attempts:2})).digest('hex');
  assert.equal(f.context.loadCheckpoint('ci-fix-v1').identity,identity);
  const result=await runCiFix(f.context,f.options);assert.equal(result.sourceRunLink,undefined);
  assert.match(result.reason,/references/i);assert.doesNotMatch(result.reason,/original run backlink/i);
});
test('missing source association adapter fails preflight without repair effects',async()=>{
  const f=fixture();f.options.sourceRunBacklink={toolName:'github.actions.repair.link',runAttempt:3};
  assert.equal((await runCiFix(f.context,f.options)).status,'unsupported');assert.equal(f.calls.length,0);assert.equal(f.modelCalls(),0);
});
test('an issue-only repair cannot opt into a source-run association',async()=>{
  const f=sourceLinkFixture(),issue=f.responses['github.issue.get'];delete f.options.runId;f.options.expectedHeadSha=headSha;
  f.options.issue={number:4,url:issue.url,repository:'owner/repo',fingerprint:createHash('sha256').update(JSON.stringify(
    [issue.number,issue.title,issue.body,issue.state,[...issue.labels].sort(),issue.url,issue.updatedAt])).digest('hex')};
  await assert.rejects(runCiFix(f.context,f.options),e=>e.code==='INVALID_ARGUMENT');assert.equal(f.calls.length,0);
});
test('source association approvals resume the original step after PR creation without another repair',async()=>{
  const f=sourceLinkFixture(),invoke=f.options.tools.invoke;let pending=true;
  f.options.tools.invoke=async input=>{
    if(input.toolName==='github.actions.repair.link'&&pending){f.calls.push(input);return {state:'pending',evidenceRefs:[]};}
    return invoke(input);
  };
  const paused=await runCiFix(f.context,f.options);assert.equal(paused.status,'waiting_approval');
  assert.equal(paused.pullRequestUrl,'https://github.com/owner/repo/pull/19');assert.equal(paused.sourceRunLink,undefined);
  pending=false;assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
  const sources=f.calls.filter(c=>c.toolName==='github.actions.repair.link');assert.equal(sources.length,2);
  assert.equal(sources[0].runId,sources[1].runId);assert.deepEqual(sources[0].arguments,sources[1].arguments);
  assert.equal(f.modelCalls(),1);for(const name of ['workspace.apply_text_patch','workspace.git.commit','github.pr.create']) assert.equal(f.calls.filter(c=>c.toolName===name).length,1);
  f.options.sourceRunBacklink.runAttempt=4;await assert.rejects(runCiFix(f.context,f.options),e=>e.code==='INVALID_ARGUMENT');
});
test('an unknown source association waits for original Runtime confirmation and never posts again',async()=>{
  const f=sourceLinkFixture(),invoke=f.options.tools.invoke;let unknown=true;
  f.options.tools.invoke=async input=>{
    if(input.toolName==='github.actions.repair.link'&&unknown){f.calls.push(input);return {state:'confirmed',result:{state:'unknown',checkRunId:88,externalId:'88',url:'https://github.com/owner/repo/runs/88',evidenceRefs:[]},evidenceRefs:[]};}
    return invoke(input);
  };
  const first=await runCiFix(f.context,f.options);assert.equal(first.status,'waiting_reconciliation');assert.equal(first.sourceRunLink,undefined);
  const original=f.calls.find(c=>c.toolName==='github.actions.repair.link'),count=f.calls.length;
  for(let i=0;i<2;i++) assert.equal((await runCiFix(f.context,f.options)).status,'waiting_reconciliation');assert.equal(f.calls.length,count);
  f.options.confirmedReplayReady=id=>id===original.runId;unknown=false;
  assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
  const replay=f.calls.filter(c=>c.toolName==='github.actions.repair.link')[1];assert.equal(replay.runId,original.runId);assert.deepEqual(replay.arguments,original.arguments);
  assert.equal(f.calls.filter(c=>c.toolName==='github.pr.create').length,1);
});
test('interrupted source association retains its original unknown identity and ignores a late confirmed receipt',async()=>{
  const f=sourceLinkFixture(),invoke=f.options.tools.invoke,controller=new AbortController(),started=Promise.withResolvers(),response=Promise.withResolvers();
  f.context.signal=controller.signal;
  f.options.tools.invoke=async input=>{
    if(input.toolName!=='github.actions.repair.link') return invoke(input);
    f.calls.push(input);started.resolve(input);return response.promise;
  };
  const pending=runCiFix(f.context,f.options),source=await started.promise;controller.abort();
  assert.equal((await mustSettle(pending)).status,'waiting_reconciliation');
  const saved=f.context.loadCheckpoint('ci-fix-v1');assert.equal(saved.inflight,'source-backlink');assert.equal(saved.results['source-backlink'],undefined);
  response.resolve({state:'confirmed',result:f.sourceReceipt(source.arguments),evidenceRefs:[source.runId]});
  await setImmediate();assert.deepEqual(f.context.loadCheckpoint('ci-fix-v1'),saved);
  f.context.signal=new AbortController().signal;
  assert.equal((await runCiFix(f.context,f.options)).status,'waiting_reconciliation');
  assert.equal(f.calls.filter(c=>c.toolName==='github.actions.repair.link').length,1);
  assert.equal(f.calls.filter(c=>c.toolName==='workspace.git.commit').length,1);
});
test('invalid trusted attempt bindings are rejected before repair reads or writes',async()=>{
  for(const runAttempt of [0,1.5,Number.MAX_SAFE_INTEGER+1]) {
    const f=sourceLinkFixture();f.options.sourceRunBacklink.runAttempt=runAttempt;
    await assert.rejects(runCiFix(f.context,f.options),e=>e.code==='INVALID_ARGUMENT');assert.equal(f.calls.length,0);assert.equal(f.modelCalls(),0);
  }
});
test('source association cannot exceed the persisted original repair step budget',async()=>{
  const f=sourceLinkFixture();f.options.maxSteps=13;
  assert.equal((await runCiFix(f.context,f.options)).status,'unsupported');
  assert.equal(f.calls.filter(c=>c.toolName==='github.pr.create').length,1);assert.ok(!f.calls.some(c=>c.toolName==='github.actions.repair.link'));
});
test('confirmed source association requires the complete exact identity and neutral check receipt',async t=>{
  const changes=[r=>{delete r.workflowExecutionId;},r=>{r.workflowExecutionId='a'.repeat(64);},r=>{r.repo='other/repo';},
    r=>{r.runId=43;},r=>{r.expectedRunAttempt=4;},r=>{r.sourceSha=fixedSha;},r=>{r.repairPrNumber=20;},r=>{r.repairHeadSha=headSha;},
    r=>{r.checkRunId=0;},r=>{r.externalId='89';},r=>{r.url='https://github.com/other/repo/runs/88';},
    r=>{r.url='https://github.com/owner/repo/runs/89';},r=>{r.url='https://github.com/owner/repo/runs/88?other=true';},
    r=>{r.url='https://github.com/owner/repo/runs/88?check_suite_focus=true#fragment';},
    r=>{r.detailsUrl='https://github.com/owner/repo/pull/20';},r=>{r.status='in_progress';},r=>{r.conclusion='success';},
    r=>{r.name='';},r=>{delete r.evidenceRefs;}];
  for(const [i,change] of changes.entries()) await t.test(String(i),async()=>{
    const f=sourceLinkFixture(),receipt=f.sourceReceipt;f.sourceReceipt=args=>{const r=receipt(args);change(r);return r;};
    await assert.rejects(runCiFix(f.context,f.options),e=>e.code==='INVALID_ARGUMENT');
  });
});
test('failed actual verification retries once then never commits',async()=>{
  const f=fixture(); f.responses['workspace.run_allowed_command'].exitCode=1;
  assert.equal((await runCiFix(f.context,f.options)).status,'verification_failed');
  assert.ok(!f.calls.some(c=>c.toolName==='workspace.git.commit'));
  assert.equal(f.modelCalls(),2);
  assert.equal(f.calls.filter(c=>c.toolName==='workspace.run_allowed_command').length,2);
});
test('maxAttempts 1 stops after a single failed verification',async()=>{
  const f=fixture(); f.responses['workspace.run_allowed_command'].exitCode=1; f.options.maxAttempts=1;
  assert.equal((await runCiFix(f.context,f.options)).status,'verification_failed');
  assert.equal(f.modelCalls(),1);
});
test('second bounded attempt can verify and commit the layered repair',async()=>{
  const f=fixture(), original=f.options.tools.invoke; let verifyCalls=0;
  f.options.tools.invoke=async input=>{
    if(input.toolName==='workspace.run_allowed_command'){verifyCalls++;
      return {state:'confirmed',result:{recipeId:'test',exitCode:verifyCalls===1?1:0,stdout:'',stderr:''},evidenceRefs:[input.runId]};}
    return original(input);};
  const r=await runCiFix(f.context,f.options);
  assert.equal(r.status,'succeeded'); assert.equal(f.modelCalls(),2);
  assert.match(r.verificationRunId,/verify-1$/);
  assert.equal(f.calls.find(c=>c.toolName==='workspace.git.commit').arguments.verificationRunId,r.verificationRunId);
});
test('missing capability is unsupported without effects',async()=>{
  const f=fixture(); delete f.options.model;
  assert.equal((await runCiFix(f.context,f.options)).status,'unsupported'); assert.equal(f.calls.length,0);
});
test('layered repairs commit every confirmed file after second-round approval resumes',async()=>{
  const f=fixture(), original=f.options.tools.invoke;
  const files=new Map([['src/a.ts','bad-a'],['src/b.ts','bad-b']]);
  const hash=text=>createHash('sha256').update(text).digest('hex');
  f.options.sourcePaths=[...files.keys()];
  let rounds=0, pending=true, verifies=0;
  f.options.model.complete=async request=>{
    const input=JSON.parse(request.messages[1].content), round=rounds++;
    assert.deepEqual(request.tools,[]);
    assert.equal(input.sources.find(s=>s.path==='src/a.ts').content,round===0?'bad-a':'good-a');
    if(round===1) assert.match(input.priorAttempts[0],/Attempt 1 diagnosis/);
    const path=round===0?'src/a.ts':'src/b.ts', oldText=files.get(path);
    return {response:{kind:'final',text:JSON.stringify({diagnosis:`repair ${path}`,patches:[{path,expectedSha256:hash(oldText),edits:[{oldText,newText:round===0?'good-a':'good-b'}]}]})},usage:{totalTokens:20}};
  };
  f.options.tools.invoke=async input=>{
    const args=input.arguments;
    if(input.toolName==='workspace.read_text'){
      f.calls.push(input); const content=files.get(args.path);
      return {state:'confirmed',result:{path:args.path,content,sha256:hash(content)},evidenceRefs:[input.runId]};
    }
    if(input.toolName==='workspace.apply_text_patch'){
      f.calls.push(input);
      if(args.path==='src/b.ts'&&pending) return {state:'pending',evidenceRefs:[]};
      const before=files.get(args.path); assert.equal(args.expectedSha256,hash(before));
      assert.equal(before,args.edits[0].oldText); const after=args.edits[0].newText; files.set(args.path,after);
      return {state:'confirmed',result:{path:args.path,beforeSha256:hash(before),afterSha256:hash(after),applied:true,changed:true},evidenceRefs:[input.runId]};
    }
    if(input.toolName==='workspace.run_allowed_command'){
      f.calls.push(input); verifies++;
      assert.equal(files.get('src/a.ts'),'good-a');
      assert.equal(files.get('src/b.ts'),verifies===1?'bad-b':'good-b');
      return {state:'confirmed',result:{recipeId:'test',exitCode:verifies===1?1:0,stdout:'',stderr:''},evidenceRefs:[input.runId]};
    }
    return original(input);
  };
  const first=await runCiFix(f.context,f.options);
  assert.equal(first.status,'waiting_approval'); assert.match(first.verificationRunId,/verify-0$/);
  assert.ok(!f.calls.some(c=>c.toolName==='workspace.git.commit'));
  pending=false; const second=await runCiFix(f.context,f.options);
  assert.equal(second.status,'succeeded'); assert.equal(rounds,2); assert.equal(verifies,2);
  assert.match(second.verificationRunId,/verify-1$/);
  const commit=f.calls.find(c=>c.toolName==='workspace.git.commit');
  assert.deepEqual(commit.arguments.paths,['src/a.ts','src/b.ts']);
  assert.equal(commit.arguments.verificationRunId,second.verificationRunId);
  const patches=f.calls.filter(c=>c.toolName==='workspace.apply_text_patch');
  assert.equal(patches.filter(c=>c.arguments.path==='src/a.ts').length,1);
  const bPatches=patches.filter(c=>c.arguments.path==='src/b.ts');
  assert.equal(bPatches.length,2); assert.equal(bPatches[0].runId,bPatches[1].runId);
  assert.deepEqual(bPatches[0].arguments,bPatches[1].arguments);
});
test('model supplied shell command is rejected',async()=>{
  const f=fixture(); f.options.model.complete=async()=>({response:{kind:'final',text:'{"diagnosis":"fix","patches":[],"shell":"rm -rf /"}'}});
  await assert.rejects(runCiFix(f.context,f.options),/Invalid CI/); assert.ok(!f.calls.some(c=>c.toolName==='workspace.apply_text_patch'));
});
test('unknown patch is persisted and never automatically retried',async()=>{
  const f=fixture(), original=f.options.tools.invoke;
  f.options.tools.invoke=async input=>input.toolName==='workspace.apply_text_patch'?(f.calls.push(input),{state:'unknown',evidenceRefs:[]}):original(input);
  assert.equal((await runCiFix(f.context,f.options)).status,'waiting_reconciliation');
  assert.equal((await runCiFix(f.context,f.options)).status,'waiting_reconciliation');
  assert.equal(f.calls.filter(c=>c.toolName==='workspace.apply_text_patch').length,1);
});
test('pending approval resumes stable run id without another model call',async()=>{
  const f=fixture(), original=f.options.tools.invoke; let pending=true;
  f.options.tools.invoke=async input=>input.toolName==='workspace.apply_text_patch'&&pending?(f.calls.push(input),{state:'pending',evidenceRefs:[]}):original(input);
  assert.equal((await runCiFix(f.context,f.options)).status,'waiting_approval'); pending=false;
  assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
  const patchCalls=f.calls.filter(c=>c.toolName==='workspace.apply_text_patch'); assert.equal(patchCalls[0].runId,patchCalls[1].runId); assert.equal(f.modelCalls(),1);
});
test('head drift after verification blocks commit',async()=>{
  const f=fixture(), original=f.options.tools.invoke; let reads=0;
  f.options.tools.invoke=async input=>{if(input.toolName==='workspace.git.head'&&++reads>1) return {state:'confirmed',result:{headSha:fixedSha,clean:false},evidenceRefs:[]};return original(input);};
  assert.equal((await runCiFix(f.context,f.options)).status,'stale'); assert.ok(!f.calls.some(c=>c.toolName==='workspace.git.commit'));
});
test('legacy in-flight precommit head resumes only its original confirmed receipt',async()=>{
  const f=fixture(), original=f.options.tools.invoke;
  f.options.tools.invoke=async input=>{
    if(input.toolName==='workspace.git.head' && input.runId.includes(':precommit-head-')) {
      f.calls.push(input); return {state:'unknown',evidenceRefs:[]};
    }
    return original(input);
  };
  assert.equal((await runCiFix(f.context,f.options)).status,'waiting_reconciliation');
  // Upgrade a journal written before the stable precommitHeadStep field existed.
  const legacy=f.context.loadCheckpoint('ci-fix-v1');
  delete legacy.precommitHeadStep;
  legacy.inflight=`precommit-head-${legacy.steps}`;
  f.context.saveCheckpoint('ci-fix-v1',legacy);
  const runId=`${f.context.taskId}:ci-fix:${legacy.identity}:${legacy.inflight}`;
  const headCall=f.calls.find(c=>c.runId.includes(':precommit-head-'));
  headCall.runId=runId;
  const count=f.calls.length, replayChecks=[];
  let confirmed=false, cachedReplays=0;
  f.options.confirmedReplayReady=id=>{replayChecks.push(id);return confirmed && id===runId;};
  f.options.tools.invoke=async input=>{
    if(input.runId===runId) {
      assert.ok(confirmed); cachedReplays++;
      assert.deepEqual(input.arguments,headCall.arguments);
      return {state:'confirmed',result:structuredClone(f.responses['workspace.git.head']),evidenceRefs:[runId]};
    }
    return original(input);
  };
  assert.equal((await runCiFix(f.context,f.options)).status,'waiting_reconciliation');
  assert.equal(f.calls.length,count); assert.equal(cachedReplays,0);
  assert.equal(f.context.loadCheckpoint('ci-fix-v1').inflight,legacy.inflight);
  confirmed=true;
  assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
  assert.deepEqual(replayChecks,[runId,runId]); assert.equal(cachedReplays,1);
  assert.equal(f.calls.filter(c=>c.toolName==='workspace.git.head').length,2);
  assert.equal(f.calls.filter(c=>c.toolName==='workspace.git.commit').length,1);
  assert.equal(f.calls.filter(c=>c.toolName==='workspace.apply_text_patch').length,1);
  assert.equal(f.modelCalls(),1);
});
test('changed request cannot reuse persisted journal',async()=>{
  const f=fixture(); await runCiFix(f.context,f.options); f.options.runId='43';
  await assert.rejects(runCiFix(f.context,f.options),/Invalid CI/);
});
test('cancelled context never invokes a tool',async()=>{
  const f=fixture(), controller=new AbortController(); controller.abort(); f.context.signal=controller.signal;
  await assert.rejects(runCiFix(f.context,f.options),/cancelled/); assert.equal(f.calls.length,0);
  assert.equal(f.modelCalls(),0); assert.equal(f.checkpoints.size,0);
});
async function mustSettle(promise) {
  let timer;
  try {return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('operation did not settle')),100);})]);}
  finally {clearTimeout(timer);}
}
test('permanently waiting model and read ports cannot hold a cancelled CI factory',async t=>{
  for(const phase of ['model','read']) await t.test(phase,async()=>{
    const f=fixture(), controller=new AbortController(), started=Promise.withResolvers();
    f.context.signal=controller.signal;
    let portSignal;
    if(phase==='model') f.options.model.complete=async request=>{portSignal=request.signal;started.resolve();return new Promise(()=>{});};
    else f.options.tools.invoke=async input=>{f.calls.push(input);portSignal=input.signal;started.resolve();return new Promise(()=>{});};
    const run=runCiFix(f.context,f.options); await started.promise; controller.abort();
    await assert.rejects(mustSettle(run),error=>error.code==='CANCELLED');
    assert.equal(portSignal.aborted,true); assert.equal(getEventListeners(controller.signal,'abort').length,0);
    assert.ok(!f.calls.some(c=>c.toolName==='workspace.apply_text_patch'));
  });
});
test('CI model and read deadlines expire even when their ports ignore signals',async t=>{
  for(const phase of ['model','read']) await t.test(phase,async t=>{
    t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-05T00:00:00Z')});
    const f=fixture(), started=Promise.withResolvers(); f.context.deadline=new Date(Date.now()+5000).toISOString();
    if(phase==='model') f.options.model.complete=async()=>{started.resolve();return new Promise(()=>{});};
    else f.options.tools.invoke=async input=>{f.calls.push(input);started.resolve();return new Promise(()=>{});};
    let error;
    const run=runCiFix(f.context,f.options).catch(value=>{error=value;});
    await started.promise; t.mock.timers.tick(5000); await setImmediate();
    assert.equal(error?.code,'TIMEOUT'); await run;
    assert.equal(getEventListeners(f.context.signal,'abort').length,0);
    assert.ok(!f.calls.some(c=>c.toolName==='workspace.apply_text_patch'));
  });
});
test('CI deadline uses the supplied clock and re-arms timers beyond the platform delay limit',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(), started=Promise.withResolvers(), maxDelay=2_147_483_647;
  let clock=0, error;
  f.options.now=()=>clock; f.context.deadline=new Date(maxDelay+5000).toISOString();
  f.options.tools.invoke=async input=>{f.calls.push(input);started.resolve();return new Promise(()=>{});};
  const run=runCiFix(f.context,f.options).catch(value=>{error=value;}); await started.promise;
  clock=maxDelay; t.mock.timers.tick(maxDelay); await setImmediate(); assert.equal(error,undefined);
  clock+=5000; t.mock.timers.tick(5000); await setImmediate();
  assert.equal(error?.code,'TIMEOUT'); await run; assert.equal(f.calls.length,1);
});
test('a model result arriving past the supplied deadline cannot settle its checkpoint',async()=>{
  const f=fixture(), complete=f.options.model.complete;
  let clock=0, portSignal;
  f.options.now=()=>clock; f.context.deadline=new Date(5000).toISOString();
  f.options.model.complete=async request=>{portSignal=request.signal;clock=5000;return complete(request);};
  await assert.rejects(runCiFix(f.context,f.options),error=>error.code==='TIMEOUT');
  const saved=f.context.loadCheckpoint('ci-fix-v1');
  assert.equal(portSignal.aborted,true); assert.equal(saved.inflight,'model-0');
  assert.equal(saved.results['model-0'],undefined); assert.equal(saved.tokens,f.options.maxTokens);
  assert.ok(!f.calls.some(c=>c.toolName==='workspace.apply_text_patch'));
});
test('cancelled patch ports retain their original unknown run and reject late confirmed results',async t=>{
  for(const metadata of ['local_write','unknown']) await t.test(metadata,async()=>{
    const f=fixture(), controller=new AbortController(), started=Promise.withResolvers(), response=Promise.withResolvers();
    f.context.signal=controller.signal;
    if(metadata==='unknown') {
      const list=f.options.tools.list;
      f.options.tools.list=()=>list().map(tool=>{if(tool.name==='workspace.apply_text_patch') delete tool.sideEffect;return tool;});
    }
    const invoke=f.options.tools.invoke;
    f.options.tools.invoke=async input=>{
      if(input.toolName!=='workspace.apply_text_patch') return invoke(input);
      f.calls.push(input); started.resolve(input); return response.promise;
    };
    const run=runCiFix(f.context,f.options), patch=await started.promise; controller.abort();
    assert.equal((await mustSettle(run)).status,'waiting_reconciliation');
    const saved=f.context.loadCheckpoint('ci-fix-v1');
    assert.equal(saved.inflight,'patch-0-0'); assert.equal(saved.results['patch-0-0'],undefined);
    response.resolve({state:'confirmed',result:f.responses['workspace.apply_text_patch'],evidenceRefs:[patch.runId]});
    await setImmediate(); assert.deepEqual(f.context.loadCheckpoint('ci-fix-v1'),saved);
    f.context.signal=new AbortController().signal;
    for(let index=0;index<2;index++) assert.equal((await runCiFix(f.context,f.options)).status,'waiting_reconciliation');
    assert.equal(f.calls.filter(c=>c.toolName==='workspace.apply_text_patch').length,1);
    assert.equal(f.calls.filter(c=>c.toolName==='workspace.run_allowed_command').length,0);
    assert.equal(getEventListeners(controller.signal,'abort').length,0);
  });
});
test('step budget persists and blocks effects',async()=>{
  const f=fixture(); f.options.maxSteps=2;
  assert.equal((await runCiFix(f.context,f.options)).status,'unsupported');
  const count=f.calls.length; await runCiFix(f.context,f.options); assert.equal(f.calls.length,count);
});
test('issue-only repair uses re-read fingerprint without inventing a CI run',async()=>{
  const f=fixture(), issue=f.responses['github.issue.get']; delete f.options.runId;
  const fingerprint=createHash('sha256').update(JSON.stringify([issue.number,issue.title,issue.body,issue.state,[...issue.labels].sort(),issue.url,issue.updatedAt])).digest('hex');
  f.options.issue={number:4,url:issue.url,repository:'owner/repo',fingerprint}; f.options.expectedHeadSha=headSha;
  assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
  assert.ok(!f.calls.some(c=>c.toolName.startsWith('github.actions.')));
  assert.match(f.calls.find(c=>c.toolName==='github.issue.comment').arguments.body,/pull\/19/);
});
test('issue drift refuses any patch',async()=>{
  const f=fixture(); delete f.options.runId; f.options.expectedHeadSha=headSha;
  f.options.issue={number:4,url:'https://github.test/issues/4',repository:'owner/repo',fingerprint:'0'.repeat(64)};
  assert.equal((await runCiFix(f.context,f.options)).status,'stale');
  assert.ok(!f.calls.some(c=>c.toolName==='workspace.apply_text_patch'));
});

test('real-model framing preserves strict CI proposal validation',async()=>{
 for(const lang of ['json','']) {const f=fixture(),complete=f.options.model.complete;
 f.options.model.complete=async request=>{const r=await complete(request);r.response.text='```'+lang+'\n'+r.response.text+'\n```';return r;};
 assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
 assert.equal(f.calls.filter(c=>c.toolName==='workspace.apply_text_patch').length,1);}
});
test('framing never accepts commentary or shell fields as CI proposal content',async()=>{
 for(const mutation of [s=>'comment\n```json\n'+s+'\n```',s=>'```json\n'+s.slice(0,-1)+',"shell":"danger"}\n```']) {
 const f=fixture(),complete=f.options.model.complete;f.options.model.complete=async request=>{const r=await complete(request);r.response.text=mutation(r.response.text);return r;};
 await assert.rejects(runCiFix(f.context,f.options),/Invalid CI/);assert.equal(f.calls.filter(c=>c.toolName==='workspace.apply_text_patch').length,0);}
});
test('real Actions queries remain bounded and never infer a missing target run',async()=>{
 const f=fixture();assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
 for(const name of ['github.actions.run.list','github.actions.job.list']) {const c=f.calls.find(c=>c.toolName===name);assert.equal(c.arguments.page,1);assert.equal(c.arguments.perPage,30);}
 const missing=fixture();missing.responses['github.actions.run.list'].items=[];
 assert.equal((await runCiFix(missing.context,missing.options)).status,'unsupported');
 assert.equal(missing.modelCalls(),0);assert.equal(missing.calls.length,1);
});

test('CI repair finds a selected run and failed job beyond the first pages',async()=>{
 const f=fixture(),invoke=f.options.tools.invoke;
 f.options.tools.invoke=async input=>{
  if(input.toolName==='github.actions.run.list'||input.toolName==='github.actions.job.list') {
   f.calls.push(input);const page=input.arguments.page;
   return {state:'confirmed',result:{items:page===1?[]:structuredClone(f.responses[input.toolName].items),page,nextPage:page===1?2:null,hasMore:page===1},evidenceRefs:[input.runId]};
  }
  return invoke(input);
 };
 assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
 for(const name of ['github.actions.run.list','github.actions.job.list']) assert.deepEqual(f.calls.filter(c=>c.toolName===name).map(c=>c.arguments.page),[1,2]);
 assert.equal(f.modelCalls(),1);assert.equal(f.calls.filter(c=>c.toolName==='workspace.git.commit').length,1);
});
test('log pagination reaches failure evidence and resumes the same approved cursor',async()=>{
 const f=fixture(),invoke=f.options.tools.invoke,complete=f.options.model.complete;let pending=true;
 f.options.tools.invoke=async input=>{
  if(input.toolName==='github.actions.log.read') {
   f.calls.push(input);const offset=input.arguments.offset;
   if(offset===6&&pending) return {state:'pending',evidenceRefs:[]};
   return {state:'confirmed',result:offset===0?{text:'setup\n',offset:0,nextOffset:6,truncated:true}:{text:'test failed',offset:6,nextOffset:null,truncated:false},evidenceRefs:[input.runId]};
  }
  return invoke(input);
 };
 f.options.model.complete=async request=>{const input=JSON.parse(request.messages[1].content);assert.equal(input.read.logs,'setup\ntest failed');assert.equal(input.read.truncated,false);return complete(request);};
 assert.equal((await runCiFix(f.context,f.options)).status,'waiting_approval');assert.equal(f.modelCalls(),0);
 pending=false;assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
 const logs=f.calls.filter(c=>c.toolName==='github.actions.log.read');
 assert.deepEqual(logs.map(c=>c.arguments.offset),[0,6,6]);assert.equal(logs[1].runId,logs[2].runId);assert.deepEqual(logs[1].arguments,logs[2].arguments);
 const count=f.calls.length;assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');assert.equal(f.calls.length,count);
 assert.equal(f.modelCalls(),1);assert.equal(f.calls.filter(c=>c.toolName==='workspace.apply_text_patch').length,1);
});
test('malformed or non-progressing CI cursors never reach model or writes',async t=>{
 for(const phase of ['runs','jobs','log']) await t.test(phase,async()=>{
  const f=fixture();
  if(phase==='runs') f.responses['github.actions.run.list']={items:[],page:1,nextPage:1,hasMore:true};
  if(phase==='jobs') f.responses['github.actions.job.list']={items:[],page:2,nextPage:null,hasMore:false};
  if(phase==='log') f.responses['github.actions.log.read']={text:'setup',offset:0,nextOffset:0,truncated:true};
  await assert.rejects(runCiFix(f.context,f.options),error=>error.code==='INVALID_ARGUMENT');
  assert.equal(f.modelCalls(),0);assert.ok(!f.calls.some(c=>c.toolName==='workspace.apply_text_patch'));
 });
});
test('CI pagination honors the persisted step budget and fixed page bound',async t=>{
 for(const maxSteps of [2,100]) await t.test(String(maxSteps),async()=>{
  const f=fixture();f.options.maxSteps=maxSteps;
  f.options.tools.invoke=async input=>{f.calls.push(input);const page=input.arguments.page;return {state:'confirmed',result:{items:[],page,nextPage:page+1,hasMore:true},evidenceRefs:[input.runId]};};
  assert.equal((await runCiFix(f.context,f.options)).status,'unsupported');
  assert.equal(f.calls.length,maxSteps===2?2:4);assert.equal(f.modelCalls(),0);
  const count=f.calls.length;assert.equal((await runCiFix(f.context,f.options)).status,'unsupported');assert.equal(f.calls.length,count);
 });
});
test('CI logs stop at the byte ceiling and report omitted pages as truncated',async()=>{
 const f=fixture(),invoke=f.options.tools.invoke;f.options.maxLogBytes=10;
 f.options.tools.invoke=async input=>{
  if(input.toolName==='github.actions.log.read') {f.calls.push(input);const offset=input.arguments.offset;return {state:'confirmed',result:{text:offset===0?'setup':'er',offset,nextOffset:offset===0?5:7,truncated:true},evidenceRefs:[input.runId]};}
  return invoke(input);
 };
 f.options.model.complete=async request=>{const input=JSON.parse(request.messages[1].content);assert.equal(input.read.logs,'setuper');assert.equal(input.read.truncated,true);return {response:{kind:'final',text:'{"diagnosis":"stop","patches":[]}'}};};
 await assert.rejects(runCiFix(f.context,f.options),error=>error.code==='INVALID_ARGUMENT');
 assert.deepEqual(f.calls.filter(c=>c.toolName==='github.actions.log.read').map(c=>c.arguments.offset),[0,5]);
 assert.ok(!f.calls.some(c=>c.toolName==='workspace.apply_text_patch'));
});
test('an endless progressing log is capped before model dispatch and reports truncation',async()=>{
 const f=fixture(),invoke=f.options.tools.invoke,complete=f.options.model.complete;
 f.options.tools.invoke=async input=>{
  if(input.toolName==='github.actions.log.read') {f.calls.push(input);const offset=input.arguments.offset;return {state:'confirmed',result:{text:'x',offset,nextOffset:offset+1,truncated:true},evidenceRefs:[input.runId]};}
  return invoke(input);
 };
 f.options.model.complete=async request=>{const input=JSON.parse(request.messages[1].content);assert.equal(input.read.logs,'x'.repeat(8));assert.equal(input.read.truncated,true);return complete(request);};
 assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
 assert.deepEqual(f.calls.filter(c=>c.toolName==='github.actions.log.read').map(c=>c.arguments.offset),[0,1,2,3,4,5,6,7]);
});
test('the largest supported CI log budget still uses the registered per-call character bound',async()=>{
 const f=fixture(),invoke=f.options.tools.invoke;f.options.maxLogBytes=256*1024;
 f.options.tools.invoke=async input=>{
  if(input.toolName==='github.actions.log.read') assert.ok(input.arguments.maxChars<=65536);
  return invoke(input);
 };
 assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
});
test('a job receipt bound to a different run cannot become CI evidence',async()=>{
 const f=fixture();f.responses['github.actions.job.list'].items[0].runId=43;
 await assert.rejects(runCiFix(f.context,f.options),error=>error.code==='INVALID_ARGUMENT');
 assert.equal(f.modelCalls(),0);assert.ok(!f.calls.some(c=>c.toolName==='github.actions.log.read'));
});
test('valid multibyte log pages preserve a complete UTF-8 prefix at the byte ceiling',async t=>{
 for(const text of ['故障故障','😀故障']) await t.test(text,async()=>{
  const f=fixture(),invoke=f.options.tools.invoke,complete=f.options.model.complete;f.options.maxLogBytes=8;
  f.options.tools.invoke=async input=>{
   if(input.toolName==='github.actions.log.read') {f.calls.push(input);return {state:'confirmed',result:{text,offset:0,nextOffset:null,truncated:false},evidenceRefs:[input.runId]};}
   return invoke(input);
  };
  // Keep the page within the public character count while exceeding its UTF-8 budget.
  f.options.model.complete=async request=>{
   const read=JSON.parse(request.messages[1].content).read;
   assert.equal(read.logs,text.startsWith('故')?'故障':'😀故');assert.ok(Buffer.byteLength(read.logs)<=8);assert.equal(read.truncated,true);
   assert.ok(!read.logs.includes('\ufffd'));return complete(request);
  };
  assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
  assert.equal(f.calls.filter(c=>c.toolName==='github.actions.log.read').length,1);
 });
});
function providerLogFixture(text) {
 const f=fixture(),invoke=f.options.tools.invoke,commands=[],pages=[];
 const provider=new GhCliProvider({repositories:[f.options.repository],readToken:async()=> 'synthetic-token',
  runner:{async run(command) {
   commands.push(command.args);
   return {exitCode:0,stdout:command.args[0]==='api'?JSON.stringify({id:7,run_id:42}):text,stderr:''};
  }}});
 f.options.tools.invoke=async input=>{
  if(input.toolName!=='github.actions.log.read') return invoke(input);
  f.calls.push(input);
  const result=await provider.execute('actions.log.read',input.arguments,input);pages.push(result);
  return {state:'confirmed',result,evidenceRefs:[input.runId]};
 };
 return {f,commands,pages};
}
test('actual GitHub UTF-16 log slicing never forwards a page-ending half emoji',async()=>{
 const {f,commands,pages}=providerLogFixture('aaa😀Z'),complete=f.options.model.complete;
 f.options.maxLogBytes=8;
 f.options.model.complete=async request=>{
  const read=JSON.parse(request.messages[1].content).read;
  assert.equal(read.logs,'aaa');assert.equal(read.truncated,true);assert.equal(read.logs.isWellFormed(),true);
  return complete(request);
 };
 assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
 assert.deepEqual(pages,[{text:'aaa\ud83d',offset:0,nextOffset:4,truncated:true}]);
 assert.equal(commands.length,2);assert.equal(f.calls.filter(c=>c.toolName==='github.actions.log.read').length,1);
});
test('original log text containing isolated surrogate code units is rejected',async t=>{
 for(const text of ['a\ud83d','a\ud83db','a\ude00']) await t.test(JSON.stringify(text),async()=>{
  const {f,pages}=providerLogFixture(text);
  await assert.rejects(runCiFix(f.context,f.options),error=>error.code==='INVALID_ARGUMENT');
  assert.equal(pages[0].truncated,false);assert.equal(f.modelCalls(),0);
  assert.ok(!f.calls.some(c=>c.toolName==='workspace.apply_text_patch'));
 });
});

test('model hash errors use the trusted read hash in the approved patch request',async()=>{
 const f=fixture(),complete=f.options.model.complete;f.options.model.complete=async request=>{const r=await complete(request);const p=JSON.parse(r.response.text);p.patches[0].expectedSha256='e'.repeat(64);r.response.text=JSON.stringify(p);return r;};
 assert.equal((await runCiFix(f.context,f.options)).status,'succeeded');
 const patch=f.calls.find(c=>c.toolName==='workspace.apply_text_patch');assert.equal(patch.arguments.expectedSha256,fileSha);assert.equal(patch.arguments.edits[0].oldText,'bad');
 const count=f.calls.length;await runCiFix(f.context,f.options);assert.equal(f.calls.length,count);
});
test('hash normalization never grants an unread model path',async()=>{
 const f=fixture(),complete=f.options.model.complete;f.options.model.complete=async request=>{const r=await complete(request);const p=JSON.parse(r.response.text);p.patches[0].path='src/unread.ts';r.response.text=JSON.stringify(p);return r;};
 await assert.rejects(runCiFix(f.context,f.options),/Invalid CI/);assert.equal(f.calls.filter(c=>c.toolName==='workspace.apply_text_patch').length,0);
});

test('one public workflow run snapshots scalar and nested execution inputs across an awaited read', async()=>{
  const f=fixture();let release,entered;
  const reached=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
  const invoke=f.options.tools.invoke;
  f.options.tools.invoke=async input=>{if(input.toolName==='github.actions.run.list'){entered();await wait;}return invoke(input);};
  const workflow=createCiFixWorkflow(f.options),running=workflow.run(f.context);
  await reached;
  f.options.repository='owner/next-repo';f.options.runId='99';f.options.headBranch='next-branch';f.options.baseBranch='other-base';
  f.options.verifyRecipeId='other-recipe';f.options.maxSteps=1;f.options.maxTokens=1;
  f.options.sourcePaths.push('src/next.ts');f.options.gitTools.commit='workspace.other.commit';
  release();assert.equal((await running).status,'succeeded');
  assert.ok(f.calls.filter(call=>call.arguments.repo).every(call=>call.arguments.repo==='owner/repo'));
  assert.ok(f.calls.filter(call=>call.arguments.repository).every(call=>call.arguments.repository==='owner/repo'));
  assert.deepEqual(f.calls.filter(call=>call.toolName==='workspace.read_text').map(call=>call.arguments.path),['src/a.ts']);
  assert.equal(f.calls.find(call=>call.toolName==='workspace.run_allowed_command').arguments.recipeId,'test');
  const pr=f.calls.find(call=>call.toolName==='github.pr.create');assert.equal(pr.arguments.head,'ci-fix');assert.equal(pr.arguments.base,'main');
  assert.ok(f.calls.some(call=>call.toolName==='workspace.git.commit'));
  f.options.gitTools.commit='workspace.git.commit'; // Keep adapters available so changed identity reaches the journal guard.
  await assert.rejects(workflow.run(f.context),error=>error.code==='INVALID_ARGUMENT');
});
test('issue source binding is snapshotted while its original read is outstanding',async()=>{
  const f=fixture(),issue=f.responses['github.issue.get'];delete f.options.runId;f.options.expectedHeadSha=headSha;
  f.options.issue={number:issue.number,url:issue.url,repository:'owner/repo',fingerprint:createHash('sha256').update(JSON.stringify(
    [issue.number,issue.title,issue.body,issue.state,[...issue.labels].sort(),issue.url,issue.updatedAt])).digest('hex')};
  let release,entered;const reached=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
  const invoke=f.options.tools.invoke;f.options.tools.invoke=async input=>{if(input.toolName==='github.issue.get'){entered();await wait;}return invoke(input);};
  const running=runCiFix(f.context,f.options);await reached;
  Object.assign(f.options.issue,{number:99,url:'https://github.test/issues/99',fingerprint:'changed',repository:'owner/other'});
  release();assert.equal((await running).status,'succeeded');
  const backlink=f.calls.find(call=>call.toolName==='github.issue.comment');assert.equal(backlink.arguments.number,4);
  assert.match(backlink.arguments.body,/Issue fingerprint: [a-f0-9]{64}/);
});
test('same workflow factory accepts updated configuration for a distinct task without mutating the original journal',async()=>{
  const f=fixture(),workflow=createCiFixWorkflow(f.options);
  assert.equal((await workflow.run(f.context)).status,'succeeded');const original=f.context.loadCheckpoint('ci-fix-v1');
  f.options.headBranch='second-branch';
  const checkpoints=new Map(),context={...f.context,taskId:'distinct-task',loadCheckpoint:key=>checkpoints.get(key),saveCheckpoint:(key,value)=>checkpoints.set(key,structuredClone(value))};
  assert.equal((await workflow.run(context)).status,'succeeded');
  assert.equal(f.calls.filter(call=>call.toolName==='github.pr.create').at(-1).arguments.head,'second-branch');
  assert.deepEqual(f.context.loadCheckpoint('ci-fix-v1'),original);
  await assert.rejects(workflow.run(f.context),error=>error.code==='INVALID_ARGUMENT');
});
test('authorization and clock hooks remain live across awaited execution inputs',async()=>{
  for(const hook of ['authorization','clock']) {
    const f=fixture();let release,entered;const reached=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
    const invoke=f.options.tools.invoke;f.options.tools.invoke=async input=>{if(input.toolName==='github.actions.run.list'){entered();await wait;}return invoke(input);};
    const running=runCiFix(f.context,f.options);await reached;
    if(hook==='authorization')f.options.authorizationRefFor=()=>undefined;
    else f.options.now=()=>Date.parse('2100-01-01T00:00:00Z');
    release();
    if(hook==='authorization')assert.equal((await running).status,'waiting_approval');
    else await assert.rejects(running,error=>error.code==='TIMEOUT');
    assert.equal(f.calls.length,1);
  }
});
