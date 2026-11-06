// 开源清单契约测试：OPEN_SOURCE_LIST.md 必须与仓库实际第三方依赖一致。
// 运行：node --test tests/contracts/open-source-list.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectThirdPartyDirectDeps, parseListedPackages, verifyOpenSourceList } from '../../scripts/competition/verify-open-source-list.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

test('真实仓库：开源清单与第三方直接依赖一致', () => {
  const result = verifyOpenSourceList(repoRoot);
  assert.deepEqual(
    result.errors,
    [],
    `清单校验失败：\n${result.errors.join('\n')}\n（warnings: ${result.warnings.join('; ')}）`,
  );
  assert.ok(result.scanned >= 10, `扫描到的第三方直接依赖过少：${result.scanned}`);
  assert.ok(result.listed >= result.scanned, `清单条目 ${result.listed} 少于实际依赖 ${result.scanned}`);
});

test('扫描器：排除 @personal-agent/*，包含根 devDependencies', () => {
  const deps = collectThirdPartyDirectDeps(repoRoot);
  assert.ok(deps.has('typescript'), '应包含根 devDependencies 的 typescript');
  assert.ok(deps.has('@modelcontextprotocol/sdk'), '应包含 MCP SDK');
  assert.ok(deps.has('@types/nodemailer'), '应包含 connectors 的类型依赖');
  for (const name of deps.keys()) {
    assert.ok(!name.startsWith('@personal-agent/'), `第一方包 ${name} 不应被当成第三方依赖`);
  }
});

test('解析器：每个包通过独立行登记', () => {
  const docText = readFileSync(join(repoRoot, 'docs', 'competition', 'OPEN_SOURCE_LIST.md'), 'utf8');
  const listed = parseListedPackages(docText);
  const names = new Set(listed.map((l) => l.name));
  assert.ok(names.has('@types/nodemailer'), '@types/nodemailer 应被解析');
  assert.ok(names.has('nodemailer'), 'nodemailer 应被解析');
  assert.ok(!names.has('Node.js') && !names.has('Node'), '非 npm 的 Node.js 行不应被当成依赖');
  // 版本前缀写法：ws 行允许 8.22.0 精确版本
  const wsRow = listed.find((l) => l.name === 'ws');
  assert.ok(wsRow && wsRow.versionText.includes('8.22.0'), 'ws 行应登记 lock 安装版本');
});

test('负例：缺少登记或版本不一致时报错', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'osl-'));
  for (const part of ['docs/competition', 'apps', 'packages/demo', 'scripts/competition']) mkdirSync(join(tmp, part), { recursive: true });
  writeFileSync(
    join(tmp, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/left-pad': { version: '1.3.0', license: 'WTFPL' } } }),
  );
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ workspaces: ['packages/*'], devDependencies: {} }));
  writeFileSync(join(tmp, 'packages/demo/package.json'), JSON.stringify({ name: 'demo', dependencies: { 'left-pad': '^1.3.0' } }));
  copyFileSync(join(repoRoot, 'scripts', 'competition', 'verify-open-source-list.mjs'), join(tmp, 'scripts/competition/verify-open-source-list.mjs'));
  writeFileSync(join(tmp, 'docs', 'competition', 'OPEN_SOURCE_LIST.md'), '# 开源组件清单\n\n| 组件 | 版本 |\n| --- | --- |\n| 暂无 | - |\n');
  const missing = verifyOpenSourceList(tmp);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes('left-pad 未登记')), `应报缺登记：${missing.errors.join('; ')}`);

  // 版本写错也应报错
  writeFileSync(
    join(tmp, 'docs', 'competition', 'OPEN_SOURCE_LIST.md'),
    '# 开源组件清单\n\n| 组件 | 版本 |\n| --- | --- |\n| left-pad | 9.9.9 |\n',
  );
  const wrongVersion = verifyOpenSourceList(tmp);
  assert.equal(wrongVersion.ok, false);
  assert.ok(wrongVersion.errors.some((e) => e.includes('left-pad') && e.includes('不一致')), `应报版本不一致：${wrongVersion.errors.join('; ')}`);

  writeFileSync(join(tmp, 'docs', 'competition', 'OPEN_SOURCE_LIST.md'), '| left-pad | 1.3.00 |\n');
  assert.equal(verifyOpenSourceList(tmp).ok, false, '版本前缀相同不能视为匹配');

  writeFileSync(join(tmp, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/left-pad': { version: '1.3.0-rc.1+build.2' } } }));
  writeFileSync(join(tmp, 'docs', 'competition', 'OPEN_SOURCE_LIST.md'), '| left-pad | 1.3.0-rc.1+build.2 |\n');
  assert.equal(verifyOpenSourceList(tmp).ok, true, '预发布及构建元数据应精确匹配');
  writeFileSync(join(tmp, 'docs', 'competition', 'OPEN_SOURCE_LIST.md'), '| left-pad | 1.3.0-rc.1+build.20 |\n');
  assert.equal(verifyOpenSourceList(tmp).ok, false, '预发布及构建元数据不能前缀匹配');
});

test('扫描目录不可读取时不能静默通过', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'osl-missing-'));
  mkdirSync(join(tmp, 'packages'));
  assert.throws(() => collectThirdPartyDirectDeps(tmp), { code: 'ENOENT' });
});

test('版本与对应包绑定，交换两个包的版本必须失败', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'osl-swap-'));
  for (const part of ['docs/competition', 'apps', 'packages']) mkdirSync(join(tmp, part), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { first: '1.0.0', second: '2.0.0' } }));
  writeFileSync(join(tmp, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/first': { version: '1.0.0' }, 'node_modules/second': { version: '2.0.0' } } }));
  writeFileSync(join(tmp, 'docs/competition/OPEN_SOURCE_LIST.md'), '| first | 2.0.0 |\n| second | 1.0.0 |\n');
  assert.equal(verifyOpenSourceList(tmp).errors.length, 2);
  writeFileSync(join(tmp, 'docs/competition/OPEN_SOURCE_LIST.md'), '| first | 2.0.0 / 1.0.0 |\n| second | 1.0.0 / 2.0.0 |\n');
  assert.equal(verifyOpenSourceList(tmp).errors.length, 2);
});

test('直接依赖按声明者解析嵌套安装，不计无关传递依赖', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'osl-nested-'));
  for (const part of ['docs/competition', 'apps', 'packages/a', 'packages/b']) mkdirSync(join(tmp, part), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({}));
  for (const pkg of ['a', 'b']) writeFileSync(join(tmp, `packages/${pkg}/package.json`), JSON.stringify({ dependencies: { example: '^1.0.0' } }));
  writeFileSync(join(tmp, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/example': { version: '1.0.1' },
    'packages/b/node_modules/example': { version: '1.0.2' },
    'node_modules/other/node_modules/example': { version: '9.0.0' },
  } }));
  writeFileSync(join(tmp, 'docs/competition/OPEN_SOURCE_LIST.md'), '| example | 1.0.1 |\n');
  const mismatch = verifyOpenSourceList(tmp);
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some((error) => error.includes('packages/b') && error.includes('1.0.2')));
  writeFileSync(join(tmp, 'docs/competition/OPEN_SOURCE_LIST.md'), '| example | 1.0.x |\n');
  assert.equal(verifyOpenSourceList(tmp).ok, true);
  writeFileSync(join(tmp, 'package-lock.json'), JSON.stringify({ packages: { 'packages/b/node_modules/example': { version: '1.0.2' } } }));
  const missing = verifyOpenSourceList(tmp);
  assert.ok(missing.errors.some((error) => error.includes('packages/a') && error.includes('没有可解析')));
});
