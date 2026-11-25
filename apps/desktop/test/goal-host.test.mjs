import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoalHostCore,createPlanExecutionFactReader} from '../electron/goal-host-core.js';

const namespace = 'desktop-user-v1:00000000-0000-4000-8000-000000000001';
const input = {id: 'goal-1', summary: '完成计划', validFrom: '2026-09-25T00:00:00.000Z',
  validUntil: '2027-09-25T00:00:00.000Z', sensitivity: 'private', state: 'active',
  reason: '用户提出', dependencies: []};
const names = {GOAL_CREATE_TOOL: 'goals.create', GOAL_REVISE_TOOL: 'goals.revise', GOAL_TOOL_VERSION: '1.0.0'};

function fixture() {
  const calls = [];
  const store = {read: () => ({revision: 0}), append: () => {}};
  const readbacks = new Map();
  let resolver;
  const host = createGoalHostCore(namespace, {
    ...names,
    createGoalTools: value => { resolver = value; return [{descriptor: {name: names.GOAL_CREATE_TOOL}},
      {descriptor: {name: names.GOAL_REVISE_TOOL}}]; },
    listGoals: value => { assert.equal(value, store); return {graphRevision: 0, goals: []}; },
    getGoal: (value, id) => { assert.equal(value, store); return {graphRevision: 0, goal: id}; },
  });
  const application = {
    runtime: {
      provisionCoordinationStore: value => { calls.push(['bind', value]); return store; },
      listTasks: () => ({items: [...readbacks.keys()].map(taskId => ({taskId})), snapshotSequence: 1}),
      getApproval: approvalId => {
        const value = [...readbacks.values()].find(item => item.approval?.approvalId === approvalId);
        if (!value) throw Object.assign(Error('not found'), {code: 'NOT_FOUND'});
        return {...value.approval, taskId: value.task.taskId, toolName: value.toolName,
          expiresAt: '2099-01-01T00:00:00.000Z'};
      },
    },
    submitHostToolTask: request => {
      calls.push(['submit', request]);
      const taskId = `task-${readbacks.size + 1}`;
      const readback = {commandId: request.commandId, toolName: request.toolName,
        toolVersion: request.toolVersion,
        task: {taskId, state: 'waiting_approval', revision: 2, updatedAt: '2026-09-25T00:00:00.000Z'},
        approval: {approvalId: 'approval-1', revision: 1, state: 'pending'}};
      readbacks.set(taskId, readback);
      return readback;
    },
    readHostToolTask: taskId => readbacks.get(taskId) ?? (() => { throw Error('not found'); })(),
    resumeHostToolTask: taskId => { calls.push(['resume', taskId]); return readbacks.get(taskId); },
  };
  return {host, application, calls, readbacks, resolver: () => resolver, store};
}

test('Competition Goal host binds one trusted namespace and supplies provenance inside Policy arguments', () => {
  const {host, application, calls, resolver, store} = fixture();
  assert.throws(() => host.list(), /尚未就绪/);
  assert.equal(typeof resolver(), 'function');
  assert.equal(resolver()(), undefined);
  host.bind(application);
  assert.equal(resolver()(), store);
  assert.deepEqual(calls[0], ['bind', namespace]);
  assert.deepEqual(host.list(), {graphRevision: 0, goals: []});
  const result = host.create({expectedGraphRevision: 0, goal: input});
  const request = calls[1][1];
  assert.equal(request.toolName, names.GOAL_CREATE_TOOL);
  assert.equal(request.toolVersion, names.GOAL_TOOL_VERSION);
  assert.match(request.commandId, /^[0-9a-f-]{36}$/);
  assert.equal(request.arguments.goal.sourceRef, `desktop-goal:${request.commandId}`);
  assert.equal(request.arguments.goal.id, input.id);
  assert.equal(result.state, 'waiting_approval');
  assert.equal(result.approval.approvalId, 'approval-1');
  assert.equal(Object.hasOwn(result, 'result'), false);
  assert.throws(() => host.create({expectedGraphRevision: 0, goal: {...input, sourceRef: 'renderer'}}), /未支持的字段/);
});

test('Goal readback only exposes confirmed Goal results and refuses unrelated tools', () => {
  const {host, application, readbacks} = fixture();
  host.bind(application);
  const task = host.revise({expectedGraphRevision: 1, expectedGoalRevision: 1, goal: input});
  const readback = readbacks.get(task.taskId);
  readback.task = {...readback.task, state: 'succeeded'};
  readback.confirmed = {runId: 'run-1', result: {kind: 'applied', graphRevision: 2,
    previousGoal: {id: 'goal-1', revision: 1}, currentGoal: {id: 'goal-1', revision: 2}, secret: 'hidden'},
    evidenceRefs: ['evidence-1']};
  const projected = host.readTask(task.taskId);
  assert.equal(projected.result.currentGoal.revision, 2);
  assert.equal(Object.hasOwn(projected.result, 'secret'), false);
  assert.deepEqual(projected.evidenceRefs, ['evidence-1']);
  readback.toolName = 'other.tool';
  assert.throws(() => host.readTask(task.taskId), /Goal 任务不存在/);
  assert.deepEqual(host.listTasks(), []);
  readback.toolName = names.GOAL_REVISE_TOOL;
  readback.confirmed.result = {kind: 'applied', graphRevision: 2};
  assert.throws(() => host.readTask(task.taskId), /缺少可验证/);
});

test('restart recovery only resumes allowed Goal approvals', () => {
  const {host, application, calls, readbacks} = fixture();
  host.bind(application);
  const task = host.create({expectedGraphRevision: 0, goal: input});
  host.resumeApproved();
  assert.equal(calls.some(call => call[0] === 'resume'), false);
  readbacks.get(task.taskId).approval.state = 'allowed';
  host.resumeApproved();
  assert.deepEqual(calls.at(-1), ['resume', task.taskId]);
});

test('Goal approval expiry comes only from the matching native record and lookup failures stay conservative', () => {
  const {host, application} = fixture();
  let native = {approvalId: 'approval-1', taskId: 'task-1', toolName: names.GOAL_CREATE_TOOL,
    revision: 1, state: 'pending', expiresAt: '2099-01-01T00:00:00.000Z', scopes: ['secret']};
  application.runtime.getApproval = () => native;
  host.bind(application);
  const task = host.create({expectedGraphRevision: 0, goal: input});
  assert.equal(task.approval.expiresAt, native.expiresAt);
  assert.equal(Object.hasOwn(task.approval, 'scopes'), false);
  assert.equal(host.listTasks()[0].approval.expiresAt, native.expiresAt);
  for (const field of ['approvalId', 'taskId', 'toolName', 'revision', 'state']) {
    const original = native[field]; native[field] = field === 'revision' ? 2 : 'wrong';
    assert.equal(Object.hasOwn(host.readTask(task.taskId).approval, 'expiresAt'), false, field);
    native[field] = original;
  }
  native.expiresAt = 0;
  assert.equal(Object.hasOwn(host.readTask(task.taskId).approval, 'expiresAt'), false);
  application.runtime.getApproval = () => {throw Object.assign(Error('not found'), {code: 'NOT_FOUND'});};
  assert.equal(Object.hasOwn(host.readTask(task.taskId).approval, 'expiresAt'), false);
  const error = Object.assign(Error('storage unavailable'), {code: 'UNAVAILABLE'});
  application.runtime.getApproval = () => {throw error;};
  assert.throws(() => host.readTask(task.taskId), candidate => candidate === error);
});

test('native Plan selection confirms the original summary/deployment once and observes an existing task without new admission',async()=>{
  const {host,application}=fixture();host.bind(application);
  const payload={plan:{id:'plan',revision:2},expectedGraphRevision:4,requestId:'synthetic-plan-click'},submissions=[];
  let prior,confirmations=0,release;
  application.readPlanExecutionTask=()=>prior;
  application.previewPlanExecution=async selection=>({source:{...selection,summary:'Actual selected summary',configurationRef:'fixed-deployment',nodes:[{}],facts:[]},sourceDigest:'a'.repeat(64)});
  application.submitPlanExecutionTask=async input=>{submissions.push(input);return prior={taskId:'original-root',state:'waiting_approval',conversationId:input.conversationId};};
  const context={conversationId:'original-chat',deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal,
    confirm:async dto=>{confirmations++;assert.equal(dto.summary,'Actual selected summary');assert.equal(dto.configurationRef,'fixed-deployment');
      assert.equal(Object.hasOwn(dto,'facts'),false);await new Promise(resolve=>{release=resolve;});return true;}};
  const first=host.executePlan(payload,context),duplicate=host.executePlan(payload,context);
  await new Promise(resolve=>setImmediate(resolve));context.conversationId='changed-chat';release();
  assert.deepEqual(await first,await duplicate);assert.equal(confirmations,1);assert.equal(submissions.length,1);
  assert.equal(submissions[0].conversationId,'original-chat');assert.equal(submissions[0].graphNamespace,namespace);
  application.previewPlanExecution=()=>{throw Error('Plan revoked');};
  assert.equal((await host.executePlan({...payload,requestId:'new-renderer-click'},context)).task.taskId,'original-root');
  assert.equal(confirmations,1);assert.equal(submissions.length,1);
});

test('declined native confirmation creates no Plan task and Memory source adapter refuses replaced namespaces or heads',async()=>{
  const {host,application}=fixture();host.bind(application);let submits=0;
  application.readPlanExecutionTask=()=>undefined;application.previewPlanExecution=async()=>({source:{plan:{id:'plan',revision:1},summary:'summary',
    configurationRef:'deployment',nodes:[{}],facts:[]},sourceDigest:'a'.repeat(64)});
  application.submitPlanExecutionTask=()=>{submits++;};
  const context={conversationId:'chat',deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal,confirm:async()=>false};
  assert.deepEqual(await host.executePlan({plan:{id:'plan',revision:1},expectedGraphRevision:1,requestId:'synthetic-decline'},context),{state:'declined'});
  assert.equal(submits,0);
  let sources;const current={ref:{id:'fact',revision:1},state:'active'};
  const facts={readCurrentPublicFact:()=>current};sources=[{memoryNamespace:'bound',facts}];
  const read=createPlanExecutionFactReader(()=>sources);
  assert.equal(read({memoryNamespace:'bound',fact:current.ref},context),current);
  assert.equal(read({memoryNamespace:'bound',fact:{id:'fact',revision:2}},context),undefined);
  assert.throws(()=>read({memoryNamespace:'foreign',fact:current.ref},context),/未接通/);
  facts.readCurrentPublicFact=()=>{sources=[];return current;};
  assert.throws(()=>read({memoryNamespace:'bound',fact:current.ref},context),/已变化/);
});
