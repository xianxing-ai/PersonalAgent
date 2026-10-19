import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {createSystemObservationTool} from '@personal-agent/windows-client';
import {createAgentArtsRuntimeApplication,createRuntimeApplication,createRuntimeSubagentDispatchTool} from '@personal-agent/runtime/application';
import {createSystemObservationConversation} from '../electron/system-observation-conversation.js';

const until=async predicate=>{for(let n=0;n<600;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Observation conversation did not settle');};
function injectedTool() {
  let count=0;
  const tool=createSystemObservationTool({sampleWindowMs:5,probe:{cpuTimes:()=>[{user:100+(++count)*80,nice:0,sys:0,idle:100+count*20,irq:0}],
    totalMemoryBytes:()=>1000,freeMemoryBytes:()=>400,uptimeSeconds:()=>120}});
  return {tool,reads:()=>count};
}
async function scenario({realLocal=false,delegated=false,decision=true,configured=true,closeAtPrompt=false}={}) {
  const fixture=realLocal?{tool:createSystemObservationTool(),reads:()=>undefined}:injectedTool();
  const {tool}=fixture,requests=[],confirmations=[],approvals=new Set();let app,host,confirmationTask;
  const conversationId='desktop-panel:22222222-2222-4222-8222-222222222222';
  host=createSystemObservationConversation({tool,getApplication:()=>app,resolveUserConversation:id=>{
    const task=app?.runtime.getTask(id);return app?.readDelegatedUserTaskParent(id)?.conversationId??task?.conversationId;
  },...(configured?{confirmExport:async scope=>{
    confirmationTask=scope.taskId;confirmations.push(scope);
    assert.equal(scope.kind,'system_observation');assert.equal(scope.conversationId,conversationId);
    assert.equal(scope.payload.source,realLocal?'node:os':'injected');assert.equal(scope.signal.aborted,false);
    if(closeAtPrompt){host.close();return new Promise(()=>{});}
    return decision;
  }}:{})});
  assert.equal(host.tools[0],tool,'Reuses the original RegisteredTool object');
  const dispatch=createRuntimeSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  app=createAgentArtsRuntimeApplication({path:':memory:',hostUserNamespace:'synthetic-system-observation',
    gatewayUrl:'https://synthetic-observation.invalid',runtimeName:'synthetic-no-cloud',
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',competitionMaxSteps:4,
    ...(delegated?{delegateUserTasks:true}:{}),tools:[tool,...(delegated?[dispatch]:[])],
    competitionToolAvailability:[...host.competitionToolAvailability,...(delegated?[{toolName:'subagent.dispatch',toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:['/subtasks/*/role','/subtasks/*/reasoningEffort']}]:[])],
    competitionToolExports:[...host.competitionToolExports,...(delegated?[{toolName:'subagent.dispatch',toolVersion:'1.0.0',
      exportPolicyVersion:'synthetic-system-summary',accepts:()=>true,project:({result})=>({total:result.total,summary:result.summary})}]:[])],
    authorizationProvider:{read:async()=>'Bearer synthetic-never-sent'},
    fetchImpl:async(_url,init)=>{
      // Explicit in-process model transport. No outbound request is made, including the node:os case.
      const query=JSON.parse(JSON.parse(init.body).query);requests.push(query);
      if(query.continuation?.proposalId==='synthetic-system-observe') {
        const policy=host.competitionToolExports[0],scope=confirmations.at(-1);
        const base={taskId:confirmationTask,proposalId:scope.proposalId,arguments:{},phase:'final',signal:scope.signal};
        assert.equal(policy.accepts({...base,projection:query.continuation.result}),true);
        assert.equal(policy.accepts({...base,projection:{...query.continuation.result,uptimeSeconds:0}}),false);
      }
      const value=query.continuation?{kind:'text',text:'Synthetic observation received; unavailable metrics remain unavailable'}
        :{kind:'tool_proposal',proposalId:'synthetic-system-observe',toolName:'computer.system.observe',toolVersion:'1.0.0',arguments:{}};
      return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(value)}},{event:'task_end'},{event:'end'}]),
        {headers:{'content-type':'application/json'}});
    }});
  try {
    assert.equal(fixture.reads(),realLocal?undefined:0,'Construction does not sample');
    const client=new Client(app);await client.connect();
    const {taskId}=await client.call('task.submit',{conversationId,goal:'Observe CPU, memory and uptime once'},
      {idempotencyKey:'synthetic-system-observation'});
    await until(async()=>{
      for(const approval of (await client.call('approval.list',{})).items)if(approval.state==='pending'&&!approvals.has(approval.approvalId)) {
        approvals.add(approval.approvalId);await client.call('authorization.respond',{approvalId:approval.approvalId,
          expectedRevision:approval.revision,decision:'allow_once'});
      }
      return app.activeTaskCount===0;
    });
    const toolTaskId=delegated?app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${taskId}-user-work`).taskId:taskId;
    return {state:app.runtime.getTask(toolTaskId).state,requests,confirmations,approvals:approvals.size,reads:fixture.reads(),
      executions:app.runtime.readToolExecutions(toolTaskId),rootState:app.runtime.getTask(taskId).state};
  } finally {host.close();app.close();}
}

test('Synthetic user-work catalog -> original Policy -> injected provider -> exact native consent -> bounded continuation',async()=>{
  const result=await scenario({delegated:true});assert.equal(result.state,'succeeded');assert.equal(result.rootState,'succeeded');
  assert.equal(result.approvals,2,'Original dispatch and read each require their own Policy approval');
  assert.deepEqual(result.requests[0].availableTools,[{name:'computer.system.observe',version:'1.0.0',
    inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}}]);
  assert.equal(result.confirmations.length,1);assert.equal(result.reads,2);
  assert.deepEqual(result.requests[1].continuation.result,result.confirmations[0].payload);
  assert.equal(result.requests[1].continuation.result.cpu.utilizationPercent,80);
  assert.deepEqual(result.requests[1].continuation.result.unavailable,['process_breakdown','disk_io','thermal','network_activity']);
  assert.equal(result.executions.filter(value=>value.toolName==='computer.system.observe'&&value.state==='confirmed').length,1);
});

test('Actual local node:os sampling uses original Policy; only explicit Synthetic transport sees the locally approved result',async()=>{
  const result=await scenario({realLocal:true});assert.equal(result.state,'succeeded');assert.equal(result.approvals,1);
  const value=result.requests[1].continuation.result;assert.equal(value.source,'node:os');
  assert.ok(value.cpu.logicalProcessorCount>=1);assert.ok(value.cpu.utilizationPercent>=0&&value.cpu.utilizationPercent<=100);
  assert.equal(value.memory.usedBytes,value.memory.totalBytes-value.memory.freeBytes);assert.ok(value.uptimeSeconds>=0);
  assert.equal(result.confirmations.length,1);
});

test('Denied exact egress or host closure retains one confirmed local read without cloud continuation',async()=>{
  for(const options of [{decision:false},{closeAtPrompt:true}]) {
    const result=await scenario(options);assert.equal(result.state,'waiting_reconciliation');
    assert.equal(result.requests.length,1);assert.equal(result.confirmations.length,1);assert.equal(result.reads,2);
    assert.equal(result.executions.filter(value=>value.state==='confirmed').length,1);
  }
});

test('Missing native export callback never publishes or samples the original system tool',async()=>{
  const result=await scenario({configured:false});assert.equal(result.requests.length,0);
  assert.equal(result.approvals,0);assert.equal(result.reads,0);assert.equal(result.executions.length,0);
});

test('Canonical task, original deadline and signal are required even for catalog readiness',()=>{
  const {tool,reads}=injectedTool(),app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:[tool]});
  const task=app.runtime.submitTask({goal:'Synthetic readiness only',conversationId:'desktop-panel',idempotencyKey:'readiness'});
  app.runtime.transitionTask(task.taskId,'planning');app.runtime.transitionTask(task.taskId,'running');
  const deadline=new Date(Date.now()+60_000).toISOString();
  app.runtime.saveCheckpoint(task.taskId,'application-profile','huawei_ict_agentarts');
  app.runtime.saveCheckpoint(task.taskId,'application-deadline',deadline);
  let canonical='desktop-panel';const host=createSystemObservationConversation({tool,getApplication:()=>app,
    resolveUserConversation:()=>canonical,confirmExport:async()=>true});
  const input={taskId:task.taskId,revision:app.runtime.getTask(task.taskId).revision,deadline,signal:new AbortController().signal};
  const ready=host.competitionToolAvailability[0].available;
  try {
    assert.equal(ready(input),true);assert.equal(ready({...input,signal:undefined}),false);
    assert.equal(ready({...input,deadline:undefined}),false);
    assert.equal(ready({...input,deadline:new Date(Date.now()+30_000).toISOString()}),false);
    canonical=undefined;assert.equal(ready(input),false);assert.equal(reads(),0);
  } finally {host.close();app.close();}
});
