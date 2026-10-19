import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@personal-agent/client';
import {FakeModelProvider} from '@personal-agent/models';
import {FakeGitHubProvider,register as registerGitHub} from '@personal-agent/github';
import {MAX_AVAILABLE_TOOLS,MAX_AVAILABLE_TOOLS_JSON_BYTES} from '@personal-agent/coordination';
import * as coding from '@personal-agent/coding-tools';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
// Isolated Runtime-owner fixes can validate this consumer regression against
// their own built public application entry without sharing node_modules.
const {createRuntimeApplication,createDesktopSubagentDispatchTool}=await import(
  process.env.PA_SYNTHETIC_DEVELOPER_RUNTIME_APPLICATION_MODULE??'../dist/application.js');

const repo='synthetic/project',head='a'.repeat(40),fixed='b'.repeat(40),base='c'.repeat(40);
const sha=value=>createHash('sha256').update(value).digest('hex');
const locateRoots=[];
after(()=>{for(const root of locateRoots)rmSync(root,{recursive:true,force:true});});
const locateOutput=['✖ value check (12.3ms)','  AssertionError [ERR_ASSERTION]: expected 1 to be 2',
  '      at TestContext.<anonymous> (app.js:2:10)','ℹ tests 1','ℹ pass 0','ℹ fail 1','✖ failing tests:',''].join('\n');
const issue={number:7,title:'Improve docs',body:'Please improve docs',state:'open',labels:[],url:`https://github.com/${repo}/issues/7`,updatedAt:'2026-10-01T00:00:00.000Z'};
const pr={number:9,title:'Fix value',body:'Update value',state:'open',base:'main',baseSha:base,head:'repair',headSha:head,url:`https://github.com/${repo}/pull/9`,draft:false};
const failures={items:[{id:12,name:'CI',status:'completed',conclusion:'failure',headSha:head,url:`https://github.com/${repo}/actions/runs/12`,createdAt:'2026-10-01T00:00:00.000Z'}],page:1,nextPage:null,hasMore:false};
const diff='diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n';
async function settle(app,client,taskId){
  for(let attempt=0;attempt<500;attempt++){
    for(const task of [app.runtime.getTask(taskId),...app.readSubagentTasks(taskId)]){
      for(const approval of app.runtime.listApprovals({taskId:task.taskId,state:'pending'}).items){
        const original=app.readPendingToolInvocation(task.taskId,approval.approvalId);
        assert.ok(original,'voice/native approval can inspect exact original nested arguments');
        assert.equal(original.argumentsDigest,approval.argumentsDigest);
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      }
    }
    const task=app.runtime.getTask(taskId);if(['succeeded','failed','cancelled'].includes(task.state)&&app.activeTaskCount===0)return task;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic developer workflow did not settle: '+JSON.stringify([app.runtime.getTask(taskId),...app.readSubagentTasks(taskId)]));
}
function fixture(kind,{modelConfigured=true,presence=true,online=true,repairIssue=false,unknownPatch=false,legacyBinding=false,automaticPatch=false,followupPatch=false,locateConfigured=true}={}){
  const locateRoot=mkdtempSync(path.join(os.tmpdir(),'developer-locate-'));locateRoots.push(locateRoot);
  writeFileSync(path.join(locateRoot,'app.js'),'function value(){\n  return 1;\n}\nmodule.exports={value};\n');
  let app,currentHead=head,source='const value = 1;\n',patchInterrupted=false,verifiedRunId,initialWorkerId;const cloud=[],writes=[],modelPayloads=[];
  const provider=new FakeGitHubProvider({'repo.get':{fullName:repo,defaultBranch:'main',private:false,url:`https://github.com/${repo}`},
    'actions.run.list':failures,'actions.job.list':{items:[{id:14,runId:12,name:'test',status:'completed',conclusion:'failure',url:`https://github.com/${repo}/actions/runs/12/job/14`}],page:1,nextPage:null,hasMore:false},
    'actions.log.read':{text:'not ok 1 - value\n',offset:0,nextOffset:null,truncated:false},
    'issue.get':repairIssue?{...issue,title:'Crash on save',body:'Save fails'}:issue,'issue.list':{items:[issue],page:1,nextPage:null,hasMore:false},
    'issue.label':{state:'confirmed',evidenceRefs:[]},'issue.comment':{state:'confirmed',evidenceRefs:[]},
    'pr.get':pr,'pr.diff':{text:diff,offset:0,nextOffset:null,truncated:false},
    'pr.create':{state:'confirmed',externalId:'9',url:pr.url,evidenceRefs:[]},'pr.comment':{state:'confirmed',evidenceRefs:[]},
    'pr.review.comment':{state:'confirmed',evidenceRefs:[]}});
  const tools=[];registerGitHub({register:tool=>{tools.push(tool);return()=>{};}},{provider});
  const synthetic=(name,sideEffect,execute,requiresPresence=false)=>({descriptor:{name,version:'1.0.0',sideEffect,requiresPresence,
    requiredScopes:['synthetic:developer'],inputSchema:{type:'object',properties:{},additionalProperties:true},outputSchema:{type:'object'},idempotencySupport:false,recoverySupport:false},execute});
  tools.push(synthetic('workspace.git.head','read',async()=>({headSha:currentHead,clean:true,workspaceClean:true,fingerprint:'synthetic'})),
    synthetic('workspace.read_text','read',async()=>({path:'app.js',content:source,sha256:sha(source)})),
    synthetic('workspace.preview_text_patch','read',async()=>({path:'app.js',beforeSha256:sha(source),afterSha256:sha('const value = 2;\n'),changed:true,previewText:'const value = 2;\n'})),
    synthetic('workspace.apply_text_patch','local_write',async()=>{writes.push('apply');const before=sha(source);source='const value = 2;\n';
      if(unknownPatch&&!patchInterrupted){patchInterrupted=true;throw Error('Synthetic response lost after apply');}
      return {path:'app.js',applied:true,changed:true,beforeSha256:before,afterSha256:sha(source)};}),
    synthetic('workspace.run_allowed_command','local_write',async(_input,context)=>{verifiedRunId=context.runId;return {recipeId:'check',exitCode:0,stdout:'',stderr:''};}),
    synthetic('workspace.git.commit','local_write',async(input,context)=>{assert.equal(input.verificationRunId,verifiedRunId,'Git consumes the actual original command receipt');
      assert.ok(app.runtime.readToolExecutions(context.taskId).some(record=>record.evidenceId===input.verificationRunId&&record.toolName==='workspace.run_allowed_command'&&record.state==='confirmed'));
      writes.push('commit');currentHead=fixed;return {headSha:fixed,parentSha:head,branch:'repair'};},true),
    synthetic('workspace.git.push','external_write',async()=>{writes.push('push');return {headSha:fixed,pushed:true};},true));
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});tools.unshift(dispatch);
  const response=kind==='code_review'?{findings:[{kind:'suggestion',ruleId:'correctness',path:'app.js',line:1,side:'RIGHT',body:'Check this changed value'}]}
    :kind==='ci_fix'?{diagnosis:'Correct value',patches:[{path:'app.js',expectedSha256:sha(source),edits:[{oldText:'value = 1',newText:'value = 2'}]}]}
      :{kind:'docs',confidence:.95,evidence:[{field:'title',quote:'Improve docs'}]};
  const fix={diagnosis:'Repair save',patches:[{path:'app.js',expectedSha256:sha(source),edits:[{oldText:'value = 1',newText:'value = 2'}]}]};
  const model=new FakeModelProvider(repairIssue?[{kind:'final',text:JSON.stringify({kind:'bug',confidence:.95,evidence:[{field:'title',quote:'Crash on save'}]})},
    {kind:'final',text:JSON.stringify(fix)}]:[{kind:'final',text:JSON.stringify(response)},{kind:'final',text:JSON.stringify(response)}]);
  const complete=model.complete.bind(model);model.complete=input=>{modelPayloads.push(input);return complete(input);};
  const args={repo,...(kind==='ci_fix'?{runId:'12'}:{}),...(['code_review','issue_triage'].includes(kind)?{number:kind==='code_review'?9:7}:{}),
    ...(kind==='code_review'?{publish:true}:{}),...(repairIssue?{repairBug:true}:{}),...(kind==='test_locate'?{output:locateOutput}:{})};
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,coordinationBinding:'synthetic-config',tools,
    hostUserNamespace:'synthetic-dev',workspacePatchReconciliation:{bindingId:'d'.repeat(64),reconcile:async input=>unknownPatch&&input.retainMarker
      ?{path:input.relativePath,state:'reconciled',runId:input.expectedRunId,argumentsDigest:input.expectedArgumentsDigest,
        beforeSha256:sha('const value = 1;\n'),afterSha256:sha('const value = 2;\n'),currentSha256:sha(source),outcome:'applied'}
      :{path:input.relativePath,state:'clear'}},
    isUserPresent:()=>presence,readConversationPreference:()=>({depth:2,fast:false}),
    coordination:{execute:async request=>{cloud.push(request);const task=app.runtime.getTask(request.taskId);
      if(task.conversationId==='user-chat')return {kind:'text',text:'Parent summary of verified workflow receipt',verification:'unverified'};
      if(request.continuation){assert.ok(request.continuation.result.state||request.continuation.result.status);return {kind:'text',text:'Child used confirmed workflow result',verification:'unverified'};}
      initialWorkerId??=request.taskId;
      const originRead=followupPatch&&request.taskId===initialWorkerId;
      const proposal={kind:'tool_proposal',proposalId:'developer-request',toolName:'developer.'+(originRead?'ci_list':kind),toolVersion:'1.0.0',arguments:originRead?{repo}:args,verification:'unverified'};
      if(legacyBinding){const key='developer-workflow:'+sha(JSON.stringify(proposal.proposalId))+':binding';
        if(app.runtime.loadCheckpoint(request.taskId,key)===undefined)app.runtime.saveCheckpoint(request.taskId,key,
          {version:1,bindingId:'synthetic-dev-config',taskId:request.taskId,deadline:request.deadline,proposalRevision:request.revision,
            request:{...args,kind},proposalDigest:sha(JSON.stringify(proposal))});}
      return proposal;}},
    developerWorkflows:{bindingId:'synthetic-dev-config',repositories:[repo],maxSteps:40,maxTokens:64000,
      ...(modelConfigured?{model}:{}),reviewRules:[{id:'correctness',text:'Review correctness of changed lines'}],
      available:()=>online,assertCurrent:()=>{assert.equal(online,true);},authorizeModelRequest:()=>{},projectResult:value=>value,
      failedRunForIssue:()=> '12',
      ...(locateConfigured?{testLocate:{root:locateRoot,contextLines:2}}:{}),
      ciFix:{verifyRecipeId:'check',sourcePaths:['app.js'],headBranch:'repair',baseBranch:'main',gitTools:{head:'workspace.git.head',commit:'workspace.git.commit',
        push:'workspace.git.push',pullRequest:'github.pr.create',backlink:'github.pr.comment'}}},
    automaticTools:tools.filter(tool=>(tool.descriptor.sideEffect==='read'&&!tool.descriptor.requiresPresence)
      ||(automaticPatch&&tool.descriptor.name==='workspace.apply_text_patch'))
      .map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version})),
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'synthetic-only',accepts:()=>true,project:({result})=>result})),
  });
  return {app,cloud,writes,modelPayloads,provider};
}
for(const kind of ['ci_list','issue_list','issue_triage','code_review','ci_fix','test_locate'])test(`public ${kind} workflow executes in the original child, approves nested writes and continues`,async()=>{
  const f=fixture(kind);const client=new Client(f.app);await client.connect();
  try{
    const task=await client.call('task.submit',{goal:'Run developer workflow '+kind,conversationId:'user-chat'},{idempotencyKey:kind,timeoutMs:60000});
    const final=await settle(f.app,client,task.taskId);assert.equal(final.state,'succeeded',JSON.stringify(final.error));
    const children=f.app.readSubagentTasks(task.taskId);assert.equal(children.length,1);assert.equal(children[0].state,'succeeded');
    assert.deepEqual(f.app.runtime.loadCheckpoint(task.taskId,'competition-tool-catalog').entries.map(tool=>tool.name),['subagent.dispatch']);
    const entries=f.app.runtime.loadCheckpoint(children[0].taskId,'competition-tool-catalog').entries;
    assert.ok(entries.some(tool=>tool.name==='developer.'+kind));assert.ok(entries.length<=MAX_AVAILABLE_TOOLS);
    assert.ok(Buffer.byteLength(JSON.stringify(entries))<=MAX_AVAILABLE_TOOLS_JSON_BYTES);
    assert.equal(f.app.readToolConversation(children[0].taskId),'user-chat','identity survives terminal child and parent');
    assert.equal(f.cloud.filter(request=>request.taskId===children[0].taskId).length,2,'pending nested approval does not resend paid proposal');
    if(kind==='ci_fix')assert.deepEqual(f.writes,['apply','commit','push']);
    if(kind==='ci_fix')assert.ok(f.app.runtime.readToolExecutions(children[0].taskId).some(record=>record.evidenceId===f.cloud.find(request=>request.continuation)?.continuation.result.verificationRunId&&record.toolName==='workspace.run_allowed_command'));
    if(['ci_fix','code_review','issue_triage'].includes(kind))assert.equal(f.modelPayloads.length,1);
    if(kind==='test_locate')assert.equal(f.modelPayloads.length,0);
  }finally{f.app.close();}
});
test('test_locate returns deterministic repo frames with snippets and no side effects',async()=>{
  const f=fixture('test_locate');const client=new Client(f.app);await client.connect();
  try{
    const task=await client.call('task.submit',{goal:'Locate the failing test',conversationId:'user-chat'},{idempotencyKey:'test-locate',timeoutMs:60000});
    const final=await settle(f.app,client,task.taskId);assert.equal(final.state,'succeeded',JSON.stringify(final.error));
    const child=f.app.readSubagentTasks(task.taskId)[0];assert.equal(child.state,'succeeded');
    const continuation=f.cloud.filter(request=>request.taskId===child.taskId).find(request=>request.continuation).continuation;
    const report=continuation.result.report;
    assert.equal(continuation.result.state,'succeeded');
    assert.equal(report.totalFailures,1);
    assert.equal(report.failures[0].name,'value check');
    assert.equal(report.failures[0].reporter,'spec');
    assert.equal(report.failures[0].frames[0].file,'app.js');
    assert.equal(report.failures[0].frames[0].line,2);
    assert.match(report.failures[0].frames[0].snippet,/> 2 .*return 1;/);
    assert.ok(report.failures[0].frames[0].confidence>0&&report.failures[0].frames[0].confidence<=1);
    assert.deepEqual(f.writes,[]);
    assert.equal(f.app.runtime.readToolExecutions(child.taskId).length,0,'deterministic parser performs no nested tool runs');
  }finally{f.app.close();}
});
test('test_locate without a trusted composition root stays explicitly unavailable',async()=>{
  const f=fixture('test_locate',{locateConfigured:false});const client=new Client(f.app);await client.connect();
  try{
    const task=await client.call('task.submit',{goal:'Locate the failing test',conversationId:'user-chat'},{idempotencyKey:'test-locate-unconfigured',timeoutMs:60000});
    const final=await settle(f.app,client,task.taskId);
    assert.ok(['succeeded','failed'].includes(final.state),JSON.stringify(final.error));
    const child=f.app.readSubagentTasks(task.taskId)[0];
    const entries=f.app.runtime.loadCheckpoint(child.taskId,'competition-tool-catalog').entries;
    assert.ok(!entries.some(tool=>tool.name==='developer.test_locate'),'unconfigured workflow must stay out of the child catalog');
    assert.ok(!f.cloud.some(request=>request.continuation&&request.continuation.result.report),'no locate report may be exported');
    assert.deepEqual(f.writes,[]);
  }finally{f.app.close();}
});
for(const followupPatch of [false,true])test(`automatic developer patch resumes exact confirmed receipt without manufacturing approval or repeating apply${followupPatch?' in an appended conversation message':''}`,async()=>{
  const f=fixture('ci_fix',{unknownPatch:true,automaticPatch:true,followupPatch}),client=new Client(f.app);await client.connect();
  try{const task=await client.call('task.submit',{goal:'Synthetic automatic patch loses its response',conversationId:'user-chat'},{idempotencyKey:'automatic-ci-replay',timeoutMs:60000});
    let executionTaskId=task.taskId;
    if(followupPatch){
      assert.equal((await settle(f.app,client,task.taskId)).state,'succeeded');
      const [origin]=f.app.readSubagentTasks(task.taskId);assert.equal(origin.state,'succeeded');
      const next=f.app.submitSubagentConversationMessage({parentTaskId:task.taskId,taskId:origin.taskId,text:'Repair CI now',requestId:'automatic-ci-followup',deadline:new Date(Date.now()+60000).toISOString()});
      executionTaskId=next.acceptedTaskId;assert.equal(f.app.readToolConversation(executionTaskId),'user-chat');
      assert.equal(f.app.runtime.loadCheckpoint(executionTaskId,'subtask-parent'),undefined,'appended execution uses its original message binding, not initial-child binding');
    }
    let child;
    for(let attempt=0;attempt<600;attempt++){
      child=followupPatch?f.app.runtime.getTask(executionTaskId):f.app.readSubagentTasks(task.taskId)[0];
      if(child?.state==='waiting_reconciliation'&&f.app.activeTaskCount===0)break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(child.state,'waiting_reconciliation');assert.deepEqual(f.writes,['apply']);
    assert.equal(f.app.runtime.listApprovals({taskId:child.taskId}).items.length,0,'trusted automatic tool creates no fabricated approval');
    const record=f.app.runtime.readToolExecutions(child.taskId).find(record=>record.toolName==='workspace.apply_text_patch');assert.equal(record.state,'unknown');
    assert.equal(f.app.runtime.policy.get(record.evidenceId).usesRemaining,0,'the original routine grant was already consumed');
    assert.equal(f.cloud.filter(request=>request.taskId===child.taskId).length,1);
    const readback=await f.app.reconcileDeveloperWorkflowPatch(child.taskId,record.evidenceId);assert.equal(readback.receipt.runId,record.evidenceId);
    assert.throws(()=>f.app.resumeConfirmedDeveloperWorkflowPatch(child.taskId,{...readback.receipt,arguments:{...readback.receipt.arguments,path:'foreign.js'}}),{code:'UNAUTHORIZED'});
    assert.doesNotThrow(()=>f.app.resumeConfirmedDeveloperWorkflowPatch(child.taskId,readback.receipt),'the exact confirmed automatic run can resume without a pending Approval object');
    assert.equal((await settle(f.app,client,executionTaskId)).state,'succeeded');assert.deepEqual(f.writes,['apply','commit','push']);
    assert.equal(f.app.readToolConversation(child.taskId),'user-chat');
    assert.equal(f.app.runtime.policy.get(record.evidenceId).usesRemaining,0);
    assert.ok(f.app.runtime.listApprovals({taskId:child.taskId}).items.every(approval=>approval.action!=='workspace.apply_text_patch'));
  }finally{f.app.close();}
});
for(const legacyBinding of [false,true])test(`CI confirmed patch replay keeps its original ${legacyBinding?'legacy':'namespaced'} run and verification receipt without a second apply`,async()=>{
  const f=fixture('ci_fix',{unknownPatch:true,legacyBinding}),client=new Client(f.app);await client.connect();
  try{const task=await client.call('task.submit',{goal:'Synthetic repair with lost apply response',conversationId:'user-chat'},{idempotencyKey:'ci-replay',timeoutMs:60000});
    let child;
    for(let attempt=0;attempt<600;attempt++){
      [child]=f.app.readSubagentTasks(task.taskId);
      if(child)for(const approval of f.app.runtime.listApprovals({taskId:child.taskId,state:'pending'}).items){
        const original=f.app.readPendingToolInvocation(child.taskId,approval.approvalId);assert.ok(original);assert.equal(original.argumentsDigest,approval.argumentsDigest);
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      }
      if(child?.state==='waiting_reconciliation'&&f.app.activeTaskCount===0)break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(child.state,'waiting_reconciliation');assert.deepEqual(f.writes,['apply']);
    const record=f.app.runtime.readToolExecutions(child.taskId).find(record=>record.toolName==='workspace.apply_text_patch');
    assert.equal(record.state,'unknown');assert.ok(record.evidenceId.startsWith(child.taskId+':ci-fix:'));assert.ok(record.evidenceId.length<=256);
    const namespace=f.app.runtime.loadCheckpoint(child.taskId,'developer-workflow:'+sha(JSON.stringify('developer-request'))+':run-namespace');
    if(legacyBinding)assert.equal(namespace,'legacy');else assert.match(namespace,/^[a-f0-9]{64}$/);
    assert.equal(f.cloud.filter(request=>request.taskId===child.taskId).length,1,'unknown original proposal cannot solicit a fresh paid proposal');
    const readback=await f.app.reconcileDeveloperWorkflowPatch(child.taskId,record.evidenceId);assert.equal(readback.receipt.runId,record.evidenceId);
    assert.throws(()=>f.app.resumeConfirmedDeveloperWorkflowPatch(child.taskId,{...readback.receipt,runId:child.taskId+':ci-fix:foreign'}),{code:'UNAUTHORIZED'});
    assert.deepEqual(f.writes,['apply']);f.app.resumeConfirmedDeveloperWorkflowPatch(child.taskId,readback.receipt);
    assert.equal((await settle(f.app,client,task.taskId)).state,'succeeded');assert.deepEqual(f.writes,['apply','commit','push']);
    const records=f.app.runtime.readToolExecutions(child.taskId),result=f.cloud.find(request=>request.taskId===child.taskId&&request.continuation)?.continuation.result;
    assert.ok(records.some(record=>record.evidenceId===result.verificationRunId&&record.state==='confirmed'&&record.toolName==='workspace.run_allowed_command'));
    assert.ok(result.evidenceRefs.every(ref=>records.some(record=>record.evidenceId===ref&&record.state==='confirmed')));
  }finally{f.app.close();}
});
test('Issue repair consumes the existing CI workflow with trusted repair goal and publishes one repair PR',async()=>{
  const f=fixture('issue_triage',{repairIssue:true}),client=new Client(f.app);await client.connect();
  try{const task=await client.call('task.submit',{goal:'Repair the save issue',conversationId:'user-chat'},{idempotencyKey:'issue-repair',timeoutMs:60000});
    assert.equal((await settle(f.app,client,task.taskId)).state,'succeeded');assert.deepEqual(f.writes,['apply','commit','push']);
    assert.equal(f.modelPayloads.length,2);assert.equal(f.provider.calls.filter(call=>call.operation==='pr.create').length,1);
    assert.equal(f.provider.calls.filter(call=>call.operation==='issue.comment').length,1);
    const request=f.cloud.find(request=>request.continuation?.result?.state==='repair_requested');assert.ok(request);
  }finally{f.app.close();}
});
test('model-dependent tools stay out of real child catalog without a configured model',async()=>{
  const {app}=fixture('issue_list',{modelConfigured:false});const client=new Client(app);await client.connect();
  try{const task=await client.call('task.submit',{goal:'List issues',conversationId:'user-chat'},{idempotencyKey:'missing-model',timeoutMs:60000});
    await settle(app,client,task.taskId);const [child]=app.readSubagentTasks(task.taskId),entries=app.runtime.loadCheckpoint(child.taskId,'competition-tool-catalog').entries;
    assert.ok(entries.some(tool=>tool.name==='developer.issue_list'));assert.equal(entries.some(tool=>tool.name==='developer.issue_triage'),false);
    const before=app.runtime.loadCheckpoint(task.taskId,'competition-tool-catalog');
    const metadata=app.readConversationToolCapabilities();assert.ok(metadata.some(tool=>tool.name==='github.pr.create'&&tool.requiresPresence));
    assert.deepEqual(app.runtime.loadCheckpoint(task.taskId,'competition-tool-catalog'),before);
  }finally{app.close();}
});
test('follow-up developer publication resumes exact nested approvals and keeps historical UI conversation identity',async()=>{
  const {app}=fixture('code_review'),client=new Client(app);await client.connect();
  try{
    const task=await client.call('task.submit',{goal:'Review changes',conversationId:'user-chat'},{idempotencyKey:'review-origin',timeoutMs:60000});
    assert.equal((await settle(app,client,task.taskId)).state,'succeeded');const [child]=app.readSubagentTasks(task.taskId);
    const next=app.submitSubagentConversationMessage({parentTaskId:task.taskId,taskId:child.taskId,text:'Review again',requestId:'follow-up',deadline:new Date(Date.now()+60000).toISOString()});
    assert.equal(app.readToolConversation(next.acceptedTaskId),'user-chat');
    assert.equal((await settle(app,client,next.acceptedTaskId)).state,'succeeded');
    assert.equal(app.readToolConversation(next.acceptedTaskId),'user-chat');
    const key='subagent-conversation-message:v1',binding=app.runtime.loadCheckpoint(next.acceptedTaskId,key);
    app.runtime.saveCheckpoint(next.acceptedTaskId,key,{...binding,originDigest:'tampered'});
    assert.equal(app.readToolConversation(next.acceptedTaskId),undefined);
  }finally{app.close();}
});
test('Gateway uses only trusted current presence, including direct wire and stale model claims',async()=>{
  for(const present of [false,true]){
    let executions=0;
    const descriptor={name:'fixture.presence',version:'1.0.0',sideEffect:'external_write',requiresPresence:true,
      requiredScopes:['synthetic:write'],inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'},idempotencySupport:false,recoverySupport:false};
    const app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',isUserPresent:()=>present,
      tools:[{descriptor,execute:async()=>{executions++;return {};}}]});
    try{
      const task=app.runtime.submitTask({goal:'Synthetic presence',conversationId:'presence',idempotencyKey:'presence'});
      const deadline=new Date(Date.now()+60000).toISOString();
      app.runtime.policy.grant({authorizationRef:'presence-run',taskId:task.taskId,toolName:descriptor.name,scopes:descriptor.requiredScopes,
        argumentsDigest:toolArgumentsDigest({}),expiresAt:deadline,maxUses:1});
      const result=await app.runtime.runTask(task.taskId,async worker=>{
        await app.tools.invoke({taskId:task.taskId,runId:'presence-run',authorizationRef:'presence-run',toolName:descriptor.name,
          toolVersion:descriptor.version,arguments:{},deadline,signal:worker.signal,userPresent:true});return {resultSummary:'done'};
      },{deadline,sideEffect:'external_write'});
      assert.equal(executions,present?1:0);assert.equal(result.state,present?'succeeded':'failed');
    }finally{app.close();}
  }
});
test('actual public coding/F15/Git/GitHub schemas fit the unchanged complete child catalog budget',async()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'developer-catalog-'));const tools=[];
  registerGitHub({register:tool=>{tools.push(tool);return()=>{};}},{provider:new FakeGitHubProvider({})});
  tools.push(coding.createWorkspaceReadTool({rootPath:root}),coding.createWorkspaceListTool({rootPath:root}),
    coding.createWorkspacePatchPreviewTool({rootPath:root}),coding.createWorkspacePatchStageTool({rootPath:root}),
    coding.createWorkspaceCommandTool({rootPath:root,recipes:[{id:'node-check',executable:process.execPath,args:['--check','app.js']}]}),
    ...Object.values(coding.createGitTools({repository:repo,rootPath:root,sourceBranch:'repair',remoteName:'origin',remoteUrl:`https://github.com/${repo}.git`,
      allowedPaths:['app.js'],authorName:'Synthetic',authorEmail:'synthetic@example.test',readVerification:async()=>undefined})),
    ...coding.createIsolatedCodingRepairTools({}));
  let app;
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools,isUserPresent:()=>true,
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
      publicEnumPaths:tool.descriptor.name==='coding.repair.publish'?['/version']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'synthetic-only',accepts:()=>true,project:()=>({})})),
    developerWorkflows:{bindingId:'synthetic',repositories:[repo],maxSteps:10,maxTokens:1000,model:new FakeModelProvider([]),
      reviewRules:[{id:'rule',text:'Synthetic rule'}],ciFix:{verifyRecipeId:'node-check',sourcePaths:['app.js']},
      available:()=>true,assertCurrent:()=>{},authorizeModelRequest:()=>{},projectResult:()=>({})}});
  try{
    const task=app.runtime.submitTask({goal:'Synthetic catalog',conversationId:'catalog',idempotencyKey:'catalog'}),deadline=new Date(Date.now()+60000).toISOString();
    app.runtime.saveCheckpoint(task.taskId,'application-profile','huawei_ict_agentarts');app.runtime.saveCheckpoint(task.taskId,'application-deadline',deadline);
    const final=await app.runtime.runTask(task.taskId,async worker=>{
      const entries=await app.prepareCompetitionToolCatalog({taskId:task.taskId,deadline,signal:worker.signal});
      assert.ok(entries.length<=MAX_AVAILABLE_TOOLS);const bytes=Buffer.byteLength(JSON.stringify(entries));assert.ok(bytes<=MAX_AVAILABLE_TOOLS_JSON_BYTES);
      assert.equal(entries.find(tool=>tool.name==='coding.repair.patch').inputSchema.properties.patch.additionalProperties,true);
      assert.deepEqual(entries.find(tool=>tool.name==='coding.repair.publish').inputSchema.properties.version.enum,[1]);
      process.stdout.write(`Synthetic public developer catalog: ${entries.length} tools, ${bytes}/${MAX_AVAILABLE_TOOLS_JSON_BYTES} bytes\n`);
      return {resultSummary:'catalog inspected'};
    },{deadline,sideEffect:'read'});
    assert.equal(final.state,'succeeded',JSON.stringify(final.error));
  }finally{app.close();rmSync(root,{recursive:true,force:true});}
});
