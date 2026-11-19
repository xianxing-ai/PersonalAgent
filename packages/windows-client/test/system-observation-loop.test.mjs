import assert from 'node:assert/strict';
import test from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {
  assertDirectProviderReadEvidence,
  assertSystemObservationFailure,
  assertSystemObservationLoopResult,
  createSystemObservationTool,
  isSystemObservationCancellation,
  isSystemObservationLoopResult,
  isSystemObservationTimeout,
  planSystemObservationAcceptance,
  SYSTEM_OBSERVATION_ACCEPTANCE_PENDING,
  SYSTEM_OBSERVATION_LOOP_ERROR_CODES,
  SYSTEM_OBSERVATION_LOOP_SUPPORTED_METRICS,
  SYSTEM_OBSERVATION_LOOP_UNAVAILABLE_METRICS,
  SYSTEM_OBSERVATION_SCOPE,
} from '../dist/index.js';

function createValidObservation(overrides = {}) {
  return {
    source: 'node:os',
    capturedAt: '2026-11-07T03:00:00.250Z',
    sampledFrom: '2026-11-07T03:00:00.000Z',
    sampledUntil: '2026-11-07T03:00:00.250Z',
    actualSampleWindowMs: 250.5,
    requestedSampleWindowMs: 250,
    cpu: {
      logicalProcessorCount: 8,
      utilizationPercent: 25.5,
    },
    memory: {
      totalBytes: 16_000_000_000,
      freeBytes: 4_000_000_000,
      usedBytes: 12_000_000_000,
      utilizationPercent: 75,
    },
    uptimeSeconds: 86_400,
    unavailable: ['process_breakdown', 'disk_io', 'thermal', 'network_activity'],
    ...overrides,
  };
}

test('assertSystemObservationLoopResult validates valid node:os and injected observation shapes', () => {
  const nodeOsResult = createValidObservation();
  assert.equal(isSystemObservationLoopResult(nodeOsResult), true);
  assert.doesNotThrow(() => assertSystemObservationLoopResult(nodeOsResult));

  const injectedResult = createValidObservation({source: 'injected'});
  assert.equal(isSystemObservationLoopResult(injectedResult), true);
  assert.doesNotThrow(() => assertSystemObservationLoopResult(injectedResult));

  assert.deepEqual(SYSTEM_OBSERVATION_LOOP_SUPPORTED_METRICS, ['cpu', 'memory', 'uptime']);
});

test('assertSystemObservationLoopResult accepts output directly from createSystemObservationTool', async () => {
  let cpuRead = 0;
  const cpuSamples = [
    [
      {user: 100, nice: 0, sys: 0, idle: 900, irq: 0},
      {user: 200, nice: 0, sys: 0, idle: 800, irq: 0},
    ],
    [
      {user: 200, nice: 0, sys: 0, idle: 1000, irq: 0},
      {user: 300, nice: 0, sys: 0, idle: 900, irq: 0},
    ],
  ];
  const tool = createSystemObservationTool({
    probe: {
      cpuTimes: () => cpuSamples[Math.min(cpuRead++, 1)],
      totalMemoryBytes: () => 1000,
      freeMemoryBytes: () => 250,
      uptimeSeconds: () => 1234,
    },
    now: () => new Date('2026-11-07T03:00:00.000Z'),
    sampleWindowMs: 1,
  });

  const observation = await tool.execute({}, {
    taskId: 'test-task',
    runId: 'test-run',
    signal: new AbortController().signal,
    deadline: '2026-11-07T03:01:00.000Z',
    scopes: [SYSTEM_OBSERVATION_SCOPE],
  });

  assert.doesNotThrow(() => assertSystemObservationLoopResult(observation));
  assert.equal(isSystemObservationLoopResult(observation), true);
});

test('failure must not masquerade with fabricated zero values', () => {
  // Fabricated zero logicalProcessorCount
  const zeroCpu = createValidObservation({
    cpu: {logicalProcessorCount: 0, utilizationPercent: 0},
  });
  assert.throws(
    () => assertSystemObservationLoopResult(zeroCpu),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('logicalProcessorCount'),
  );
  assert.equal(isSystemObservationLoopResult(zeroCpu), false);

  // Fabricated zero totalBytes
  const zeroMemory = createValidObservation({
    memory: {totalBytes: 0, freeBytes: 0, usedBytes: 0, utilizationPercent: 0},
  });
  assert.throws(
    () => assertSystemObservationLoopResult(zeroMemory),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('totalBytes'),
  );
  assert.equal(isSystemObservationLoopResult(zeroMemory), false);

  // Inconsistent memory usedBytes calculation
  const inconsistentMemory = createValidObservation({
    memory: {totalBytes: 1000, freeBytes: 250, usedBytes: 500, utilizationPercent: 50},
  });
  assert.throws(
    () => assertSystemObservationLoopResult(inconsistentMemory),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('usedBytes'),
  );

  // Negative values
  const negativeUptime = createValidObservation({uptimeSeconds: -1});
  assert.throws(
    () => assertSystemObservationLoopResult(negativeUptime),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('uptimeSeconds'),
  );

  // Invalid source
  const fakeSource = createValidObservation({source: 'simulated'});
  assert.throws(
    () => assertSystemObservationLoopResult(fakeSource),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('source'),
  );
});

test('failure semantics enforce allowed error codes and reject fake results or info leakage', () => {
  assert.deepEqual(SYSTEM_OBSERVATION_LOOP_ERROR_CODES, [
    'EXTERNAL_FAILURE',
    'CANCELLED',
    'TIMEOUT',
    'INVALID_ARGUMENT',
  ]);

  const externalFailure = new ProtocolError('EXTERNAL_FAILURE', 'System observation is unavailable');
  assert.doesNotThrow(() => assertSystemObservationFailure(externalFailure));

  const cancelledError = new ProtocolError('CANCELLED', 'System observation was cancelled');
  assert.doesNotThrow(() => assertSystemObservationFailure(cancelledError));
  assert.equal(isSystemObservationCancellation(cancelledError), true);
  assert.equal(isSystemObservationTimeout(cancelledError), false);

  const timeoutError = new ProtocolError('TIMEOUT', 'System observation deadline expired');
  assert.doesNotThrow(() => assertSystemObservationFailure(timeoutError));
  assert.equal(isSystemObservationTimeout(timeoutError), true);
  assert.equal(isSystemObservationCancellation(timeoutError), false);

  // Reject unsupported error codes
  const unknownError = new ProtocolError('INTERNAL_ERROR', 'Unknown failure');
  assert.throws(
    () => assertSystemObservationFailure(unknownError),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('Unsupported system observation error code'),
  );

  // Reject error embedding fabricated observation data
  const masqueradedError = Object.assign(new ProtocolError('EXTERNAL_FAILURE', 'Failed'), {
    cpu: {logicalProcessorCount: 0, utilizationPercent: 0},
    memory: {totalBytes: 0, freeBytes: 0, usedBytes: 0, utilizationPercent: 0},
  });
  assert.throws(
    () => assertSystemObservationFailure(masqueradedError),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('fabricate or embed observation results'),
  );

  // Reject error leaking private paths
  const leakingError = new ProtocolError('EXTERNAL_FAILURE', 'Failed at C:\\Users\\Administrator\\secret.txt');
  assert.throws(
    () => assertSystemObservationFailure(leakingError),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('sensitive system information'),
  );
});

test('unsupported metrics must be declared unavailable and cannot be present as data fields', () => {
  assert.deepEqual(SYSTEM_OBSERVATION_LOOP_UNAVAILABLE_METRICS, [
    'process_breakdown',
    'disk_io',
    'thermal',
    'network_activity',
  ]);

  // Missing one unavailable declaration
  const incompleteUnavailable = createValidObservation({
    unavailable: ['process_breakdown', 'disk_io', 'thermal'],
  });
  assert.throws(
    () => assertSystemObservationLoopResult(incompleteUnavailable),
    error => error.code === 'INVALID_ARGUMENT' && error.message.includes('unavailable'),
  );

  // Unsupported metric injected as data field
  const withDiskIo = createValidObservation({disk_io: {readBytes: 1000}});
  assert.throws(
    () => assertSystemObservationLoopResult(withDiskIo),
    error => error.code === 'INVALID_ARGUMENT' && (error.message.includes('disk_io') || error.message.includes('Unsupported or unexpected property')),
  );

  const withThermal = createValidObservation({thermal: 65.5});
  assert.throws(
    () => assertSystemObservationLoopResult(withThermal),
    error => error.code === 'INVALID_ARGUMENT' && (error.message.includes('thermal') || error.message.includes('Unsupported or unexpected property')),
  );

  // Sensitive private properties must not be present
  const withHostname = createValidObservation({hostname: 'DESKTOP-TEST'});
  assert.throws(
    () => assertSystemObservationLoopResult(withHostname),
    error => error.code === 'INVALID_ARGUMENT' && (error.message.includes('hostname') || error.message.includes('Unsupported or unexpected property')),
  );
});

test('Linux platform or missing real machine evidence returns closedLoop=false with pending gates', () => {
  assert.deepEqual(SYSTEM_OBSERVATION_ACCEPTANCE_PENDING, [
    'policy',
    'agentarts',
    'desktop-ui',
    'windows-provider',
  ]);

  // Default execution in current environment (Linux)
  const defaultPlan = planSystemObservationAcceptance();
  assert.equal(defaultPlan.closedLoop, false);
  assert.deepEqual(defaultPlan.pending, ['policy', 'agentarts', 'desktop-ui', 'windows-provider']);
  assert.equal(defaultPlan.reason, '待真机验收');

  // Explicit non-Windows platform
  const linuxPlan = planSystemObservationAcceptance({platform: 'linux'});
  assert.deepEqual(linuxPlan, {
    closedLoop: false,
    pending: ['policy', 'agentarts', 'desktop-ui', 'windows-provider'],
    reason: '待真机验收',
  });

  const macPlan = planSystemObservationAcceptance({platform: 'darwin'});
  assert.equal(macPlan.closedLoop, false);
  assert.equal(macPlan.reason, '待真机验收');

  // Windows platform without complete physical machine acceptance
  const winPlan = planSystemObservationAcceptance({platform: 'win32'});
  assert.equal(winPlan.closedLoop, false);
  assert.deepEqual(winPlan.pending, ['policy', 'agentarts', 'desktop-ui', 'windows-provider']);
  assert.equal(winPlan.reason, '待真机验收');

  // Even if mock flags are provided, closedLoop is strictly false and never claims success
  const mockPlan = planSystemObservationAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    productionAuthorizationVerified: true,
    agentArtsVerified: true,
    desktopUiVerified: true,
    windowsProviderVerified: true,
  });
  assert.equal(mockPlan.closedLoop, false);
  assert.equal(mockPlan.reason, '待真机验收');
  assert.deepEqual(mockPlan.pending, ['policy', 'agentarts', 'desktop-ui', 'windows-provider']);
});

function directProviderEvidence(overrides = {}) {
  return {
    evidenceKind: 'direct_provider_read_only',
    platform: 'win32',
    nodeVersion: 'v24.15.0',
    tool: 'computer.system.observe@1.0.0',
    source: 'node:os',
    capturedAt: '2026-11-10T00:00:00.000Z',
    sampledFrom: '2026-11-10T00:00:00.000Z',
    sampledUntil: '2026-11-10T00:00:00.200Z',
    requestedSampleWindowMs: 200,
    actualSampleWindowMs: 200,
    schemaValid: true,
    aggregateValuesPresent: true,
    unavailable: ['process_breakdown', 'disk_io', 'thermal', 'network_activity'],
    productionAuthorizationVerified: false,
    agentArtsVerified: false,
    ...overrides,
  };
}

test('direct provider evidence stays redacted and cannot claim a closed loop', () => {
  assert.doesNotThrow(() => assertDirectProviderReadEvidence(directProviderEvidence()));
  assert.throws(
    () => assertDirectProviderReadEvidence(directProviderEvidence({productionAuthorizationVerified: true})),
    error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => assertDirectProviderReadEvidence(directProviderEvidence({agentArtsVerified: true})),
    error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => assertDirectProviderReadEvidence(directProviderEvidence({platform: 'linux'})),
    error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => assertDirectProviderReadEvidence(directProviderEvidence({closedLoop: true})),
    error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => assertDirectProviderReadEvidence(directProviderEvidence({evidenceKind: 'mock'})),
    error => error instanceof ProtocolError && error.code === 'INVALID_ARGUMENT',
  );
  const plan = planSystemObservationAcceptance({platform: 'win32', evidence: directProviderEvidence()});
  assert.equal(plan.closedLoop, false);
});
