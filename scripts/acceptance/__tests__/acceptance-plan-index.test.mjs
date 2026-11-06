import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import {
  REQUIRED_ENVIRONMENTS,
  VALID_STATUSES,
  normalizeEnvironment,
  validateNormalizedRecord,
  KNOWN_UNMERGED_PRS,
} from '../types.mjs';
import { parseMarkdownPlan } from '../parsers/markdown-plan-parser.mjs';
import { parseCodePlan } from '../parsers/code-plan-parser.mjs';
import { parseJsonPlan } from '../parsers/json-plan-parser.mjs';
import { scanAcceptancePlans, matchGlob } from '../scanner.mjs';
import { formatMarkdownReport, formatJsonReport } from '../formatter.mjs';
import { runAcceptanceIndexCli } from '../build-pending-acceptance-index.mjs';

const FIXTURES_DIR = path.resolve('scripts/acceptance/__tests__/__fixtures__');

test('types: normalizeEnvironment strictly matches explicit environment keywords and rejects context words', () => {
  assert.equal(normalizeEnvironment(''), null);
  assert.equal(normalizeEnvironment(null), null);
  assert.equal(normalizeEnvironment(undefined), null);

  const win = normalizeEnvironment('windows真机');
  assert.deepEqual(win.environments, ['windows_real_machine']);

  const cloud = normalizeEnvironment('huawei_cloud, AgentArts云端');
  assert.deepEqual(cloud.environments, ['huawei_cloud']);

  const multi = normalizeEnvironment(['Win32', '真实账号', '人工审批']);
  assert.deepEqual(multi.environments.sort(), [
    'real_account',
    'rights_holder_or_human',
    'windows_real_machine',
  ]);

  const custom = normalizeEnvironment('定制红外物理传感器');
  assert.deepEqual(custom.environments, ['other']);
  assert.equal(custom.details[0].raw, '定制红外物理传感器');
});

test('types: validateNormalizedRecord strictly checks all required fields and detects cannotConfirm', () => {
  const validBase = {
    id: 'test-plan',
    title: '测试规划',
    sourcePath: 'docs/test.md',
    closedLoop: false,
    status: 'unavailable',
    requiredEnvironments: ['windows_real_machine'],
    acceptanceSteps: ['步骤1'],
    evidenceRequirements: ['证据1'],
    reason: '待真实验收',
  };

  const v1 = validateNormalizedRecord(validBase);
  assert.equal(v1.ok, true);
  assert.equal(v1.errors.length, 0);

  // 缺失 closedLoop
  const noClosedLoop = { ...validBase };
  delete noClosedLoop.closedLoop;
  const v2 = validateNormalizedRecord(noClosedLoop);
  assert.equal(v2.ok, false);
  assert.ok(v2.missingFields.includes('closedLoop'));

  // 缺失环境
  const noEnv = { ...validBase, requiredEnvironments: [] };
  const v3 = validateNormalizedRecord(noEnv);
  assert.equal(v3.ok, false);
  assert.ok(v3.missingFields.includes('requiredEnvironments'));
  assert.equal(v3.cannotConfirm.requiredEnvironments.reason, 'missing_environment_declaration');

  // 缺失步骤
  const noSteps = { ...validBase, acceptanceSteps: [] };
  const v4 = validateNormalizedRecord(noSteps);
  assert.equal(v4.ok, false);
  assert.ok(v4.missingFields.includes('acceptanceSteps'));

  // 缺失证据要求
  const noEvidence = { ...validBase, evidenceRequirements: [] };
  const v5 = validateNormalizedRecord(noEvidence);
  assert.equal(v5.ok, false);
  assert.ok(v5.missingFields.includes('evidenceRequirements'));

  // closedLoop 为 false 且无 reason 或 pendingItems
  const noReason = { ...validBase, reason: '', pendingItems: [] };
  const v6 = validateNormalizedRecord(noReason);
  assert.equal(v6.ok, false);
  assert.ok(v6.missingFields.includes('reason/pendingItems'));
});

test('types: anti-forgery prevents closedLoop:true without verified evidence or with mock marker', () => {
  const forgedRecord = {
    id: 'forged-plan',
    title: '伪造已闭环规划',
    sourcePath: 'docs/forged.md',
    closedLoop: true,
    status: 'verified',
    requiredEnvironments: ['windows_real_machine'],
    acceptanceSteps: ['步骤1'],
    evidenceRequirements: ['证据1'],
    hasVerifiedEvidence: false,
  };

  const check1 = validateNormalizedRecord(forgedRecord);
  assert.equal(check1.ok, false);
  assert.ok(check1.errors.some((e) => e.includes('Anti-forgery violation')));

  // 带 mock 标记的 closedLoop:true 亦必须被拒绝
  const mockRecord = {
    ...forgedRecord,
    hasVerifiedEvidence: true,
    mock: true,
  };
  const check2 = validateNormalizedRecord(mockRecord);
  assert.equal(check2.ok, false);
  assert.ok(check2.errors.some((e) => e.includes('Anti-forgery violation')));

  // 合法有证据的记录可通过
  const genuineRecord = {
    ...forgedRecord,
    hasVerifiedEvidence: true,
    evidenceDigest: 'sha256:abc123456789',
  };
  const check3 = validateNormalizedRecord(genuineRecord);
  assert.equal(check3.ok, true);
});

test('security: scanner strictly treats input code as plain text and NEVER executes top-level JS/MJS code', () => {
  const maliciousPath = path.join(FIXTURES_DIR, 'malicious-exec-test.plan.mjs');
  // 该文件顶层直接包含 throw new Error(...)，若被 import/require/eval 执行则进程崩溃
  // 纯静态文本解析器必须正常读取、不抛异常地完成解析
  const res = parseCodePlan(maliciousPath, '.');
  assert.equal(res.isPlan, true);
  assert.equal(res.ok, false); // 缺少 steps 与 evidence 等字段
  assert.ok(res.missingFields.includes('acceptanceSteps'));
});

test('parsers: code-plan-parser detects ambiguous_closedLoop in multiple conditional branches without guessing', () => {
  const ambiguousPath = path.join(FIXTURES_DIR, 'ambiguous-closedloop.plan.ts');
  const res = parseCodePlan(ambiguousPath, '.');

  assert.equal(res.isPlan, true);
  assert.equal(res.ok, false);
  assert.ok(res.missingFields.includes('closedLoop'));
  assert.equal(res.cannotConfirm?.closedLoop?.reason, 'ambiguous_closedLoop');
  assert.equal(res.cannotConfirm?.closedLoop?.occurrences?.length, 2);
  assert.equal(res.cannotConfirm?.closedLoop?.occurrences[0].rawVal, 'false');
  assert.equal(res.cannotConfirm?.closedLoop?.occurrences[1].rawVal, 'true');
});

test('parsers: code-plan-parser statically extracts explicit literals and records line-level provenance', () => {
  const validPath = path.join(FIXTURES_DIR, 'valid-code-plan.plan.mjs');
  const res = parseCodePlan(validPath, '.');

  assert.equal(res.isPlan, true);
  assert.equal(res.ok, true);
  assert.equal(res.record.id, 'mock-windows-sandbox-acceptance');
  assert.equal(res.record.closedLoop, false);
  assert.equal(res.record.status, 'unavailable');
  assert.deepEqual(res.record.requiredEnvironments, ['windows_real_machine']);
  assert.equal(res.record.acceptanceSteps.length, 3);
  assert.equal(res.record.evidenceRequirements.length, 2);

  // 验证逐字段行号 provenance
  const prov = res.record.provenance;
  assert.ok(prov.id && prov.id.lineStart > 0);
  assert.ok(prov.closedLoop && prov.closedLoop.lineStart > 0 && prov.closedLoop.value === false);
  assert.ok(prov.requiredEnvironments && prov.requiredEnvironments.lineStart > 0);
  assert.ok(prov.status && prov.status.lineStart > 0);
});

test('parsers: parseMarkdownPlan correctly parses valid plan and detects errors', () => {
  const validPath = path.join(FIXTURES_DIR, 'valid-markdown-plan-ACCEPTANCE-PLAN.md');
  const resValid = parseMarkdownPlan(validPath, '.');

  assert.equal(resValid.isPlan, true);
  assert.equal(resValid.ok, true);
  assert.equal(resValid.record.id, 'f09-cloud-prefix-plan');
  assert.equal(resValid.record.closedLoop, false);
  assert.equal(resValid.record.status, 'unavailable');
  assert.deepEqual(resValid.record.requiredEnvironments.sort(), ['huawei_cloud', 'real_account']);
  assert.equal(resValid.record.acceptanceSteps.length, 3);
  assert.equal(resValid.record.evidenceRequirements.length, 3);
  assert.ok(resValid.record.provenance.closedLoop.lineStart > 0);

  // 缺字段失败路径
  const missingClosedLoopPath = path.join(FIXTURES_DIR, 'missing-closedloop-ACCEPTANCE-PLAN.md');
  const resNoClosedLoop = parseMarkdownPlan(missingClosedLoopPath, '.');
  assert.equal(resNoClosedLoop.isPlan, true);
  assert.equal(resNoClosedLoop.ok, false);
  assert.ok(resNoClosedLoop.missingFields.includes('closedLoop'));

  const missingEnvPath = path.join(FIXTURES_DIR, 'missing-env-ACCEPTANCE-PLAN.md');
  const resNoEnv = parseMarkdownPlan(missingEnvPath, '.');
  assert.equal(resNoEnv.isPlan, true);
  assert.equal(resNoEnv.ok, false);
  assert.ok(resNoEnv.missingFields.includes('requiredEnvironments'));
  assert.equal(resNoEnv.cannotConfirm?.requiredEnvironments?.reason, 'missing_environment_declaration');
});

test('parsers: prompt injection text is strictly treated as string data and never executed', () => {
  const injectionPath = path.join(FIXTURES_DIR, 'prompt-injection-ACCEPTANCE-PLAN.md');
  const res = parseMarkdownPlan(injectionPath, '.');

  assert.equal(res.isPlan, true);
  assert.equal(res.ok, true);
  assert.ok(res.record.acceptanceSteps[0].includes('rm -rf'));
  assert.equal(res.record.closedLoop, false);
  assert.equal(res.record.acceptanceSteps.length, 4);
});

test('parsers: parseJsonPlan handles valid json plan with key lines provenance', () => {
  const jsonPlanPath = path.join(FIXTURES_DIR, 'valid-json-plan.plan.json');
  const res = parseJsonPlan(jsonPlanPath, '.');

  assert.equal(res.isPlan, true);
  assert.equal(res.ok, true);
  assert.equal(res.record.id, 'valid-json-plan');
  assert.equal(res.record.closedLoop, false);
  assert.deepEqual(res.record.requiredEnvironments.sort(), ['real_account', 'rights_holder_or_human']);
  assert.ok(res.record.provenance.closedLoop.lineStart > 0);
});

test('unmerged-18: all 18 real unmerged fixtures are accurately classified and honestly report missing fields', () => {
  const manifestPath = path.join(FIXTURES_DIR, 'unmerged-zemeng-plans', 'MANIFEST.json');
  assert.ok(fs.existsSync(manifestPath), 'MANIFEST.json must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.length, 18, 'Must contain all 18 unmerged files');

  let planCandidates = 0;
  for (const item of manifest) {
    const fullPath = path.resolve(item.fixturePath);
    assert.ok(fs.existsSync(fullPath), `Fixture file must exist: ${item.fixturePath}`);

    let res;
    if (item.originalPath.endsWith('.md')) {
      res = parseMarkdownPlan(fullPath, '.');
    } else {
      res = parseCodePlan(fullPath, '.');
    }

    assert.equal(res.isPlan, true, `File ${item.originalPath} must be accurately classified as an acceptance plan candidate`);
    planCandidates++;

    // 严禁假齐套：在未提供完整机器格式字面量的情况下，必须诚实报错，不能假报 ok=true
    assert.equal(res.ok, false, `File ${item.originalPath} must honestly fail full validation due to missing explicit fields`);
    assert.ok(Array.isArray(res.missingFields) && res.missingFields.length > 0, `File ${item.originalPath} must list missing fields`);
    assert.ok(res.cannotConfirm && typeof res.cannotConfirm === 'object', `File ${item.originalPath} must have cannotConfirm records`);

    // 严禁将 true 改为 false：检查不能有任何字段被违规篡改
    if (res.rawRecord?.cannotConfirm?.closedLoop?.reason === 'ambiguous_closedLoop') {
      assert.equal(res.rawRecord.closedLoop, undefined, 'Ambiguous closedLoop must remain undefined, never guessed or mutated');
    }
  }

  assert.equal(planCandidates, 18);
});

test('scanner: scanAcceptancePlans collects plans, errors, and skips by environment', async () => {
  const scanResult = await scanAcceptancePlans({
    root: FIXTURES_DIR,
    globs: [
      'valid-markdown-plan-ACCEPTANCE-PLAN.md',
      'valid-code-plan.plan.mjs',
      'valid-json-plan.plan.json',
      'missing-closedloop-ACCEPTANCE-PLAN.md',
      'missing-env-ACCEPTANCE-PLAN.md',
      'missing-steps-ACCEPTANCE-PLAN.md',
      'missing-evidence-ACCEPTANCE-PLAN.md',
      'closedloop-true-no-evidence-ACCEPTANCE-PLAN.md',
      'skipped-historical-ACCEPTANCE.md',
    ],
  });

  assert.ok(scanResult.summary.totalFilesScanned >= 8);
  assert.ok(scanResult.records.length >= 3);
  assert.ok(scanResult.errors.length >= 4);
  assert.ok(scanResult.skipped.length >= 1);

  assert.ok(scanResult.summary.byEnvironment.windows_real_machine >= 1);
});

test('formatter: formatMarkdownReport and formatJsonReport output disclaimer and provenance', async () => {
  const scanResult = await scanAcceptancePlans({
    root: FIXTURES_DIR,
    globs: [
      'valid-markdown-plan-ACCEPTANCE-PLAN.md',
      'valid-code-plan.plan.mjs',
      'valid-json-plan.plan.json',
    ],
  });

  const md = formatMarkdownReport({
    records: scanResult.records,
    errors: scanResult.errors,
    skipped: scanResult.skipped,
    summary: scanResult.summary,
    generatedAt: '2026-11-07T06:00:00.000Z',
  });

  assert.ok(md.includes('# 真环境待验收总表'));
  assert.ok(md.includes('仅假设这些文件合入后的离线输入汇总、非真实验收、非已合并主干'));
  assert.ok(md.includes('Windows 真机环境'));
  assert.ok(md.includes('已知未合并验收规划 PR（待合并后自动纳入）'));

  const jsonStr = formatJsonReport({
    records: scanResult.records,
    errors: scanResult.errors,
    skipped: scanResult.skipped,
    summary: scanResult.summary,
    generatedAt: '2026-11-07T06:00:00.000Z',
    scanRoots: ['test-root'],
  });

  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.ok(parsed.disclaimer.includes('非真实验收'));
  assert.equal(parsed.summary.validPlans, 3);
  assert.equal(parsed.unmergedPrReference.length, KNOWN_UNMERGED_PRS.length);
});

test('cli: runAcceptanceIndexCli succeeds on targeted valid fixtures and writes reports', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-index-test-'));

  const exitCode = await runAcceptanceIndexCli([
    '--root',
    FIXTURES_DIR,
    '--globs',
    'valid-markdown-plan-ACCEPTANCE-PLAN.md,valid-code-plan.plan.mjs,valid-json-plan.plan.json',
    '--out-dir',
    tempDir,
  ]);

  assert.equal(exitCode, 0);

  const mdPath = path.join(tempDir, 'pending-acceptance-by-env.md');
  const jsonPath = path.join(tempDir, 'pending-acceptance-index.json');

  assert.ok(fs.existsSync(mdPath));
  assert.ok(fs.existsSync(jsonPath));

  const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(jsonContent.summary.validPlans, 3);
  assert.equal(jsonContent.summary.errorsCount, 0);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('cli: runAcceptanceIndexCli exits non-zero on validation errors and honors --report-errors', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-index-test-err-'));

  // 1. 无 --report-errors 遇到错误：exit 1 且不写文件
  const exitCode1 = await runAcceptanceIndexCli([
    '--root',
    FIXTURES_DIR,
    '--globs',
    'missing-closedloop-ACCEPTANCE-PLAN.md',
    '--out-dir',
    tempDir,
  ]);
  assert.equal(exitCode1, 1);
  assert.equal(fs.existsSync(path.join(tempDir, 'pending-acceptance-by-env.md')), false);

  // 2. 带 --report-errors 遇到错误：写入文件但 exit code 仍为 1
  const exitCode2 = await runAcceptanceIndexCli([
    '--root',
    FIXTURES_DIR,
    '--globs',
    'missing-closedloop-ACCEPTANCE-PLAN.md',
    '--out-dir',
    tempDir,
    '--report-errors',
  ]);
  assert.equal(exitCode2, 1);
  assert.equal(fs.existsSync(path.join(tempDir, 'pending-acceptance-by-env.md')), true);
  assert.equal(fs.existsSync(path.join(tempDir, 'pending-acceptance-index.json')), true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
