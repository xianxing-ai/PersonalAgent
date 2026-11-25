import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import * as runtimeModule from '@personal-agent/runtime/application';
import {createDesktopEgressHost} from '../electron/egress-host.js';
import {createRemoteRunnerDesktopHost} from '../electron/remote-runner-host.js';
import {createAsyncSubagentHost} from '../electron/async-subagent-host.js';
import {additiveConversationBindings} from '../electron/additive-conversation-tools.js';

const until=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Original task did not settle');};
async function fixture(t,{goal='public fixture',classify=()=> 'public',beforePump=()=>{},watch=false}={}) {
  const directory=mkdtempSync(join(tmpdir(),'runner-egress-')),sent=[],classified=[];
  let app,remote;
  const hostOptions={competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)};
  const asyncHost=createAsyncSubagentHost({runtimeModule,subagentOptions:hostOptions,getGrantedTools:()=>[],getRemoteSubmit:()=>remote.service});
  const duty=runtimeModule.createDeveloperDutyTools({getRuntime:()=>app.runtime});
  const dispatch=runtimeModule.createDesktopSubagentDispatchTool(hostOptions),additional=[...asyncHost.tools,...(watch?duty.tools:[])],tools=[dispatch,...additional];
  const additive=additiveConversationBindings(additional,()=>app.runtime);
  const port=new FakeCoordinationPort(request=>{
    const binding=app.runtime.loadCheckpoint(request.taskId,'subtask-parent');
    if(binding?.subtaskId==='user-work'){
      if(watch&&!app.runtime.findTaskByIdempotencyKey('developer-duty-registry:v1'))
        return {kind:'tool_proposal',proposalId:'watch',toolName:'duty.watch',toolVersion:'1.0.0',verification:'mock',arguments:{repo:'octo/repo'}};
      return app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${binding.parentTaskId}-remote`)?{kind:'text',text:'queued',verification:'mock'}:
        {kind:'tool_proposal',proposalId:'spawn',toolName:'subagent.spawn',toolVersion:'1.0.0',verification:'mock',
          arguments:{subtasks:[{subtaskId:'remote',role:'researcher',goal}]}};
    }
    assert.equal(binding,undefined,'remote rejection must never silently run the child locally');
    return {kind:'text',text:'delegated',verification:'mock'};
  });
  app=runtimeModule.createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',delegateUserTasks:true,coordination:port,
    coordinationBinding:'explicit-fake',tools,automaticTools:[dispatch,...additional.filter(tool=>['subagent.spawn','duty.watch'].includes(tool.descriptor.name))]
      .map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version})),
    competitionToolAvailability:[...additive.availability,{toolName:dispatch.descriptor.name,toolVersion:dispatch.descriptor.version,available:()=>true}],
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,exportPolicyVersion:'fixture',accepts:()=>true,project:({result})=>result}))});
  const egress=createDesktopEgressHost({classifyLocally:scope=>{classified.push(scope);return classify(scope,app);}});
  remote=createRemoteRunnerDesktopHost({runtimeModule,getRuntime:()=>app.runtime,userData:directory,egressHost:egress,
    // Explicit Fake secure storage and SSH process; no credential or network access.
    safeStorage:{encryptString:value=>Buffer.from(value),decryptString:value=>value.toString(),isEncryptionAvailable:()=>true},
    spawn(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{};
      child.stdin.on('data',bytes=>{const job=JSON.parse(bytes.toString());sent.push(job);setImmediate(()=>{
        child.stdout.write(JSON.stringify({v:1,jobId:job.id,idempotencyKey:job.idempotencyKey,kind:job.kind,state:'succeeded',verification:'executed',summary:'fixture remote result'}));child.emit('close',0);});});
      return child;}});
  const hostKey='ssh-ed25519 fixture',proposal=remote.service.propose('add',{name:'fixture',address:'runner.example',port:2222,user:'worker',
    provider:'other',os:'ubuntu',arch:'x86_64',limits:{maxConcurrent:1,maxJobsPerMinute:5},repos:[],enabled:true,
    hostKey,hostKeyFingerprint:createHash('sha256').update(hostKey).digest('hex'),privateKey:'fixture PRIVATE KEY',runnerToken:'fixture-token-0123456789abcdef0123456789abcdef'});
  remote.service.confirm(proposal.proposalId,proposal.digest);
  t.after(()=>{asyncHost.stop();egress.close();app.close();rmSync(directory,{recursive:true,force:true});});
  const client=new Client(app);await client.connect();
  const parent=await client.call('task.submit',{goal:'delegate fixture',conversationId:'original-workspace'},{idempotencyKey:'remote-parent',timeoutMs:60000});
  await until(()=>app.runtime.getTask(parent.taskId).state==='succeeded'&&app.activeTaskCount===0);
  const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-remote`);assert.ok(child);
  beforePump(app,parent,child);
  await asyncHost.pump();
  await until(()=>['succeeded','failed','waiting_reconciliation'].includes(app.runtime.getTask(child.taskId).state)
    &&app.runtime.listTasks({limit:100}).items.every(task=>!app.runtime.isTaskActive(task.taskId)));
  return {app,duty,parent,child:app.runtime.getTask(child.taskId),sent,classified};
}

test('confirmed async authority survives parent completion and exact SSH payload uses the original egress host',async t=>{
  const result=await fixture(t);
  assert.equal(result.child.state,'succeeded');assert.equal(result.sent.length,1);assert.equal(result.classified.length,1);
  const scope=result.classified[0];assert.equal(scope.destination,'ssh://worker@runner.example:2222/');
  const {signature,...message}=result.sent[0];assert.ok(signature);assert.deepEqual(JSON.parse(scope.payload),message);
  assert.equal(message.payload.goal,'public fixture');assert.equal(result.app.runtime.getTask(result.parent.taskId).state,'succeeded');
});

test('remote rejects forbidden payload before classification',async t=>{const result=await fixture(t,{goal:'api_key=fixture-secret-value'});
  assert.equal(result.child.state,'failed');assert.equal(result.sent.length,0);assert.equal(result.classified.length,0);});
test('remote discards a changed original parent epoch without a local fallback',async t=>{
  const result=await fixture(t,{beforePump(app,parent){app.runtime.advanceExecutionEpoch(parent.taskId,{requestId:'replan',reason:'replan'});}});
  assert.equal(result.child.state,'failed');assert.equal(result.sent.length,0);assert.equal(result.classified.length,0);});
test('remote cancellation during exact local confirmation never sends',async t=>{const result=await fixture(t,{classify(scope,app){
  const taskId=JSON.parse(scope.payload).idempotencyKey.slice('remote-subagent:'.length);app.runtime.requestCancel(taskId);return 'public';}});
  assert.notEqual(result.child.state,'succeeded');assert.equal(result.sent.length,0);});

test('canonical duty user-work reaches the real registered watch tool and ordinary children stay denied',async t=>{
  const {app,duty,parent,child}=await fixture(t,{watch:true});assert.equal(child.state,'succeeded');
  const owner=app.runtime.findTaskByIdempotencyKey('developer-duty-registry:v1');
  assert.deepEqual(app.runtime.loadCheckpoint(owner.taskId,'developer-duty-watch:v1'),{repos:['octo/repo']});
  const foreign=app.runtime.submitTask({conversationId:`desktop-subtask:${parent.taskId}`,goal:'foreign',idempotencyKey:'foreign'});
  await assert.rejects(duty.tools.find(tool=>tool.descriptor.name==='duty.watch').execute({repo:'foreign/repo'},
    {taskId:foreign.taskId,runId:'foreign',scopes:['agent:delegate'],authorizationRef:'foreign',signal:new AbortController().signal,
      deadline:new Date(Date.now()+10000).toISOString()}),{code:'UNAUTHORIZED'});
});
