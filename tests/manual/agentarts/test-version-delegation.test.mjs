import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRuntimeApplication} from '@personal-agent/runtime/application';
import {ModelGateway,FakeModelProvider} from '@personal-agent/models';
import {Client} from '@personal-agent/client';
import {createTestVersionDelegationTools} from './test-version-delegation.mjs';
import {createAdaptiveWorkflowSelector} from '../../../apps/agentarts-runtime/src/adaptive-decision.mjs';
const context=taskId=>({taskId,runId:'direct-fixture',signal:new AbortController().signal,deadline:new Date(Date.now()+20000).toISOString(),authorizationRef:'fixture',scopes:['agent:delegate']});
const proposal=(name,input={})=>({kind:'tool_proposal',proposal:{toolName:name,toolVersion:'1.0.0',arguments:input}});
const report=problem=>proposal('delegation.report_state',{problem,candidates:['inspect','continue'],nextSteps:['read current fixture']});

test('explicit Fake models drive existing child loop through real state/file/Evidence, notify and controller advice',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pa-delegation-fixture-')),path=join(directory,'actual.txt');await writeFile(path,'baseline');
  let app;const actions=['continue','notify_controller','request_controller'],decisions=[];
  const model=new ModelGateway(new FakeModelProvider([
    proposal('delegation.read_state'),report('normal next step'),
    async()=>{await writeFile(path,'actually changed');return report('file changed');},
    report('need controller handling'),request=>{
      const feedback=JSON.parse(request.messages.at(-1).content).result;
      assert.equal(feedback.controllerActor,'model_controller');assert.equal(feedback.userDecision,null);
      assert.equal(feedback.controllerAdvice.advice,'Continue by reading current fixture');
      assert.equal(feedback.executionRequiresOriginalPolicy,true);
      return proposal('delegation.read_state');
    },{kind:'final',text:'continued after advisory controller response'},
  ]));
  const controller=new ModelGateway(new FakeModelProvider([{kind:'final',text:JSON.stringify({advice:'Continue by reading current fixture',nextTool:'delegation.read_state'})}]));
  const tools=createTestVersionDelegationTools({getRuntime:()=>app.runtime,getTools:()=>app.tools,controller,
    adaptive:{decide:async input=>{decisions.push(JSON.parse(input.context));return {selectedId:actions.shift(),decided_by:'explicit_fake_decision',verification:'mock'};}},
    observe:async()=>{const data=await readFile(path);return {fixture:'actual.txt',sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length};},
    dispatchOptions:{getModelGateway:()=>model}});
  const registered=[...tools.childTools,...tools.parentTools];
  app=createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',tools:registered,
    automaticTools:registered.map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version}))});
  t.after(async()=>{app.close();await rm(directory,{recursive:true,force:true});});
  const parent=app.runtime.submitTask({conversationId:'fixture',goal:'actual delegation fixture',idempotencyKey:'parent'});
  const other=app.runtime.submitTask({conversationId:'fixture',goal:'unrelated task',idempotencyKey:'other'});
  const client=new Client(app);await client.connect();
  const cursor=app.runtime.readEvents().at(-1).sequence;
  await client.call('event.subscribe',{streamId:'tasks',afterSequence:cursor});
  const result=await app.runtime.runTask(parent.taskId,async worker=>{
    const result=await tools.dispatch.execute({subtasks:[{subtaskId:'child',role:'coder',goal:'Inspect state and report changes',model:'explicit-fake',thinkingDepth:4}]},
      {...context(parent.taskId),signal:worker.signal,deadline:worker.deadline});
    assert.equal(result.succeeded,1,JSON.stringify(result));return {resultSummary:result.summary,evidenceRefs:[]};
  },{deadline:context(parent.taskId).deadline});
  assert.equal(result.state,'succeeded');
  const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-child`);
  assert.equal(child.state,'succeeded');assert.ok(app.runtime.readEvidence(child.taskId).length>=5);
  assert.equal(decisions.length,3);assert.notEqual(decisions[0].state.observation.sha256,decisions[1].state.observation.sha256);
  assert.ok(decisions[0].state.evidence.child.length>=1);assert.equal(decisions[0].state.child.state,'running');
  assert.equal(app.runtime.getTask(other.taskId).state,'created','notify must not stop other work');
  const notices=app.runtime.readEvents(cursor).filter(event=>event.type==='task.progress'&&event.taskId===parent.taskId&&event.payload.stepId.startsWith('delegation-'));
  assert.equal(notices.length,2);assert.ok(notices.every(event=>!event.payload.label.includes('file changed')));
  const readReport=tools.parentTools.find(tool=>tool.descriptor.name==='delegation.read_report');
  const readback=await readReport.execute({subtaskId:'child'},context(parent.taskId));
  assert.equal(readback.report.action,'request_controller');assert.equal(readback.report.trainingPerformed,false);
  assert.equal(readback.report.notification.state,'published');
  await assert.rejects(readReport.execute({subtaskId:'child'},context(other.taskId)),{code:'UNAUTHORIZED'});
  await assert.rejects(tools.childTools[0].execute({taskId:child.taskId},context(other.taskId)),{code:'INVALID_ARGUMENT'});
  await assert.rejects(tools.childTools[0].execute({},context(other.taskId)),{code:'UNAUTHORIZED'});
});

async function boundaryFixture(t,{observe=async()=>({}),action='request_controller'}={}) {
  let app,decisions=0,controllerCalls=0;
  const controller=new ModelGateway(new FakeModelProvider([()=>{controllerCalls++;return {kind:'final',text:JSON.stringify({advice:'inspect',nextTool:null})};}]));
  const tools=createTestVersionDelegationTools({getRuntime:()=>app.runtime,getTools:()=>app.tools,controller,observe:input=>observe(input,app.runtime),
    adaptive:{decide:async()=>{decisions++;return {selectedId:action,decided_by:'explicit_fake_decision'};}},
    dispatchOptions:{getModelGateway:()=>new ModelGateway(new FakeModelProvider([{kind:'final',text:'fixture'}]))}});
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:tools.childTools});t.after(()=>app.close());
  const parent=app.runtime.submitTask({conversationId:'fixture',goal:'parent',idempotencyKey:'parent'});
  const other=app.runtime.submitTask({conversationId:'fixture',goal:'other parent',idempotencyKey:'other'});
  await tools.dispatch.execute({subtasks:[{subtaskId:'child',role:'coder',goal:'fixture'}]},context(parent.taskId));
  await tools.dispatch.execute({subtasks:[{subtaskId:'other-child',role:'coder',goal:'other fixture'}]},context(other.taskId));
  const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-child`);
  const otherChild=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${other.taskId}-other-child`);
  return {app,parent,child,otherChild,tools,counts:()=>({decisions,controllerCalls}),
    report:()=>tools.childTools[1].execute({problem:'private fixture body',candidates:['inspect'],nextSteps:['read']},context(child.taskId))};
}
for(const mode of ['terminal','cancelled'])test(`${mode} parent rejects new report before decision/controller call`,async t=>{
  const fixture=await boundaryFixture(t);
  if(mode==='terminal')await fixture.app.runtime.runTask(fixture.parent.taskId,async()=>({resultSummary:'done',evidenceRefs:[]}),{deadline:context('fixture').deadline});
  else fixture.app.runtime.requestCancel(fixture.parent.taskId,'fixture cancellation');
  await assert.rejects(fixture.report(),{code:'REVISION_CONFLICT'});assert.deepEqual(fixture.counts(),{decisions:0,controllerCalls:0});
});
test('state revision change during actual observation rejects stale evidence without decision retry',async t=>{
  const fixture=await boundaryFixture(t,{observe:async(input,runtime)=>{runtime.recordProgress(input.parentTaskId,{stepId:'concurrent-fixture',label:'state changed'});return {};}});
  await assert.rejects(fixture.report(),{code:'REVISION_CONFLICT'});assert.deepEqual(fixture.counts(),{decisions:0,controllerCalls:0});
});
test('failed notification is persisted accurately, does not replay advice, and leaves other child unchanged',async t=>{
  const fixture=await boundaryFixture(t,{action:'notify_controller'}),runtime=fixture.app.runtime;
  const before=runtime.getTask(fixture.otherChild.taskId),original=runtime.recordProgress;
  runtime.recordProgress=()=>{throw Error('explicit notification failure fixture');};
  try {
    const report=await fixture.report();assert.equal(report.notification.state,'not_published');
    assert.deepEqual(await fixture.report(),report);assert.deepEqual(fixture.counts(),{decisions:1,controllerCalls:0});
    assert.deepEqual(runtime.getTask(fixture.otherChild.taskId),before);
    assert.equal(runtime.readEvents().filter(event=>event.type==='task.progress'&&event.payload.stepId===report.notification.stepId).length,0);
    runtime.saveCheckpoint(fixture.child.taskId,'delegation:report:direct-fixture',{...report,notification:{...report.notification,state:'pending'}});
    assert.equal((await fixture.report()).notification.state,'not_published','interrupted notification is reconciled by event readback without resend');
    assert.deepEqual(fixture.counts(),{decisions:1,controllerCalls:0});
  }finally {runtime.recordProgress=original;}
});

test('unregistered controller tool is rejected without granting permissions or stopping child',async t=>{
  let app;const controller=new ModelGateway(new FakeModelProvider([{kind:'final',text:JSON.stringify({advice:'Use absent tool',nextTool:'unregistered.write'})}]));
  const tools=createTestVersionDelegationTools({getRuntime:()=>app.runtime,getTools:()=>app.tools,controller,
    adaptive:{decide:async()=>({selectedId:'request_controller',decided_by:'explicit_fake_decision'})},
    dispatchOptions:{getModelGateway:()=>new ModelGateway(new FakeModelProvider([{kind:'final',text:'fixture'}]))}});
  app=createRuntimeApplication({path:':memory:',profile:'huawei_ict_agentarts',tools:[...tools.childTools]});t.after(()=>app.close());
  const parent=app.runtime.submitTask({conversationId:'fixture',goal:'parent',idempotencyKey:'parent'});
  await tools.dispatch.execute({subtasks:[{subtaskId:'child',role:'coder',goal:'fixture'}]},context(parent.taskId));
  const child=app.runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.taskId}-child`);
  await assert.rejects(tools.childTools[1].execute({problem:'missing capability',candidates:['ask'],nextSteps:['inspect']},context(child.taskId)),{code:'UNSUPPORTED_CAPABILITY'});
  assert.equal(app.runtime.loadCheckpoint(parent.taskId,'delegation:child:child'),undefined);
  assert.equal(app.runtime.getTask(child.taskId).state,'succeeded');
});
test('new delegation site escalates an unqualified local choice to explicit Fake teacher once',async()=>{
  const records=new Map();let localCalls=0;
  const teacherProvider=new FakeModelProvider([{kind:'final',text:JSON.stringify({selectedId:'request_controller',rationale:'fixture blocker needs handling'})}]);
  const selector=createAdaptiveWorkflowSelector({modelRevision:'offline-fixture',laya:{select:async()=>{localCalls++;return 'continue';}},
    teacher:new ModelGateway(teacherProvider),store:{read:key=>records.get(key),writeOnce:(key,value)=>{if(records.has(key))return false;records.set(key,value);return true;}}});
  const result=await selector.decide({requestId:'fixture',site:'delegation.child-report.v1',criteriaVersion:'v1',criteria:'Select handling',context:'Explicit offline fixture blocker',
    candidates:[{id:'continue',description:'continue'},{id:'request_controller',description:'request controller'}],
    sources:[{sourceId:'fixture',revision:'v1',sha256:'0'.repeat(64)}],signal:new AbortController().signal,deadline:context('fixture').deadline});
  assert.equal(result.selectedId,'request_controller');assert.equal(result.reason,'unvalidated_decision_site');assert.equal(localCalls,1);
  assert.equal(teacherProvider.requests.length,1);assert.equal(result.teacher.verification,'mock');
  assert.equal(result.trainingPerformed,false);
});
