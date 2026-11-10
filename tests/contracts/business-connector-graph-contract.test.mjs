// 业务连接器 ↔ 28 图能力覆盖契约（Potatos 分区，business 域）。
// 运行：node --test tests/contracts/business-connector-graph-contract.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, copyFileSync, writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {verifyCapabilityCoverage, graphCapabilities, domainOf} from '../../scripts/competition/verify-graph-capability-coverage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

test('business 域：每个图声明的业务能力都有提供者或缺口登记', () => {
  const result = verifyCapabilityCoverage({domain: 'business'});
  assert.deepEqual(result.errors, [], `business 域覆盖校验失败：\n${result.errors.join('\n')}`);
  assert.ok(result.stats.checked >= 10, `business 域应至少 10 个图能力（实际 ${result.stats.checked}）`);
  assert.ok(result.stats.provided >= 5, `business 域应有 ≥5 个已提供能力（实际 ${result.stats.provided}）`);
});

test('business 域：工具能力前缀必须映射到既有连接器/服务包', () => {
  const declared = graphCapabilities();
  for (const [name, info] of declared) {
    if (domainOf(name) !== 'business' || info.kind !== 'tool') continue;
    const prefix = name.split('.')[0];
    const pkgDir = {calendar: 'packages/connectors/calendar', mail: 'packages/connectors/mail',
      feeds: 'packages/connectors/feeds', research: 'packages/connectors/research', weather: 'packages/connectors/weather',
      todo: 'packages/productivity', notification: 'packages/notifications', notifications: 'packages/notifications'}[prefix];
    assert.ok(pkgDir, `business 工具前缀 ${prefix}（${name}）必须映射到连接器/服务包目录`);
  }
  // 关键对齐抽查：这些名字必须被 28 图引用（防图与连接器漂移）。
  // 注：weather.forecast 虽由连接器提供，但 F11 当前未引用它——不纳入图对齐抽查。
  for (const name of ['calendar.events', 'mail.inbox', 'mail.reconcile_send', 'feeds.collect', 'research.search']) {
    assert.ok(declared.has(name), `${name} 应被 28 图引用`);
  }
});

test('business 域：登记缺口条目状态合法且域正确（notification.deliver 允许 #574 在途）', () => {
  const result = verifyCapabilityCoverage({domain: 'business'});
  const registered = result.rows.filter((r) => r.status.startsWith('registered:'));
  assert.ok(registered.length >= 6, `business 域应有 ≥6 个登记缺口（实际 ${registered.length}）`);
  for (const row of registered) {
    assert.equal(domainOf(row.name), 'business', `${row.name} 的域应为 business`);
    assert.ok(['registered:open', 'registered:in-flight-pr', 'registered:needs-real-environment'].includes(row.status), `${row.name} 状态非法`);
  }
  const deliver = registered.find((r) => r.name === 'notification.deliver');
  assert.ok(deliver && deliver.status === 'registered:in-flight-pr', 'notification.deliver 应登记为在途（#574）');
});

test('负例：从登记中移除一条业务缺口 → 校验必须失败并点名该能力', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'capcov-'));
  mkdirSync(join(tmp, 'docs/competition/evidence'), {recursive: true});
  copyFileSync(join(repoRoot, 'docs/competition/workflow-wiring.json'), join(tmp, 'docs/competition/workflow-wiring.json'));
  const registry = JSON.parse(readFileSync(join(repoRoot, 'docs/competition/evidence/graph-capability-gaps.json'), 'utf8'));
  const tampered = {...registry, gaps: registry.gaps.filter((g) => g.name !== 'todo.registered_write')};
  writeFileSync(join(tmp, 'docs/competition/evidence/graph-capability-gaps.json'), JSON.stringify(tampered));
  const result = verifyCapabilityCoverage({domain: 'business', repo: tmp});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('todo.registered_write')), `应点名缺登记能力：${result.errors.join('; ')}`);
});
