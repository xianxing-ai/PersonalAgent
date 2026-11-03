import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {FakeModelProvider, ModelGateway} from '@personal-agent/models';
import {createDeveloperExperienceApplication, openSqliteLearningHost} from '@personal-agent/learning';
import {createDeveloperDirectionSession, createRuntimeApplication, standingDecisionForTool} from '../dist/application.js';

const comment = {name: 'github.pr.comment', version: '1.0.0', sideEffect: 'external_write', requiredScopes: ['github:write'],
  inputSchema: {type: 'object', additionalProperties: false, required: ['repo', 'branch', 'body'], properties: {repo: {type: 'string'}, branch: {type: 'string'}, body: {type: 'string'}}},
  outputSchema: {type: 'object'}, requiresPresence: false, recoverySupport: false, idempotencySupport: false};
const merge = {...comment, name: 'github.pr.merge', requiredScopes: ['github:merge'],
  inputSchema: {type: 'object', additionalProperties: false, required: ['repo', 'branch', 'action'], properties: {repo: {type: 'string'}, branch: {type: 'string'}, action: {type: 'string'}}}};
const deadline = () => new Date(Date.now() + 10_000).toISOString();

async function settle(app) {
  for (let index = 0; index < 200 && app.activeTaskCount; index += 1) await new Promise(resolve => setTimeout(resolve, 5));
}

test('the main tool loop keeps per-action approval until a repository is enrolled, and irreversible actions still ask', async () => {
  const session = createDeveloperDirectionSession({now: () => Date.parse('2026-11-03T00:00:00.000Z')});
  let questions = 0;
  let comments = 0;
  let merges = 0;
  const app = createRuntimeApplication({path: ':memory:', profile: 'huawei_ict_agentarts', hostUserNamespace: 'direction-fixture',
    tools: [
      {descriptor: comment, execute: async () => {comments += 1; return {};}},
      {descriptor: merge, execute: async () => {merges += 1; return {};}},
    ],
    requiresToolAuthorization: () => true,
    requestToolAuthorization: async () => {questions += 1; return 'deny';},
    standingAutonomy: input => standingDecisionForTool(session, input)});
  try {
    const unenrolled = app.submitHostToolTask({commandId: 'comment-unenrolled', toolName: comment.name, toolVersion: comment.version,
      arguments: {repo: 'octo/repo', branch: 'agent/fix', body: 'status'}, deadline: deadline()});
    await settle(app);
    assert.equal(questions, 1);
    assert.equal(comments, 0);
    assert.notEqual(app.runtime.getTask(unenrolled.task.taskId).state, 'succeeded');
    session.enroll({repo: 'octo/repo', credentialRef: 'github-credential-ref'});
    const allowed = app.submitHostToolTask({commandId: 'comment-enrolled', toolName: comment.name, toolVersion: comment.version,
      arguments: {repo: 'octo/repo', branch: 'agent/fix', body: 'status'}, deadline: deadline()});
    await settle(app);
    assert.equal(questions, 1);
    assert.equal(comments, 1);
    assert.equal(app.runtime.getTask(allowed.task.taskId).state, 'succeeded');
    assert.ok(app.runtime.listCheckpointKeys(allowed.task.taskId).some(key => key.startsWith('standing-autonomy-audit:')));
    const irreversible = app.submitHostToolTask({commandId: 'merge-enrolled', toolName: merge.name, toolVersion: merge.version,
      arguments: {repo: 'octo/repo', branch: 'agent/fix', action: 'merge'}, deadline: deadline()});
    await settle(app);
    assert.equal(questions, 2);
    assert.equal(merges, 0);
    assert.notEqual(app.runtime.getTask(irreversible.task.taskId).state, 'succeeded');
  } finally {app.close();}
});

test('budget downgrade calls the fallback gateway only after it is explicitly configured', async () => {
  const primary = new ModelGateway(new FakeModelProvider([{kind: 'final', text: 'primary'}], {model: 'primary-model'}));
  const fallback = new ModelGateway(new FakeModelProvider([{kind: 'final', text: 'fallback'}], {model: 'fallback-model'}));
  const request = {messages: [{role: 'user', content: '继续'}], tools: [], deadline: deadline(), signal: new AbortController().signal};
  const plain = createDeveloperDirectionSession({now: () => Date.parse('2026-11-03T00:00:00.000Z')});
  const goal = plain.submitGoal({sentence: '小预算', repo: 'octo/repo', budget: 1});
  assert.equal(plain.reserveCost({taskId: goal.id, repo: 'octo/repo', tokens: {input: 2_000_000, output: 0}}).action, 'pause');
  await assert.rejects(plain.completeModel(request), {code: 'UNSUPPORTED_CAPABILITY'});
  const switched = createDeveloperDirectionSession({now: () => Date.parse('2026-11-03T00:00:00.000Z'), modelDowngrade: {primary, fallback}});
  const other = switched.submitGoal({sentence: '小预算', repo: 'octo/repo', budget: 1});
  assert.equal(switched.reserveCost({taskId: other.id, repo: 'octo/repo', tokens: {input: 2_000_000, output: 0}}).action, 'downgrade_model');
  const completed = await switched.completeModel(request);
  assert.equal(completed.downgraded, true);
  assert.equal(completed.result.response.text, 'fallback');
  assert.equal(completed.result.deployment.model, 'fallback-model');
});

test('task context includes recipes from the existing developer experience lease', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'direction-experience-'));
  const learning = openSqliteLearningHost(path.join(directory, 'learning.sqlite'));
  const scope = {workspaceId: 'workspace', workspaceDigest: 'b'.repeat(64), configurationDigest: 'c'.repeat(64),
    workflowVersion: 'F15@1', runtimeVersion: 'runtime@1', recipeFingerprint: 'd'.repeat(64)};
  const sourceRef = `developer-experience:v1:dGFzaw:${'a'.repeat(64)}`;
  const context = () => ({deadline: '2099-01-01T00:00:00.000Z', signal: new AbortController().signal});
  const experience = createDeveloperExperienceApplication({namespace: 'developer', learning, ports: {
    readConfirmedSource: () => ({sourceRef, scope, requiredRecipeIds: ['typecheck'], evidenceRefs: ['trial', 'compare', 'adopt', 'publish']}),
    confirmActivation: async () => true,
  }});
  try {
    experience.propose({...context(), workflowId: 'experience', expectedRevision: null, operationId: 'propose', sourceRef, createdAt: '2026-10-20T00:00:00.000Z'});
    await experience.validate('experience', 1, context());
    await experience.activate({...context(), workflowId: 'experience', revision: 1, expectedActiveRevision: null, operationId: 'activate', activatedAt: '2026-10-20T00:00:00.000Z'});
    const session = createDeveloperDirectionSession({readExperienceRecipes: () => experience.assertApplicable(experience.readApplicable('experience', scope, context()), scope, context()).requiredRecipeIds});
    session.rememberProfile(session.applyWizard({repo: 'octo/repo', credentialRef: 'github-credential-ref', files: [{path: 'AGENTS.md', text: '用中文'}], present: true}).profile);
    assert.match(session.taskContext('octo/repo'), /typecheck/);
    assert.match(session.taskContext('octo/repo'), /AGENTS.md/);
  } finally {learning.close(); rmSync(directory, {recursive: true, force: true});}
});
