import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createGitTools,createWorkspaceCommandTool,createWorkspacePatchPreviewTool} from '@personal-agent/coding-tools';
import {createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {register as registerGitHub} from '@personal-agent/github';
import * as publicRuntime from '@personal-agent/runtime/application';
// Root owns the public re-exports; inject the exact built modules until that shared edit lands.
import {createF16CiFailurePorts} from '../../runtime/dist/application/f16-ci-failure-ports.js';
import {createF17ReproductionPorts} from '../../runtime/dist/application/f17-reproduction-ports.js';
import {createF17ConfiguredDriverResolver} from '../../runtime/dist/application/f17-configured-driver.js';
import {createF17ObservedCommandTool} from '../../runtime/dist/application/f17-command-observer.js';
import {createF16HeadReader} from '../../runtime/dist/application/f16-head-reader.js';
import {readF16Source,awaitF16Port} from '../../runtime/dist/application/f16-source-receipts.js';
import {createF16F17WorkflowPorts,F16_F17_CONFIGURATIONS} from '../electron/f16-f17-workflow-ports.js';

const runtimeModule={...publicRuntime,createF16CiFailurePorts,createF17ReproductionPorts,createF17ConfiguredDriverResolver,
  createF17ObservedCommandTool,createF16HeadReader,readF16Source,awaitF16Port};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sleep=()=>new Promise(resolve=>setTimeout(resolve,5));

// Explicit synthetic image/selector/consent and temporary public-shaped repository.
// Commands and Git execute locally; the original configured worker, Policy, bridge and SQLite are real.
async function fixture(t,{workflow='F17',deny,unknownHead=false,denyNestedHead=false,substitute,skipDecision=false,abstain=false,exportMutation,noReview=false,ciFailure=false}={}){
  const cache=resolve('.cache/f16-f17');await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'configured-')),root=join(directory,'workspace');await mkdir(root);
  const sourceText="import test from 'node:test';import assert from 'node:assert/strict';test('original failure',()=>assert.equal(1,2));\n";
  await writeFile(join(root,'failure.test.mjs'),sourceText);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','fixture');git('config','user.name','Synthetic');git('config','user.email','fixture@example.invalid');
  git('add','.');git('commit','-qm','Synthetic failure');git('remote','add','origin','https://github.com/xianxing-ai/PersonalAgent.git');
  const headSha=git('rev-parse','HEAD'),repository='xianxing-ai/PersonalAgent';let app,client,ports,revoked=false;
  const counters={command:0,head:0},exports=[],requests=[],actions=[];
  const patch={path:'failure.test.mjs',expectedSha256:createHash('sha256').update(sourceText).digest('hex'),
    edits:[{oldText:'assert.equal(1,2)',newText:'assert.equal(1,1)'}]};
  const recipe={id:workflow==='F17'?'reproduce':'ci-verify',executable:process.execPath,args:workflow==='F17'?['--test','--test-reporter=tap','failure.test.mjs']:
    ['--input-type=module','-e',"import {execFileSync as run} from 'node:child_process';run(process.execPath,['--test','failure.test.mjs']);run('git',['add','failure.test.mjs']);run('git',['commit','-qm','Synthetic verified patch']);process.stdout.write(JSON.stringify({repository:'xianxing-ai/PersonalAgent',headSha:run('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runId:9,jobId:10}));"]};
  const originalCommand=createWorkspaceCommandTool({rootPath:root,recipes:[recipe]}),commandTool={...originalCommand,
    execute:async(...args)=>{counters.command++;return originalCommand.execute(...args);}};
  const originalGit=createGitTools({repository,rootPath:root,sourceBranch:'fixture',remoteName:'origin',
    remoteUrl:'https://github.com/xianxing-ai/PersonalAgent.git',allowedPaths:['failure.test.mjs'],authorName:'Synthetic',
    authorEmail:'fixture@example.invalid',readVerification:async()=>undefined}).head;
  const gitTool={...originalGit,execute:async(...args)=>{counters.head++;
    if(unknownHead&&counters.head===3)throw new ProtocolError('RESULT_UNKNOWN','Synthetic interrupted HEAD');
    return originalGit.execute(...args);}};
  const decision=createWorkflowDecisionTool({selector:{select:async request=>({selectedId:request.candidates[0].id})}});
  const github=[];
  registerGitHub({register:tool=>{github.push(tool);return ()=>{};}},{provider:{verification:'mock',execute:async(op,input)=>{
    const success=input.status==='success'||input.runId===9,page=items=>({items,page:1,nextPage:null,hasMore:false});
    if(op==='actions.run.list')return page([{id:success?9:7,name:'Synthetic CI',status:'completed',conclusion:success&&!ciFailure?'success':'failure',
      headSha:success?git('rev-parse','HEAD'):headSha,url:'https://github.com/xianxing-ai/PersonalAgent/actions/runs/'+(success?9:7),createdAt:new Date().toISOString()}]);
    if(op==='actions.job.list')return page([{id:success?10:8,runId:input.runId,name:'Synthetic CI job',status:'completed',conclusion:success&&!ciFailure?'success':'failure',
      url:'https://github.com/xianxing-ai/PersonalAgent/actions/runs/'+input.runId+'/job/'+(success?10:8)}]);
    if(op==='actions.log.read')return {text:'Synthetic public CI test failure',offset:0,nextOffset:null,truncated:false};
    throw Error('Synthetic CI supports only read operations');}}});
  const preview=createWorkspacePatchPreviewTool({rootPath:root});
  const patchTool={descriptor:{...preview.descriptor,name:'workspace.apply_text_patch',sideEffect:'local_write',
    outputSchema:{type:'object'},requiredScopes:['workspace:read','workspace:write']},async execute(input,ctx){
      // Explicit synthetic Linux patch adapter, not native Windows acceptance.
      const value=await preview.execute(input,ctx);await writeFile(join(root,value.path),value.previewText);
      return {path:value.path,beforeSha256:value.beforeSha256,afterSha256:value.afterSha256,byteLength:value.byteLength,changed:true,applied:true};}};
  const reviewTool={descriptor:{name:'workflow.host.f16_n04',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},
    outputSchema:{type:'object'},sideEffect:'read',requiredScopes:['workspace:read'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    execute:async()=>({noCheatingDetected:true,patchDigest:hash(patch),reviewRef:'synthetic-review'})};
  const f16TestIntent=noReview?undefined:{tool:reviewTool,available:async()=>true,verifyReceipt:async({review})=>
    review.result.noCheatingDetected===true&&review.result.patchDigest===hash(patch)&&review.readback.task.state==='succeeded'};
  const image={bindingId:'synthetic-'+workflow+'-image',available:async()=>true,receiptSecret:async()=>'synthetic-secret-at-least-32-characters',
    async advance(request){requests.push(request);const index=request.checkpoint?Number(request.checkpoint.split(':')[1])+1:0;
      const sequence=(workflow==='F17'?['F17_N02','F17_N03','F17_N04']:['F16_N01','F16_N02','F16_N03','F16_N04','F16_N05'])
        .filter(node=>!skipDecision||!node.endsWith('_N02'));
      const nodeId=sequence[index],definition=F16_F17_CONFIGURATIONS[workflow],nodes=workflow==='F17'?{F17_N01:{state:'completed'}}:{};
      if(skipDecision)nodes[workflow+'_N02']={state:'completed'};
      sequence.forEach((id,i)=>nodes[id]={state:i<index?'completed':i===index?'waiting_receipt':'pending'});
      if(!nodeId)return {workflowId:workflow,workflowVersion:'1.0.0',checkpoint:'synthetic:'+index,state:'settled',nodes,proposals:[]};
      const toolName=definition.nodes[nodeId],descriptor=[decision,gitTool,patchTool,ports.commandTool,...ports.tools].find(v=>v.descriptor.name===toolName).descriptor;
      const args=toolName==='decision.choose_candidate'?{context:JSON.stringify({workflowId:workflow,nodeId,input:request.input,
        candidateValues:[{id:'locate',value:{legitimateFix:true},...(abstain?{abstain:true}:{})},{id:'defer',value:{legitimateFix:false},abstain:true}]}),
        candidates:[{id:'locate',description:'Locate the original failure'},{id:'defer',description:'Defer diagnosis'}],requestId:request.requestId}:
        ['F17_N03','F16_N05'].includes(nodeId)?{recipeId:request.input.recipeId}:nodeId==='F16_N03'?request.input.patch:{};
      if(substitute&&nodeId==='F17_N03')args.recipeId='substituted';
      const operationId='synthetic-'+nodeId;
      return {workflowId:workflow,workflowVersion:'1.0.0',checkpoint:'synthetic:'+index,state:'awaiting_host',nodes,
        proposals:[{kind:'tool_proposal',nodeId,operationId,proposalId:operationId,originControlRevision:request.controlRevision,
          inputDigest:hash(args),toolSchemaDigest:hash(descriptor.inputSchema),toolName,toolVersion:descriptor.version,
          arguments:args,resourceKeys:[],effect:descriptor.sideEffect==='read'?'read':'write'}]};}};
  async function source(scope,id,toolName,args){
    const request={commandId:'initial-'+id,toolName,toolVersion:'1.0.0',arguments:args,deadline:scope.deadline};
    const prepared=app.prepareHostToolTask(request);
    app.runtime.saveCheckpointOnce(prepared.taskId,'coding-repair:parent',{taskId:scope.taskId,operationId:request.commandId});
    app.runtime.saveCheckpointOnce(scope.taskId,'coding-repair:host:'+request.commandId,{localTaskId:prepared.taskId,request});
    app.finalizeHostToolTask({taskId:prepared.taskId,commandId:request.commandId,arguments:args,expectedTaskRevision:prepared.revision});
    for(let i=0;i<2000;i++){
      const read=app.readHostToolTask(prepared.taskId);if(read.confirmed)return {taskId:prepared.taskId,runId:read.confirmed.runId,
        scopeRef:read.confirmed.runId,toolVersion:read.toolVersion,arguments:args};
      if(['failed','cancelled','waiting_reconciliation'].includes(read.task.state))throw new Error('Initial fixture source failed');await sleep();
    }throw Error('Initial fixture source did not finish');
  }
  const workspace={root,recipes:[recipe],commandTool,available:async()=>true,
    patchReconciliation:{bindingId:hash(root),reconcile:async()=>{throw new ProtocolError('RESULT_UNKNOWN','Synthetic fixture never claims native recovery');}},
    assertCurrent(){if(revoked)throw Error('Synthetic revoked workspace');},
    async readSelection(workflow,scope){
      if(workflow==='F16')return {selectionRef:'fixture',repository,headSha,recipeId:recipe.id,runId:7,jobId:8,patch};
      const key='synthetic:initial-selection',saved=app.runtime.loadCheckpoint(scope.taskId,key);if(saved)return saved;
      const beforeHead=await source(scope,'before','workspace.git.head',{repository});
      const command=await source(scope,'failure','workspace.run_allowed_command',{recipeId:recipe.id});
      const afterHead=await source(scope,'after','workspace.git.head',{repository});
      const selected={selectionRef:'fixture',repository,headSha,recipeId:recipe.id,sourceSessionId:'initial-fixture',initialFailure:{command,beforeHead,afterHead}};
      app.runtime.saveCheckpointOnce(scope.taskId,key,selected);return selected;
    }};
  const authority={available:async()=>true,assertCurrent(){if(revoked)throw Error('Synthetic revoked authority');},
    async authorizeExport(value){exports.push(value);if(exportMutation)await exportMutation({value,app,git,root});return deny!==value.stage;}};
  function open(){
    ports=createF16F17WorkflowPorts({runtimeModule,getApplication:()=>app,images:{[workflow]:image},workspace,authority,
      authorizeExport:authority.authorizeExport,f16TestIntent});
    const tools=[decision,gitTool,patchTool,...github,ports.commandTool,...ports.tools,publicRuntime.createDesktopSubagentDispatchTool({competitionOnly:true,
      getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(task,worker,scoped)=>app.runDefaultSubagentWorker(task,worker,scoped)})];
    app=publicRuntime.createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',delegateUserTasks:true,
      hostUserNamespace:'synthetic-f16-f17-configured',coordinationBinding:'synthetic-deployment',tools,configuredWorkflowWorkers:ports.configuredWorkflowWorkers,
      workspacePatchReconciliation:ports.workspacePatchReconciliation,
      coordination:{execute:async request=>{
        if(app.runtime.getTask(request.taskId).conversationId==='fixture-chat'||request.continuation)
          return {kind:'text',text:'Synthetic configured continuation',verification:'unverified'};
        return {kind:'tool_proposal',proposalId:'fixture-graph',toolName:F16_F17_CONFIGURATIONS[workflow].toolName,toolVersion:'1.0.0',
          arguments:{selectionRef:'fixture'},verification:'unverified'};}},
      competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,available:()=>true,
        publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
      competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'synthetic-v1',
        accepts:()=>true,project:({result})=>result}))});client=new Client(app);
  }
  open();await client.connect();
  t.after(async()=>{for(let i=0;i<500&&app.activeTaskCount;i++)await sleep();app.close();await rm(directory,{recursive:true,force:true});});
  return {get app(){return app;},get ports(){return ports;},counters,exports,requests,actions,git,headSha,
    async run(){
      const submitted=await client.call('task.submit',{goal:'Locate the synthetic failing test',conversationId:'fixture-chat'},
        {idempotencyKey:'fixture-workflow',timeoutMs:120000});let child;
      for(let i=0;i<3000;i++){
        for(const task of app.runtime.listTasks({limit:100}).items)for(const approval of app.runtime.listApprovals({taskId:task.taskId,state:'pending'}).items){
          const denied=denyNestedHead&&app.runtime.loadCheckpoint(task.taskId,'workflow-business-tool:source')
            &&app.runtime.loadCheckpoint(task.taskId,'host-tool-intent')?.toolName==='workspace.git.head';
          await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:denied?'deny':'allow_once'});
        }
        [child]=app.readSubagentTasks(submitted.taskId);
        if(child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state))return child;
        await sleep();
      }throw Error('Configured fixture did not settle: '+JSON.stringify(child));
    },async reopen(){assert.equal(app.activeTaskCount,0);app.close();open();await client.connect();},revoke:()=>{revoked=true;}};
}

test('F16/F17 ports stay absent without real services and F16 requires an independent test intent verifier',()=>{
  assert.equal(createF16F17WorkflowPorts().configuredWorkflowWorkers.length,0);
  assert.ok(Object.isFrozen(F16_F17_CONFIGURATIONS.F17.inputSchema.properties));
});

test('F17 Desktop configuration drives actual worker, two-layer Policy children and ordered real reproduction',async t=>{
  const f=await fixture(t),task=await f.run();assert.equal(task.state,'succeeded',JSON.stringify(task.error));
  assert.equal(f.counters.command,2,'one original failure plus one actual reproduction');assert.equal(f.requests.length,4);
  const tasks=f.app.runtime.listTasks({limit:100}).items,reportTask=tasks.find(v=>f.app.runtime.loadCheckpoint(v.taskId,'f17:failure-report:synthetic-F17_N04'));
  assert.ok(reportTask);const report=f.app.runtime.loadCheckpoint(reportTask.taskId,'f17:failure-report:synthetic-F17_N04');
  assert.equal(report.document.reproduction.headSha,f.headSha);assert.equal(report.report.all6PassResolved,false);assert.ok(report.report.locatedFrameCount);
  const commandTask=report.document.reproduction.command.taskId,observation=f.app.runtime.loadCheckpoint(commandTask,'f17:command-observation');
  assert.ok(observation);assert.equal(observation.beforeHead.provenance.kind,'business');
  assert.equal(observation.beforeHead.provenance.proof.sourceHost.taskId,commandTask);
  assert.ok(f.exports.some(v=>v.stage==='completion'));await f.reopen();assert.equal(f.app.runtime.getTask(task.taskId).state,'succeeded');
  assert.equal(f.counters.command,2);
});

test('F17 unavailable permission and substituted recipe cannot run the graph command',async t=>{
  for(const options of [{deny:'initial'},{substitute:true}]){
    const f=await fixture(t,options),task=await f.run();assert.equal(task.state,'failed',JSON.stringify(task.error));assert.equal(f.counters.command,1);
  }
});

test('F16/F17 require original local dependency receipts even when the image marks a skipped decision completed',async t=>{
  for(const workflow of ['F16','F17']){
    const f=await fixture(t,{workflow,skipDecision:true}),task=await f.run();
    assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');assert.equal(f.counters.command,workflow==='F17'?1:0);
  }
});

test('F16/F17 cannot execute past an original abstaining decision even if the image proposes a command',async t=>{
  for(const workflow of ['F16','F17']){
    const f=await fixture(t,{workflow,abstain:true}),task=await f.run();
    assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');assert.equal(f.counters.command,workflow==='F17'?1:0);
  }
});

test('F17 unknown nested HEAD preserves the original command across SQLite reopen without replay',async t=>{
  const f=await fixture(t,{unknownHead:true}),task=await f.run();assert.equal(task.state,'waiting_reconciliation',JSON.stringify(task.error));
  assert.equal(f.counters.command,1);const original=f.app.readPendingOwnedWorkflowHostTask(task.taskId);assert.ok(original);
  await f.reopen();assert.throws(()=>f.app.resumeTask(task.taskId),{code:'RESULT_UNKNOWN'});
  assert.equal(f.app.readPendingOwnedWorkflowHostTask(task.taskId).taskId,original.taskId);assert.equal(f.counters.command,1);
});

test('F17 completion permission await rechecks the real workspace HEAD',async t=>{
  const f=await fixture(t,{exportMutation:async({value,git})=>{if(value.stage==='completion')git('commit','--allow-empty','-qm','Changed during export');}});
  const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'REVISION_CONFLICT');assert.equal(f.counters.command,2);
});

test('F17 rejects uncommitted source changes after completion consent and does not replay a denied nested read',async t=>{
  const changed=await fixture(t,{exportMutation:async({value,root})=>{
    if(value.stage==='completion')await writeFile(join(root,'failure.test.mjs'),'// changed after the report\n');}});
  const result=await changed.run();assert.equal(result.state,'failed');assert.equal(result.error.code,'REVISION_CONFLICT');
  const denied=await fixture(t,{denyNestedHead:true}),task=await denied.run();
  assert.notEqual(task.state,'succeeded');assert.equal(denied.counters.command,1);assert.equal(denied.exports.some(v=>v.stage==='completion'),false);
});

test('F17 cancellation bounds an uncooperative completion permission callback',async t=>{
  const f=await fixture(t,{exportMutation:async({value,app})=>{
    if(value.stage==='completion'){app.runtime.requestCancel(value.taskId);await new Promise(()=>{});}}});
  const task=await f.run();assert.equal(task.state,'cancelled');assert.equal(f.counters.command,2);
});

test('F16 Desktop configuration verifies original CI children, patch review and a fresh repaired-commit CI readback',async t=>{
  const f=await fixture(t,{workflow:'F16'}),task=await f.run();assert.equal(task.state,'succeeded',JSON.stringify(task.error));
  assert.equal(f.counters.command,1);assert.equal(f.requests.length,6);
  const completion=f.exports.find(value=>value.stage==='completion');assert.ok(completion);
  assert.equal(completion.value.ciStatus,'passed');assert.equal(completion.value.runId,9);assert.notEqual(completion.value.headSha,f.headSha);
  const sourceTasks=f.app.runtime.listTasks({limit:100}).items.filter(task=>f.app.runtime.loadCheckpoint(task.taskId,'workflow-business-tool:source'));
  assert.ok(sourceTasks.length>=8);await f.reopen();assert.equal(f.app.runtime.getTask(task.taskId).state,'succeeded');assert.equal(f.counters.command,1);
});

test('F16 missing real review service stays unavailable and failed repaired CI cannot complete',async t=>{
  const missing=await fixture(t,{workflow:'F16',noReview:true});
  assert.ok(missing.ports.unavailable.includes('f16_test_intent_verifier_unavailable'));
  assert.equal(missing.ports.configuredWorkflowWorkers.length,0);
  const failed=await fixture(t,{workflow:'F16',ciFailure:true}),task=await failed.run();
  assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');assert.equal(failed.counters.command,1);
  assert.equal(failed.exports.some(value=>value.stage==='completion'),false);
});

test('F16 rejects a replaced nested source marker after the original export permission await',async t=>{
  const f=await fixture(t,{workflow:'F16',exportMutation:async({value,app})=>{
    if(value.stage==='receipt'&&value.value?.commitSha){
      const task=app.runtime.listTasks({limit:100}).items.find(item=>app.runtime.loadCheckpoint(item.taskId,'host-tool-intent')?.toolName==='github.actions.log.read');
      const marker=app.runtime.loadCheckpoint(task.taskId,'workflow-business-tool:source');
      app.runtime.saveCheckpoint(task.taskId,'workflow-business-tool:source',{...marker,sourceTaskId:'foreign-source-host'});
    }}});
  const task=await f.run();assert.equal(task.state,'failed');assert.equal(task.error.code,'UNAUTHORIZED');assert.equal(f.counters.command,0);
});
