import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync, execFileSync} from 'node:child_process';
import {randomBytes, createCipheriv, createDecipheriv,createHash} from 'node:crypto';
import {monitorEventLoopDelay, performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {projectionFixture} from './performance-fixture.mjs';
import {Conversations} from '../electron/conversations.js';
import {createEncryptedModuleStorage} from '../electron/encrypted-module-storage.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2), option = (name, fallback) => args[args.indexOf(name) + 1] ?? fallback;
const output = path.resolve(root, args.includes('--output') ? option('--output') : '.cache/performance/baseline.json');
const summarize = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {count: samples.length, p50: sorted[Math.ceil(sorted.length * .5) - 1],
    p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1)};
};
const immediate = () => new Promise(resolve => setImmediate(resolve));
if (!args.includes('--child')) {
  mkdirSync(path.dirname(output), {recursive: true});
  const results = [];
  for (const size of [100, 1000, 10000]) for (const scenario of ['projection', 'conversation-write', 'metadata-write']) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', scenario, '--size', String(size)],
      {cwd: root, encoding: 'utf8', windowsHide: true});
    if (child.status !== 0) throw Error(child.stderr || `Benchmark child exited ${child.status}`);
    const result = JSON.parse(child.stdout); results.push(result);
    console.log(`${scenario} n=${size} p50=${result.wallMs.p50.toFixed(2)} p95=${result.wallMs.p95.toFixed(2)} max=${result.wallMs.max.toFixed(2)} ms`);
  }
  writeFileSync(output, JSON.stringify({schemaVersion: 1, mode: 'synthetic-node-production-functions',
    head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    sourceHashes:Object.fromEntries(['electron/main.js','electron/history-pages.js','electron/task-projection-cache.js',
      'electron/snapshot-publisher.js','electron/conversations.js','electron/encrypted-module-storage.js',
      'test-support/performance-fixture.mjs','test-support/performance-benchmark.mjs']
      .map(name=>[name,createHash('sha256').update(readFileSync(new URL('../'+name,import.meta.url))).digest('hex')])),
    node: process.version, platform: process.platform, arch: process.arch,
    limitations: ['No user data', 'IPC uses structuredClone in Node, not Electron transport',
      'Encryption uses synthetic AES-GCM, not OS safeStorage', 'RSS peaks are sampled, not a continuous maximum',
      '30 measured iterations after 5 warmups per isolated process; not hardware-wide SLO evidence'], results}, null, 2) + '\n');
} else {
  const scenario = option('--child'), size = Number(option('--size')), startedAt = new Date().toISOString();
  const workspace = path.join(root, '.cache', 'performance', 'synthetic', `${scenario}-${size}-${process.pid}`);
  mkdirSync(workspace, {recursive: true});
  let operation, verify, bytes = 0, sends = 0;
  if (scenario === 'projection') {
    const fixture = projectionFixture({size, send: () => sends++});
    const surfaces = ['panel', 'workspace', undefined];
    bytes = surfaces.reduce((sum, surface) => sum + Buffer.byteLength(JSON.stringify(fixture.snapshot(surface))), 0);
    operation = () => fixture.publish();
    verify = () => ({authoritativeSyntheticTasks: fixture.authoritative.size, residentTaskProjections:fixture.tasks.size,
      sends,snapshotBytesThreeSurfaces:bytes});
  } else if (scenario === 'conversation-write') {
    const file = path.join(workspace, 'conversations.json');
    const empty = new Conversations();
    const turns = Array.from({length: size}, (_, i) => ({taskId: `synthetic-${i}`, surface: 'panel',
      goal: 'Synthetic public input '.repeat(8), conversationId: 'desktop-panel', createdAt: new Date(i * 1000).toISOString()}));
    writeFileSync(file, JSON.stringify({version: 4, sessions: [...empty.sessions.values()], activeSessions: empty.activeSessions,
      turns, messages: [], preferences: []}));
    const conversations = new Conversations(file); let revision = 0;
    operation = () => conversations.setDraft('panel', 'desktop-panel', `Synthetic draft ${++revision}`);
    verify = () => {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.turns.length !== size || saved.sessions[0].draft !== `Synthetic draft ${revision}`) throw Error('Draft/history lost');
      return {persistedTurns: saved.turns.length, writes: revision, bytes: Buffer.byteLength(JSON.stringify(saved))};
    };
  } else {
    const key = randomBytes(32);
    const safeStorage = {isEncryptionAvailable: () => true, encryptString(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    }, decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString('utf8');
    }};
    const storage = createEncryptedModuleStorage({userData: workspace, safeStorage, filename: 'synthetic-metadata.json'});
    const records = Object.fromEntries(Array.from({length: size}, (_, i) => [`synthetic-${i}`, {sourceRevision: 1,
      firstObservedAt: '2026-01-01T00:00:00Z', classifierFingerprint: 'a'.repeat(64),
      subject: 'Synthetic public metadata '.repeat(4), outbox: {state: 'accepted', taskId: `synthetic-task-${i}`}}]));
    const state = {records, latest: {}, cursors: {}, heads: {}, observed: {}, analyses: {}}; let revision = 0;
    operation = () => {state.revision = ++revision; storage.set('inbox-triage', structuredClone(state));};
    verify = () => {
      const readback = createEncryptedModuleStorage({userData: workspace, safeStorage, filename: 'synthetic-metadata.json'}).get('inbox-triage');
      if (Object.keys(readback.records).length !== size || readback.revision !== revision) throw Error('Metadata lost');
      return {persistedRecords: size, writes: revision, bytes: readFileSync(path.join(workspace, 'synthetic-metadata.json')).length};
    };
  }
  for (let i = 0; i < 5; i++) await operation();
  const histogram = monitorEventLoopDelay({resolution: 10}); histogram.enable();
  await delay(25); const utilization = performance.eventLoopUtilization(), samples = [], memory = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now(); await operation(); samples.push(performance.now() - start);
    memory.push(process.memoryUsage()); await immediate();
  }
  await delay(25); histogram.disable();
  const elu = performance.eventLoopUtilization(utilization), correctness = verify();
  const sampledPeakBytes = Object.fromEntries(['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers']
    .map(field => [field, Math.max(...memory.map(sample => sample[field]))]));
  process.stdout.write(JSON.stringify({scenario, size, startedAt, endedAt: new Date().toISOString(), warmupCount: 5,
    wallMs: summarize(samples), rawWallMs: samples, sampledPeakBytes,
    eventLoopDelayMs: {count: histogram.count, p50: histogram.percentile(50) / 1e6, p95: histogram.percentile(95) / 1e6,
      max: histogram.max / 1e6}, eventLoopUtilization: elu, correctness}));
}
