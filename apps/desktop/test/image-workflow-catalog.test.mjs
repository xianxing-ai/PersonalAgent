import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@personal-agent/client';
import {getOwnedWorkflowAdapterRequirements} from '@personal-agent/agentarts';
import {createAgentArtsRuntimeApplication,createDesktopSubagentDispatchTool} from '@personal-agent/runtime/application';
import {createImageWorkflowCatalogHost} from '../electron/image-workflow-catalog.js';
import {createContentFenceProduct} from '../electron/content-fence-product.js';

function fixture(){
  const descriptors=[],signal=new AbortController().signal,deadline=new Date(Date.now()+60000).toISOString();let cancelled=false;
  const application={tools:{list:()=>descriptors},runtime:{getTask:()=>({state:'running',cancelRequested:cancelled}),loadCheckpoint:()=>deadline},readToolConversation:()=> 'original-ui'};
  const host=createImageWorkflowCatalogHost({getApplication:()=>application}),context={taskId:'original',deadline,signal,authorizationRef:'read-grant',scopes:['workflow:catalog']};
  return {host,descriptors,context,cancel:()=>{cancelled=true;}};
}
test('public catalog reports 28 designs/185 nodes and exact public adapter requirements without inventing graph execution',async()=>{
  const f=fixture();try{f.descriptors.push({name:'developer.ci_fix',version:'1.0.0',privateToken:'DO_NOT_EXPORT',inputSchema:{secret:'PRIVATE_SCHEMA'}},
    {name:'workspace.read_text',version:'1.0.0'},{name:'workspace.run_allowed_command',version:'1.0.0'});
    const result=await f.host.tools[0].execute({},f.context);assert.equal(result.designWorkflowCount,28);assert.equal(result.designNodeCount,185);
    assert.equal(result.workflows.reduce((n,w)=>n+w.nodeCount,0),185);assert.equal(result.workflows.length,28);
    assert.equal(result.adapterRequirementCount,152);assert.equal(result.hostRequirementCount,111);assert.equal(result.guardRequirementCount,41);
    assert.equal(result.authorizationGranted,false);assert.equal(result.readinessChecked,false);assert.equal(result.remoteImageVerification,'unverified');
    const f20=result.workflows.find(w=>w.workflowId==='F20');assert.equal(f20.adapters.length,0);assert.equal(f20.state,'unavailable');assert.equal(f20.entry.state,'unavailable');
    assert.ok(result.workflows.find(w=>w.workflowId==='F16').unavailableReasons.includes('conversation_entry_not_registered'));
    assert.doesNotMatch(JSON.stringify(result),/DO_NOT_EXPORT|PRIVATE_SCHEMA|privateToken/);assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);
    const policy=f.host.competitionToolExports[0];assert.deepEqual(policy.project({taskId:'original',result,signal:f.context.signal}),result);
    assert.throws(()=>policy.project({taskId:'original',result:{...result,checkpoint:'FORGED_PRIVATE'},signal:f.context.signal}),{code:'UNAUTHORIZED'});
  }finally{f.host.close();}
});
test('only exact registered F15 entry and host adapter versions affect registration; readiness remains unchecked',async()=>{
  const f=fixture();try{const requirements=getOwnedWorkflowAdapterRequirements().filter(r=>r.workflowId==='F15');
    f.descriptors.push({name:'coding.repair.workflow',version:'1.0.0'},{name:'workspace.read_text',version:'1.0.0'});
    let result=await f.host.tools[0].execute({workflowId:'F15'},f.context);assert.equal(result.workflows.length,1);assert.equal(result.workflows[0].nodes.length,result.workflows[0].nodeCount);assert.equal(result.workflows[0].entry.state,'entry_registered_requires_task_authorization');assert.equal(result.workflows[0].state,'unavailable');
    f.descriptors.push(...requirements.map(r=>({name:r.toolName,version:r.toolVersion})));result=await f.host.tools[0].execute({workflowId:'F15'},f.context);
    assert.equal(result.workflows[0].state,'entry_registered_requires_task_authorization');assert.deepEqual(result.workflows[0].missingAdapterNames,[]);
    f.descriptors.find(d=>d.name===requirements[0].toolName).version='other';
    assert.throws(()=>f.host.competitionToolExports[0].project({taskId:'original',result,signal:f.context.signal}),{code:'UNAUTHORIZED'});
    result=await f.host.tools[0].execute({workflowId:'F15'},f.context);assert.deepEqual(result.workflows[0].missingAdapterNames,[requirements[0].toolName]);
  }finally{f.host.close();}
});
test('input cannot select private source, remote image operation, task or proof; cancelled tasks and missing authorization are denied',async()=>{
  const f=fixture();try{for(const input of [{workflowId:'F00'},{workflowId:'F29'},{workflowId:'owned-F15'},{taskId:'foreign'},{advance:true},{proof:'forged'}])await assert.rejects(f.host.tools[0].execute(input,f.context),{code:'INVALID_ARGUMENT'});
    await assert.rejects(f.host.tools[0].execute({},{...f.context,authorizationRef:undefined}),{code:'SCOPE_DENIED'});
    f.cancel();assert.equal(f.host.competitionToolAvailability[0].available(f.context),false);
    await assert.rejects(f.host.tools[0].execute({},f.context),{code:'UNAUTHORIZED'});
  }finally{f.host.close();}
});
test('original user-work child exports the catalog through the production fence and continues with an injection',async()=>{
  let app,sending;const host=createImageWorkflowCatalogHost({getApplication:()=>app}),read=host.tools[0],requests=[];
  const dispatch=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,runDefaultWorker:(s,w,t)=>app.runDefaultSubagentWorker(s,w,t)});
  const fence=createContentFenceProduct();
  app=createAgentArtsRuntimeApplication({path:':memory:',gatewayUrl:'https://catalog.invalid',runtimeName:'synthetic-catalog',
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',enableNewTaskToolContinuations:true,
    authorizationProvider:{read:async()=> 'Bearer synthetic'},
    beforeCompetitionSend:request=>{sending=request;},
    delegateUserTasks:true,tools:[dispatch,...fence.wrapTools([read])],readConversationPreference:()=>({depth:2,fast:false}),
    coordinationInput:{beforeCoordinationSend:request=>assert.equal(request.revision,app.runtime.getTask(request.taskId).revision)},
    automaticTools:[dispatch,read].map(t=>({toolName:t.descriptor.name,toolVersion:t.descriptor.version})),
    competitionToolAvailability:[...host.competitionToolAvailability,{toolName:'subagent.dispatch',toolVersion:'1.0.0',publicEnumPaths:['/subtasks/*/role'],available:()=>true}],
    competitionToolExports:[...host.competitionToolExports,{toolName:'subagent.dispatch',toolVersion:'1.0.0',exportPolicyVersion:'synthetic-summary',accepts:()=>true,project:({result})=>result}],
    fetchImpl:async (_url,init)=>{
      const {taskId,revision}=sending;
      const query=JSON.parse(JSON.parse(init.body).query);
      const headers=new Headers(init.headers);
      requests.push({taskId,revision,requestId:headers.get('x-request-id'),sessionId:headers.get('x-hw-agentarts-session-id')});
      let value;
      if(app.runtime.getTask(taskId).conversationId==='original-ui')value={kind:'text',text:'Synthetic parent summary'};
      else if(query.continuation){
        assert.equal(query.continuation.result.designNodeCount,185);
        assert.equal(query.continuation.result.workflows[0].workflowId,'F17');
        assert.equal(query.continuation.result.workflows[0].state,'unavailable');
        assert.match(query.goal,/请用一句话总结 F17/);
        value={kind:'text',text:'F17 有设计清单，图入口尚不可用。'};
      }else{
        const catalog=query.availableTools.find(t=>t.name===read.descriptor.name);
        assert.deepEqual(catalog.inputSchema.properties.workflowId.enum,Array.from({length:28},(_,i)=>'F'+String(i+1).padStart(2,'0')));
        app.runtime.injectUserMessage(taskId,'请用一句话总结 F17','user','catalog-interruption');
        value={kind:'tool_proposal',proposalId:'read-image-design',toolName:read.descriptor.name,toolVersion:read.descriptor.version,arguments:{workflowId:'F17'}};
      }
      return new Response(JSON.stringify([{event:'message',data:{text:JSON.stringify(value)}},{event:'task_end'},{event:'end'}]),
        {headers:{'content-type':'application/json'}});
    }});
  const client=new Client(app);await client.connect();try{const task=await client.call('task.submit',{goal:'Read public F17 design and real graph entry gaps',conversationId:'original-ui'},{idempotencyKey:'image-catalog'});
    for(let i=0;i<500&&!['succeeded','failed'].includes(app.runtime.getTask(task.taskId).state);i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(app.runtime.getTask(task.taskId).state,'succeeded',JSON.stringify(app.runtime.getTask(task.taskId).error));
    const [child]=app.readSubagentTasks(task.taskId);assert.equal(child.state,'succeeded');assert.equal(app.runtime.listApprovals({taskId:child.taskId}).items.length,0);
    assert.match(app.runtime.getTask(child.taskId).resultSummary,/F17 有设计清单，图入口尚不可用/);
    assert.equal(app.runtime.readToolExecutions(child.taskId).filter(run=>run.toolName===read.descriptor.name&&run.state==='confirmed').length,1);
    const childRequests=requests.filter(r=>r.taskId===child.taskId);
    assert.equal(childRequests.length,2);
    assert.ok(childRequests.every(request=>request.requestId));
    assert.notEqual(childRequests[0].requestId,childRequests[1].requestId);
    assert.ok(childRequests[0].sessionId);
    assert.equal(childRequests[0].sessionId,childRequests[1].sessionId);
  }finally{host.close();app.close();}
});
