import assert from 'node:assert/strict';
import test from 'node:test';
import {validateToolValue} from '@personal-agent/contracts';
import {
  createSystemObservationTool,
  describeSystemObservationCapabilities,
  register,
  SYSTEM_OBSERVATION_SCOPE,
  SYSTEM_OBSERVATION_TOOL_NAME,
  SYSTEM_OBSERVATION_TOOL_VERSION,
} from '../dist/index.js';

const observedAt = new Date('2026-09-17T12:00:00.000Z');
const context = overrides => ({
  taskId: 'task-1',
  runId: 'run-1',
  signal: new AbortController().signal,
  deadline: '2026-09-17T12:01:00.000Z',
  authorizationRef: 'authorization-1',
  scopes: [SYSTEM_OBSERVATION_SCOPE],
  ...overrides,
});

test('register exposes the provider through ToolHost and disposal removes it', () => {
  let registered;
  let removed = false;
  const host = {register(tool) {
    registered = tool;
    return () => { removed = true; registered = undefined; };
  }};
  const dispose = register(host, {probe: probe(), now: () => observedAt, sampleWindowMs: 1});
  assert.equal(registered.descriptor.name, SYSTEM_OBSERVATION_TOOL_NAME);
  assert.deepEqual(registered.descriptor.requiredScopes, [SYSTEM_OBSERVATION_SCOPE]);
  assert.equal(removed, false);
  dispose();
  assert.equal(removed, true);
  assert.equal(registered, undefined);
});

function probe(overrides = {}) {
  let cpuRead = 0;
  const cpu = [
    [
      {user: 100, nice: 0, sys: 0, idle: 900, irq: 0},
      {user: 200, nice: 0, sys: 0, idle: 800, irq: 0},
    ],
    [
      {user: 200, nice: 0, sys: 0, idle: 1_000, irq: 0},
      {user: 300, nice: 0, sys: 0, idle: 900, irq: 0},
    ],
  ];
  return {
    cpuTimes: () => cpu[Math.min(cpuRead++, 1)],
    totalMemoryBytes: () => 1_000,
    freeMemoryBytes: () => 250,
    uptimeSeconds: () => 1_234,
    ...overrides,
  };
}

test('factory exposes one minimal read-only descriptor with exact schemas', () => {
  const tool = createSystemObservationTool({probe: probe(), now: () => observedAt, sampleWindowMs: 1});
  assert.equal(tool.descriptor.name, SYSTEM_OBSERVATION_TOOL_NAME);
  assert.equal(tool.descriptor.version, SYSTEM_OBSERVATION_TOOL_VERSION);
  assert.equal(tool.descriptor.sideEffect, 'read');
  assert.deepEqual(tool.descriptor.requiredScopes, ['computer:system:read']);
  assert.equal(tool.descriptor.idempotencySupport, false);
  assert.equal(tool.descriptor.recoverySupport, false);
  assert.equal(tool.descriptor.requiresPresence, false);
  assert.doesNotThrow(() => validateToolValue(tool.descriptor.inputSchema, {}));
  assert.throws(() => validateToolValue(tool.descriptor.inputSchema, {path: 'private'}), {code: 'INVALID_ARGUMENT'});
  assert.deepEqual(describeSystemObservationCapabilities(), {
    toolName: SYSTEM_OBSERVATION_TOOL_NAME,
    requiredScope: SYSTEM_OBSERVATION_SCOPE,
    supported: ['cpu', 'memory', 'uptime'],
    unavailable: ['process_breakdown', 'disk_io', 'thermal', 'network_activity'],
  });
});

test('synthetic CPU, memory and uptime become a bounded aggregate observation', async () => {
  const tool = createSystemObservationTool({probe: probe(), now: () => observedAt, sampleWindowMs: 1});
  const result = await tool.execute({}, context({deadline: '2026-09-17T12:00:01.000Z'}));
  assert.deepEqual({...result, actualSampleWindowMs: 0}, {
    source: 'injected',
    capturedAt: '2026-09-17T12:00:00.000Z',
    sampledFrom: '2026-09-17T12:00:00.000Z',
    sampledUntil: '2026-09-17T12:00:00.000Z',
    actualSampleWindowMs: 0,
    requestedSampleWindowMs: 1,
    cpu: {logicalProcessorCount: 2, utilizationPercent: 50},
    memory: {totalBytes: 1_000, freeBytes: 250, usedBytes: 750, utilizationPercent: 75},
    uptimeSeconds: 1_234,
    unavailable: ['process_breakdown', 'disk_io', 'thermal', 'network_activity'],
  });
  assert.ok(Number.isFinite(result.actualSampleWindowMs) && result.actualSampleWindowMs >= 0);
  assert.doesNotThrow(() => validateToolValue(tool.descriptor.outputSchema, result));
  assert.doesNotMatch(JSON.stringify(result), /hostname|username|processName|commandLine|path|address|credential/i);
});

test('cancellation interrupts sampling without a second probe or lingering timer', async () => {
  let reads = 0;
  const source = probe({cpuTimes: () => {
    reads++;
    return [{user: 1, nice: 0, sys: 0, idle: 9, irq: 0}];
  }});
  const tool = createSystemObservationTool({probe: source, sampleWindowMs: 1_000});
  const controller = new AbortController();
  const started = Date.now();
  const pending = tool.execute({}, context({
    signal: controller.signal,
    deadline: new Date(Date.now() + 5_000).toISOString(),
  }));
  controller.abort();
  await assert.rejects(pending, {code: 'CANCELLED'});
  assert.equal(reads, 1);
  assert.ok(Date.now() - started < 500);
});

test('cancelled or expired contexts do not read the probe', async () => {
  let reads = 0;
  const source = probe({cpuTimes: () => { reads++; return []; }});
  const tool = createSystemObservationTool({probe: source, now: () => observedAt, sampleWindowMs: 1});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(tool.execute({}, context({signal: controller.signal})), {code: 'CANCELLED'});
  await assert.rejects(tool.execute({}, context({deadline: '2026-09-17T11:59:59.999Z'})), {code: 'TIMEOUT'});
  assert.equal(reads, 0);
});

test('deadline interrupts sampling without retrying the probe', async () => {
  let reads = 0;
  const source = probe({cpuTimes: () => {
    reads++;
    return [{user: 1, nice: 0, sys: 0, idle: 9, irq: 0}];
  }});
  const tool = createSystemObservationTool({probe: source, sampleWindowMs: 1_000});
  await assert.rejects(tool.execute({}, context({
    deadline: new Date(Date.now() + 15).toISOString(),
  })), {code: 'TIMEOUT'});
  assert.equal(reads, 1);
});

test('a slow synchronous probe cannot return after the deadline', async () => {
  let current = observedAt.getTime();
  let reads = 0;
  const source = probe({cpuTimes: () => {
    reads++;
    if (reads === 2) current += 1_000;
    return reads === 1
      ? [{user: 1, nice: 0, sys: 0, idle: 9, irq: 0}]
      : [{user: 2, nice: 0, sys: 0, idle: 18, irq: 0}];
  }});
  const tool = createSystemObservationTool({probe: source, now: () => new Date(current), sampleWindowMs: 1});
  await assert.rejects(tool.execute({}, context({deadline: '2026-09-17T12:00:01.000Z'})), {code: 'TIMEOUT'});
  assert.equal(reads, 2);
});

test('invalid or failing probes do not fabricate observations or leak source errors', async () => {
  const stalled = createSystemObservationTool({
    probe: probe({cpuTimes: () => [{user: 1, nice: 0, sys: 0, idle: 9, irq: 0}]}),
    sampleWindowMs: 1,
  });
  await assert.rejects(stalled.execute({}, context({deadline: new Date(Date.now() + 1_000).toISOString()})),
    error => error.code === 'EXTERNAL_FAILURE' && !/private|secret/i.test(error.message));

  const failed = createSystemObservationTool({
    probe: probe({cpuTimes: () => { throw new Error('secret C:\\Users\\private'); }}),
    sampleWindowMs: 1,
  });
  await assert.rejects(failed.execute({}, context({deadline: new Date(Date.now() + 1_000).toISOString()})),
    error => error.code === 'EXTERNAL_FAILURE' && !/Users|secret|private/i.test(error.message));
});

test('counter regressions cannot be hidden by another core or CPU time category', async t => {
  for (const scenario of ['cross-core mutable snapshot', 'same-core category']) await t.test(scenario, async () => {
    const samples = [{user: 100, nice: 0, sys: 0, idle: 900, irq: 0},
      {user: 200, nice: 0, sys: 0, idle: 800, irq: 0}];
    let reads = 0;
    const tool = createSystemObservationTool({sampleWindowMs: 1, probe: probe({cpuTimes: () => {
      if (reads++ > 0) {
        if (scenario === 'cross-core mutable snapshot') {
          Object.assign(samples[0], {user: 0, idle: 0});
          Object.assign(samples[1], {user: 2000, idle: 2000});
        } else {
          Object.assign(samples[0], {user: 50, sys: 200, idle: 1000});
        }
      }
      return samples;
    }})});
    await assert.rejects(tool.execute({}, context({deadline: new Date(Date.now() + 1000).toISOString()})),
      error => error.code === 'EXTERNAL_FAILURE' && error.message === 'System observation is unavailable');
    assert.equal(reads, 2);
  });
});

test('one unchanged core and reused mutable snapshots still allow valid aggregate growth', async () => {
  const samples = [{user: 100, nice: 0, sys: 0, idle: 900, irq: 0},
    {user: 200, nice: 0, sys: 0, idle: 800, irq: 0}];
  let reads = 0;
  const tool = createSystemObservationTool({sampleWindowMs: 1, probe: probe({cpuTimes: () => {
    if (reads++ > 0) Object.assign(samples[1], {user: 300, idle: 900});
    return samples;
  }})});
  const result = await tool.execute({}, context({deadline: new Date(Date.now() + 1000).toISOString()}));
  assert.deepEqual(result.cpu, {logicalProcessorCount: 2, utilizationPercent: 50});
  assert.equal(result.source, 'injected');
  assert.doesNotThrow(() => validateToolValue(tool.descriptor.outputSchema, result));
  assert.equal(reads, 2);
});
