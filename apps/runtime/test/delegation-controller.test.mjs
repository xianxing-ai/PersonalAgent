import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createRuntimeApplication, consumeOriginalChildControllerAdvice} from '../dist/application.js';
import {createRuntimeSubagentDispatchTool} from '../dist/application/subagent-host.js';
import {FakeCoordinationPort} from '@personal-agent/coordination/testing';
import {FakeModelProvider, ModelGateway} from '@personal-agent/models';

test('bound child report reaches the parent, a stale revision conflicts, and teacher advice adds no tool', async () => {
  const descriptor = {name:'fixture.child-read', version:'1.0.0', inputSchema:{type:'object'}, outputSchema:{type:'object'},
    sideEffect:'read', requiredScopes:['fixture:read'], idempotencySupport:true, recoverySupport:true, requiresPresence:false};
  const tool = {descriptor, execute: async () => ({value:'unread'})};
  const app = createRuntimeApplication({path:join(mkdtempSync(join(process.cwd(), '.cache', 'delegation-controller-')), 'runtime.sqlite'),
    profile:'huawei_ict_agentarts', tools:[tool], automaticTools:[{toolName:descriptor.name, toolVersion:descriptor.version}],
    coordination:new FakeCoordinationPort(() => ({kind:'text', text:'unused', verification:'mock'}))});
  const parent = app.runtime.submitTask({goal:'delegate', conversationId:'competition', idempotencyKey:'parent'});
  const gateway = new ModelGateway(new FakeModelProvider([() => ({kind:'final', text:'fixture child report'})]));
  let grants = 0;
  const grant = app.runtime.policy.grant.bind(app.runtime.policy);
  app.runtime.policy.grant = input => {grants++; return grant(input);};
  try {
    const deadline = new Date(Date.now()+60_000).toISOString();
    const dispatch = createRuntimeSubagentDispatchTool({getRuntime:() => app.runtime, getModelGateway:() => gateway, getTools:() => app.tools});
    await dispatch.execute({subtasks:[{subtaskId:'child', role:'researcher', goal:'read the assigned material'}]},
      {taskId:parent.taskId, runId:'dispatch', authorizationRef:'parent-ref', scopes:['agent:delegate'], signal:new AbortController().signal, deadline});
    const child = app.runtime.findTaskByIdempotencyKey('subagent-dispatch-'+parent.taskId+'-child');
    assert.equal(child.state, 'succeeded');
    const report = {reportId:'report-1', parentTaskId:parent.taskId, childTaskId:child.taskId, expectedChildRevision:child.revision,
      problem:'fixture blocker', candidates:['wait'], nextSteps:['ask the original controller']};
    const scope = {deadline, signal:new AbortController().signal};
    let decisions = 0, adviceCalls = 0;
    const ports = {listTools:() => app.tools.list(),
      decide:() => {decisions++; return {selectedId:'request_controller', decided_by:'explicit_fake_decision'};},
      advise:() => {adviceCalls++; return {advice:'stay inside the original tool', nextTool:null};}};
    assert.throws(() => consumeOriginalChildControllerAdvice(app.runtime, {...report, expectedChildRevision:child.revision-1}, ports, scope), {code:'REVISION_CONFLICT'});
    assert.equal(decisions, 0);
    assert.throws(() => consumeOriginalChildControllerAdvice(app.runtime, report, {...ports, advise:() => {adviceCalls++; return {advice:'open a new tool', nextTool:'unregistered.write'};}}, scope), {code:'UNSUPPORTED_CAPABILITY'});
    assert.throws(() => consumeOriginalChildControllerAdvice(app.runtime, {...report, reportId:'report-no-advise'}, {listTools:ports.listTools, decide:ports.decide}, scope), {code:'UNSUPPORTED_CAPABILITY'});
    assert.equal(app.runtime.loadCheckpoint(parent.taskId, 'delegation:child:child'), undefined);
    const decision = consumeOriginalChildControllerAdvice(app.runtime, report, ports, scope);
    assert.equal(decision.action, 'request_controller');
    assert.equal(decision.controllerAdvice.nextTool, null);
    assert.equal(decision.executionRequiresOriginalPolicy, true);
    assert.equal(decision.trainingPerformed, false);
    assert.equal(decision.notification.state, 'published');
    assert.equal(app.runtime.readEvents().some(event => event.taskId === parent.taskId && event.type === 'task.progress' && event.payload.stepId === decision.notification.stepId), true);
    assert.equal(consumeOriginalChildControllerAdvice(app.runtime, report, ports, scope).inputDigest, decision.inputDigest);
    assert.equal(decisions, 3);
    assert.equal(adviceCalls, 2);
    assert.equal(grants, 0);
    assert.throws(() => consumeOriginalChildControllerAdvice(app.runtime, {...report, reportId:'report-2', expectedChildRevision:child.revision+1}, ports, scope), {code:'REVISION_CONFLICT'});
    assert.equal(decisions, 3);
    app.runtime.requestCancel(parent.taskId, 'cancelled fixture parent');
    assert.throws(() => consumeOriginalChildControllerAdvice(app.runtime, {...report, reportId:'report-cancelled-parent'}, ports, scope), {code:'REVISION_CONFLICT'});
  } finally {app.close();}
});
