// Desktop 注入契约（lab 分区，device-cloud 域）。
// 运行：node --test tests/contracts/desktop-injection-contract.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accessSync, constants as fsConstants, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {verifyCapabilityCoverage, graphCapabilities, domainOf, scanProvidedCapabilities} from '../../scripts/competition/verify-graph-capability-coverage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

test('device-cloud 域：每个图声明的能力都有提供者或缺口登记', () => {
  const result = verifyCapabilityCoverage({domain: 'device-cloud'});
  assert.deepEqual(result.errors, [], `device-cloud 域覆盖校验失败：\n${result.errors.join('\n')}`);
  assert.ok(result.stats.checked >= 20, `device-cloud 域应至少 20 个图能力（实际 ${result.stats.checked}）`);
});

test('注入契约文档引用的组合文件必须真实存在', () => {
  const doc = readFileSync(join(repoRoot, 'docs/interfaces/DESKTOP_INJECTION_CONTRACT.md'), 'utf8');
  const referenced = [...new Set([...doc.matchAll(/`(apps\/desktop\/[^`]+|packages\/[a-z-]+\/src\/[a-z0-9-]+\.ts)`/g)].map((m) => m[1]))];
  assert.ok(referenced.length >= 5, `注入契约应引用 ≥5 个具体文件（实际 ${referenced.length}）`);
  for (const rel of referenced) {
    assert.doesNotThrow(() => accessSync(join(repoRoot, rel), fsConstants.F_OK), `契约引用的文件不存在：${rel}`);
  }
});

test('已提供的设备/云端能力必须在注入契约文档中登记消费点', () => {
  const doc = readFileSync(join(repoRoot, 'docs/interfaces/DESKTOP_INJECTION_CONTRACT.md'), 'utf8');
  const providedHosts = [...graphCapabilities().entries()]
    .filter(([name, info]) => domainOf(name) === 'device-cloud' && info.kind === 'host')
    .filter(([name]) => scanProvidedCapabilities().has(name))
    .map(([name]) => name);
  assert.ok(providedHosts.length >= 1, 'device-cloud 域应有已提供 host 口（如 F14 观察口）');
  for (const name of providedHosts) {
    assert.ok(doc.includes(name), `已提供 host 口 ${name} 必须在注入契约中登记消费点`);
  }
});

test('未提供的设备/云端口保持 unavailable 语义：登记状态合法', () => {
  const result = verifyCapabilityCoverage({domain: 'device-cloud'});
  for (const row of result.rows.filter((r) => r.status.startsWith('registered:'))) {
    assert.ok(['registered:open', 'registered:in-flight-pr', 'registered:needs-real-environment'].includes(row.status), `${row.name} 状态非法`);
  }
  const shadow = result.rows.filter((r) => r.name.startsWith('shadow.'));
  assert.ok(shadow.every((r) => r.status === 'registered:in-flight-pr'), 'shadow.* 应登记为在途（#571）');
});
