import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {createProactiveHostProofs,ProactiveWorkflowEngine} from '@personal-agent/agentarts';
import {createDesktopProactiveWorkflowApplication} from '../electron/proactive-workflow-host.js';
import {createDesktopProactiveRuntimePump} from '../electron/proactive-runtime-pump.js';

const until=async predicate=>{for(let n=0;n<500;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Synthetic proactive pump state did not arrive');};
test('Synthetic original Scheduler wake enters the original signed responsibility once, including pump recreation',async()=>{
  let clock=Date.now(),app,workflow,changed=false;
  const deadline=new Date(clock+60_000).toISOString(),proofs=createProactiveHostProofs('synthetic-public-proactive-pump-key-32');
  const contract={id:'synthetic-pump',version:'1',criteria:'Synthetic public wake only',qualifiedForMain:false,batchIndependent:true,
    candidates:[{id:'continue',description:'Continue',action:'continue'},{id:'defer',description:'Defer',action:'defer'}]};
  const engine=new ProactiveWorkflowEngine({checkpointSecret:'synthetic-public-proactive-pump-checkpoint-32',decisionContracts:[contract],now:()=>clock,
    verifyEvent:async(v,c)=>proofs.verify('event',v,c),verifyResponsibility:async(v,c)=>proofs.verify('responsibility',v,c),
    verifyReceipt:async(v,_p,c)=>proofs.verify('receipt',v,c),verifyControl:async(v,c)=>proofs.verify('control',v,c)});
  const descriptor=name=>({name,version:'1.0.0',inputSchema:{type:'object'},outputSchema:{type:'object'},sideEffect:'read',
    requiredScopes:['synthetic:pump'],requiresPresence:false,idempotencySupport:true,recoverySupport:true});
  const tools=[{descriptor:descriptor('synthetic.teacher'),execute:async value=>({selections:value.independentQuestions.map(question=>({
    itemId:question.itemId,candidateId:'continue',decisionRef:'synthetic-decision-'+question.itemId,decidedBy:'deepseek',
    uncertain:false,complex:false,importance:'important',authorityRequired:false}))})},
  {descriptor:descriptor('synthetic.continue'),execute:async()=>({status:'pending',resultRef:'synthetic-public-readback',
    nextWake:{runAt:new Date(clock+1000).toISOString(),reason:'Original source follow-up',timeZone:'UTC',missedRunPolicy:'run_once'}})}];
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',proactiveWorkflows:true,now:()=>new Date(clock),tools,
    automaticTools:[...tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0'})),
      ...['retrieve_context','update_item','schedule_wake'].map(kind=>({toolName:'proactive.'+kind,toolVersion:'1.0.0'}))]});
  const configuration=()=>({contractRef:contract.id,adapter:{endpoint:'http://127.0.0.1:18765/invocations'+(changed?'?endpoint=changed':'')}});
  workflow=createDesktopProactiveWorkflowApplication({application:app,readConfiguration:configuration,localDeviceAvailable:()=>true,
    resolveUserConversation:id=>app.runtime.getTask(id).conversationId,
    bindings:[{kind:'teacher_decision',toolName:'synthetic.teacher',toolVersion:'1.0.0',location:'local_device',effect:'read'},
      {kind:'continue',toolName:'synthetic.continue',toolVersion:'1.0.0',location:'local_device',effect:'read'}],
    createAdapter:()=>({describe:async()=>({contracts:[contract]}),sign:proofs.sign,
      advancePort:async input=>proofs.sign('advance_result',{requestId:input.requestId,...await engine.advance(input)},input),
      verifyAdvance:(result,input)=>proofs.verify('advance_result',result,input)})});
  const source=app.runtime.submitTask({goal:'Keep this public synthetic source current',conversationId:'desktop-panel',idempotencyKey:'pump-source'});
  const original=await workflow.start({sourceTaskId:source.taskId,commandId:'synthetic-pump-start',taskDeadline:deadline});
  const makePump=()=>createDesktopProactiveRuntimePump({getApplication:()=>app,getWorkflow:()=>workflow,
    resolveUserConversation:id=>app.runtime.getTask(id).conversationId,now:()=>clock});
  try {
    await until(()=>app.runtime.listSchedules('desktop-panel').length===1);
    const first=app.runtime.listSchedules('desktop-panel')[0];clock+=2000;
    const pump=makePump(),firstTick=await pump.tick();
    assert.equal(firstTick.sessions.find(item=>item.taskId===original.taskId).wakes,1);
    assert.equal(app.runtime.getSchedule(first.scheduleId).status,'fired');
    const wakeTask=app.runtime.getSchedule(first.scheduleId).taskId;
    assert.ok(wakeTask);assert.equal(app.runtime.findTaskByIdempotencyKey(first.taskIdempotencyKey).taskId,wakeTask);
    assert.equal((await pump.tick()).sessions.find(item=>item.taskId===original.taskId).wakes,0);
    assert.equal((await makePump().tick()).sessions.find(item=>item.taskId===original.taskId).wakes,0);
    assert.equal(app.runtime.getSchedule(first.scheduleId).taskId,wakeTask);
    const session=await workflow.acquireMaintenance(original.taskId,{deadline,signal:new AbortController().signal});
    assert.equal(Object.keys(session.host.inspect().application.state.entries).filter(id=>id==='runtime-wake:'+first.scheduleId).length,1);
    changed=true;
    const rejected=await makePump().tick();assert.equal(rejected.sessions.find(item=>item.taskId===original.taskId).state,'unavailable');
    clock=Date.parse(deadline)+1;
    assert.equal((await makePump().tick()).sessions.find(item=>item.taskId===original.taskId).state,'deadline_expired');
  }finally{app.runtime.requestCancel(original.taskId,'Synthetic cleanup');await until(()=>app.activeTaskCount===0);app.close();}
});

test('Synthetic maintenance never resumes legacy, cancelled or withheld responsibilities',async()=>{
  const actions=[],binding={taskId:'old',sourceTaskId:'source',taskDeadline:new Date(Date.now()+60000).toISOString()};
  const workflow={snapshot:()=>({state:'configured_not_verified'}),maintenancePage:()=>({items:[
    {binding,state:'created'},{binding:{...binding,taskId:'cancelled',imageBinding:'public'},state:'cancelled'},
    {binding:{...binding,taskId:'withheld',imageBinding:'public'},state:'created',withheld:true}],snapshotSequence:1}),
    acquireMaintenance:async()=>assert.fail('No implicit binding or network')};
  const pump=createDesktopProactiveRuntimePump({getApplication:()=>({runtime:{},resumeProactiveTask:id=>actions.push(id)}),getWorkflow:()=>workflow,
    resolveUserConversation:()=> 'desktop-panel'});
  const result=await pump.tick();assert.deepEqual(result.sessions.map(item=>item.state),['legacy_requires_explicit_resume','source_unavailable']);
  assert.deepEqual(actions,[]);
});

test('Synthetic repeated poll does not keep re-entering an unresolved original worker',async()=>{
  let resumed=0;
  const binding={taskId:'unknown',sourceTaskId:'source',taskDeadline:new Date(Date.now()+60000).toISOString(),imageBinding:'synthetic-original-image'};
  const workflow={snapshot:()=>({state:'configured_not_verified'}),maintenancePage:()=>({items:[{binding,state:'waiting_reconciliation',conversationId:'desktop-panel'}]}),
    acquireMaintenance:async()=>({binding,host:{inspect:()=>({application:{state:{schedules:{}}}})}})};
  const pump=createDesktopProactiveRuntimePump({getApplication:()=>({runtime:{getTask:()=>({state:'waiting_reconciliation'})},resumeProactiveTask:()=>{resumed++;}}),
    getWorkflow:()=>workflow,resolveUserConversation:()=> 'desktop-panel'});
  await pump.tick();await pump.tick();assert.equal(resumed,1);
});

test('Synthetic bounded maintenance continues its original snapshot on the next existing poll',async()=>{
  const pages=[];
  const workflow={snapshot:()=>({state:'configured_not_verified'}),maintenancePage:input=>{
    pages.push(input);const index=input.beforeSequence??0;
    return {items:[],snapshotSequence:42,...(index<11?{nextBeforeSequence:index+1}:{})};}};
  const pump=createDesktopProactiveRuntimePump({getApplication:()=>({runtime:{}}),getWorkflow:()=>workflow,
    resolveUserConversation:()=> 'desktop-panel'});
  assert.equal((await pump.tick()).state,'bounded');assert.equal(pages.length,10);
  assert.equal((await pump.tick()).state,'processed');assert.equal(pages[10].beforeSequence,10);
  assert.equal(pages[10].snapshotSequence,42);
  await pump.tick();assert.deepEqual(pages[12],{});
});
