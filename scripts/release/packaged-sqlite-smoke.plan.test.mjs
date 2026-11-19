import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  planPackagedSqliteSmoke,
  checkPackagedSqliteSmokePlan,
} from './packaged-sqlite-smoke.plan.mjs';
import { runReleasePreflight } from './preflight.mjs';

function writeJson(root, relativePath, data) {
  const absolute = path.resolve(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(data, null, 2)}\n`);
}

test('planPackagedSqliteSmoke outputs unavailable and pending on non-Windows', () => {
  const plan = planPackagedSqliteSmoke({ platform: 'linux' });

  assert.equal(plan.ready, false);
  assert.equal(plan.reason, 'unavailable');
  assert.equal(plan.pending, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.verified, false);
  assert.equal(plan.evidenceLevel, 'unverified');
  assert.equal(plan.platform, 'linux');
});

test('planPackagedSqliteSmoke outputs unavailable and pending on Windows without artifact', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-smoke-plan-test-'));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const plan = planPackagedSqliteSmoke({ platform: 'win32', projectRoot: tmpRoot });

  assert.equal(plan.ready, false);
  assert.equal(plan.reason, 'unavailable');
  assert.equal(plan.pending, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.verified, false);
  assert.equal(plan.evidenceLevel, 'unverified');
});

test('planPackagedSqliteSmoke with dummy or real path does not execute Electron and remains unverified', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-smoke-plan-test-'));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const fakeExe = path.join(tmpRoot, 'fake-electron.exe');
  fs.writeFileSync(fakeExe, 'not-a-real-binary');

  const plan = planPackagedSqliteSmoke({
    platform: 'win32',
    projectRoot: tmpRoot,
    artifactPath: fakeExe,
  });

  // 必须保持 pending 与 unverified，不得宣称已验收
  assert.equal(plan.pending, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.verified, false);
  assert.equal(plan.evidenceLevel, 'unverified');
  assert.equal(plan.ready, true);
  assert.equal(plan.reason, 'planned_manual_acceptance_required');
});

test('checklist includes table creation, WAL mode, read-write, and restart readback', () => {
  const plan = planPackagedSqliteSmoke({ platform: 'linux' });
  const text = plan.checklist.join(' ');

  assert.ok(text.includes('node:sqlite'), 'checklist must require node:sqlite');
  assert.ok(text.includes('建库'), 'checklist must require table creation / migration');
  assert.ok(text.includes('WAL'), 'checklist must require WAL mode');
  assert.ok(text.includes('读写'), 'checklist must require read-write transactions');
  assert.ok(text.includes('重启读回'), 'checklist must require restart readback');
});

test('placeholder file in repo conforms to pending and unverified requirements without passed', () => {
  const placeholderPath = path.resolve(process.cwd(), 'tests/manual/release/windows-electron-sqlite.json');
  assert.ok(fs.existsSync(placeholderPath), 'Placeholder file must exist');

  const raw = fs.readFileSync(placeholderPath, 'utf8');
  assert.equal(/"status"\s*:\s*"passed"/i.test(raw), false, 'Must not claim status=passed');
  assert.equal(/"verified"\s*:\s*true/i.test(raw), false, 'Must not claim verified=true');

  const parsed = JSON.parse(raw);
  assert.equal(parsed.status, 'pending');
  assert.equal(parsed.executed, false);
  assert.equal(parsed.verified, false);
  assert.equal(parsed.evidenceLevel, 'unverified');
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.profile, 'huawei_ict_agentarts');

  const checklistText = parsed.checklist.join(' ');
  assert.ok(checklistText.includes('node:sqlite'));
  assert.ok(checklistText.includes('建库'));
  assert.ok(checklistText.includes('WAL'));
  assert.ok(checklistText.includes('读写'));
  assert.ok(checklistText.includes('重启读回'));
});

test('checkPackagedSqliteSmokePlan passes on repo root', () => {
  const result = checkPackagedSqliteSmokePlan({ projectRoot: process.cwd() });
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.ok(result.checks.every((c) => c.status === 'pass'));
});

test('checkPackagedSqliteSmokePlan detects illegal passed flag and missing checklist items', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-smoke-plan-test-'));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  // Case 1: missing placeholder
  const missingRes = checkPackagedSqliteSmokePlan({ projectRoot: tmpRoot });
  assert.equal(missingRes.ok, false);
  assert.ok(missingRes.errors.some((e) => e.includes('missing or invalid')));

  // Case 2: illegal passed flag
  writeJson(tmpRoot, 'tests/manual/release/windows-electron-sqlite.json', {
    schemaVersion: 1,
    status: 'passed',
    executed: true,
    verified: true,
    evidenceLevel: 'verified',
    checklist: ['node:sqlite', '建库', 'WAL', '读写', '重启读回'],
  });
  const passedRes = checkPackagedSqliteSmokePlan({ projectRoot: tmpRoot });
  assert.equal(passedRes.ok, false);
  assert.ok(passedRes.errors.some((e) => e.includes('NEVER declare passed')));

  // Case 3: missing checklist keywords
  writeJson(tmpRoot, 'tests/manual/release/windows-electron-sqlite.json', {
    schemaVersion: 1,
    status: 'pending',
    executed: false,
    verified: false,
    evidenceLevel: 'unverified',
    checklist: ['just test'],
  });
  const kwRes = checkPackagedSqliteSmokePlan({ projectRoot: tmpRoot });
  assert.equal(kwRes.ok, false);
  assert.ok(kwRes.errors.some((e) => e.includes('missing required keywords')));
});

test('CLI invocation without --check exits non-zero indicating cannot be considered verified', () => {
  let thrownError = null;
  let stdout = '';

  try {
    stdout = execFileSync(process.execPath, ['scripts/release/packaged-sqlite-smoke.plan.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    thrownError = err;
    stdout = err.stdout;
  }

  assert.ok(thrownError, 'CLI without --check must exit non-zero');
  assert.equal(thrownError.status, 1);

  const plan = JSON.parse(stdout);
  assert.equal(plan.ready, false);
  assert.equal(plan.reason, 'unavailable');
  assert.equal(plan.pending, true);
  assert.equal(plan.evidenceLevel, 'unverified');
});

test('CLI invocation with --check exits 0 on valid repository', () => {
  const stdout = execFileSync(process.execPath, ['scripts/release/packaged-sqlite-smoke.plan.mjs', '--check'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const report = JSON.parse(stdout);
  assert.equal(report.ok, true);
  assert.ok(report.checks.every((c) => c.status === 'pass'));
});

test('preflight continues to block on sqlite smoke requirement and publishable remains false', () => {
  const report = runReleasePreflight(process.cwd());
  const sqliteCheck = report.checks.find((c) => c.id === 'sqlite-packaged-electron-smoke');

  assert.ok(sqliteCheck, 'sqlite-packaged-electron-smoke check must exist in preflight');
  assert.equal(sqliteCheck.status, 'blocked');
  assert.equal(sqliteCheck.code, 'PACKAGED_ELECTRON_SQLITE_SMOKE_REQUIRED');
  assert.equal(report.publishable, false);
  assert.equal(report.releaseStatus, 'blocked');
});
