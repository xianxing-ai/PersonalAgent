import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CrewError,
  CrewKernel,
  openCrewKernel,
} from '../dist/index.js';

const root = fileURLToPath(new URL('../../../.cache/crew-tests/', import.meta.url));
mkdirSync(root, {recursive: true});
const dbFile = () => join(mkdtempSync(join(root, 'consent-')), 'crew.sqlite');

function open(path = dbFile()) {
  let clock = 1700000000000;
  return {kernel: openCrewKernel(path, {now: () => (clock += 1000)}), path, clock: () => clock};
}

test('consent defaults to refused: requireGranted throws CONSENT_REQUIRED before any grant', () => {
  const {kernel} = open();
  try {
    for (const driverId of ['codex', 'claude', 'opencode', 'grok', 'gemini', 'acp-generic']) {
      assert.throws(
        () => kernel.consent.requireGranted(driverId),
        error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
        driverId,
      );
      assert.equal(kernel.consent.getConsent(driverId), undefined);
    }
  } finally { kernel.close(); }
});

test('grant records the user consent into the crew SQLite store and requireGranted passes', () => {
  const {kernel} = open();
  try {
    const record = kernel.consent.grant({
      driverId: 'codex',
      loginKind: 'local-login',
      termsSummary: 'Codex（OpenAI）：使用本人本机已登录的官方 CLI，Sign in with ChatGPT；请求来自用户本人控制的环境，不得多人共用',
      grantedBy: 'user',
    });
    assert.equal(record.granted, true);
    assert.equal(record.loginKind, 'local-login');
    assert.equal(record.driverId, 'codex');
    assert.ok(record.grantedAt);
    assert.equal(record.revokedAt, undefined);
    const granted = kernel.consent.requireGranted('codex');
    assert.equal(granted.granted, true);
    assert.equal(granted.termsSummary.includes('不得多人共用'), true);
    // 其他驱动不受影响。
    assert.throws(() => kernel.consent.requireGranted('grok'), error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED');
  } finally { kernel.close(); }
});

test('revoke flips the record, keeps audit fields, and start-side checks refuse again', () => {
  const {kernel} = open();
  try {
    kernel.consent.grant({driverId: 'codex', loginKind: 'local-login', termsSummary: 'x', grantedBy: 'user'});
    const revoked = kernel.consent.revoke('codex', '用户撤销：改用 API key');
    assert.equal(revoked.granted, false);
    assert.equal(revoked.revokeReason, '用户撤销：改用 API key');
    assert.ok(revoked.revokedAt);
    assert.throws(
      () => kernel.consent.requireGranted('codex'),
      error => error instanceof CrewError && error.code === 'CONSENT_REQUIRED',
    );
    assert.throws(
      () => kernel.consent.revoke('codex', '重复撤销'),
      error => error instanceof CrewError && error.code === 'CONFLICT',
    );
    assert.throws(
      () => kernel.consent.revoke('gemini', '从未同意过'),
      error => error instanceof CrewError && error.code === 'NOT_FOUND',
    );
  } finally { kernel.close(); }
});

test('re-grant after revoke enables the driver again with fresh consent fields', () => {
  const {kernel} = open();
  try {
    kernel.consent.grant({driverId: 'codex', loginKind: 'local-login', termsSummary: '第一次', grantedBy: 'user'});
    const revoked = kernel.consent.revoke('codex', '暂停使用');
    assert.equal(revoked.granted, false);
    const again = kernel.consent.grant({driverId: 'codex', loginKind: 'local-login', termsSummary: '第二次同意', grantedBy: 'user'});
    assert.equal(again.granted, true);
    assert.equal(again.termsSummary, '第二次同意');
    assert.equal(again.revokedAt, undefined);
    assert.equal(again.revokeReason, undefined);
    assert.ok(again.grantedAt > revoked.revokedAt, 're-grant records a fresh timestamp');
    assert.equal(kernel.consent.requireGranted('codex').termsSummary, '第二次同意');
  } finally { kernel.close(); }
});

test('consent records survive a restart of the same database', () => {
  const {kernel, path} = open();
  kernel.consent.grant({driverId: 'codex', loginKind: 'local-login', termsSummary: '持久化检查', grantedBy: 'user'});
  kernel.close();
  const reopened = openCrewKernel(path, {now: () => 1700009999999});
  try {
    const record = reopened.consent.requireGranted('codex');
    assert.equal(record.granted, true);
    assert.equal(record.termsSummary, '持久化检查');
  } finally { reopened.close(); }
});

test('invalid consent inputs are rejected without writes', () => {
  const {kernel} = open();
  try {
    assert.throws(
      () => kernel.consent.grant({driverId: 'not-a-driver', loginKind: 'local-login', termsSummary: 'x', grantedBy: 'user'}),
      error => error instanceof CrewError && error.code === 'INVALID_INPUT',
    );
    assert.throws(
      () => kernel.consent.grant({driverId: 'codex', loginKind: 'shared-subscription', termsSummary: 'x', grantedBy: 'user'}),
      error => error instanceof CrewError && error.code === 'INVALID_INPUT',
    );
    assert.throws(
      () => kernel.consent.grant({driverId: 'codex', loginKind: 'local-login', termsSummary: '  ', grantedBy: 'user'}),
      error => error instanceof CrewError && error.code === 'INVALID_INPUT',
    );
    assert.equal(kernel.consent.getConsent('codex'), undefined, 'rejected grants must not write');
  } finally { kernel.close(); }
});

test('the kernel exposes the consent provider that drivers share', () => {
  const {kernel} = open();
  try {
    assert.ok(typeof kernel.consent.requireGranted === 'function');
    kernel.consent.grant({driverId: 'opencode', loginKind: 'api-key', termsSummary: 'OpenCode provider API key', grantedBy: 'user'});
    const record = kernel.consent.getConsent('opencode');
    assert.equal(record.loginKind, 'api-key');
    assert.ok(kernel instanceof CrewKernel);
  } finally { kernel.close(); }
});
