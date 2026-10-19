import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,lstatSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {Client} from '@personal-agent/client';
import {validateToolValue,ProtocolError} from '@personal-agent/contracts';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createWorkspaceReadTool,createWorkspacePatchPreviewTool,createWorkspaceCommandTool} from '@personal-agent/coding-tools';
import {createRuntimeApplication,createDesktopSubagentDispatchTool} from '@personal-agent/runtime/application';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';
import {Conversations} from '../electron/conversations.js';
import {createConversationToolAccess} from '../electron/conversation-tool-access.js';

const sha=text=>createHash('sha256').update(text).digest('hex');
const geometry=text=>text.replace(/\bbegin="[^"]*"/g,'begin="TIMING-ONLY"');
const terminal=task=>['succeeded','failed','cancelled'].includes(task.state);
async function until(predicate){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Pelican fixture did not reach the expected Runtime state');}

test('Local/Synthetic conversation delegates Pelican read→preview→fixture CAS→real Node verification with original approvals and Evidence',async t=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'pa-conversation-pelican-'));
  const workspace=path.join(directory,'workspace');
  mkdirSync(workspace);
  const fixtureName='pelican-animation.svg',fixturePath=path.join(workspace,fixtureName);
  const original=readFileSync(fileURLToPath(new URL('../../../tests/manual/agentarts/fixtures/pelican-animation-bug.svg',import.meta.url)),'utf8');
  assert.equal([...original.matchAll(/\bbegin="indefinite"/g)].length,3);
  const geometrySha256=sha(geometry(original));writeFileSync(fixturePath,original,{flag:'wx'});
  let app,childId,plan,previewResult,currentAvailable=[];
  const proposals=[],executions=[],approvals=[],modelRequests=[],modelErrors=[];
  const conversations=new Conversations();const conversationId=conversations.activeConversationId('panel');
  t.after(async()=>{if(app){await until(()=>app.activeTaskCount===0);app.close();}rmSync(directory,{recursive:true,force:true});});
  const observeExecution=(tool)=>({...tool,execute:async(input,context)=>{
    const record=app.runtime.readToolExecutions(context.taskId).find(item=>item.evidenceId===context.runId);
    assert.equal(record?.policyDecision,'allow');assert.equal(record?.executionStarted,true);
    assert.equal(record?.state,'started');assert.equal(context.taskId,childId);
    assert.equal(app.runtime.matchesToolExecutionInput(record,{arguments:input,scopeRef:context.authorizationRef}),true);
    const result=await tool.execute(input,context);executions.push({toolName:tool.descriptor.name,taskId:context.taskId,runId:context.runId,result});return result;
  }});
  const read=observeExecution(createWorkspaceReadTool({rootPath:workspace}));
  const preview=observeExecution(createWorkspacePatchPreviewTool({rootPath:workspace}));
  const syntheticCas=observeExecution({descriptor:{name:'workspace.synthetic_cas_apply',version:'1.0.0',
    inputSchema:{type:'object',required:['path','expectedSha256','expectedAfterSha256','content'],additionalProperties:false,
      properties:{path:{const:fixtureName},expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},expectedAfterSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},content:{type:'string',maxLength:16000}}},
    outputSchema:{type:'object',required:['verification','path','beforeSha256','afterSha256','readbackMatched'],additionalProperties:false,
      properties:{verification:{const:'synthetic-fixture-cas'},path:{const:fixtureName},beforeSha256:{type:'string'},afterSha256:{type:'string'},readbackMatched:{const:true}}},
    sideEffect:'local_write',requiredScopes:['fixture:pelican:write'],requiresPresence:false,idempotencySupport:false,recoverySupport:false},
    async execute(input,context){
      if(context.signal.aborted||Date.now()>=Date.parse(context.deadline))throw new ProtocolError('CANCELLED','Synthetic fixture write cancelled');
      if(input.path!==fixtureName||!lstatSync(fixturePath).isFile()||lstatSync(fixturePath).isSymbolicLink())throw new ProtocolError('INVALID_ARGUMENT','Synthetic fixture path changed');
      const before=readFileSync(fixturePath,'utf8');
      if(sha(before)!==input.expectedSha256||sha(input.content)!==input.expectedAfterSha256||sha(geometry(input.content))!==geometrySha256)throw new ProtocolError('REVISION_CONFLICT','Synthetic fixture CAS or geometry check failed');
      // Explicit test-only, synchronous CAS on this private temporary public fixture.
      // This never substitutes for the production Windows native patch implementation.
      writeFileSync(fixturePath,input.content);
      const after=readFileSync(fixturePath,'utf8');assert.equal(after,input.content);
      return {verification:'synthetic-fixture-cas',path:fixtureName,beforeSha256:sha(before),afterSha256:sha(after),readbackMatched:true};
    }});
  const verifier=`const assert=require('node:assert/strict');const fs=require('node:fs');const crypto=require('node:crypto');const text=fs.readFileSync(${JSON.stringify(fixtureName)},'utf8');const animations=[...text.matchAll(/<animateTransform\\b[^>]*>/g)];assert.equal(animations.length,3);assert.deepEqual(animations.map(match=>/\\bbegin="([^"]*)"/.exec(match[0])[1]),['0s','0s','0s']);const normalized=text.replace(/\\bbegin="[^"]*"/g,'begin="TIMING-ONLY"');assert.equal(crypto.createHash('sha256').update(normalized).digest('hex'),${JSON.stringify(geometrySha256)});process.stdout.write(JSON.stringify({verification:'real-local-node',animationCount:3,begins:['0s','0s','0s'],geometryPreserved:true}));`;
  const command=observeExecution(createWorkspaceCommandTool({rootPath:workspace,maxDurationMs:5000,
    recipes:[{id:'verify-pelican',executable:process.execPath,args:['-e',verifier]}]}));
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(definition,worker,tools)=>app.runDefaultSubagentWorker(definition,worker,tools)});
  const tools=[dispatch,read,preview,syntheticCas,command];
  const propose=(proposalId,toolName,args)=>{
    const published=currentAvailable.find(tool=>tool.name===toolName);
    assert.ok(published,'proposal must use the actual child directory');
    validateToolValue(published.inputSchema,args);
    validateToolValue(tools.find(tool=>tool.descriptor.name===toolName).descriptor.inputSchema,args);
    const proposal={kind:'tool_proposal',proposalId,toolName,toolVersion:'1.0.0',arguments:args,verification:'unverified'};
    proposals.push(structuredClone(proposal));return proposal;
  };
  // An explicit script, not a real model. Unverified proposals exercise the real
  // directory/export/Policy path; the script cannot produce approval responses.
  const coordination=new FakeCoordinationPort(async request=>{
    try{
    const child=app.runtime.loadCheckpoint(request.taskId,'subtask-parent');
    modelRequests.push({taskId:request.taskId,tools:structuredClone(request.availableTools),continuation:request.continuation});
    if(!child){
      assert.ok(request.continuation,'mandatory user-work must finish before the parent script is called');
      assert.equal(request.continuation.result.succeeded,1);assert.equal(request.continuation.result.failed,0);
      assert.equal(app.runtime.getTask(childId).state,'succeeded');
      assert.deepEqual(executions.map(item=>item.toolName),[read.descriptor.name,preview.descriptor.name,syntheticCas.descriptor.name,command.descriptor.name]);
      return {kind:'text',text:'Local/Synthetic Pelican repair: 3 begin=0s; geometry preserved; original child Evidence confirmed.',verification:'mock'};
    }
    childId=request.taskId;assert.equal(child.subtaskId,'user-work');
    if(request.availableTools)currentAvailable=request.availableTools;
    else {assert.ok(request.continuation);assert.deepEqual(app.runtime.loadCheckpoint(childId,'competition-tool-catalog').entries,currentAvailable);}
    const names=currentAvailable.map(tool=>tool.name).sort();
    assert.deepEqual(names,[read,preview,syntheticCas,command].map(tool=>tool.descriptor.name).sort());
    for(const available of currentAvailable){
      const actual=tools.find(tool=>tool.descriptor.name===available.name);
      assert.deepEqual(available.inputSchema.required,actual.descriptor.inputSchema.required);
      assert.deepEqual(Object.keys(available.inputSchema.properties).sort(),Object.keys(actual.descriptor.inputSchema.properties).sort());
      assert.equal(available.inputSchema.additionalProperties,false);
    }
    const continuation=request.continuation;
    if(!continuation)return propose('pelican-read',read.descriptor.name,{path:fixtureName});
    if(continuation.proposalId==='pelican-read'){
      const content=continuation.result.content;assert.equal(content,original);
      const edits=[...content.matchAll(/<animateTransform\b[^>]*>/g)].map(([tag])=>({oldText:tag,newText:tag.replace('begin="indefinite"','begin="0s"')}));
      assert.equal(edits.length,3);plan={path:fixtureName,expectedSha256:sha(content),edits};
      return propose('pelican-preview',preview.descriptor.name,plan);
    }
    if(continuation.proposalId==='pelican-preview'){
      previewResult=continuation.result;assert.equal(previewResult.changed,true);assert.equal(previewResult.beforeSha256,sha(original));
      assert.equal(sha(geometry(previewResult.previewText)),geometrySha256);
      return propose('pelican-apply-synthetic-cas',syntheticCas.descriptor.name,{path:fixtureName,
        expectedSha256:previewResult.beforeSha256,expectedAfterSha256:previewResult.afterSha256,content:previewResult.previewText});
    }
    if(continuation.proposalId==='pelican-apply-synthetic-cas'){
      assert.equal(continuation.result.verification,'synthetic-fixture-cas');assert.equal(continuation.result.readbackMatched,true);
      return propose('pelican-verify-real-node',command.descriptor.name,{recipeId:'verify-pelican'});
    }
    assert.equal(continuation.proposalId,'pelican-verify-real-node');assert.equal(continuation.result.exitCode,0);
    assert.deepEqual(continuation.result.proof,{verification:'real-local-node',animationCount:3,begins:['0s','0s','0s'],geometryPreserved:true});
    return {kind:'text',text:'Local/Synthetic child confirmed public fixture CAS and real local Node verification.',verification:'mock'};
    }catch(error){modelErrors.push(error.message);throw error;}
  });
  app=createRuntimeApplication({path:path.join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,
    coordination,coordinationBinding:'explicit-local-synthetic-pelican-script-v1',competitionMaxSteps:8,tools,
    automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version}],
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',
      publicEnumPaths:['/recipeId','/path','/subtasks/*/role','/subtasks/*/reasoningEffort'],available:()=>true})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'public-pelican-fixture-only-v1',
      accepts:({taskId,arguments:args})=>{
        const task=app.runtime.getTask(taskId),binding=app.runtime.loadCheckpoint(taskId,'subtask-parent');
        return tool===dispatch?task.conversationId===conversationId:binding?.subtaskId==='user-work'&&(!args.path||args.path===fixtureName);
      },project:({result})=>tool===command?{recipeId:result.recipeId,exitCode:result.exitCode,proof:JSON.parse(result.stdout)}:result})),
  });
  const access=createConversationToolAccess({getApplication:()=>app,getConversations:()=>conversations});
  const client=new Client(app);await client.connect();
  const accepted=await client.call('task.submit',{goal:'Fix the public Pelican animation so all three animations start at 0s; preserve every geometry byte and verify using the fixed Node recipe.',conversationId},
    {idempotencyKey:'local-synthetic-pelican-user-turn',timeoutMs:60000});
  conversations.add(accepted.taskId,'panel','Public Pelican fixture repair',conversationId);
  for(let turn=0;turn<8&&!terminal(app.runtime.getTask(accepted.taskId));turn++){
    await until(()=>app.activeTaskCount===0);
    if(terminal(app.runtime.getTask(accepted.taskId)))break;
    const pending=access.readPendingApproval({taskId:accepted.taskId,conversationId,deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal});
    assert.ok(pending,JSON.stringify({message:'same UI must discover original child approval',modelErrors,parent:app.runtime.getTask(accepted.taskId),children:app.readSubagentTasks(accepted.taskId),approvals:app.runtime.listApprovals({state:'pending'}),childId,requests:modelRequests.map(item=>({taskId:item.taskId,names:item.tools?.map(tool=>tool.name)}))}));
    assert.equal(pending.taskId,childId);assert.equal(pending.requestTaskId,accepted.taskId);
    assert.equal(access.readPendingApproval({taskId:accepted.taskId,conversationId:'desktop-workspace',deadline:new Date(Date.now()+60000).toISOString(),signal:new AbortController().signal}),undefined);
    const invocation=app.readPendingToolInvocation(pending.taskId,pending.approvalId);
    assert.equal(toolArgumentsDigest(invocation.arguments),pending.argumentsDigest);
    validateToolValue(tools.find(tool=>tool.descriptor.name===pending.toolName).descriptor.inputSchema,invocation.arguments);
    if(pending.toolName!==command.descriptor.name)assert.equal(readFileSync(fixturePath,'utf8'),original);
    if(pending.toolName===syntheticCas.descriptor.name){
      assert.equal(executions.some(item=>item.toolName===syntheticCas.descriptor.name),false);
      await assert.rejects(client.call('authorization.respond',{approvalId:pending.approvalId,expectedRevision:pending.revision+1,decision:'allow_once'}),{code:'REVISION_CONFLICT'});
      assert.equal(app.runtime.getApproval(pending.approvalId).state,'pending');
      assert.equal(readFileSync(fixturePath,'utf8'),original);
      assert.equal(executions.some(item=>item.toolName===syntheticCas.descriptor.name),false);
    }
    approvals.push({approvalId:pending.approvalId,revision:pending.revision,toolName:pending.toolName,argumentsDigest:pending.argumentsDigest});
    await client.call('authorization.respond',{approvalId:pending.approvalId,expectedRevision:pending.revision,decision:'allow_once'});
  }
  await until(()=>app.activeTaskCount===0);
  const parent=app.runtime.getTask(accepted.taskId),children=app.readSubagentTasks(parent.taskId);
  assert.equal(parent.state,'succeeded');assert.equal(children.length,1);assert.equal(children[0].taskId,childId);assert.equal(children[0].state,'succeeded');
  assert.equal(approvals.length,4);assert.equal(new Set(approvals.map(item=>item.approvalId)).size,4);
  assert.equal(modelRequests.filter(item=>item.taskId===parent.taskId).length,1,'parent never directly reads/writes the workspace');
  assert.equal(modelRequests.length,6);assert.deepEqual(modelErrors,[]);
  assert.deepEqual(proposals.map(item=>item.toolName),[read,preview,syntheticCas,command].map(tool=>tool.descriptor.name));
  const records=app.runtime.readToolExecutions(childId);assert.equal(records.length,4);
  for(const record of records){assert.equal(record.state,'confirmed');assert.equal(record.policyDecision,'allow');assert.equal(record.executionStarted,true);assert.ok(approvals.some(item=>item.approvalId===record.evidenceId));}
  const evidence=app.runtime.readEvidence(childId);assert.equal(evidence.length,4);
  for(const record of records){assert.ok(evidence.some(item=>item.evidenceId===record.evidenceId));assert.ok(parent.evidenceRefs.includes(record.evidenceId));}
  assert.equal(app.runtime.readToolExecutions(parent.taskId)[0].toolName,'subagent.dispatch');
  assert.equal(access.resolveConversation(childId),conversationId);
  const repaired=readFileSync(fixturePath,'utf8');assert.equal(sha(repaired),previewResult.afterSha256);
  assert.equal(sha(geometry(repaired)),geometrySha256);assert.equal([...repaired.matchAll(/\bbegin="0s"/g)].length,3);
  const actualCommand=executions.find(item=>item.toolName===command.descriptor.name).result;
  assert.equal(actualCommand.exitCode,0);assert.equal(JSON.parse(actualCommand.stdout).geometryPreserved,true);
  assert.match(parent.resultSummary,/Local\/Synthetic Pelican repair/);
});
