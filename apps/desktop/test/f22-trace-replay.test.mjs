import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier,createWorkflowDecisionTool} from '@personal-agent/agentarts';
import {createRuntimeApplication,createDesktopSubagentDispatchTool} from '@personal-agent/runtime/application';
import {createDesktopF22TraceReplayConfiguration,createDesktopF22WorkflowWorkerPorts} from '../electron/f22-trace-replay-host.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});

test('F22 actual graph replays the original SQLite unknown write without executing it again',async t=>{
  // Engine, Runtime, Policy, HostBridge, SQLite and native configuration are real.
  // Original service, candidates/selector and consent responses are explicit fixtures.
  const directory=await mkdtemp(join(tmpdir(),'pa-f22-trace-'));
  let app,sourceTaskId,calls=0,returned;
  const exports=[],proposals=[],cloudRequests=[],configuration=createDesktopF22TraceReplayConfiguration({userData:directory});
  const privateArgument='synthetic-private-original-argument-must-stay-local';
  assert.deepEqual(configuration.snapshot(),{enabled:false,revision:1});
  configuration.configure({enabled:true,expectedRevision:1});
  const bundle=createDesktopF22WorkflowWorkerPorts({getApplication:()=>app,configuration,hostUserNamespace:'synthetic-f22',
    getToolDescriptor:(name,version)=>tools.find(tool=>tool.descriptor.name===name&&tool.descriptor.version===version)?.descriptor,
    authorizeExport:async request=>{exports.push(request);return true;}});
  const sourceTool={descriptor:{name:'synthetic.record_write',version:'1.0.0',sideEffect:'local_write',requiredScopes:['synthetic:write'],
    requiresPresence:false,idempotencySupport:false,recoverySupport:false,inputSchema:object({value:{type:'string'}}),outputSchema:{type:'object'}},
    async execute(){calls++;throw new ProtocolError('RESULT_UNKNOWN','Synthetic acknowledgement lost');}};
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  const tools=[sourceTool,dispatch,createWorkflowDecisionTool({selector:{select:async()=> 'supported'}}),...bundle.tools];
  const secret='synthetic-f22-original-receipt-secret-at-least-32-bytes';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:secret,decisionTool:{name:'decision.choose_candidate',version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async context=>{
      const value=context.input.decisionOutputs[context.node.id]??{arguments:{}};
      return [{id:'supported',description:'Synthetic original replay only',value,
        ...(context.node.id==='F22_N02'?{branches:context.input.branches}:{})},
        {id:'review',description:'Synthetic abstention',value:null,abstain:true}];
    }});
  const image={bindingId:'synthetic-f22-actual-engine',receiptSecret:async()=>secret,advance:async request=>{
    cloudRequests.push(structuredClone({...request,signal:undefined}));
    const result=await engine.advance(request);proposals.push(...result.proposals);return result;}};
  app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'synthetic-f22',delegateUserTasks:true,
    coordinationBinding:'synthetic-f22',tools,configuredWorkflowWorkers:bundle.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),
    automaticTools:[{toolName:dispatch.descriptor.name,toolVersion:'1.0.0'}],
    coordination:{execute:async request=>{
      if(request.continuation){if(request.continuation.result?.mode==='trace_replay')returned=request.continuation.result;
        return {kind:'text',text:'Synthetic historical summary',verification:'mock'};}
      return {kind:'tool_proposal',proposalId:'synthetic-f22-request',toolName:'workflow.f22.trace_replay',toolVersion:'1.0.0',arguments:{sourceTaskId},verification:'mock'};
    }},
    competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,
      publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
    competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-v1',accepts:()=>true,project:({result})=>result}))});
  t.after(async()=>{app.close();configuration.close();await rm(directory,{recursive:true,force:true});});
  const client=new Client(app);await client.connect();
  const until=async check=>{const end=Date.now()+20000;while(Date.now()<end){
    for(const approval of app.runtime.listApprovals({state:'pending',limit:100}).items)
      await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    if(check())return;await new Promise(resolve=>setTimeout(resolve,5));
  }assert.fail('F22 did not settle: '+JSON.stringify(app.runtime.listTasks({limit:100}).items.map(task=>({id:task.taskId,state:task.state,error:task.error}))));};
  const original=app.runtime.submitTask({goal:'Synthetic original write',conversationId:'synthetic-chat',idempotencyKey:'original'});
  app.runtime.transitionTask(original.taskId,'planning');app.runtime.transitionTask(original.taskId,'running');
  const deadline=new Date(Date.now()+60000).toISOString(),bridge=app.createOwnedWorkflowHost({parentTaskId:original.taskId,receiptSecret:secret,assertActive(){}});
  const args={value:privateArgument},proposal={kind:'tool_proposal',nodeId:'F22_N04',operationId:'synthetic-original',proposalId:'synthetic-original',
    originControlRevision:0,inputDigest:hash({arguments:args}),toolSchemaDigest:hash(sourceTool.descriptor.inputSchema),toolName:sourceTool.descriptor.name,
    toolVersion:'1.0.0',arguments:args,resourceKeys:[],effect:'write'};
  sourceTaskId=bridge.submit({taskId:original.taskId,sessionId:'synthetic-source',workflowId:'F22',controlRevision:0,deadline,taskDeadline:deadline},proposal).localTaskId;
  await until(()=>app.readHostToolTask(sourceTaskId).task.state==='waiting_reconciliation'&&app.activeTaskCount===0);
  const before=app.runtime.readToolExecutions(sourceTaskId);
  const root=await client.call('task.submit',{goal:'Replay my historical trace only',conversationId:'synthetic-chat'},
    {idempotencyKey:'synthetic-f22-replay',timeoutMs:60000});
  let child;await until(()=>{[child]=app.readSubagentTasks(root.taskId);return child&&app.activeTaskCount===0&&['succeeded','failed','cancelled','waiting_reconciliation'].includes(child.state);});
  assert.equal(child.state,'succeeded',JSON.stringify(child.error));
  assert.equal(returned.mode,'trace_replay');assert.equal(returned.counterfactualComparison,'unknown');
  assert.equal(returned.actualToolCalls,0);assert.equal(returned.actualModelCalls,0);assert.equal(returned.trainingPerformed,false);
  assert.equal(returned.actions[0].comparability,'write_not_replayed');assert.equal(returned.timeline[0].record.state,'unknown');
  assert.equal(returned.sourceTaskId,sourceTaskId);assert.equal(calls,1);assert.deepEqual(app.runtime.readToolExecutions(sourceTaskId),before);
  assert.ok(exports.some(item=>item.stage==='initial'));assert.ok(exports.some(item=>item.stage==='completion'));
  assert.deepEqual(proposals.filter(p=>p.toolName.startsWith('workflow.host.')).map(p=>p.nodeId),['F22_N09','F22_N01','F22_N04','F22_N06']);
  assert.ok(proposals.some(p=>p.nodeId==='F22_N08'&&p.toolName==='decision.choose_candidate'));
  assert.equal(JSON.stringify(exports).includes(privateArgument),false,'workflow consent cannot export original tool arguments');
  assert.equal(JSON.stringify(cloudRequests).includes(privateArgument),false,'original tool bodies never enter image input, receipts or resolved values');
  assert.equal(Object.hasOwn(returned.timeline[0].record,'arguments'),false);
  assert.equal(Object.hasOwn(returned.timeline[0].record,'result'),false);
  assert.equal(Object.hasOwn(returned.actions[0],'result'),false);
  assert.equal(app.runtime.loadCheckpoint(child.taskId,'f22:original-trace-replay').frozenSnapshot.records[0].arguments.value,privateArgument,
    'the exact original remains available only to the local replay and validation');
});
