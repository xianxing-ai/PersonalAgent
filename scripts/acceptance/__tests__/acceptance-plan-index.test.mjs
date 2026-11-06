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

test('types: normalizeEnvironment handles single string, array, and keywords', () => {
  assert.equal(normalizeEnvironment(''), null);
  assert.equal(normalizeEnvironment(null), null);

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

test('types: validateNormalizedRecord strictly checks all required fields', () => {
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

test('types: anti-forgery prevents closedLoop:true without verified evidence', () => {
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

test('parsers: parseMarkdownPlan correctly parses valid plan and detects errors', () => {
  // 1. 合法 markdown 规划
  const validPath = path.join(FIXTURES_DIR, 'valid-markdown-plan-ACCEPTANCE-PLAN.md');
  const resValid = parseMarkdownPlan(validPath, '.');
  assert.equal(resValid.isPlan, true);
  assert.equal(resValid.ok, true);
  assert.equal(resValid.record.id, 'f09-cloud-prefix-plan');
  assert.equal(resValid.record.closedLoop, false);
  assert.equal(resValid.record.status, 'unavailable');
  assert.deepEqual(resValid.record.requiredEnvironments, ['huawei_cloud', 'real_account']);
  assert.equal(resValid.record.acceptanceSteps.length, 3);
  assert.equal(resValid.record.evidenceRequirements.length, 3);

  // 2. 缺失 closedLoop
  const missingClPath = path.join(FIXTURES_DIR, 'missing-closedloop-ACCEPTANCE-PLAN.md');
  const resCl = parseMarkdownPlan(missingClPath, '.');
  assert.equal(resCl.isPlan, true);
  assert.equal(resCl.ok, false);
  assert.ok(resCl.missingFields.includes('closedLoop'));

  // 3. 缺失环境
  const missingEnvPath = path.join(FIXTURES_DIR, 'missing-env-ACCEPTANCE-PLAN.md');
  const resEnv = parseMarkdownPlan(missingEnvPath, '.');
  assert.equal(resEnv.isPlan, true);
  assert.equal(resEnv.ok, false);
  assert.ok(resEnv.missingFields.includes('requiredEnvironments'));

  // 4. 缺失步骤
  const missingStepsPath = path.join(FIXTURES_DIR, 'missing-steps-ACCEPTANCE-PLAN.md');
  const resSteps = parseMarkdownPlan(missingStepsPath, '.');
  assert.equal(resSteps.isPlan, true);
  assert.equal(resSteps.ok, false);
  assert.ok(resSteps.missingFields.includes('acceptanceSteps'));

  // 5. 缺失证据
  const missingEvPath = path.join(FIXTURES_DIR, 'missing-evidence-ACCEPTANCE-PLAN.md');
  const resEv = parseMarkdownPlan(missingEvPath, '.');
  assert.equal(resEv.isPlan, true);
  assert.equal(resEv.ok, false);
  assert.ok(resEv.missingFields.includes('evidenceRequirements'));

  // 6. 防伪测试：closedLoop 为 true 无实证
  const falseClaimPath = path.join(FIXTURES_DIR, 'closedloop-true-no-evidence-ACCEPTANCE-PLAN.md');
  const resClaim = parseMarkdownPlan(falseClaimPath, '.');
  assert.equal(resClaim.isPlan, true);
  assert.equal(resClaim.ok, false);
  assert.ok(resClaim.errors.some((e) => e.includes('Anti-forgery')));

  // 7. 历史非规划文件识别为 skip
  const histPath = path.join(FIXTURES_DIR, 'skipped-historical-ACCEPTANCE.md');
  const resHist = parseMarkdownPlan(histPath, '.');
  assert.equal(resHist.isPlan, false);
  assert.equal(resHist.skippedReason, 'historical_acceptance_evidence_or_receipt_not_a_plan');
});

test('parsers: prompt injection text is strictly treated as string data and never executed', () => {
  const injectionPath = path.join(FIXTURES_DIR, 'prompt-injection-ACCEPTANCE-PLAN.md');
  const res = parseMarkdownPlan(injectionPath, '.');

  assert.equal(res.isPlan, true);
  assert.equal(res.ok, true);
  // 验证危险指令作为普通字符串保存在 acceptanceSteps
  assert.ok(res.record.acceptanceSteps.some((s) => s.includes('rm -rf /')));
  assert.ok(res.record.acceptanceSteps.some((s) => s.includes('process.exit(99)')));
  assert.ok(res.record.acceptanceSteps.some((s) => s.includes('cat ~/.bashrc')));
  // 进程仍然正常存活，未被 exit
});

test('parsers: parseCodePlan executes exported pure function in .plan.mjs', async () => {
  const codePlanPath = path.join(FIXTURES_DIR, 'valid-code-plan.plan.mjs');
  const res = await parseCodePlan(codePlanPath, '.');

  assert.equal(res.isPlan, true);
  assert.equal(res.ok, true);
  assert.equal(res.record.id, 'mock-windows-sandbox-acceptance');
  assert.equal(res.record.closedLoop, false);
  assert.equal(res.record.status, 'unavailable');
  assert.deepEqual(res.record.requiredEnvironments, ['windows_real_machine']);
  assert.equal(res.record.acceptanceSteps.length, 3);
});

test('parsers: parseJsonPlan handles valid json plan and historical matrix', () => {
  const jsonPlanPath = path.join(FIXTURES_DIR, 'valid-json-plan.plan.json');
  const res = parseJsonPlan(jsonPlanPath, '.');

  assert.equal(res.isPlan, true);
  assert.equal(res.ok, true);
  assert.equal(res.record.id, 'valid-json-plan');
  assert.equal(res.record.closedLoop, false);
  assert.deepEqual(res.record.requiredEnvironments.sort(), ['real_account', 'rights_holder_or_human']);
});

test('scanner: scanAcceptancePlans collects plans, errors, and skips by environment', async () => {
  const scanResult = await scanAcceptancePlans({
    root: FIXTURES_DIR,
  });

  assert.ok(scanResult.summary.totalFilesScanned > 5);
  // 合法规划至少包含: valid-code-plan, valid-markdown-plan, prompt-injection, valid-json-plan, valid-claimed-verified
  assert.ok(scanResult.records.length >= 4);
  // 错误项应包含: missing-closedloop, missing-env, missing-steps, missing-evidence, closedloop-true-no-evidence
  assert.ok(scanResult.errors.length >= 5);
  // 跳过项应包含 skipped-historical-ACCEPTANCE.md
  assert.ok(scanResult.skipped.length >= 1);

  // 环境统计应覆盖 windows_real_machine 与 huawei_cloud
  assert.ok(scanResult.summary.byEnvironment.windows_real_machine >= 1);
  assert.ok(scanResult.summary.byEnvironment.huawei_cloud >= 1);
});

test('formatter: formatMarkdownReport and formatJsonReport output expected structures', async () => {
  const scanResult = await scanAcceptancePlans({
    root: FIXTURES_DIR,
  });

  const md = formatMarkdownReport({
    records: scanResult.records,
    errors: scanResult.errors,
    skipped: scanResult.skipped,
    summary: scanResult.summary,
    generatedAt: '2026-11-07T06:00:00.000Z',
  });

  assert.ok(md.includes('# 真环境待验收总表'));
  assert.ok(md.includes('Windows 真机环境'));
  assert.ok(md.includes('华为云 / AgentArts 云端环境'));
  assert.ok(md.includes('已知未合并验收规划 PR（待合并后自动纳入）'));
  assert.ok(md.includes('#594'));
  assert.ok(md.includes('#605'));
  assert.ok(md.includes('扫描校验异常清单'));

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
  assert.equal(parsed.generatedAt, '2026-11-07T06:00:00.000Z');
  assert.ok(Array.isArray(parsed.records));
  assert.ok(Array.isArray(parsed.errors));
  assert.ok(Array.isArray(parsed.unmergedPrReference));
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
