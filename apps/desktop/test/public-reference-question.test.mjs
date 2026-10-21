import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicReferenceQuestionConsent} from '../electron/public-reference-question.js';

// Explicit host-port Fakes; these do not establish Runtime, model or native source acceptance.
function fixture(coding=false){
  const deadline=new Date(Date.now()+60000).toISOString(),signal=new AbortController().signal,calls=[];
  let current=true;
  const original={taskId:coding?'local':'task',runId:'run',proposalId:'proposal',toolName:coding?'coding.repair.read':'workspace.read_text',
    toolVersion:'1.0.0',arguments:{path:'public.md'},deadline,argumentsDigest:'a'.repeat(64)};
  const question=Object.fromEntries(['prepare','prepareExport','currentRequirement','assertConsumedResult','authorizeConsumedExport']
    .map(name=>[name,(...args)=>calls.push([name,...args])]));
  const confirm=createPublicReferenceQuestionConsent({question,confirmApplicationAuthorization:async(...args)=>{calls.push(['intent',...args]);return true;},
    readMcpDescriptor:()=>undefined,readSkillManifest:()=>({id:'workspace-reference-summary',version:'1.0.0',digest:'b'.repeat(64)}),
    readOriginalScope:(task,run,completed)=>task===original.taskId&&(run===undefined||run===original.runId)&&completed===coding?structuredClone(original):undefined,
    isCurrent:()=>current});
  const context={deadline,signal,...(coding?{authorization:{taskId:'local',runId:'run'},result:{content:'public'}}:{runId:'run'})};
  const request={phase:'preflight',query:{taskId:'task',proposalId:'proposal',path:'public.md',configurationRef:'configuration'},
    toolName:original.toolName,maxExportBytes:1024,purpose:'coding-reference',expiresAt:deadline,
    ...(coding?{readTaskId:'local',readRunId:'run'}:{})};
  return {confirm,context,request,calls,original,stale:()=>{current=false;}};
}
test('PUBLIC read prepares the original card and confirmed receipt consumes the same requirements',async()=>{
  const f=fixture();assert.equal(await f.confirm(f.request,f.context),true);
  assert.deepEqual(f.calls.map(value=>value[0]),['prepare','prepareExport']);
  assert.equal(f.calls[0][2].requirements[0].requirementId,'public-reference-read');
  assert.equal(f.calls[1][2].requirementId,'public-reference-export');
  assert.equal(await f.confirm({...f.request,phase:'confirmed',contentDigest:'c'.repeat(64),byteLength:17},f.context),true);
  assert.deepEqual(f.calls.slice(2).map(value=>[value[0],value[2]]),[['currentRequirement','public-reference-read'],['currentRequirement','public-reference-export']]);
});
test('changed task/proposal/path scope, oversize and stale requests receive no requirement',async()=>{
  for(const change of [{query:{taskId:'other'}},{query:{proposalId:'other'}},{query:{path:'other.md'}},{toolName:'mcp.workspace.read_text'},{maxExportBytes:262145}]){
    const f=fixture(),request={...f.request,...change,query:{...f.request.query,...change.query}};
    assert.equal(await f.confirm(request,f.context),false);assert.equal(f.calls.length,0);
  }
  const f=fixture();f.stale();assert.equal(await f.confirm(f.request,f.context),false);assert.equal(f.calls.length,0);
});
test('completed local coding read uses trusted task/run mapping and pre-existing export receipt only',async()=>{
  const f=fixture(true);assert.equal(await f.confirm(f.request,f.context),true);
  assert.equal(await f.confirm({...f.request,phase:'confirmed',contentDigest:'c'.repeat(64),byteLength:17},f.context),true);
  assert.deepEqual(f.calls.map(value=>value[0]),['assertConsumedResult','assertConsumedResult','authorizeConsumedExport']);
  assert.equal(f.calls[2][3],'public-reference-export');assert.deepEqual(f.calls[2][2],f.context.result);
  for(const change of [{readTaskId:'worker'},{readRunId:'other'}])assert.equal(await f.confirm({...f.request,...change},f.context),false);
  assert.equal(await f.confirm({...f.request,query:{...f.request.query,path:'private.md'}},f.context),false);
});
test('only exact static Skill tuple is public without an intent; altered catalog uses original-task intent',async()=>{
  const f=fixture(),request={phase:'catalog',query:f.request.query,catalogKind:'skill',expiresAt:f.context.deadline,
    publicParameters:{skillId:'workspace-reference-summary',version:'1.0.0',digest:'b'.repeat(64)}};
  assert.equal(await f.confirm(request,f.context),true);assert.equal(f.calls.length,0);
  assert.equal(await f.confirm({...request,publicParameters:{...request.publicParameters,privatePath:'private.md'}},f.context),true);
  assert.equal(f.calls[0][0],'intent');assert.equal(f.calls[0][1],'reference.catalog');
});
