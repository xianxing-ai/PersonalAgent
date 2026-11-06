import assert from 'node:assert/strict';
import test from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {
  assertWindowsSandboxEvidence,
  isWindowsSandboxEvidence,
  planWindowsSandboxAcceptance,
  WINDOWS_SANDBOX_ACCEPTANCE_BACKEND,
  WINDOWS_SANDBOX_ACCEPTANCE_CAPABILITY,
  WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON,
  WINDOWS_SANDBOX_ACCEPTANCE_PENDING_GATES,
  WINDOWS_SANDBOX_ACCEPTANCE_LIMITS,
} from '../dist/index.js';

const validSha = 'a'.repeat(64);
const validSha2 = 'b'.repeat(64);
const validSha3 = 'c'.repeat(64);
const validSha4 = 'd'.repeat(64);

function makeValidHelperFiles() {
  return {
    'WindowsJobProcessHost.dll': validSha2,
    'WindowsJobProcessHost.deps.json': validSha3,
    'WindowsJobProcessHost.runtimeconfig.json': validSha4,
  };
}

function makeValidEvidence(overrides = {}) {
  return {
    platform: 'win32',
    backend: WINDOWS_SANDBOX_ACCEPTANCE_BACKEND,
    enforced: true,
    outcome: 'exited',
    exitCode: 0,
    signal: null,
    stdout: 'process completed safely',
    stderr: '',
    executionStarted: true,
    stopped: true,
    sideEffects: 'none',
    helper: {
      helperPath: 'C:\\Program Files\\PersonalAgent\\native\\WindowsJobProcessHost.exe',
      helperSha256: validSha,
      helperFilesSha256: makeValidHelperFiles(),
      attested: true,
    },
    sandboxRef: 'sandbox-001',
    taskId: 'task-001',
    runId: 'run-001',
    authorizationRef: 'auth-grant-001',
    argumentsDigest: validSha,
    evidenceRef: 'evidence-001',
    targetRef: 'target-001',
    appContainer: true,
    psecVerified: true,
    jobObjectVerified: true,
    descendantsStopped: true,
    filesystemVerified: true,
    networkDenyVerified: true,
    bindingVerified: true,
    assertCurrentVerified: true,
    exactGrantConsumed: true,
    helperVerified: true,
    ...overrides,
  };
}

test('assertWindowsSandboxEvidence validates genuine Windows sandbox live evidence shape', () => {
  const evidence = makeValidEvidence();
  assert.doesNotThrow(() => assertWindowsSandboxEvidence(evidence));
  assert.equal(isWindowsSandboxEvidence(evidence), true);

  // Flat helper properties
  const flatEvidence = makeValidEvidence({
    helper: undefined,
    helperPath: 'C:/PersonalAgent/WindowsJobProcessHost.exe',
    helperSha256: validSha,
    helperFilesSha256: makeValidHelperFiles(),
  });
  assert.doesNotThrow(() => assertWindowsSandboxEvidence(flatEvidence));
  assert.equal(isWindowsSandboxEvidence(flatEvidence), true);

  // Different valid outcomes
  for (const outcome of ['exited', 'cancelled', 'timeout', 'unknown', 'unavailable']) {
    const ev = makeValidEvidence({outcome});
    assert.doesNotThrow(() => assertWindowsSandboxEvidence(ev));
    assert.equal(isWindowsSandboxEvidence(ev), true);
  }
});

test('assertWindowsSandboxEvidence rejects non-objects and primitives', () => {
  for (const invalid of [null, undefined, 42, 'string', true, []]) {
    assert.throws(
      () => assertWindowsSandboxEvidence(invalid),
      (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('non-null object'),
    );
    assert.equal(isWindowsSandboxEvidence(invalid), false);
  }
});

test('assertWindowsSandboxEvidence rejects mock and synthetic flags', () => {
  for (const flag of [{mock: true}, {isMock: true}, {synthetic: true}, {evidenceLevel: 'mock'}]) {
    const invalid = makeValidEvidence(flag);
    assert.throws(
      () => assertWindowsSandboxEvidence(invalid),
      (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('Mock evidence cannot be asserted'),
    );
    assert.equal(isWindowsSandboxEvidence(invalid), false);
  }
});

test('assertWindowsSandboxEvidence rejects non-win32 platforms', () => {
  for (const plat of ['linux', 'darwin', 'android', 'freebsd', '']) {
    const invalid = makeValidEvidence({platform: plat});
    assert.throws(
      () => assertWindowsSandboxEvidence(invalid),
      (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('platform must be "win32"'),
    );
    assert.equal(isWindowsSandboxEvidence(invalid), false);
  }
});

test('assertWindowsSandboxEvidence rejects non-windows-psec backend', () => {
  for (const backend of ['none', 'docker', 'wsl', 'sandbox', '']) {
    const invalid = makeValidEvidence({backend});
    assert.throws(
      () => assertWindowsSandboxEvidence(invalid),
      (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('backend must be "windows-psec"'),
    );
    assert.equal(isWindowsSandboxEvidence(invalid), false);
  }
});

test('assertWindowsSandboxEvidence rejects un-enforced executions', () => {
  // Non-boolean enforced
  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({enforced: 'yes'})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('enforced must be a boolean'),
  );

  // False enforced
  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({enforced: false})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('enforced must be strictly true'),
  );
});

test('assertWindowsSandboxEvidence rejects invalid outcomes and lifecycle flags', () => {
  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({outcome: 'running'})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('outcome must be a valid outcome'),
  );

  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({executionStarted: 'true'})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('executionStarted must be a boolean'),
  );

  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({stopped: null})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('stopped must be a boolean'),
  );

  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({sideEffects: 'dangerous'})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('sideEffects must be "none", "possible", or "unknown"'),
  );

  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({exitCode: '1'})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('exitCode must be an integer or null'),
  );
});

test('assertWindowsSandboxEvidence validates helper attestation and pins', () => {
  // Missing helper
  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({helper: undefined, helperPath: undefined})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('must contain helper attestation'),
  );

  // Wrong executable name
  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({
      helper: {
        helperPath: 'C:\\Windows\\System32\\cmd.exe',
        helperSha256: validSha,
        helperFilesSha256: makeValidHelperFiles(),
      },
    })),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('helperPath must point to WindowsJobProcessHost.exe'),
  );

  // Invalid helper sha256
  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({
      helper: {
        helperPath: 'C:\\WindowsJobProcessHost.exe',
        helperSha256: 'short-sha',
        helperFilesSha256: makeValidHelperFiles(),
      },
    })),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('helperSha256 must be a 64-character hex string'),
  );

  // Missing required dependency file pin
  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({
      helper: {
        helperPath: 'C:\\WindowsJobProcessHost.exe',
        helperSha256: validSha,
        helperFilesSha256: {
          'WindowsJobProcessHost.dll': validSha2,
          // Missing deps.json and runtimeconfig.json
        },
      },
    })),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('helperFilesSha256 must include a valid 64-character hex digest'),
  );
});

test('assertWindowsSandboxEvidence rejects invalid string identifiers and digests', () => {
  assert.throws(
    () => assertWindowsSandboxEvidence(makeValidEvidence({argumentsDigest: 'invalid-digest'})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('argumentsDigest must be a 64-character hex string'),
  );

  for (const field of ['taskId', 'runId', 'sandboxRef', 'authorizationRef', 'evidenceRef', 'targetRef']) {
    assert.throws(
      () => assertWindowsSandboxEvidence(makeValidEvidence({[field]: '   '})),
      (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes(`${field} must be a non-empty string`),
    );
  }
});

test('planWindowsSandboxAcceptance fails closed when platform is not win32', () => {
  const plan = planWindowsSandboxAcceptance({
    platform: 'linux',
    hasRealMachineEvidence: true,
    evidence: makeValidEvidence(),
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON);
  assert.deepEqual(plan.pending, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_GATES);
  assert.deepEqual(plan.verifiedGates, []);
  assert.ok(plan.limits.length > 0);
});

test('planWindowsSandboxAcceptance fails closed when helper is unavailable', () => {
  // Explicit helperAvailable: false
  const plan1 = planWindowsSandboxAcceptance({
    platform: 'win32',
    helperAvailable: false,
    hasRealMachineEvidence: true,
    evidence: makeValidEvidence(),
  });
  assert.equal(plan1.closedLoop, false);
  assert.equal(plan1.status, 'unavailable');
  assert.equal(plan1.reason, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON);

  // Invalid helperPath provided
  const plan2 = planWindowsSandboxAcceptance({
    platform: 'win32',
    helperPath: 'C:\\bad-helper.exe',
    hasRealMachineEvidence: true,
    evidence: makeValidEvidence(),
  });
  assert.equal(plan2.closedLoop, false);
  assert.equal(plan2.status, 'unavailable');
  assert.equal(plan2.reason, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON);
});

test('planWindowsSandboxAcceptance fails closed when real evidence is missing', () => {
  // No options passed
  const plan1 = planWindowsSandboxAcceptance();
  assert.equal(plan1.closedLoop, false);
  assert.equal(plan1.status, 'unavailable');
  assert.equal(plan1.reason, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON);

  // Win32 but no evidence provided
  const plan2 = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
  });
  assert.equal(plan2.closedLoop, false);
  assert.equal(plan2.status, 'unavailable');

  // Win32 and evidence provided, but hasRealMachineEvidence is not true
  const plan3 = planWindowsSandboxAcceptance({
    platform: 'win32',
    evidence: makeValidEvidence(),
  });
  assert.equal(plan3.closedLoop, false);
  assert.equal(plan3.status, 'unavailable');
});

test('planWindowsSandboxAcceptance fails closed under mock mode', () => {
  const plan1 = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: makeValidEvidence(),
    mock: true,
  });
  assert.equal(plan1.closedLoop, false);
  assert.equal(plan1.status, 'unavailable');

  const plan2 = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: makeValidEvidence({isMock: true}),
  });
  assert.equal(plan2.closedLoop, false);
  assert.equal(plan2.status, 'unavailable');

  const plan3 = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: makeValidEvidence(),
    evidenceLevel: 'mock',
  });
  assert.equal(plan3.closedLoop, false);
  assert.equal(plan3.status, 'unavailable');
});

test('planWindowsSandboxAcceptance prohibits caller forcing fake closedLoop: true', () => {
  const plan = planWindowsSandboxAcceptance({
    platform: 'linux',
    closedLoop: true,
  });
  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
});

test('planWindowsSandboxAcceptance achieves verified closedLoop with valid win32 real machine evidence', () => {
  const evidence = makeValidEvidence();
  const plan = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence,
  });

  assert.equal(plan.closedLoop, true);
  assert.equal(plan.status, 'verified');
  assert.equal(plan.reason, '已通过 Windows 真机验收');
  assert.deepEqual(plan.pending, []);
  assert.deepEqual(plan.verifiedGates, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_GATES);
  assert.equal(plan.evidenceSummary?.helperSha256, validSha);
  assert.equal(plan.evidenceSummary?.outcome, 'exited');
  assert.equal(plan.evidenceSummary?.enforced, true);
  assert.equal(plan.evidenceSummary?.taskId, 'task-001');
  assert.equal(plan.evidenceSummary?.runId, 'run-001');
});

test('planWindowsSandboxAcceptance tracks pending gates when specific gates are unverified', () => {
  const incompleteEvidence = makeValidEvidence({
    networkDenyVerified: false,
    networkBlocked: false,
    networkVerified: false,
    outcome: 'unknown',
  });

  const plan = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: incompleteEvidence,
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.ok(plan.pending.includes('network_deny_guard'));
});

test('planWindowsSandboxAcceptance preserves custom pending items', () => {
  const customGate = 'host_pipe_handshake';
  const plan = planWindowsSandboxAcceptance({
    platform: 'linux',
    customPendingItems: [customGate],
  });

  assert.equal(plan.closedLoop, false);
  assert.ok(plan.pending.includes(customGate));
});
