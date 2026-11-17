import assert from 'node:assert/strict';
import test from 'node:test';
import {InMemoryAuthorizationPolicy} from '@personal-agent/policy';
import {
  AutonomyPolicyConfig,
  MemoryAutonomyConfigStore,
  RISK_CLASSIFICATION_TABLE,
  applyAutonomyGrant,
  classifyTool,
  createRiskAutonomyGate,
} from '../dist/index.js';

const digest = 'a'.repeat(64);
const otherDigest = 'b'.repeat(64);
const grantBase = {
  authorizationRef: 'auth-1',
  taskId: 'task-1',
  scopes: ['fixture:read'],
  expiresAt: '2026-12-01T00:00:00.000Z',
  argumentsDigest: digest,
  maxUses: 1,
};

test('the classification table keeps irreversible actions gated and only compensatable writes at medium', () => {
  assert.equal(classifyTool({toolName: 'weather.forecast'}).catalogued, true);
  assert.equal(classifyTool({toolName: 'fixture.read', sideEffect: 'read'}).catalogued, false);
  assert.equal(classifyTool({toolName: 'todo.update'}).tier, 'medium');
  assert.equal(classifyTool({toolName: 'todo.update'}).compensatable, true);
  assert.equal(classifyTool({toolName: 'todo.update', sideEffect: 'local_write'}).compensation?.action, 'todo.update');
  const removed = classifyTool({toolName: 'file.delete', sideEffect: 'local_write', recoverySupport: true});
  assert.equal(removed.category, 'delete');
  assert.equal(removed.irreversible, true);
  assert.equal(removed.floorAsk, true);
  assert.equal(classifyTool({toolName: 'payment.pay', sideEffect: 'local_write', recoverySupport: true}).category, 'payment');
  assert.equal(classifyTool({toolName: 'mail.send', sideEffect: 'read'}).category, 'message_send');
  assert.equal(classifyTool({toolName: 'weather.forecast', action: 'send_message', sideEffect: 'read'}).category, 'message_send');
  assert.equal(classifyTool({toolName: 'weather.forecast', sideEffect: 'external_write'}).category, 'external_submit');
  assert.equal(classifyTool({toolName: 'calendar.create'}).irreversible, true);
  assert.equal(classifyTool({toolName: 'git.push.force'}).category, 'external_submit');
  assert.equal(classifyTool({toolName: 'mail.reconcile_send', sideEffect: 'read'}).category, 'read');
  const presence = classifyTool({toolName: 'computer.desktop.click', sideEffect: 'read', requiresPresence: true});
  assert.equal(presence.category, 'presence');
  assert.equal(presence.floorAsk, true);
  const plainWrite = classifyTool({toolName: 'workspace.apply_text_patch', sideEffect: 'local_write', recoverySupport: false});
  assert.equal(plainWrite.category, 'local_write');
  assert.equal(plainWrite.tier, 'high');
  assert.equal(plainWrite.compensatable, false);
  const restored = classifyTool({toolName: 'notes.rewrite', sideEffect: 'local_write', recoverySupport: true});
  assert.equal(restored.tier, 'medium');
  assert.equal(restored.compensation?.action, 'restore:notes.rewrite');
  assert.ok(RISK_CLASSIFICATION_TABLE.every(entry => !entry.irreversible || entry.tier === 'high'));
  assert.ok(RISK_CLASSIFICATION_TABLE.filter(entry => entry.tier === 'medium').every(entry => entry.compensation));
});

test('autonomous, balanced and conservative stances map the three risk tiers', () => {
  const autonomous = new AutonomyPolicyConfig();
  assert.equal(autonomous.decide({toolName: 'weather.forecast', sideEffect: 'read'}).disposition, 'execute');
  assert.equal(autonomous.decide({toolName: 'todo.update', sideEffect: 'local_write'}).disposition, 'execute_and_notify');
  assert.equal(autonomous.decide({toolName: 'workspace.apply_text_patch', sideEffect: 'local_write'}).disposition, 'ask');
  assert.equal(autonomous.decide({toolName: 'mail.send', sideEffect: 'external_write'}).disposition, 'ask');
  assert.equal(autonomous.decide({toolName: 'payment.transfer'}).disposition, 'ask');

  const balanced = new AutonomyPolicyConfig({stance: 'balanced'});
  assert.equal(balanced.decide({toolName: 'weather.forecast', sideEffect: 'read'}).disposition, 'execute');
  assert.equal(balanced.decide({toolName: 'todo.update', sideEffect: 'local_write'}).disposition, 'ask');
  assert.equal(balanced.decide({toolName: 'mail.send'}).disposition, 'ask');

  const conservative = new AutonomyPolicyConfig({stance: 'conservative'});
  assert.equal(conservative.decide({toolName: 'weather.forecast', sideEffect: 'read'}).disposition, 'ask');
  assert.equal(conservative.decide({toolName: 'todo.list', sideEffect: 'read'}).disposition, 'ask');
  assert.equal(conservative.decide({toolName: 'todo.update', sideEffect: 'local_write'}).disposition, 'ask');
});

test('category overrides and revocation cannot turn irreversible actions into automatic execution', () => {
  const config = new AutonomyPolicyConfig();
  config.setCategoryOverride('read', 'ask');
  assert.equal(config.decide({toolName: 'weather.forecast', sideEffect: 'read'}).disposition, 'ask');
  assert.equal(config.decide({toolName: 'weather.forecast', sideEffect: 'read'}).overrideApplied, true);
  config.clearCategoryOverride('read');
  assert.equal(config.decide({toolName: 'weather.forecast', sideEffect: 'read'}).disposition, 'execute');
  config.setCategoryOverride('local_reversible_write', 'execute');
  const silent = config.decide({toolName: 'todo.update', sideEffect: 'local_write'});
  assert.equal(silent.disposition, 'execute');
  assert.equal(silent.compensatable, true);
  config.setCategoryOverride('local_reversible_write', 'ask');
  assert.equal(config.decide({toolName: 'todo.create', sideEffect: 'local_write'}).disposition, 'ask');
  for (const category of ['message_send', 'payment', 'delete', 'external_submit', 'presence', 'local_write']) {
    assert.throws(() => config.setCategoryOverride(category, 'execute'), {code: 'INVALID_ARGUMENT'});
    assert.throws(() => config.setCategoryOverride(category, 'execute_and_notify'), {code: 'INVALID_ARGUMENT'});
  }
  config.setCategoryOverride('message_send', 'ask');
  assert.equal(config.decide({toolName: 'mail.send', sideEffect: 'external_write'}).disposition, 'ask');
  config.revoke();
  assert.equal(config.decide({toolName: 'weather.forecast', sideEffect: 'read'}).disposition, 'ask');
  assert.equal(config.decide({toolName: 'weather.forecast', sideEffect: 'read'}).reason, 'autonomy revoked');
  config.restore();
  assert.equal(config.decide({toolName: 'weather.forecast', sideEffect: 'read'}).disposition, 'execute');
  const described = config.describeSettings();
  assert.equal(described.categories.find(item => item.category === 'message_send')?.floor, 'ask');
  assert.deepEqual(described.categories.find(item => item.category === 'read')?.allowedDispositions,
    ['execute', 'execute_and_notify', 'ask']);
  const store = new MemoryAutonomyConfigStore();
  store.save({stance: 'autonomous', revoked: false, revision: 3, categoryOverrides: {message_send: 'execute'}});
  assert.throws(() => new AutonomyPolicyConfig({store}), {code: 'INVALID_ARGUMENT'});
});

test('automatic execution writes an audit and a notification, and only compensated actions can be undone', () => {
  let next = 0;
  const config = new AutonomyPolicyConfig({idFactory: () => `id-${++next}`, now: () => new Date('2026-11-11T00:00:00.000Z')});
  const read = config.recordAutomatic({
    toolName: 'weather.forecast', sideEffect: 'read', runId: 'run-read', toolVersion: '1.0.0',
    argumentsDigest: digest, taskId: 'task-1',
  });
  assert.equal(read.audit.disposition, 'execute');
  assert.equal(read.notification.immediate, false);
  assert.equal(read.notification.undoAvailable, false);
  assert.equal(read.audit.argumentsDigest, digest);
  assert.equal(JSON.stringify(read.audit).includes('青岛'), false);
  const write = config.recordAutomatic({
    toolName: 'todo.update', sideEffect: 'local_write', runId: 'run-write', toolVersion: '1.0.0',
    argumentsDigest: digest,
  });
  assert.equal(write.audit.disposition, 'execute_and_notify');
  assert.equal(write.notification.immediate, true);
  assert.equal(write.notification.summary, '已完成可回滚动作 todo.update');
  assert.deepEqual(config.requestUndo(write.audit.auditId), {
    auditId: write.audit.auditId,
    state: 'rollback_requested',
    compensation: {action: 'todo.update', summary: '写回变更前的待办字段'},
  });
  assert.equal(config.requestUndo(write.audit.auditId).state, 'rollback_requested');
  assert.equal(config.listAudits().find(item => item.auditId === write.audit.auditId)?.rollback, 'requested');
  assert.throws(() => config.requestUndo(read.audit.auditId), {code: 'INVALID_ARGUMENT'});
  assert.throws(() => config.recordAutomatic({
    toolName: 'mail.send', sideEffect: 'external_write', runId: 'run-send', toolVersion: '1.0.0', argumentsDigest: digest,
  }), {code: 'UNAUTHORIZED'});
  assert.equal(config.listAudits().some(item => item.toolName === 'mail.send'), false);
  const again = config.recordAutomatic({
    toolName: 'weather.forecast', sideEffect: 'read', runId: 'run-read', toolVersion: '1.0.0', argumentsDigest: digest, taskId: 'task-1',
  });
  assert.equal(again.audit.auditId, read.audit.auditId);
  assert.equal(config.listNotifications().length, 2);
  assert.throws(() => config.recordAutomatic({
    toolName: 'weather.forecast', sideEffect: 'read', runId: 'run-read', toolVersion: '1.0.0', argumentsDigest: otherDigest,
  }), {code: 'REVISION_CONFLICT'});
  config.revoke();
  assert.throws(() => config.recordAutomatic({
    toolName: 'research.search', sideEffect: 'read', runId: 'run-after-revoke', toolVersion: '1.0.0', argumentsDigest: digest,
  }), {code: 'UNAUTHORIZED'});
  assert.equal(config.requestUndo(write.audit.auditId).state, 'rollback_requested');
});

test('applyAutonomyGrant uses the existing Policy grant and refuses irreversible actions', () => {
  const policy = new InMemoryAuthorizationPolicy();
  const config = new AutonomyPolicyConfig();
  const allowed = applyAutonomyGrant(policy, config, {
    grant: {...grantBase, toolName: 'weather.forecast', scopes: ['weather:read']},
    toolVersion: '1.0.0', runId: 'run-1', argumentsDigest: digest, sideEffect: 'read', taskId: 'task-1',
  });
  assert.equal(allowed.granted, true);
  assert.deepEqual(policy.authorize({
    authorizationRef: 'auth-1', taskId: 'task-1', toolName: 'weather.forecast', requiredScopes: ['weather:read'],
    argumentsDigest: digest, now: Date.parse('2026-11-11T00:00:00.000Z'),
  }).scopes, ['weather:read']);
  const denied = applyAutonomyGrant(policy, config, {
    grant: {...grantBase, authorizationRef: 'auth-send', toolName: 'mail.send', scopes: ['mail:write']},
    toolVersion: '1.0.0', runId: 'run-send', argumentsDigest: digest, sideEffect: 'external_write',
  });
  assert.equal(denied.granted, false);
  assert.equal(denied.decision.disposition, 'ask');
  assert.equal(policy.get('auth-send'), undefined);
  config.revoke();
  const blocked = new InMemoryAuthorizationPolicy();
  const after = applyAutonomyGrant(blocked, config, {
    grant: {...grantBase, authorizationRef: 'auth-2', toolName: 'weather.forecast', scopes: ['weather:read']},
    toolVersion: '1.0.0', runId: 'run-2', argumentsDigest: digest, sideEffect: 'read',
  });
  assert.equal(after.granted, false);
  assert.equal(blocked.get('auth-2'), undefined);
});

test('the runtime gate rechecks the current settings before recording a grant', () => {
  const config = new AutonomyPolicyConfig();
  const gate = createRiskAutonomyGate(config);
  const input = {
    taskId: 'task-1', runId: 'run-1', toolName: 'todo.update', toolVersion: '1.0.0',
    sideEffect: 'local_write', recoverySupport: true, requiresPresence: false, argumentsDigest: digest,
  };
  assert.equal(gate.review({toolName: 'weather.forecast', sideEffect: 'read', toolVersion: '1.0.0', runId: 'r', taskId: 't', recoverySupport: false, requiresPresence: false, argumentsDigest: digest}).blockLegacy, false);
  const strict = new AutonomyPolicyConfig({stance: 'conservative'});
  assert.equal(createRiskAutonomyGate(strict).review({toolName: 'weather.forecast', sideEffect: 'read', toolVersion: '1.0.0', runId: 'r', taskId: 't', recoverySupport: false, requiresPresence: false, argumentsDigest: digest}).blockLegacy, true);
  const store = new MemoryAutonomyConfigStore();
  const first = new AutonomyPolicyConfig({store});
  first.setStance('balanced');
  const second = new AutonomyPolicyConfig({store});
  assert.equal(second.getSettings().stance, 'balanced');
  const medium = new AutonomyPolicyConfig();
  medium.recordAutomatic({toolName: 'todo.update', sideEffect: 'local_write', runId: 'run-undo', toolVersion: '1.0.0', argumentsDigest: digest});
  const audit = medium.listAudits()[0];
  medium.rememberCompensation('run-undo', {toolName: 'notes.restore', toolVersion: '1.0.0', arguments: {note: 'back'}});
  assert.deepEqual(medium.consumeCompensation(audit.auditId).call, {toolName: 'notes.restore', toolVersion: '1.0.0', arguments: {note: 'back'}});
  config.revoke();
  assert.equal(gate.review(input).disposition, 'ask');
  assert.throws(() => gate.recordGranted({...input, disposition: 'execute_and_notify'}), {code: 'UNAUTHORIZED'});
  assert.equal(config.listAudits().length, 0);
  config.restore();
  gate.recordGranted({...input, disposition: 'execute_and_notify'});
  assert.equal(config.listAudits()[0]?.immediate, true);
  assert.equal(config.listNotifications()[0]?.undoAvailable, true);
});
