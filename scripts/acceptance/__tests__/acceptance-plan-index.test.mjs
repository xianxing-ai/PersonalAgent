import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

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

  // 18 份快照逐文件静态解析预期分类与行号精准对照表（严禁仅靠 12/6 总数通过，防止异错偶合）
  const EXPECTED_PER_FIXTURE = {
    // PR #594
    'docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md': {
      pr: 594,
      ok: true,
      id: 'sqlite-packaged-electron-smoke',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 5,
    },
    'scripts/release/packaged-sqlite-smoke.plan.mjs': {
      pr: 594,
      ok: true,
      id: 'sqlite-packaged-electron-smoke',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 160,
    },
    // PR #596
    'docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md': {
      pr: 596,
      ok: true,
      id: 'deployment-readback-plan',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 5,
    },
    'packages/agentarts/src/deployment-readback-plan.ts': {
      pr: 596,
      ok: false,
      id: 'deployment-readback-plan',
      status: 'unavailable',
      missingFields: ['closedLoop'],
      cannotConfirmReason: 'ambiguous_closedLoop',
      expectedLines: [263, 392],
    },
    // PR #598
    'docs/modules/MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107.md': {
      pr: 598,
      ok: true,
      id: 'release-install-upgrade-uninstall',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 5,
    },
    'scripts/release/release-install-upgrade-uninstall.plan.mjs': {
      pr: 598,
      ok: true,
      id: 'release-install-upgrade-uninstall',
      closedLoop: false,
      status: 'pending',
      closedLoopLine: 255,
    },
    // PR #599
    'docs/modules/MOD-16-NOTEPAD-LIVE-ACCEPTANCE-PLAN-20261107.md': {
      pr: 599,
      ok: true,
      id: 'notepad-live-acceptance',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 5,
    },
    'packages/windows-client/src/notepad-live-acceptance-plan.ts': {
      pr: 599,
      ok: false,
      id: 'notepad-live-acceptance',
      status: 'unavailable',
      missingFields: ['closedLoop'],
      cannotConfirmReason: 'ambiguous_closedLoop',
      expectedLines: [127, 346],
    },
    // PR #602
    'docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md': {
      pr: 602,
      ok: true,
      id: 'privacy-deletion-acceptance-plan',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 5,
    },
    'packages/goals/src/privacy-deletion-acceptance-plan.ts': {
      pr: 602,
      ok: true,
      id: 'privacy-deletion-acceptance-plan',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 423,
    },
    // PR #604
    'docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md': {
      pr: 604,
      ok: true,
      id: 'windows-sandbox-acceptance-plan',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 5,
    },
    'packages/coding-tools/src/windows-sandbox-acceptance-plan.ts': {
      pr: 604,
      ok: false,
      id: 'windows-sandbox-acceptance-plan',
      status: 'unavailable',
      missingFields: ['closedLoop'],
      cannotConfirmReason: 'ambiguous_closedLoop',
      expectedLines: [161, 512],
    },
    // PR #605
    'docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md': {
      pr: 605,
      ok: true,
      id: 'f09-cloud-prefix-plan',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 5,
    },
    'packages/agentarts/src/f09-cloud-prefix-acceptance-plan.ts': {
      pr: 605,
      ok: false,
      id: 'f09-cloud-prefix-plan',
      status: 'unavailable',
      missingFields: ['closedLoop'],
      cannotConfirmReason: 'ambiguous_closedLoop',
      expectedLines: [330, 481],
    },
    // PR #606
    'docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md': {
      pr: 606,
      ok: true,
      id: 'cloud-persistent-acceptance-plan',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 5,
    },
    'packages/coordination/src/cloud-persistent-acceptance-plan.ts': {
      pr: 606,
      ok: false,
      id: 'cloud-persistent-acceptance-plan',
      status: 'unavailable',
      missingFields: ['closedLoop'],
      cannotConfirmReason: 'ambiguous_closedLoop',
      expectedLines: [434, 436, 565],
    },
    // PR #607
    'docs/modules/MOD-04B-AGENTARTS-ACCEPTANCE-PLAN-20261107.md': {
      pr: 607,
      ok: true,
      id: 'mod04b-agentarts-acceptance-plan',
      closedLoop: false,
      status: 'unavailable',
      closedLoopLine: 5,
    },
    'packages/coordination/src/mod04b-agentarts-acceptance-plan.ts': {
      pr: 607,
      ok: false,
      id: 'mod04b-agentarts-acceptance-plan',
      status: 'unavailable',
      missingFields: ['closedLoop'],
      cannotConfirmReason: 'ambiguous_closedLoop',
      expectedLines: [558, 560, 817],
    },
  };

  let planCandidates = 0;
  let validCount = 0;
  let errorCount = 0;

  for (const item of manifest) {
    assert.ok(item.snapshotAt, `Item ${item.originalPath} must have snapshotAt timestamp`);
    assert.ok(item.disclaimer, `Item ${item.originalPath} must have disclaimer stating not main and not real acceptance`);

    const fullPath = path.resolve(item.fixturePath);
    assert.ok(fs.existsSync(fullPath), `Fixture file must exist: ${item.fixturePath}`);

    // 严防篡改：逐文件核验 SHA-256 与字节长度
    const fileBytes = fs.readFileSync(fullPath);
    const actualSha = crypto.createHash('sha256').update(fileBytes).digest('hex');
    assert.equal(actualSha, item.sha256, `SHA256 must match MANIFEST for ${item.originalPath}`);
    assert.equal(fileBytes.length, item.bytes, `Byte length must match MANIFEST for ${item.originalPath}`);

    let res;
    if (item.originalPath.endsWith('.md')) {
      res = parseMarkdownPlan(fullPath, '.');
    } else {
      res = parseCodePlan(fullPath, '.');
    }

    assert.equal(res.isPlan, true, `File ${item.originalPath} must be accurately classified as an acceptance plan candidate`);
    planCandidates++;

    const exp = EXPECTED_PER_FIXTURE[item.originalPath];
    assert.ok(exp, `Expected configuration must exist for ${item.originalPath}`);
    assert.equal(item.pr, exp.pr, `PR must match for ${item.originalPath}`);
    assert.equal(res.ok, exp.ok, `Parse result ok must match expected for ${item.originalPath}`);

    if (exp.ok) {
      validCount++;
      // 合规规划必须满足离线安全红线：closedLoop 为 false，状态为待真实验收状态 (unavailable/pending)
      assert.equal(res.record.id, exp.id, `id must match for ${item.originalPath}`);
      assert.equal(res.record.closedLoop, exp.closedLoop, `Valid plan ${item.originalPath} must have closedLoop: false`);
      assert.equal(res.record.status, exp.status, `Valid plan ${item.originalPath} must match status`);
      assert.equal(
        res.record.provenance?.closedLoop?.lineStart,
        exp.closedLoopLine,
        `closedLoop line provenance must match for ${item.originalPath}`,
      );
      assert.equal(
        res.record.provenance?.closedLoop?.sourcePath,
        path.relative('.', fullPath),
        `sourcePath provenance must match for ${item.originalPath}`,
      );
    } else {
      errorCount++;
      // 存在缺漏的规划必须如实列入 missingFields 并具备 cannotConfirm 原因
      assert.equal(res.rawRecord?.id, exp.id, `id must match for ${item.originalPath}`);
      assert.equal(res.rawRecord?.status, exp.status, `status must match for ${item.originalPath}`);
      assert.equal(res.rawRecord?.closedLoop, undefined, `closedLoop must remain undefined for ${item.originalPath}`);
      assert.deepEqual(res.missingFields, exp.missingFields, `missingFields must match exactly for ${item.originalPath}`);
      assert.equal(
        res.cannotConfirm?.closedLoop?.reason,
        exp.cannotConfirmReason,
        `cannotConfirm reason must match for ${item.originalPath}`,
      );
      assert.equal(
        res.cannotConfirm?.closedLoop?.sourcePath,
        path.relative('.', fullPath),
        `cannotConfirm sourcePath must match for ${item.originalPath}`,
      );

      const occurrenceLines = res.cannotConfirm?.closedLoop?.occurrences?.map((o) => o.line);
      assert.deepEqual(
        occurrenceLines,
        exp.expectedLines,
        `Occurrence lines must match exactly for ${item.originalPath}`,
      );
    }
  }

  assert.equal(planCandidates, 18, 'All 18 files must be recognized as plan candidates');
  assert.equal(validCount, 12, 'Exactly 12 plans (9 markdown + 3 code) have complete machine declarations');
  assert.equal(errorCount, 6, 'Exactly 6 code plans report ambiguous_closedLoop due to limits strings');
});

test('parsers: strict elimination of id and title fallbacks across markdown, code, and json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-fallback-test-'));
  try {
    // 1. Markdown without frontmatter id and title
    const mdPath = path.join(tmpDir, 'no-id-or-title-ACCEPTANCE-PLAN.md');
    fs.writeFileSync(
      mdPath,
      '正文开头没有 H1 也没有 frontmatter。\n\n## 验收步骤\n1. 步1\n\n## 证据要求\n1. 证1\n',
      'utf8',
    );
    const mdRes = parseMarkdownPlan(mdPath, tmpDir);
    assert.equal(mdRes.isPlan, true);
    assert.equal(mdRes.ok, false);
    assert.ok(mdRes.missingFields.includes('id'), 'Markdown lacking id must report id in missingFields');
    assert.ok(mdRes.missingFields.includes('title'), 'Markdown lacking title must report title in missingFields');
    assert.equal(mdRes.cannotConfirm?.id?.reason, 'missing_id');
    assert.equal(mdRes.cannotConfirm?.title?.reason, 'missing_title');
    assert.equal(mdRes.title, null, 'Extracted title must be null when missing in source');

    // 2. Code without id or title
    const codePath = path.join(tmpDir, 'anonymous-plan.plan.mjs');
    fs.writeFileSync(
      codePath,
      'export function planAnon() { return { closedLoop: false, status: "unavailable" }; }\n',
      'utf8',
    );
    const codeRes = parseCodePlan(codePath, tmpDir);
    assert.equal(codeRes.isPlan, true);
    assert.equal(codeRes.ok, false);
    assert.ok(codeRes.missingFields.includes('id'), 'Code lacking id must report id in missingFields');
    assert.ok(codeRes.missingFields.includes('title'), 'Code lacking title must report title in missingFields');
    assert.equal(codeRes.cannotConfirm?.id?.reason, 'missing_id');
    assert.equal(codeRes.cannotConfirm?.title?.reason, 'missing_title');
    assert.equal(codeRes.title, null, 'Extracted title must be null when missing in source');

    // 3. JSON without id or title
    const jsonPath = path.join(tmpDir, 'anonymous-plan.plan.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ isPlan: true, closedLoop: false, status: 'unavailable' }, null, 2),
      'utf8',
    );
    const jsonRes = parseJsonPlan(jsonPath, tmpDir);
    assert.equal(jsonRes.isPlan, true);
    assert.equal(jsonRes.ok, false);
    assert.ok(jsonRes.missingFields.includes('id'), 'JSON lacking id must report id in missingFields');
    assert.ok(jsonRes.missingFields.includes('title'), 'JSON lacking title must report title in missingFields');
    assert.equal(jsonRes.cannotConfirm?.id?.reason, 'missing_id');
    assert.equal(jsonRes.cannotConfirm?.title?.reason, 'missing_title');
    assert.equal(jsonRes.title, null, 'Extracted title must be null when missing in source');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
