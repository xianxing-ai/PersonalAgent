import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeApplication,createDesktopSubagentDispatchTool,OWNED_WORKFLOW_WORKER_TOOL} from '../dist/application.js';

// Synthetic image and workspace; Runtime, Policy, Gateway and host children are real.
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture({configured=true,unknown=false,unknownSource=false,replaceSample=false,denyExport=false,denyFrontier=false}={}) {
  let app;const calls=[],cloud=[],advances=[];
  const caseInput={schemaFile:'schema.json',codeFile:'api.ts',recipeId:'check-api',docTemplate:'template',targetDoc:'docs/api.md',sourceVersion:'fixture-v1'};
  const candidate={version:1,docMarkdown:'# Fixture API',sampleSnippet:'export const example = true;'};
  const decisionArgs=nodeId=>({context:JSON.stringify({workflowId:'F20',nodeId,candidateValues:[{id:'synthetic-candidate',value:candidate}]})});
  const tool=(name,sideEffect,properties,required,execute)=>({descriptor:{name,version:'1.0.0',sideEffect,
    requiredScopes:['synthetic:f20'],inputSchema:{type:'object',properties,required,additionalProperties:false},outputSchema:{type:'object'},
    idempotencySupport:false,recoverySupport:false,requiresPresence:false},execute:async(args,context)=>{
      calls.push({name,args,taskId:context.taskId,runId:context.runId});return execute(args,context);}});
  const tools=[tool('workspace.read_text','read',{path:{type:'string'}},['path'],args=>{
    if(unknownSource&&args.path==='api.ts')throw new ProtocolError('RESULT_UNKNOWN','Synthetic source result is unknown');
    return {path:args.path,content:'synthetic'};}),
    tool('decision.choose_candidate','read',{context:{type:'string'}},['context'],()=>({selectedId:'synthetic-candidate'})),
    tool('coding.repair.trial','local_write',{candidateId:{type:'string'},patches:{type:'array',items:{type:'object'}},
      recipeIds:{type:'array',items:{type:'string'}}},
      ['candidateId','patches','recipeIds'],(args,context)=>{
      if(unknown)throw new ProtocolError('RESULT_UNKNOWN','Synthetic trial result is unknown');
      const parent=app.runtime.loadCheckpoint(context.taskId,'coding-repair:parent');
      return {binding:{version:1,taskId:parent.taskId,trialTaskId:context.taskId,candidateId:args.candidateId,artifactId:'fixture-artifact',
        workspaceId:'fixture-workspace',sessionId:'fixture-session',baselineSnapshotId:'fixture-baseline',inputDigest:hash('source'),
        configurationDigest:hash('configuration'),workflowVersion:'fixture-v1',runtimeVersion:'fixture-v1',recipeFingerprint:hash('recipe'),
        artifactDigest:hash('artifact'),parentArtifactDigests:[],executionKind:'synthetic'},
        session:{version:1,sessionId:'fixture-session',taskId:context.taskId,workspaceId:'fixture-workspace',mode:'isolated',baselineSnapshotId:'fixture-baseline'},
        checkReadback:{version:1,sessionId:'fixture-session',snapshot:{snapshotId:'fixture-checked',packages:[],files:[]},verification:[{
          version:1,recipeId:caseInput.recipeId,status:'VALID',exitCode:0,sessionId:'fixture-session',inputSnapshotId:'fixture-checked',
          runId:'fixture-verify',packageIds:[],files:[],evidenceRefs:[context.runId],diagnostics:[]}]}};})];
  tools.unshift(createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,scoped)=>app.runDefaultSubagentWorker(subtask,worker,scoped)}));
  const image={bindingId:'synthetic-f20-image',receiptSecret:async()=> 'synthetic-receipt-secret-at-least-32-chars',advance:async request=>{
    advances.push(request.requestId);const phase=request.checkpoint?Number(request.checkpoint):0;
    const [name,node,args]=phase===0?['workspace.read_text','F20_N01',{path:'schema.json'}]
      :phase===1?['decision.choose_candidate','F20_N02',decisionArgs('F20_N02')]:phase===2?['coding.repair.trial','F20_N03',
        {candidateId:'synthetic-candidate',patches:[{path:'api.ts.f20-sample.ts',expectedSha256:null,edits:[],
          createText:replaceSample?'export const substituted = true;':candidate.sampleSnippet}],recipeIds:['check-api']}]
        :['decision.choose_candidate','F20_N04',decisionArgs('F20_N04')];
    const descriptor=request.availableTools.find(tool=>tool.name===name),operationId=`synthetic-f20-${request.taskId}-${phase}`;
    return {workflowId:'F20',workflowVersion:'1.0.0',checkpoint:String(phase+1),state:phase===4?'settled':'awaiting_host',
      nodes:Object.fromEntries(['F20_N01','F20_N02','F20_N03','F20_N04'].map(id=>[id,{state:id===node&&phase<4?'waiting_receipt':'completed'}])),
      proposals:phase===4?[]:[{kind:'tool_proposal',nodeId:node,operationId,proposalId:operationId,inputDigest:hash(args),
        originControlRevision:0,toolName:name,toolVersion:'1.0.0',toolSchemaDigest:hash(descriptor.inputSchema),arguments:args,
        resourceKeys:[],effect:phase===2?'write':'read'}],unavailable:[]};
  }};
  const ownedWorkflowWorker={image,available:()=>true,assertCurrent:()=>{},assertFrontier:()=>!denyFrontier,authorizeExport:async()=>!denyExport,
    resolveInput:async()=>caseInput,
    verifyCompletion:async({sourceReads,read})=>{
      assert.ok(sourceReads.some(item=>item.confirmed.result.path==='schema.json'));
      assert.ok(sourceReads.some(item=>item.confirmed.result.path==='api.ts'));
      assert.ok(sourceReads.filter(item=>item.confirmed.result.path==='schema.json').some(item=>item.commandId!==read.commandId));
      return {additionalSourceTaskIds:[]};}};
  if(!configured)delete ownedWorkflowWorker.verifyCompletion;
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,hostUserNamespace:'synthetic-f20-owner',
    coordinationBinding:'synthetic-f20-deployment',tools,ownedWorkflowWorker,
    coordination:{execute:async request=>{cloud.push(request);
      if(app.runtime.getTask(request.taskId).conversationId==='user-chat')return {kind:'text',text:'Synthetic parent',verification:'unverified'};
      if(request.continuation)return {kind:'text',text:'Synthetic F20 continuation',verification:'unverified'};
      return {kind:'tool_proposal',proposalId:'f20-synthetic',toolName:OWNED_WORKFLOW_WORKER_TOOL,toolVersion:'1.0.0',
        arguments:{workflowId:'F20',inputRef:'registered-case'},verification:'unverified'};}},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))});
  return {app,calls,cloud,advances,caseInput};
}
async function drive(f,client,taskId,{onApproval}={}) {
  for(let attempt=0;attempt<600;attempt++) {
    const tasks=[f.app.runtime.getTask(taskId),...f.app.readSubagentTasks(taskId)];
    for(const task of [...tasks]){const host=f.app.readPendingOwnedWorkflowHostTask(task.taskId);if(host)tasks.push(host);}
    for(const task of tasks)for(const approval of f.app.runtime.listApprovals({taskId:task.taskId,state:'pending'}).items) {
      await onApproval?.(task,approval);
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    }
    const [child]=f.app.readSubagentTasks(taskId);
    if(child&&f.app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))return child;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Synthetic F20 did not settle: '+JSON.stringify(f.app.runtime.listTasks({limit:30}).items));
}
async function submit(f){const client=new Client(f.app);await client.connect();const task=await client.call('task.submit',
  {goal:'Use F20 for the synthetic case',conversationId:'user-chat'},{idempotencyKey:'synthetic-f20-runtime',timeoutMs:60000});return {client,task};}
test('actual Runtime reads both sources and resumes original graph host approvals',async()=>{
  const f=fixture(),{client,task}=await submit(f);try{
    const child=await drive(f,client,task.taskId);
    assert.equal(child.state,'succeeded',JSON.stringify(child.error));
    assert.deepEqual(f.calls.map(call=>call.name),['workspace.read_text','workspace.read_text','workspace.read_text',
      'decision.choose_candidate','coding.repair.trial','decision.choose_candidate']);
    assert.deepEqual(f.calls.slice(0,2).map(call=>call.args.path),['schema.json','api.ts']);
    assert.ok(f.cloud.some(request=>request.taskId===child.taskId&&request.availableTools?.some(tool=>tool.name===OWNED_WORKFLOW_WORKER_TOOL)));
    assert.ok(f.cloud.some(request=>request.taskId===child.taskId&&request.continuation?.result?.published===false));
    assert.equal(f.advances.length,5);assert.equal(f.app.readSubagentTasks(child.taskId).length,0);
  }finally{f.app.close();}
});
test('missing F20 provider is not advertised in Runtime catalog',async()=>{
  const f=fixture({configured:false}),{client,task}=await submit(f);try{
    const child=await drive(f,client,task.taskId);
    assert.equal(child.state,'failed');assert.equal(f.advances.length,0);assert.equal(f.calls.length,0);
    assert.ok(f.cloud.filter(request=>request.taskId===child.taskId).every(request=>!request.availableTools?.some(tool=>tool.name===OWNED_WORKFLOW_WORKER_TOOL)));
  }finally{f.app.close();}
});

test('a substituted sample never reaches the trial even after the original source and candidate approvals',async()=>{
  const f=fixture({replaceSample:true}),{client,task}=await submit(f);try{
    const child=await drive(f,client,task.taskId);
    assert.equal(child.state,'failed');assert.equal(child.error.code,'UNAUTHORIZED');
    assert.equal(f.calls.filter(call=>call.name==='coding.repair.trial').length,0);
  }finally{f.app.close();}
});

test('explicit export and frontier denials cannot be treated as successful guards',async()=>{
  for(const options of [{denyExport:true},{denyFrontier:true}]){
    const f=fixture(options),{client,task}=await submit(f);try{
      const child=await drive(f,client,task.taskId);
      assert.equal(child.state,'failed');assert.equal(child.error.code,'UNAUTHORIZED');
      assert.equal(f.calls.filter(call=>call.name==='coding.repair.trial').length,0);
      if(options.denyExport)assert.equal(f.advances.length,0);
    }finally{f.app.close();}
  }
});
test('unknown original F20 command is not replayed',async()=>{
  const f=fixture({unknown:true}),{client,task}=await submit(f);try{
    const child=await drive(f,client,task.taskId);assert.equal(child.state,'waiting_reconciliation');
    assert.equal(f.calls.filter(call=>call.name==='coding.repair.trial').length,1);
    assert.throws(()=>f.app.resumeTask(child.taskId),{code:'RESULT_UNKNOWN'});
    assert.equal(f.calls.filter(call=>call.name==='coding.repair.trial').length,1);
  }finally{f.app.close();}
});
test('unknown second source stays on its original HostTask and the image does not advance',async()=>{
  const f=fixture({unknownSource:true}),{client,task}=await submit(f);try{
    const child=await drive(f,client,task.taskId);assert.equal(child.state,'waiting_reconciliation');
    assert.deepEqual(f.calls.map(call=>call.args.path),['schema.json','api.ts']);
    assert.equal(f.advances.length,0);const original=f.app.readPendingOwnedWorkflowHostTask(child.taskId);
    assert.ok(original);assert.equal(original.state,'waiting_reconciliation');
    assert.throws(()=>f.app.resumeTask(child.taskId),{code:'RESULT_UNKNOWN'});
    assert.equal(f.app.readPendingOwnedWorkflowHostTask(child.taskId).taskId,original.taskId);
    assert.equal(f.calls.filter(call=>call.args.path==='api.ts').length,1);
  }finally{f.app.close();}
});
test('a Synthetic trusted readback resumes the held original worker without replaying its unknown source',async()=>{
  const f=fixture({unknownSource:true}),{client,task}=await submit(f);try{
    const held=await drive(f,client,task.taskId);assert.equal(held.state,'waiting_reconciliation');
    const host=f.app.readPendingOwnedWorkflowHostTask(held.taskId);assert.equal(host.state,'waiting_reconciliation');
    // This is a Synthetic adapter observation applied to the original Runtime run;
    // it is not evidence that a production readback adapter exists.
    const result={path:'api.ts',content:'synthetic'};
    const confirmed=f.app.runtime.reconcileToolExecution(host.taskId,'host-tool-'+host.taskId,'applied',result);
    assert.equal(confirmed.state,'succeeded');
    f.app.resumeTask(held.taskId);
    const completed=await drive(f,client,task.taskId);
    assert.equal(completed.state,'succeeded',JSON.stringify(completed.error));
    assert.equal(f.calls.filter(call=>call.args.path==='api.ts').length,1);
    assert.equal(f.advances.length,5);
  }finally{f.app.close();}
});
test('changing the fixed case while the first source approval is pending cannot widen the next read',async()=>{
  const f=fixture(),{client,task}=await submit(f);let changed=false;
  try{
    const child=await drive(f,client,task.taskId,{onApproval:async(current,approval)=>{
      if(!changed&&current.conversationId?.startsWith('host-tool:')&&approval.action==='workspace.read_text'){
        changed=true;f.caseInput.codeFile='replacement.ts';
      }
    }});
    assert.equal(changed,true);assert.equal(child.state,'failed');assert.equal(child.error.code,'REVISION_CONFLICT');
    assert.deepEqual(f.calls.map(call=>call.args.path),['schema.json']);assert.equal(f.advances.length,0);
  }finally{f.app.close();}
});
