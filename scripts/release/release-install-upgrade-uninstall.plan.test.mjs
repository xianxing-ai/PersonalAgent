import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ACCEPTANCE_ITEMS,
  checkReleaseInstallUpgradeUninstallPlan,
  planReleaseInstallUpgradeUninstall,
} from './release-install-upgrade-uninstall.plan.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./release-install-upgrade-uninstall.plan.mjs', import.meta.url));

function write(root, relativePath, contents) {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function writeJson(root, relativePath, value) {
  write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture({
  placeholders = true,
  installer = false,
  tamperedStatus = null,
  tamperedVerified = null,
  tamperedExecuted = null,
  tamperedNotes = null,
  missingOne = null,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mod19-plan-test-'));

  if (placeholders) {
    const templates = {
      'tests/manual/release/windows-install-start.json': {
        schemaVersion: 1,
        profile: 'huawei_ict_agentarts',
        acceptanceId: 'release-install-start',
        status: tamperedStatus ?? 'pending',
        executed: tamperedExecuted ?? false,
        verified: tamperedVerified ?? false,
        evidenceLevel: tamperedVerified ? 'verified' : 'unverified',
        target: 'Windows 11 x64 NSIS standalone installer',
        notes: tamperedNotes ?? '占位文件：尚未在 Windows 真机执行安装与启动验证。未验收（MANUAL_EVIDENCE_NOT_EXECUTED）。',
        checklist: [
          '执行安装包（无管理员提权要求，asInvoker）',
          '自定义安装路径成功安装',
          '桌面及开始菜单快捷方式正确生成',
          '首次启动正常，主进程正确初始化 userData 目录',
          '打包后 Electron 主进程 SQLite 正常读写',
        ],
      },
      'tests/manual/release/windows-upgrade-data-retention.json': {
        schemaVersion: 1,
        profile: 'huawei_ict_agentarts',
        acceptanceId: 'release-upgrade-data',
        status: 'pending',
        executed: false,
        verified: false,
        evidenceLevel: 'unverified',
        target: 'Windows 11 x64 NSIS upgrade across versions',
        notes: '占位文件：尚未在 Windows 真机执行覆盖升级与数据保留验证。未验收（MANUAL_EVIDENCE_NOT_EXECUTED）。',
        checklist: [
          '预先写入测试版本 userData（含 SQLite 任务表与会话记录）',
          '运行新版本安装程序覆盖安装',
          '启动新版本应用，检查 userData 数据库完好保留',
          '会话历史可正常读回，无数据丢失或表重建',
        ],
      },
      'tests/manual/release/windows-uninstall.json': {
        schemaVersion: 1,
        profile: 'huawei_ict_agentarts',
        acceptanceId: 'release-uninstall',
        status: 'pending',
        executed: false,
        verified: false,
        evidenceLevel: 'unverified',
        target: 'Windows 11 x64 NSIS uninstaller',
        notes: '占位文件：尚未在 Windows 真机执行卸载验证。未验收（MANUAL_EVIDENCE_NOT_EXECUTED）。',
        checklist: [
          '通过控制面板/Windows设置或卸载快捷方式触发卸载',
          '安装目录及程序二进制文件被干净移除',
          '桌面及开始菜单快捷方式被干净移除',
          '用户数据（userData，含 SQLite 与凭据）按策略默认保留，不被意外清除',
        ],
      },
    };

    for (const [relPath, content] of Object.entries(templates)) {
      if (missingOne && relPath.includes(missingOne)) {
        continue;
      }
      writeJson(root, relPath, content);
    }
  }

  if (installer) {
    write(root, 'apps/desktop/release/PersonalAgent-Setup.exe', 'MZ dummy installer binary content');
  }

  return root;
}

test('unavailable: non-Windows platform returns unavailable and pending even with installer', (t) => {
  const root = createFixture({ installer: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planReleaseInstallUpgradeUninstall({
    projectRoot: root,
    platform: 'linux',
  });

  assert.equal(plan.ready, false);
  assert.equal(plan.reason, 'unavailable');
  assert.equal(plan.pending, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.verified, false);
  assert.equal(plan.evidenceLevel, 'unverified');
  assert.match(plan.notes, /非 Windows 环境无法执行/);
});

test('unavailable: missing installer artifact on Windows returns unavailable and pending', (t) => {
  const root = createFixture({ installer: false });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planReleaseInstallUpgradeUninstall({
    projectRoot: root,
    platform: 'win32',
  });

  assert.equal(plan.ready, false);
  assert.equal(plan.reason, 'unavailable');
  assert.equal(plan.pending, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.verified, false);
  assert.equal(plan.evidenceLevel, 'unverified');
  assert.match(plan.notes, /未检测到打包后的 Windows 安装包产物/);
});

test('unavailable: missing placeholder files returns unavailable and pending', (t) => {
  const root = createFixture({ installer: true, missingOne: 'windows-install-start' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const plan = planReleaseInstallUpgradeUninstall({
    projectRoot: root,
    platform: 'win32',
  });

  assert.equal(plan.ready, false);
  assert.equal(plan.reason, 'unavailable');
  assert.equal(plan.pending, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.verified, false);
  assert.equal(plan.evidenceLevel, 'unverified');
  assert.ok(Array.isArray(plan.missingPlaceholders));
  assert.ok(plan.missingPlaceholders.includes('tests/manual/release/windows-install-start.json'));
});

test('占位 pending: valid pending placeholders pass static check and produce planned pending output on Windows', (t) => {
  const root = createFixture({ installer: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = checkReleaseInstallUpgradeUninstallPlan({ projectRoot: root });
  assert.equal(report.ok, true);
  assert.equal(report.summary.fail, 0);
  assert.ok(report.summary.pass >= 28);

  const plan = planReleaseInstallUpgradeUninstall({
    projectRoot: root,
    platform: 'win32',
  });

  assert.equal(plan.ready, true);
  assert.equal(plan.reason, 'planned_manual_acceptance_required');
  assert.equal(plan.pending, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.verified, false);
  assert.equal(plan.evidenceLevel, 'unverified');
  assert.match(plan.notes, /静态规划就绪.*绝不执行安装器或 Electron/);
  assert.equal(plan.items.length, 3);
  for (const item of plan.items) {
    assert.equal(item.status, 'pending');
    assert.ok(Array.isArray(item.checklist) && item.checklist.length >= 3);
  }
});

test('拒绝 passed: placeholder claiming status=passed is rejected by check and plan', (t) => {
  const root = createFixture({ installer: true, tamperedStatus: 'passed' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = checkReleaseInstallUpgradeUninstallPlan({ projectRoot: root });
  assert.equal(report.ok, false);
  assert.ok(report.summary.fail > 0);
  assert.ok(report.checks.some((c) => c.status === 'fail' && (c.code === 'ILLEGAL_PASSED_CLAIM' || c.code === 'STATUS_NOT_PENDING')));

  const plan = planReleaseInstallUpgradeUninstall({
    projectRoot: root,
    platform: 'win32',
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.reason, 'unavailable');
  assert.equal(plan.pending, true);
  assert.equal(plan.verified, false);
  assert.equal(plan.executed, false);
});

test('拒绝 passed: placeholder claiming verified=true is rejected by check and plan', (t) => {
  const root = createFixture({ installer: true, tamperedVerified: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = checkReleaseInstallUpgradeUninstallPlan({ projectRoot: root });
  assert.equal(report.ok, false);
  assert.ok(report.summary.fail > 0);
  assert.ok(report.checks.some((c) => c.status === 'fail' && (c.code === 'ILLEGAL_PASSED_CLAIM' || c.code === 'EVIDENCE_NOT_UNVERIFIED')));

  const plan = planReleaseInstallUpgradeUninstall({
    projectRoot: root,
    platform: 'win32',
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.reason, 'unavailable');
  assert.equal(plan.pending, true);
});

test('拒绝 passed: placeholder claiming executed=true is rejected by check and plan', (t) => {
  const root = createFixture({ installer: true, tamperedExecuted: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = checkReleaseInstallUpgradeUninstallPlan({ projectRoot: root });
  assert.equal(report.ok, false);
  assert.ok(report.summary.fail > 0);
  assert.ok(report.checks.some((c) => c.status === 'fail' && c.code === 'EXECUTED_NOT_FALSE'));

  const plan = planReleaseInstallUpgradeUninstall({
    projectRoot: root,
    platform: 'win32',
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.reason, 'unavailable');
});

test('CLI 退出码: invoking CLI without --check exits non-zero (code 1)', (t) => {
  const root = createFixture({ installer: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = spawnSync(process.execPath, [SCRIPT_PATH, root], { encoding: 'utf8' });
  assert.equal(res.status, 1, `Expected exit code 1, got ${res.status}. stderr: ${res.stderr}`);

  const output = JSON.parse(res.stdout);
  assert.equal(output.pending, true);
  assert.equal(output.executed, false);
  assert.equal(output.verified, false);
});

test('CLI 退出码: invoking CLI with --check on valid fixture exits 0', (t) => {
  const root = createFixture({ installer: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = spawnSync(process.execPath, [SCRIPT_PATH, '--check', root], { encoding: 'utf8' });
  assert.equal(res.status, 0, `Expected exit code 0, got ${res.status}. stderr: ${res.stderr}`);

  const report = JSON.parse(res.stdout);
  assert.equal(report.ok, true);
});

test('CLI 退出码: invoking CLI with --check on invalid fixture (tampered passed) exits 1', (t) => {
  const root = createFixture({ installer: true, tamperedStatus: 'passed' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = spawnSync(process.execPath, [SCRIPT_PATH, '--check', root], { encoding: 'utf8' });
  assert.equal(res.status, 1, `Expected exit code 1, got ${res.status}`);

  const report = JSON.parse(res.stdout);
  assert.equal(report.ok, false);
});
