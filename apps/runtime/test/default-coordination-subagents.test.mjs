import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {getEventListeners} from 'node:events';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {createAgentArtsRuntimeApplication,createRuntimeApplication,createDesktopSubagentDispatchTool,resumeRuntimeSubagentTask,readRuntimeSubagentSummary,SUBAGENT_DISPATCH_TOOL_NAME,SUBAGENT_DISPATCH_TOOL_VERSION} from '../dist/application.js';
const read={name:'fixture.default-child-read',version:'1.0.0',sideEffect:'read',requiredScopes:['fixture:read'],
  requiresPresence:false,recoverySupport:true,idempotencySupport:true,inputSchema:{type:'object',required:['value'],properties:{value:{type:'string'}},additionalProperties:false},outputSchema:{type:'object'}};
async function until(predicate){const deadline=Date.now()+60_000;while(Date.now()<deadline){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('state did not arrive');}
test('default children reuse Competition worker and original approvals without an independent model API',async t=>{
  let app,reads=0,independentCalls=0;
  const dispatch=createDesktopSubagentDispatchTool({getRuntime:()=>app.runtime,getTools:()=>app.tools,
    runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools),
    getModelGateway:()=>{independentCalls++;return undefined;}});
  const port=new FakeCoordinationPort(request=>{
    const task=app.runtime.getTask(request.taskId);
    if(task.conversationId.startsWith('desktop-subtask:')) {
      assert.equal(app.runtime.loadCheckpoint(task.taskId,'subtask-coordination-binding').profile,'huawei_ict_agentarts');
      assert.ok(app.runtime.loadCheckpoint(task.taskId,'subtask-tools-binding').every(tool=>tool.name!==SUBAGENT_DISPATCH_TOOL_NAME));
      if(task.goal.includes('approved child')&&!request.continuation)return {kind:'tool_proposal',proposalId:'original-child-read',
        toolName:read.name,toolVersion:read.version,arguments:{value:'public fixture'},verification:'mock'};
      return {kind:'text',text:'Child result '+task.goal,verification:'mock'};
    }
    if(!request.continuation)return {kind:'tool_proposal',proposalId:'default-dispatch',
      toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
      arguments:{subtasks:[{subtaskId:'one',role:'researcher',goal:'approved child'},
        {subtaskId:'two',role:'planner',goal:'independent planning child',thinkingDepth:2}]},verification:'mock'};
    assert.equal(request.continuation.result.succeeded,2);assert.equal(request.continuation.result.failed,0);
    return {kind:'text',text:'Both default cloud roles completed',verification:'mock'};
  });
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',coordination:port,
    coordinationBinding:'fixed-original-cloud-source',tools:[dispatch,{descriptor:read,execute:async input=>{reads++;return input;}}],
    automaticTools:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION}]});t.after(()=>app.close());
  const client=new Client(app,Date.now);await client.connect();
  const parent=await client.call('task.submit',{goal:'Delegate two default roles',conversationId:'desktop-panel'},{idempotencyKey:'default-cloud',timeoutMs:60_000});
  await until(()=>app.runtime.getTask(parent.taskId).state==='waiting_approval'&&app.activeTaskCount===0);
  const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-one`);
  assert.equal(reads,0);assert.equal(independentCalls,0);
  const approval=app.runtime.getApproval(`competition-tool-${child.taskId}-1`);
  await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
  await until(()=>app.runtime.getTask(parent.taskId).state==='succeeded'&&app.activeTaskCount===0);
  assert.equal(reads,1);assert.equal(independentCalls,0);assert.equal(port.requests.length,5);
  assert.equal(app.runtime.readToolExecutions(parent.taskId).length,1);
  assert.equal(app.runtime.readToolExecutions(child.taskId)[0].state,'confirmed');
  assert.ok(app.runtime.getTask(parent.taskId).evidenceRefs.includes(approval.approvalId));
  assert.throws(()=>app.resumeTask(child.taskId),{code:'REVISION_CONFLICT'});assert.equal(reads,1);
});


test('persistent default children retain the original AgentArts candidate protocol across approval restarts',async t=>{
  for(const [initial,restored] of [[undefined,undefined],['1.0','1.0'],[undefined,'1.0'],['1.0',undefined]]) {
    await t.test(`${initial??'disabled'} -> ${restored??'disabled'}`,async()=>{
      const directory=await mkdtemp(path.join(os.tmpdir(),'pa-child-config-'));
      let app,reads=0;
      const sends=[];
      const open=repairCandidateVersion=>{
        const dispatch=createDesktopSubagentDispatchTool({getRuntime:()=>app.runtime,getTools:()=>app.tools,
          runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
        return createAgentArtsRuntimeApplication({path:path.join(directory,'runtime.sqlite'),
          gatewayUrl:'https://agentarts.example.test',runtimeName:'binding',responseMode:'tool-proposal-json',
          ...(repairCandidateVersion===undefined?{}:{repairCandidateVersion}),
          authorizationProvider:{read:async()=>'Bearer synthetic'},
          tools:[dispatch,{descriptor:read,execute:async input=>{reads++;return input;}}],
          automaticTools:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION}],
          competitionToolExports:[
            {toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
              exportPolicyVersion:'fixture-v1',accepts:()=>true,project:({result})=>({succeeded:result.succeeded})},
            {toolName:read.name,toolVersion:read.version,exportPolicyVersion:'fixture-v1',
              accepts:()=>true,project:({result})=>result},
          ],
          beforeCompetitionSend:request=>{sends.push({taskId:request.taskId,continuation:request.continuation});},
          fetchImpl:async(_url,init)=>{
            const body=JSON.parse(init.body);
            let query;try {query=JSON.parse(body.query);}catch {query={goal:body.query};}
            const continuation=query.continuation||query.goal?.startsWith('以下本地已确认');
            const result=continuation?{kind:'text',text:'Synthetic done'}
              :query.goal.includes('original child')?{kind:'tool_proposal',proposalId:'original-child-read',
                toolName:read.name,toolVersion:read.version,arguments:{value:'public'}}
              :{kind:'tool_proposal',proposalId:'original-dispatch',toolName:SUBAGENT_DISPATCH_TOOL_NAME,
                toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
                arguments:{subtasks:[{subtaskId:'one',role:'researcher',goal:'original child'}]}};
            return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(result),index:0}}),
              {headers:{'content-type':'application/json'}});
          },
        });
      };
      try {
        app=open(initial);
        const client=new Client(app);await client.connect();
        const parent=await client.call('task.submit',{goal:'Delegate one role',conversationId:'binding'},
          {idempotencyKey:'binding',timeoutMs:60_000});
        await until(()=>app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-one`)
          &&app.activeTaskCount===0);
        const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-one`);
        assert.equal(child.state,'waiting_approval');assert.equal(reads,0);
        const originalBinding=app.runtime.loadCheckpoint(child.taskId,'subtask-coordination-binding');
        const originalLoop=app.runtime.loadCheckpoint(child.taskId,'competition-loop');
        const originalDeadline=app.runtime.loadCheckpoint(child.taskId,'application-deadline');
        const oldRef=app.coordinationConfigurationRef;
        if(initial===undefined)assert.equal(oldRef,createHash('sha256').update(JSON.stringify({
          gatewayUrl:'https://agentarts.example.test',runtimeName:'binding',invokeMode:'published',
          workflowGoalInput:null,responseMode:'tool-proposal-json',initialRequestMode:'goal',
        })).digest('hex'));
        app.close();app=open(restored);
        const restoredClient=new Client(app);await restoredClient.connect();
        const approval=app.runtime.getApproval(`competition-tool-${child.taskId}-1`);
        const approve=()=>restoredClient.call('authorization.respond',{approvalId:approval.approvalId,
          expectedRevision:approval.revision,decision:'allow_once'});
        if(initial!==restored)await assert.rejects(approve(),{code:'REVISION_CONFLICT'});
        else await approve();
        await until(()=>app.activeTaskCount===0);
        const outcome=app.runtime.getTask(child.taskId);
        assert.deepEqual(app.runtime.loadCheckpoint(child.taskId,'subtask-coordination-binding'),originalBinding);
        assert.equal(app.runtime.loadCheckpoint(child.taskId,'application-deadline'),originalDeadline);
        if(initial!==restored){
          assert.equal(outcome.state,'waiting_approval');
          assert.deepEqual(app.runtime.getApproval(approval.approvalId),approval);
          assert.equal(approval.state,'pending');assert.equal(app.runtime.policy.get(approval.approvalId),undefined);
          assert.notEqual(app.coordinationConfigurationRef,oldRef);
          assert.equal(reads,0);assert.deepEqual(app.runtime.readToolExecutions(child.taskId),[]);
          assert.deepEqual(app.runtime.loadCheckpoint(child.taskId,'competition-loop'),originalLoop);
          assert.equal(sends.filter(send=>send.taskId===child.taskId).length,1);
        }else{
          assert.equal(app.coordinationConfigurationRef,oldRef);
          assert.equal(outcome.state,'succeeded');assert.equal(reads,1);
          const execution=app.runtime.readToolExecutions(child.taskId);
          assert.equal(execution.length,1);assert.equal(execution[0].evidenceId,approval.approvalId);
          assert.equal(execution[0].state,'confirmed');
          assert.equal(sends.filter(send=>send.taskId===child.taskId&&send.continuation).length,1);
        }
      }finally{app?.close();await rm(directory,{recursive:true,force:true});}
    });
  }
});

test('AgentArts factory snapshots the candidate mode once for the adapter and child binding',()=>{
  let reads=0,fetches=0;
  const app=createAgentArtsRuntimeApplication({path:':memory:',
    gatewayUrl:'https://agentarts.example.test',runtimeName:'binding',responseMode:'tool-proposal-json',
    get repairCandidateVersion(){reads++;return reads===1?'1.0':undefined;},
    authorizationProvider:{read:async()=>'Bearer synthetic'},
    fetchImpl:async()=>{fetches++;throw Error('No request expected');},
  });
  try{
    assert.equal(reads,1);
    assert.equal(app.coordinationConfigurationRef,createHash('sha256').update(JSON.stringify({
      gatewayUrl:'https://agentarts.example.test',runtimeName:'binding',invokeMode:'published',
      workflowGoalInput:null,responseMode:'tool-proposal-json',initialRequestMode:'goal',repairCandidateVersion:'1.0',
    })).digest('hex'));
    assert.equal(fetches,0);
  }finally{app.close();}
});


test('confirmed default-child replay retains parent cancellation without reexecuting the original read',async t=>{
  for(const cancel of [false,true])await t.test(`parent cancellation=${cancel}`,async()=>{
    let app,reads=0,permitted=true,release,arrive,continuationSignal;
    const entered=new Promise(resolve=>{arrive=resolve;});
    const sends=[];
    const dispatch=createDesktopSubagentDispatchTool({getRuntime:()=>app.runtime,getTools:()=>app.tools,
      runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
    app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',
      runtimeName:'replay',responseMode:'tool-proposal-json',
      authorizationProvider:{read:async()=>'Bearer synthetic'},
      tools:[dispatch,{descriptor:read,execute:async input=>{reads++;return input;}}],
      automaticTools:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION}],
      competitionToolExports:[
        {toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
          exportPolicyVersion:'fixture-v1',accepts:()=>true,project:({result})=>({succeeded:result.succeeded})},
        {toolName:read.name,toolVersion:read.version,exportPolicyVersion:'fixture-v1',accepts:()=>permitted,
          project:({result})=>{permitted=false;return result;}},
      ],
      fetchImpl:async(_url,init)=>{
        const body=JSON.parse(init.body);
        let query;try{query=JSON.parse(body.query);}catch{query={goal:body.query};}
        sends.push(query);
        if(query.continuation){
          continuationSignal=init.signal;arrive();await new Promise(resolve=>{release=resolve;});
        }
        const result=query.continuation?{kind:'text',text:'Synthetic replay done'}
          :query.goal.includes('original child')?{kind:'tool_proposal',proposalId:'original-child-read',
            toolName:read.name,toolVersion:read.version,arguments:{value:'public'}}
          :{kind:'tool_proposal',proposalId:'original-dispatch',toolName:SUBAGENT_DISPATCH_TOOL_NAME,
            toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
            arguments:{subtasks:[{subtaskId:'one',role:'researcher',goal:'original child'}]}};
        return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(result),index:0}}),
          {headers:{'content-type':'application/json'}});
      },
    });
    try{
      const client=new Client(app);await client.connect();
      const parent=await client.call('task.submit',{goal:'Delegate one role',conversationId:'replay'},
        {idempotencyKey:'replay'});
      await until(()=>app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-one`)
        &&app.activeTaskCount===0);
      const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-one`);
      assert.equal(child.state,'waiting_approval');
      const approval=app.runtime.getApproval(`competition-tool-${child.taskId}-1`);
      await client.call('authorization.respond',{approvalId:approval.approvalId,
        expectedRevision:approval.revision,decision:'allow_once'});
      await until(()=>app.activeTaskCount===0);
      assert.equal(app.runtime.getTask(child.taskId).state,'waiting_reconciliation');assert.equal(reads,1);
      const originalLoop=app.runtime.loadCheckpoint(child.taskId,'competition-loop');
      const originalDeadline=app.runtime.loadCheckpoint(child.taskId,'application-deadline');
      assert.equal(originalLoop.pending,undefined);assert.equal(originalLoop.continuation.state,'confirmed');
      const record=app.runtime.readToolExecutions(child.taskId)[0];
      assert.equal(record.evidenceId,approval.approvalId);assert.equal(record.state,'confirmed');
      permitted=true;
      app.runtime.prepareConfirmedReplay(child.taskId,{runId:approval.approvalId,
        toolName:read.name,toolVersion:read.version,arguments:{value:'public'}});
      const parentController=new AbortController();
      const resumed=resumeRuntimeSubagentTask({getRuntime:()=>app.runtime,getTools:()=>app.tools,
        runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)},
        child.taskId,parentController.signal);
      await entered;
      if(cancel)parentController.abort('Synthetic parent cancellation');
      // The transport is intentionally non-cooperative; local cancellation must
      // determine the terminal task state even if this response later arrives.
      release();
      const outcome=await resumed;
      assert.equal(outcome.state,cancel?'cancelled':'succeeded');
      assert.equal(continuationSignal.aborted,cancel);
      assert.equal(reads,1);assert.equal(sends.length,3);
      assert.deepEqual(app.runtime.readToolExecutions(child.taskId),[record]);
      assert.deepEqual(app.runtime.loadCheckpoint(child.taskId,'competition-loop'),originalLoop);
      assert.equal(app.runtime.loadCheckpoint(child.taskId,'application-deadline'),originalDeadline);
      assert.equal(getEventListeners(parentController.signal,'abort').length,0);
      assert.ok(outcome.evidenceRefs.includes(approval.approvalId));
      if(cancel){assert.equal(outcome.cancelRequested,true);assert.doesNotMatch(outcome.resultSummary??'',/Synthetic replay done/);}
      else assert.match(outcome.resultSummary,/Synthetic replay done/);
    }finally{release?.();app.close();}
  });
});

test('sequential Competition dispatch accepts prototype-like IDs and absent IDs remain pending',async t=>{
 for(const secondId of ['two','constructor','__proto__','toString'])await t.test(secondId,async()=>{
  let app;
  const sends=[];
  const definition=(id,index)=>({subtaskId:id,role:'researcher',goal:'synthetic child '+index});
  const proposal=(id,index)=>({kind:'tool_proposal',proposalId:'dispatch-'+index,
   toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
   arguments:{subtasks:[definition(id,index)]}});
  const dispatch=createDesktopSubagentDispatchTool({getRuntime:()=>app.runtime,getTools:()=>app.tools,
   runDefaultWorker:(subtask,worker,tools)=>app.runDefaultSubagentWorker(subtask,worker,tools)});
  app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://agentarts.example.test',
   runtimeName:'special-id',responseMode:'tool-proposal-json',authorizationProvider:{read:async()=>'Bearer synthetic'},
   tools:[dispatch],automaticTools:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION}],
   competitionToolExports:[{toolName:SUBAGENT_DISPATCH_TOOL_NAME,toolVersion:SUBAGENT_DISPATCH_TOOL_VERSION,
    exportPolicyVersion:'fixture-v1',accepts:()=>true,project:({result})=>({succeeded:result.succeeded})}],
   fetchImpl:async(_url,init)=>{
    const body=JSON.parse(init.body);let query;try{query=JSON.parse(body.query);}catch{query={goal:body.query};}
    sends.push(query);
    const result=query.continuation?.proposalId==='dispatch-1'?proposal(secondId,2)
     :query.continuation?{kind:'text',text:'Both synthetic children done'}
     :query.goal==='Delegate twice'?proposal('one',1):{kind:'text',text:'Synthetic child done'};
    return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(result),index:0}}),
     {headers:{'content-type':'application/json'}});
   },
  });
  try{
   const client=new Client(app);await client.connect();
   const parent=await client.call('task.submit',{goal:'Delegate twice',conversationId:'special-id'},{idempotencyKey:'special-id'});
   await until(()=>app.activeTaskCount===0&&['succeeded','failed'].includes(app.runtime.getTask(parent.taskId).state));
   assert.equal(app.runtime.getTask(parent.taskId).state,'succeeded');
   const records=app.runtime.loadCheckpoint(parent.taskId,'subtask-progress-records');
   assert.deepEqual(Object.keys(records).sort(),['one',secondId].sort());
   assert.ok(Object.hasOwn(records,secondId));
   for(const id of ['one',secondId])assert.equal(app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-${id}`).state,'succeeded');
   const executions=app.runtime.readToolExecutions(parent.taskId);
   assert.equal(executions.length,2);assert.ok(executions.every(record=>record.state==='confirmed'));
   assert.equal(sends.length,5);
   const summary=readRuntimeSubagentSummary(app.runtime,parent.taskId,[definition('one',1),definition(secondId,2)]);
   assert.equal(summary.succeeded,2);assert.ok(summary.subtasks.every(item=>item.state==='succeeded'));
   const absent=readRuntimeSubagentSummary(app.runtime,parent.taskId,[definition('hasOwnProperty',3)]);
   assert.equal(absent.subtasks.length,1);assert.equal(absent.subtasks[0].state,'pending');assert.equal(absent.succeeded,0);
   assert.throws(()=>readRuntimeSubagentSummary(app.runtime,parent.taskId,[{...definition(secondId,2),goal:'changed'}]),{code:'REVISION_CONFLICT'});
   assert.deepEqual(app.runtime.loadCheckpoint(parent.taskId,'subtask-progress-records'),records);
  }finally{app.close();}
 });
});
