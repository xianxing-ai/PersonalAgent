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

test('planWindowsSandboxAcceptance verifies structural gates with simulated win32 evidence but keeps closedLoop=false (no physical helper process execution)', () => {
  // 依据 AGENTS.md 与 Windows 沙箱可信验收规范：内存自报对象不构成独立于调用方的 Windows 原生 AppContainer/JobObject 物理执行证据。
  // 结构门全部通过进入 structuralGates，但全部 6 项实机门控在未物理执行时必须保持在 pending 中，
  // verifiedGates 保持为空，全链路闭环严格保持 closedLoop: false、status: unavailable。
  const evidence = makeValidEvidence();
  const plan = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence,
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_REASON);
  assert.equal(plan.pending.length, 6);
  assert.deepEqual(plan.pending, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_GATES);
  assert.deepEqual(plan.verifiedGates, []);
  assert.deepEqual(plan.structuralGates, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_GATES);
  assert.equal(plan.structuralVerification?.fullyCovered, true);
  assert.equal(plan.structuralVerification?.missingGates.length, 0);
  assert.ok(plan.structuralVerification?.pinAttestationGap.includes('未与固定受信 Pin 清单比对'));
  assert.equal(plan.evidenceSummary?.helperSha256, validSha);
  assert.equal(plan.evidenceSummary?.outcome, 'exited');
  assert.equal(plan.evidenceSummary?.enforced, true);
  assert.equal(plan.evidenceSummary?.taskId, 'task-001');
  assert.equal(plan.evidenceSummary?.runId, 'run-001');
});

test('planWindowsSandboxAcceptance tracks pending gate when specific gate is unverified in evidence', () => {
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
  assert.equal(plan.pending.length, 6);
  assert.ok(!plan.structuralGates?.includes('network_deny_guard'));
  assert.ok(plan.structuralVerification?.missingGates.includes('network_deny_guard'));
  assert.ok(plan.structuralVerification?.missingFields.includes('networkDenyVerified'));
  assert.equal(plan.structuralVerification?.fullyCovered, false);
});

test('planWindowsSandboxAcceptance preserves custom pending items and validates limits', () => {
  const customGate = 'host_pipe_handshake';
  const plan = planWindowsSandboxAcceptance({
    platform: 'linux',
    customPendingItems: [customGate],
  });

  assert.equal(plan.closedLoop, false);
  assert.ok(plan.pending.includes(customGate));
  const text = plan.limits.join('\n');
  assert.ok(text.includes('closedLoop=false'));
});

test('planWindowsSandboxAcceptance cross-review blockers: removes outcome exited short-circuits, enforces gate 4 sideEffects none and gate 6 exactGrantConsumed (simulated fixture)', () => {
  // Blocker 1: outcome: 'exited' must not short-circuit gates 1, 2, 3, 5
  const exitedShortCircuitAttempt = makeValidEvidence({
    outcome: 'exited',
    helper: {
      helperPath: 'C:\\Program Files\\PersonalAgent\\native\\WindowsJobProcessHost.exe',
      helperSha256: validSha,
      helperFilesSha256: makeValidHelperFiles(),
      attested: false,
    },
    helperVerified: false,
    appContainer: false,
    psecVerified: false,
    jobObjectVerified: false,
    descendantsStopped: false,
    networkDenyVerified: false,
    networkBlocked: false,
    networkVerified: false,
  });

  const plan1 = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: exitedShortCircuitAttempt,
  });

  assert.ok(plan1.structuralVerification?.missingGates.includes('helper_attestation'));
  assert.ok(plan1.structuralVerification?.missingGates.includes('psec_appcontainer_boundary'));
  assert.ok(plan1.structuralVerification?.missingGates.includes('job_object_containment'));
  assert.ok(plan1.structuralVerification?.missingGates.includes('network_deny_guard'));

  // Blocker 2: gate 4 requires sideEffects === 'none' AND filesystemVerified === true
  const sideEffectsPossibleEvidence = makeValidEvidence({
    sideEffects: 'possible', // Cannot pass gate 4!
    filesystemVerified: true,
  });
  const plan2 = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: sideEffectsPossibleEvidence,
  });
  assert.ok(plan2.structuralVerification?.missingGates.includes('filesystem_isolation'));

  // Blocker 2 (cont): gate 6 requires exactGrantConsumed === true (authorizationRef alone is insufficient)
  const noExactGrantEvidence = makeValidEvidence({
    authorizationRef: 'auth-ref-only',
    exactGrantConsumed: false,
  });
  const plan3 = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: noExactGrantEvidence,
  });
  assert.ok(plan3.structuralVerification?.missingGates.includes('policy_binding'));

  // When all 6 gates strictly pass simulated structure validation:
  const allGatesPassEvidence = makeValidEvidence({
    outcome: 'exited',
    helperVerified: true,
    enforced: true,
    appContainer: true,
    stopped: true,
    jobObjectVerified: true,
    sideEffects: 'none',
    filesystemVerified: true,
    networkDenyVerified: true,
    exactGrantConsumed: true,
  });
  const plan4 = planWindowsSandboxAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: allGatesPassEvidence,
  });
  assert.equal(plan4.pending.length, 6);
  assert.deepEqual(plan4.structuralGates, WINDOWS_SANDBOX_ACCEPTANCE_PENDING_GATES);
  assert.equal(plan4.structuralVerification?.fullyCovered, true);
  assert.deepEqual(plan4.verifiedGates, []);
  // Full closed loop strictly remains false without physical helper execution
  assert.equal(plan4.closedLoop, false);
  assert.equal(plan4.status, 'unavailable');
});
