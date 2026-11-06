// Web Demo 契约测试：数据构建、服务器接口与诚实性（数据缺失→503，不编造）。
// 运行：node --test tests/contracts/web-demo.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDemoData } from '../../docs/demo/web-demo/build-demo-data.mjs';
import { startDemoServer } from '../../docs/demo/web-demo/demo-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

test('buildDemoData：从仓库真实文件生成 28 图数据，含可追溯来源哈希', () => {
  const data = buildDemoData(repoRoot);
  assert.equal(data.stats.workflowCount, 28, '应有 28 张工作流图');
  assert.equal(data.stats.configuredCount, 0, '当前 configured 必须如实为 0/28');
  assert.equal(data.stats.hostGuardChecklistDone, 0);
  assert.ok(data.stats.designNodeCount >= 150, `设计节点数应与 wiring 一致（实际 ${data.stats.designNodeCount}）`);
  assert.equal(data.verification, 'unverified');
  assert.ok(data.profile === 'huawei_ict_agentarts');

  // 每张图都有状态与来源
  const ids = data.workflows.map((w) => w.workflowId);
  assert.deepEqual(ids, Array.from({ length: 28 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`), 'F01–F28 编号连续');
  for (const w of data.workflows) {
    assert.ok(w.nodeCount > 0, `${w.workflowId} 节点数 > 0`);
    assert.ok(['production-gap', 'wiring-in-pr', 'needs-real-environment'].includes(w.status.status), `${w.workflowId} 状态合法：${w.status.status}`);
    assert.ok(Array.isArray(w.status.sources) && w.status.sources.length > 0, `${w.workflowId} 状态必须注来源`);
    assert.ok(Array.isArray(w.nodes) && w.nodes.length === w.nodeCount);
  }

  // 来源可追溯：sha256 与 workflowCount、时间
  assert.equal(data.sources.length, 2);
  assert.match(data.sources[0].path, /workflow-wiring\.json$/);
  assert.match(data.sources[0].sha256, /^[0-9a-f]{64}$/);
  assert.ok(!Number.isNaN(Date.parse(data.generatedAt)));
  assert.equal(data.liveDemo.runtimeConfigured, false, '构建期未配置 Runtime 必须如实标 false');
});

test('buildDemoData：所有来源均属于指定仓库', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'webdemo-source-'));
  const wiringDir = join(tmp, 'docs', 'competition');
  const statusDir = join(tmp, 'docs', 'demo', 'web-demo');
  mkdirSync(wiringDir, { recursive: true });
  mkdirSync(statusDir, { recursive: true });
  copyFileSync(join(repoRoot, 'docs', 'competition', 'workflow-wiring.json'), join(wiringDir, 'workflow-wiring.json'));
  const statusPath = join(statusDir, 'capability-status.json');
  const statusText = JSON.stringify({ snapshotDate: 'fixture-date', capabilities: [{ id: 'F01', status: 'fixture-status' }] });
  writeFileSync(statusPath, statusText);
  const data = buildDemoData(tmp);
  assert.equal(data.stats.snapshotDate, 'fixture-date');
  assert.equal(data.workflows[0].status.status, 'fixture-status');
  assert.equal(data.sources[1].sha256, createHash('sha256').update(statusText).digest('hex'));
  unlinkSync(statusPath);
  assert.throws(() => buildDemoData(tmp), { code: 'ENOENT' });
});

test('demo-server：接口返回真实数据；数据缺失返回 503 而不是编造', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'webdemo-'));
  const dataFile = join(tmp, 'demo-data.json');
  const data = buildDemoData(repoRoot);
  writeFileSync(dataFile, JSON.stringify(data));

  const { url, close } = await startDemoServer({ port: 0, dataFile, publicDir: join(repoRoot, 'docs', 'demo', 'web-demo', 'public') });
  try {
    const health = await (await fetch(`${url}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.dataLoaded, true);
    assert.equal(health.profile, 'huawei_ict_agentarts');

    const full = await (await fetch(`${url}/api/demo-data`)).json();
    assert.equal(full.workflows.length, 28);

    const list = await (await fetch(`${url}/api/workflows`)).json();
    assert.equal(list.workflows.length, 28);
    assert.ok(!('nodes' in list.workflows[0]), '列表不携带节点大对象');

    const f01 = await (await fetch(`${url}/api/workflows/F01`)).json();
    assert.equal(f01.workflowId, 'F01');
    assert.ok(f01.nodes.length > 0);

    const caps = await (await fetch(`${url}/api/capabilities`)).json();
    assert.equal(caps.capabilities.length, 28);

    const missing = await fetch(`${url}/api/workflows/F99`);
    assert.equal(missing.status, 404);

    // 静态页可访问
    const page = await fetch(`${url}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /PersonalAgent 在线 Demo/);

    // 防目录穿越
    const evil = await fetch(`${url}/..%2f..%2f..%2fpackage.json`);
    assert.ok([403, 404].includes(evil.status), `目录穿越应被拒绝，实际 ${evil.status}`);

    // 写方法拒绝
    const post = await fetch(`${url}/api/demo-data`, { method: 'POST' });
    assert.equal(post.status, 405);
  } finally {
    await close();
  }

  // 数据缺失：503 + 明确原因，不返回编造数据
  const { url: url2, close: close2 } = await startDemoServer({ port: 0, dataFile: join(tmp, 'absent.json'), publicDir: join(repoRoot, 'docs', 'demo', 'web-demo', 'public') });
  try {
    const res = await fetch(`${url2}/api/demo-data`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'data_unavailable');
    const health = await (await fetch(`${url2}/api/health`)).json();
    assert.equal(health.dataLoaded, false);
  } finally {
    await close2();
  }
});

test('构建脚本 CLI：--out 写入指定路径，内容与函数一致', async () => {
  const { execFileSync } = await import('node:child_process');
  const tmp = mkdtempSync(join(tmpdir(), 'webdemocli-'));
  const out = join(tmp, 'nested', 'demo-data.json');
  mkdirSync(join(tmp, 'nested'), { recursive: true });
  execFileSync(process.execPath, [join(repoRoot, 'docs', 'demo', 'web-demo', 'build-demo-data.mjs'), '--out', out], { cwd: tmp });
  const written = JSON.parse(await import('node:fs').then((m) => m.readFileSync(out, 'utf8')));
  const expected = buildDemoData(repoRoot);
  assert.equal(written.stats.workflowCount, expected.stats.workflowCount);
  assert.equal(written.git.head, expected.git.head);
});
