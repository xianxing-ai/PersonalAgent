// 基础底座 ↔ 28 图能力覆盖契约（goo 分区，foundation 域）。
// 运行：node --test tests/contracts/foundation-graph-contract.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, copyFileSync, writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {verifyCapabilityCoverage, graphCapabilities, domainOf, scanProvidedCapabilities} from '../../scripts/competition/verify-graph-capability-coverage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

test('foundation 域：每个图声明的基础能力都有提供者或缺口登记', () => {
  const result = verifyCapabilityCoverage({domain: 'foundation'});
  assert.deepEqual(result.errors, [], `foundation 域覆盖校验失败：\n${result.errors.join('\n')}`);
  assert.ok(result.stats.checked >= 45, `foundation 域应至少 45 个图能力（实际 ${result.stats.checked}）`);
  assert.ok(result.stats.provided >= 5, `foundation 域应有 ≥5 个已提供能力（实际 ${result.stats.provided}）`);
});

test('foundation 域：关键提供者真实存在（排除声明文件的自证）', () => {
  const provided = scanProvidedCapabilities();
  for (const name of ['memory.query', 'knowledge.search', 'workspace.read_text', 'workspace.run_allowed_command',
    'github.bound_pr_diff', 'github.current_head_merge_gate', 'github.issue_snapshot', 'github.merged_repair_readback']) {
    assert.ok(provided.has(name), `${name} 应有提供者`);
  }
  const declared = graphCapabilities();
  for (const name of ['memory.query', 'knowledge.search']) {
    assert.ok(declared.has(name), `${name} 应被 28 图引用`);
  }
});

test('foundation 域：缺口登记规模与归属（runtime/policy 面归 goo122）', () => {
  const result = verifyCapabilityCoverage({domain: 'foundation'});
  const registered = result.rows.filter((r) => r.status.startsWith('registered:'));
  assert.ok(registered.length >= 40, `foundation 域应有 ≥40 个登记缺口（实际 ${registered.length}）`);
  const registry = JSON.parse(readFileSync(join(repoRoot, 'docs/competition/evidence/graph-capability-gaps.json'), 'utf8'));
  for (const gap of registry.gaps.filter((g) => g.domain === 'foundation' && g.name.startsWith('runtime.'))) {
    assert.deepEqual(gap.owners, ['goo122'], `${gap.name} runtime 面负责人应为 goo122`);
  }
  const probe = registry.gaps.find((g) => g.name === 'system.registered_probe');
  assert.deepEqual(probe.owners, ['zemeng5208'], 'system.registered_probe 归 zemeng（MOD-17 providers 已有，缺组合）');
});

test('负例：foundation 登记被清空 → 校验失败并点名 runtime 能力', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'capcov-f-'));
  mkdirSync(join(tmp, 'docs/competition/evidence'), {recursive: true});
  copyFileSync(join(repoRoot, 'docs/competition/workflow-wiring.json'), join(tmp, 'docs/competition/workflow-wiring.json'));
  const registry = JSON.parse(readFileSync(join(repoRoot, 'docs/competition/evidence/graph-capability-gaps.json'), 'utf8'));
  const tampered = {...registry, gaps: registry.gaps.filter((g) => g.domain !== 'foundation')};
  writeFileSync(join(tmp, 'docs/competition/evidence/graph-capability-gaps.json'), JSON.stringify(tampered));
  const result = verifyCapabilityCoverage({domain: 'foundation', repo: tmp});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith('图能力 runtime.')), `应点名 runtime 缺登记：${result.errors[0]}`);
});
