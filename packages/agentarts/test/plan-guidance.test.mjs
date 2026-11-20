import assert from 'node:assert/strict';
import test from 'node:test';
import {FakeModelProvider} from '@personal-agent/models';
import {OwnedAgentOrchestrator, PROMPT_VERSION, getOwnedBindings} from '../dist/index.js';
import {BOUND_PLAN_DRAFT_PROMPT, PLAN_GUIDANCE_PROMPT, WORLD_GUIDANCE_PROMPT, CONTINUATION_TOOL_PROMPT} from '../dist/prompts.js';
import {planGuidance} from '../dist/world-guidance.js';
import {GOAL_PREFIX} from '../dist/input.js';
import {REPAIR_QUERY} from '../../../tests/manual/agentarts/support/owned-minimal-repair-scenario.mjs';

const ref = (id, revision = 1) => ({id: id.repeat(64), revision});
const node = (id, revision, kind, summary) => ({
  ...ref(id, revision), kind, summary, state: 'active',
  validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
});
const repairQuery = (extra = {}) => GOAL_PREFIX + JSON.stringify({
  action: 'REVISE', strategy: '最小修复',
  nodes: [
    node('b', 1, 'goal', '14点准备'), node('b', 2, 'goal', '16点准备'),
    node('a', 1, 'plan', '14点准备'), node('c', 1, 'plan', '其他工作'),
  ],
  repairContext: {
    expectedGraphRevision: 7,
    targets: [
      {node: ref('a'), summary: '14点准备', requestedDependencies: [ref('b', 2)]},
      {node: ref('c'), summary: '其他工作', requestedDependencies: [ref('b', 2)]},
    ],
    allowedDependencies: [ref('b', 2)],
    ...extra,
  },
  omittedSources: 0, calibrated: false, executed: false,
});

const validWorld = {
  reportVersion: '1.1', revision: 7,
  observed_facts: [{node: ref('b'), fact: '14点准备', confidence: 'explicit'}, {node: ref('b', 2), fact: '16点准备', confidence: 'explicit'}],
  changed_facts: [{previous: ref('b'), current: ref('b', 2), change: '目标时间变化'}],
  affected_items: [{kind: 'plan_step', node: ref('a'), impact: 'direct', reason: '目标时间变化'}],
  missing_information: [], recommended_disposition: 'REVISE', summary: '只改准备时间',
};

const validPlan = {
  reportVersion: '1.1', base_revision: 7, disposition: 'REVISE',
  preserved_steps: [{node: ref('c'), reason: '无关步骤保持不变'}],
  rechecked_steps: [],
  revised_steps: [{node: ref('a'), replacement: '16点准备', reason: '目标时间变化'}],
  removed_steps: [],
  dependency_updates: [{node: ref('a'), dependencies: [ref('b', 2)], reason: '使用新目标版本'}],
  evidence_required: ['本地Runtime/Policy/CAS读回'], missing_information: [], local_next_actions: [],
};

const validCandidate = {
  kind: 'repair_candidate', candidateVersion: '1.0',
  candidate: {
    expectedGraphRevision: 7,
    changes: [{node: ref('a'), summary: '16点准备', reason: '目标时间变化', dependencies: [ref('b', 2)]}],
  },
};

const ctx = () => ({
  deadline: new Date(Date.now() + 5000).toISOString(),
  signal: new AbortController().signal,
  sessionId: 'session-guidance',
  requestId: 'request-guidance',
});

test('planGuidance derives exact affected_targets, preserved_targets and optional prospective_dependencies without preselecting disposition', () => {
  const context = {
    expectedGraphRevision: 7,
    targets: [
      {node: ref('a'), summary: '14点准备', requestedSummary: '16点准备', requestedDependencies: [ref('b', 2)]},
      {node: ref('c'), summary: '其他工作', requestedDependencies: [ref('d', 2)]},
    ],
    allowedDependencies: [ref('b', 2), ref('d', 2)],
  };
  const prospective = [ref('a', 2)];
  const constraints = planGuidance(context, {reportVersion: '1.2', affected: [ref('a').id]}, prospective);
  assert.deepEqual(constraints, {
    reportVersion: '1.2',
    base_revision: 7,
    affected_targets: [{
      node: ref('a'),
      current_summary: '14点准备',
      required_dependencies: [ref('b', 2)],
      required_replacement: '16点准备',
    }],
    preserved_targets: [{node: ref('c')}],
    prospective_dependencies: [ref('a', 2)],
  });
  assert.equal(Object.hasOwn(constraints, 'disposition'), false);
  assert.equal(Object.hasOwn(constraints, 'changes'), false);

  const withoutProspective = planGuidance(context, {affected: [ref('a').id]});
  assert.equal(withoutProspective.reportVersion, '1.1');
  assert.equal(Object.hasOwn(withoutProspective, 'prospective_dependencies'), false);
});

test('prompts reflect current convergence rules for world, plan and non-repeating readonly continuation', () => {
  assert.equal(PROMPT_VERSION, 'owned-1.12');
  assert.match(WORLD_GUIDANCE_PROMPT, /因果/);
  assert.match(PLAN_GUIDANCE_PROMPT, /plan_constraints/);
  assert.match(PLAN_GUIDANCE_PROMPT, /preserved_targets/);
  assert.match(CONTINUATION_TOOL_PROMPT, /confirmed/);
  assert.match(CONTINUATION_TOOL_PROMPT, /严禁再次发出相同tool_proposal/);
});

test('both bound repair routes assemble the same public Plan from the model draft and preserve the exact candidate through Review', async () => {
  const controller = getOwnedBindings().find(b => b.type === 'controller' && b.origin === 'new-owned-binding');
  const planBinding = getOwnedBindings().find(b => b.type === 'workflow' && b.roles.join(',') === 'plan');
  const makeProvider = value => new FakeModelProvider(Array.from({length: 4}, () => ({kind: 'final', text: JSON.stringify(value)})));
  const models = {
    fast: makeProvider({kind: 'text', text: 'unused'}),
    world: makeProvider(validWorld),
    plan: makeProvider({planDraftVersion:'1.0', disposition:'REVISE',
      steps:[{slot:1, action:'revise', reason:validPlan.revised_steps[0].reason}], missing_information:[]}),
    review: makeProvider({reviewDecisionVersion:'1.0', decision:'accept'}),
  };
  const orchestrator = new OwnedAgentOrchestrator(models, 2048);

  const ctrlOut = await orchestrator.invokeController({...ctx(), controllerId: controller.id, query: REPAIR_QUERY});
  assert.equal(ctrlOut.result.kind, 'application_result');
  assert.deepEqual(ctrlOut.result.value, validCandidate);
  const workflowOut = await orchestrator.invokeWorkflow({...ctx(), workflowId: planBinding.id, query: REPAIR_QUERY, world: validWorld});
  assert.equal(workflowOut.result.kind, 'role_report');
  assert.deepEqual(workflowOut.result.value.revised_steps, validPlan.revised_steps);

  assert.equal(models.plan.requests.length, 2);
  for (const request of models.plan.requests) {
    assert.equal(request.messages[0].content, BOUND_PLAN_DRAFT_PROMPT);
    const userPayload = JSON.parse(request.messages[1].content);
    assert.deepEqual(userPayload.plan_constraints.affected_targets, [{
      node: ref('a'),
      current_summary: '14点准备',
      required_dependencies: [ref('b', 2)],
      required_replacement: '16点准备',
    }]);
    assert.deepEqual(userPayload.plan_constraints.preserved_targets, [{node: ref('c')}]);
  }
});

test('validation failures emit sanitized RoleReceipt diagnostics without relaxing rejection or emitting for caller-supplied world/plan', async () => {
  const planBinding = getOwnedBindings().find(b => b.type === 'workflow' && b.roles.join(',') === 'plan');
  const controller = getOwnedBindings().find(b => b.type === 'controller' && b.origin === 'new-owned-binding');
  const runCase = async (models, fn) => {
    const receipts = [];
    const orchestrator = new OwnedAgentOrchestrator(models, 2048, r => receipts.push(r));
    await assert.rejects(() => fn(orchestrator));
    return receipts;
  };
  const once = value => new FakeModelProvider([{kind: 'final', text: JSON.stringify(value)}]);

  // 1. world_report_invalid
  const r1 = await runCase({fast: once({}), world: once({...validWorld, affected_items: [{kind: 'plan', node: ref('a'), impact: 'direct', reason: 'bad'}]}), plan: once(validPlan), review: once(validCandidate)},
    o => o.invokeController({...ctx(), controllerId: controller.id, query: repairQuery()}));
  assert.deepEqual(r1.at(-1), {role: 'world', requestId: 'request-guidance', promptVersion: PROMPT_VERSION, status: 'failed', failureStage: 'role_validation', validationReason: 'world_report_invalid'});

  // 2. plan_scope_exceeded (changes target c which world marked unaffected)
  const outOfScopePlan = {
    ...validPlan,
    preserved_steps: [],
    revised_steps: [...validPlan.revised_steps, {node: ref('c'), replacement: '私自修改', reason: '越界'}],
    dependency_updates: [...validPlan.dependency_updates, {node: ref('c'), dependencies: [ref('b', 2)], reason: '越界'}],
  };
  const r2 = await runCase({fast: once({}), world: once(validWorld), plan: once(outOfScopePlan), review: once(validCandidate)},
    o => o.invokeWorkflow({...ctx(), workflowId: planBinding.id, query: repairQuery(), world: validWorld}));
  assert.equal(r2.at(-1).failureStage, 'role_validation');
  assert.equal(r2.at(-1).validationReason, 'plan_report_invalid'); // preserved/revised mismatch caught inside validatePlan

  // 2b. plan_scope_exceeded (test plan_unsupported_operation on removed_steps)
  const unsupportedPlan = {
    ...validPlan,
    revised_steps: [],
    dependency_updates: [],
    removed_steps: [{node: ref('a'), reason: '删除'}],
  };
  const r2b = await runCase({fast: once({}), world: once(validWorld), plan: once(unsupportedPlan), review: once(validCandidate)},
    o => o.invokeWorkflow({...ctx(), workflowId: planBinding.id, query: repairQuery(), world: validWorld}));
  assert.equal(r2b.at(-1).failureStage, 'role_validation');
  assert.equal(r2b.at(-1).validationReason, 'plan_unsupported_operation');

  // 3. review_plan_substituted
  const substitutedCandidate = {
    kind: 'repair_candidate', candidateVersion: '1.0',
    candidate: {expectedGraphRevision: 7, changes: [{node: ref('c'), summary: '其他工作', reason: '偷换节点', dependencies: [ref('b', 2)]}]},
  };
  const r3 = await runCase({fast: once({}), world: once(validWorld), plan: once(validPlan), review: once(substitutedCandidate)},
    o => o.invokeController({...ctx(), controllerId: controller.id, query: repairQuery()}));
  assert.equal(r3.at(-1).role, 'review');
  assert.equal(r3.at(-1).failureStage, 'role_validation');
  assert.equal(r3.at(-1).validationReason, 'review_plan_substituted');
  assert.equal(JSON.stringify(r3).includes('偷换节点'), false);

  // 4. tool_proposal_invalid
  const r4 = await runCase({fast: once({kind: 'tool_proposal', proposalId: 'proposal-1', toolName: 'unknown.tool', toolVersion: '1.0.0', arguments: {}}), world: once(validWorld), plan: once(validPlan), review: once(validCandidate)},
    o => o.invoke({...ctx(), query: 'hi'}));
  assert.equal(r4.at(-1).role, 'fast');
  assert.equal(r4.at(-1).failureStage, 'role_validation');
  assert.equal(r4.at(-1).validationReason, 'tool_proposal_invalid');

  // 5. Caller-supplied invalid request.world in plan binding does NOT emit model role_validation receipt
  const r5 = await runCase({fast: once({}), world: once(validWorld), plan: once(validPlan), review: once(validCandidate)},
    o => o.invokeWorkflow({...ctx(), workflowId: planBinding.id, query: repairQuery(), world: {invalid: true}}));
  assert.equal(r5.length, 0);
});
