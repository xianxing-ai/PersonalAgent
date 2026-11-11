import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createRuntimeApplication,createReadonlyMcpHost} from '../dist/application.js';

test('official MCP read passes original SQLite approval once and Skill recovery only reuses confirmed Evidence',async()=>{
  const root=path.resolve('.cache/reference-skill-application',randomUUID());mkdirSync(root,{recursive:true});
  writeFileSync(path.join(root,'reference.md'),'Public synthetic reference.\nSecond synthetic line.\n');
  const mcp=createReadonlyMcpHost({rootPath:root,nodeExecutable:process.execPath,enabled:true});
  let app,calls=0,interrupt=false;
  try {
    await mcp.start({signal:new AbortController().signal,deadline:new Date(Date.now()+15000).toISOString()});
    const tool={...mcp.tools[0],execute:async(...args)=>{calls++;return mcp.tools[0].execute(...args);}};
    app=createRuntimeApplication({path:path.join(root,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-reference',tools:[tool],riskAutonomy:false,
      coordination:new FakeCoordinationPort(()=>({kind:'text',text:'unused',verification:'mock'}))});
    app.configureReferenceSkill({enabled:true,isToolAvailable:()=>mcp.health().connected,currentConfigurationRef:()=> 'synthetic-config-1',
      assertDispatchBinding(taskId){if(interrupt && calls===1){interrupt=false;app.runtime.transitionTask(taskId,'waiting_reconciliation');throw Error('Synthetic interruption after the confirmed read');}}});
    const client=new Client(app,Date.now);await client.connect();
    const manifest=app.referenceSkillSnapshot().manifest;
    const task=app.submitReferenceSkillTask({skillId:manifest.id,version:manifest.version,digest:manifest.digest,path:'reference.md',idempotencyKey:'synthetic-1',deadline:new Date(Date.now()+60000).toISOString()});
    for(let i=0;i<100 && app.activeTaskCount;i++) await new Promise(r=>setTimeout(r,5));
    assert.equal(app.runtime.getTask(task.taskId).state,'waiting_approval');assert.equal(calls,0);
    const runId=`skill-read-${task.taskId}-${manifest.digest.slice(0,16)}`;
    const approval=app.runtime.getApproval(runId);interrupt=true;
    await client.call('authorization.respond',{approvalId:runId,expectedRevision:approval.revision,decision:'allow_once'});
    for(let i=0;i<100 && app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(calls,1);assert.equal(app.runtime.getTask(task.taskId).state,'waiting_reconciliation');
    const record=app.runtime.readToolExecutions(task.taskId).find(r=>r.evidenceId===runId);
    assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);
    const recovered=await app.reconcileReferenceSkillTask(task.taskId);
    assert.equal(recovered.state,'succeeded');assert.match(recovered.resultSummary,/Public synthetic reference/);
    assert.ok(recovered.evidenceRefs.includes(runId));assert.equal(calls,1);
    assert.equal(app.runtime.loadCheckpoint(task.taskId,'skill:workspace-reference-summary:v1').phase,'complete');
    await assert.rejects(app.reconcileReferenceSkillTask(task.taskId),{code:'REVISION_CONFLICT'});assert.equal(calls,1);
  } finally {app?.close();await mcp.dispose();rmSync(root,{recursive:true,force:true});}
});

test('enabled routine reference read uses the current scope without another approval',async()=>{
  const root=path.resolve('.cache/reference-skill-application',randomUUID());mkdirSync(root,{recursive:true});
  writeFileSync(path.join(root,'reference.md'),'Public routine reference.\n');
  const mcp=createReadonlyMcpHost({rootPath:root,nodeExecutable:process.execPath,enabled:true});
  let app,calls=0;
  try {
    await mcp.start({signal:new AbortController().signal,deadline:new Date(Date.now()+15000).toISOString()});
    const tool={...mcp.tools[0],execute:async(...args)=>{calls++;assert.equal(mcp.health().connected,true);return mcp.tools[0].execute(...args);}};
    app=createRuntimeApplication({path:path.join(root,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-routine',tools:[tool],
      automaticTools:[{toolName:'mcp.workspace.read_text',toolVersion:'1.0.0'}],
      coordination:new FakeCoordinationPort(()=>({kind:'text',text:'unused',verification:'mock'}))});
    app.configureReferenceSkill({enabled:true,isToolAvailable:()=>mcp.health().connected,currentConfigurationRef:()=> 'synthetic-config-1'});
    const manifest=app.referenceSkillSnapshot().manifest;
    const task=app.submitReferenceSkillTask({skillId:manifest.id,version:manifest.version,digest:manifest.digest,path:'reference.md',idempotencyKey:'routine-1',deadline:new Date(Date.now()+60000).toISOString()});
    for(let i=0;i<100 && app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(calls,1);
    const record=app.runtime.readToolExecutions(task.taskId)[0];assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');
    assert.ok(app.runtime.getTask(task.taskId).evidenceRefs.includes(record.evidenceId));
    app.setReferenceSkillEnabled(false);
    const disabled=app.submitReferenceSkillTask({skillId:manifest.id,version:manifest.version,digest:manifest.digest,path:'reference.md',idempotencyKey:'routine-disabled',deadline:new Date(Date.now()+60000).toISOString()});
    for(let i=0;i<100 && app.activeTaskCount;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(app.runtime.getTask(disabled.taskId).state,'failed');assert.equal(calls,1);
  } finally {app?.close();await mcp.dispose();rmSync(root,{recursive:true,force:true});}
});
