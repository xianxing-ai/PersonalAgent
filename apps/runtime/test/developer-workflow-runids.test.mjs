import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {FakeModelProvider} from '@personal-agent/models';
import {FakeGitHubProvider,register} from '@personal-agent/github';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {createRuntimeApplication,createDesktopSubagentDispatchTool} from '../dist/application.js';

const repo='synthetic/project',base='c'.repeat(40),diff='diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n';
const pr=number=>({number,title:`Change ${number}`,body:'Synthetic change',state:'open',base:'main',baseSha:base,
  head:'repair-'+number,headSha:(number===9?'a':'b').repeat(40),url:`https://github.com/${repo}/pull/${number}`,draft:false});
async function runSequence(proposals){
  let app,listReads=0;const continuations=[],approvals=[],writes=[],scopes=[];
  const provider=new FakeGitHubProvider({'repo.get':{fullName:repo,defaultBranch:'main',private:false,url:`https://github.com/${repo}`},
    'pr.get':input=>pr(input.number),'pr.diff':{text:diff,offset:0,nextOffset:null,truncated:false},
    'pr.review.comment':input=>{writes.push(input);return {state:'confirmed',externalId:String(writes.length),evidenceRefs:[]};},
    'actions.run.list':input=>{listReads++;return {items:[{id:100+listReads,name:'CI',status:'completed',conclusion:'failure',headSha:'a'.repeat(40),url:`https://github.com/${repo}/actions/runs/${100+listReads}`,createdAt:'2026-10-01T00:00:00.000Z'}],page:input.page??1,nextPage:input.page===1?2:null,hasMore:input.page===1};}});
  const tools=[];register({register:tool=>{tools.push({...tool,execute:async(input,context)=>{scopes.push({taskId:context.taskId,runId:context.runId,name:tool.descriptor.name});return tool.execute(input,context);}});return()=>{};}},{provider});
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(s,w,t)=>app.runDefaultSubagentWorker(s,w,t)});tools.unshift(dispatch);
  const model=new FakeModelProvider([9,10].map(number=>({kind:'final',text:JSON.stringify({findings:[{kind:'suggestion',ruleId:'correctness',path:'app.js',line:1,side:'RIGHT',body:`Inspect PR ${number}`} ]})})));
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,tools,isUserPresent:()=>true,
    competitionMaxSteps:proposals.length+1,readConversationPreference:()=>({depth:2,fast:false}),
    automaticTools:tools.filter(t=>t.descriptor.sideEffect==='read'&&!t.descriptor.requiresPresence).map(t=>({toolName:t.descriptor.name,toolVersion:t.descriptor.version})),
    competitionToolAvailability:tools.map(t=>({toolName:t.descriptor.name,toolVersion:t.descriptor.version,available:()=>true,publicEnumPaths:t===dispatch?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(t=>({toolName:t.descriptor.name,toolVersion:t.descriptor.version,exportPolicyVersion:'synthetic-runids',accepts:()=>true,project:({result})=>result})),
    developerWorkflows:{bindingId:'synthetic-runids',repositories:[repo],maxSteps:20,maxTokens:8000,model,reviewRules:[{id:'correctness',text:'Inspect changed lines'}],available:()=>true,assertCurrent(){},authorizeModelRequest(){},projectResult:value=>value},
    coordination:{execute:async request=>{
      if(app.runtime.getTask(request.taskId).conversationId==='original-ui')return {kind:'text',text:'Synthetic parent summary',verification:'unverified'};
      if(request.continuation)continuations.push(request.continuation);
      const proposal=proposals[continuations.length];return proposal?{kind:'tool_proposal',...proposal,toolVersion:'1.0.0',verification:'unverified'}:{kind:'text',text:'Synthetic sequence completed',verification:'unverified'};
    }}});
  const client=new Client(app);await client.connect();
  try{
    const parent=await client.call('task.submit',{goal:'Synthetic several developer requests in one worker',conversationId:'original-ui'},{idempotencyKey:'runids',timeoutMs:60000});
    for(let i=0;i<1200;i++){
      const [child]=app.readSubagentTasks(parent.taskId);
      if(child)for(const approval of app.runtime.listApprovals({taskId:child.taskId,state:'pending'}).items){
        const original=app.readPendingToolInvocation(child.taskId,approval.approvalId);assert.ok(original);assert.equal(original.argumentsDigest,approval.argumentsDigest);assert.equal(original.argumentsDigest,toolArgumentsDigest(original.arguments));
        approvals.push({approvalId:approval.approvalId,...structuredClone(original)});
        await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
      }
      if(['succeeded','failed'].includes(app.runtime.getTask(parent.taskId).state)&&app.activeTaskCount===0)break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    const [child]=app.readSubagentTasks(parent.taskId);assert.equal(child.state,'succeeded',JSON.stringify(child.error));assert.equal(app.runtime.getTask(parent.taskId).state,'succeeded');
    const records=app.runtime.readToolExecutions(child.taskId);assert.ok(scopes.every(s=>s.taskId===child.taskId));assert.ok(records.every(r=>r.taskId===child.taskId));
    assert.equal(new Set(records.map(r=>r.evidenceId)).size,records.length);assert.ok(records.every(r=>r.evidenceId.length<=256));
    return {provider,continuations,approvals,writes,records,childTaskId:child.taskId,listReads};
  }finally{app.close();}
}
test('two distinct PR reviews publish in the same original child with separate exact approvals and real result evidence',async()=>{
  const result=await runSequence([9,10].map(number=>({proposalId:'review-'+number,toolName:'developer.code_review',arguments:{repo,number,publish:true}})));
  assert.deepEqual(result.continuations.map(c=>c.result.report.number),[9,10]);assert.deepEqual(result.writes.map(w=>w.number),[9,10]);
  assert.equal(result.approvals.length,2);assert.notEqual(result.approvals[0].approvalId,result.approvals[1].approvalId);
  assert.deepEqual(result.approvals.map(a=>a.arguments.number),[9,10]);assert.notEqual(result.approvals[0].argumentsDigest,result.approvals[1].argumentsDigest);
  const first=new Set(result.continuations[0].result.evidenceRefs),second=result.continuations[1].result.evidenceRefs;
  assert.ok(second.every(ref=>!first.has(ref)));assert.ok([...first,...second].every(ref=>result.records.some(r=>r.evidenceId===ref&&r.state==='confirmed')));
});
test('different CI pages and a fresh repeated page each execute in the same child instead of replaying an earlier proposal',async()=>{
  const result=await runSequence([1,2,1].map((page,index)=>({proposalId:'ci-page-'+index,toolName:'developer.ci_list',arguments:{repo,page,perPage:1}})));
  assert.deepEqual(result.continuations.map(c=>c.result.page),[1,2,1]);assert.deepEqual(result.continuations.map(c=>c.result.items[0].id),[101,102,103]);
  assert.equal(result.listReads,3);assert.equal(result.approvals.length,0);assert.equal(result.records.filter(r=>r.toolName==='github.actions.run.list').length,3);
});
