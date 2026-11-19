#!/usr/bin/env node
// MOD-32 Trace 读回 helper：只读加载一次评估/运行 Trace（manifest + events.jsonl），
// 做三件事，全部只读：
//   1) 一致性校验——manifest.totals / perCase 与 events 汇总必须一致，不一致退出码 2（判分无效）；
//   2) 脱敏——token/secret/password/credential/authorization/cookie/hid 等键值、
//      邮箱、Bearer 头统一替换为 [REDACTED]；sha256 证据哈希保留（它们是刻意的证据）；
//   3) 有界消费视图——每事件截断到上限，输出 runId/adapter/统计/逐用例结果。
// 用法：node scripts/competition/read-trace.mjs <trace-*.manifest.json> [--json] [--max-bytes 2000]

import {readFileSync, readdirSync} from 'node:fs';
import {join, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const SENSITIVE_KEY = /(token|secret|password|passwd|credential|authorization|cookie|\bhid\b|apikey|api_key|access_?key)/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

export function redactTraceValue(value, depth = 0) {
  if (depth > 12) return '[TRUNCATED]';
  if (typeof value === 'string') {
    return value.replace(BEARER, 'Bearer [REDACTED]').replace(EMAIL, '[EMAIL]');
  }
  if (Array.isArray(value)) return value.map((item) => redactTraceValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key) && typeof item !== 'object' && item !== null) out[key] = '[REDACTED]';
      else out[key] = redactTraceValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function truncateEvent(event, maxBytes) {
  const text = JSON.stringify(event);
  if (text.length <= maxBytes) return event;
  return {ts: event.ts, runId: event.runId, type: event.type, truncated: true,
    preview: `${text.slice(0, maxBytes)}…（原文 ${text.length} 字节，完整内容见 events 文件）`};
}

/** 读取并校验一次 Trace 运行。manifest 与 events 同目录、同 runId。 */
export function readTraceRun(manifestPath, {maxBytes = 2000} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dir = dirname(manifestPath);
  const runId = manifest.runId;
  if (!runId) throw new Error('manifest 缺少 runId');
  const eventsPath = manifest.files?.events ?? join(dir, `trace-${runId}.events.jsonl`);
  const events = readFileSync(eventsPath, 'utf8').split('\n').filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  const caseStarts = events.filter((e) => e.type === 'case_started');
  const caseFinishes = events.filter((e) => e.type === 'case_finished');
  const finished = events.find((e) => e.type === 'run_finished');
  const totals = manifest.totals ?? {};
  const consistent =
    totals.passed === (finished?.passed ?? -1) &&
    totals.failed === (finished?.failed ?? -1) &&
    totals.unavailable === (finished?.unavailable ?? -1) &&
    Array.isArray(manifest.perCase) &&
    manifest.perCase.length === caseStarts.length &&
    manifest.perCase.length === caseFinishes.length &&
    manifest.perCase.every((c) => caseFinishes.some((e) => e.caseId === c.caseId && e.status === c.status));

  return {
    runId,
    manifest,
    events,
    consistent,
    redactedManifest: redactTraceValue(manifest),
    redactedEvents: events.map((event) => truncateEvent(redactTraceValue(event), maxBytes)),
    summary: {
      adapter: manifest.adapter,
      startedAt: manifest.startedAt,
      finishedAt: manifest.finishedAt,
      gitHead: manifest.gitHead,
      totals,
      perCase: manifest.perCase ?? [],
    },
  };
}

/** 在目录中列出可读回的 Trace 运行（按 manifest 文件）。 */
export function listTraceRuns(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.manifest.json')).sort().reverse()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function main(argv) {
  const args = argv.slice(2);
  const flags = {json: false, maxBytes: 2000};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') flags.json = true;
    else if (args[i] === '--max-bytes') flags.maxBytes = Number(args[++i]);
    else positional.push(args[i]);
  }
  if (positional.length !== 1) {
    console.error('用法：node scripts/competition/read-trace.mjs <trace-*.manifest.json> [--json] [--max-bytes N]');
    return 1;
  }
  const run = readTraceRun(positional[0], flags);
  if (!run.consistent) {
    console.error(`[trace-readback] manifest 与 events 汇总不一致（runId=${run.runId}），该运行判分无效`);
    return 2;
  }
  if (flags.json) {
    console.log(JSON.stringify({summary: run.summary, events: run.redactedEvents}, null, 2));
  } else {
    console.log(`runId=${run.runId} adapter=${run.summary.adapter} passed=${run.summary.totals.passed} failed=${run.summary.totals.failed} unavailable=${run.summary.totals.unavailable} score=${((run.summary.totals.score ?? 0) * 100).toFixed(1)}%`);
    for (const c of run.summary.perCase) console.log(`  ${c.caseId}: ${c.status} (${c.score})`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) {
  process.exit(main(process.argv));
}
