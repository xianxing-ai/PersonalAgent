import assert from 'node:assert/strict';
import test from 'node:test';
import {ProtocolError} from '@personal-agent/contracts';
import {
  assertNotepadLiveEvidence,
  isNotepadLiveEvidence,
  planNotepadLiveAcceptance,
  NOTEPAD_LIVE_ACCEPTANCE_CAPABILITY,
  NOTEPAD_LIVE_ACCEPTANCE_TOOL_NAME,
  NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON,
  NOTEPAD_LIVE_ACCEPTANCE_PENDING_GATES,
  NOTEPAD_LIVE_ACCEPTANCE_LIMITS,
} from '../dist/index.js';

const validSha = 'a'.repeat(64);
const validIsoTime = '2026-11-07T04:00:00.000Z';

function makeValidEvidence(overrides = {}) {
  return {
    platform: 'win32',
    capability: NOTEPAD_LIVE_ACCEPTANCE_CAPABILITY,
    confirmationGate: {
      confirmed: true,
      gate: 'f9',
      source: 'f9_hotkey',
      confirmedAt: validIsoTime,
      targetRef: 'target-1234',
    },
    readbackSummary: {
      readbackDigest: validSha,
      verified: true,
      verifiedAt: validIsoTime,
    },
    readbackDigest: validSha,
    source: 'windows-uia',
    nativeReadbackVerified: true,
    isolatedJournalReadback: true,
    exactGrantConsumed: true,
    taskId: 'task-001',
    runId: 'run-001',
    targetRef: 'target-1234',
    evidenceRef: 'evidence-001',
    ...overrides,
  };
}

test('assertNotepadLiveEvidence validates genuine Windows live evidence shape', () => {
  const evidence = makeValidEvidence();
  assert.doesNotThrow(() => assertNotepadLiveEvidence(evidence));
  assert.equal(isNotepadLiveEvidence(evidence), true);

  // Accepts computer.notepad.replace_text as capability
  const evidence2 = makeValidEvidence({
    capability: NOTEPAD_LIVE_ACCEPTANCE_TOOL_NAME,
    readbackSummary: validSha,
  });
  assert.doesNotThrow(() => assertNotepadLiveEvidence(evidence2));
  assert.equal(isNotepadLiveEvidence(evidence2), true);
});

test('assertNotepadLiveEvidence rejects non-objects and primitives', () => {
  for (const invalid of [null, undefined, 42, 'string', true, []]) {
    assert.throws(
      () => assertNotepadLiveEvidence(invalid),
      (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('non-null object'),
    );
    assert.equal(isNotepadLiveEvidence(invalid), false);
  }
});

test('assertNotepadLiveEvidence rejects mock or synthetic flags', () => {
  for (const flag of [{mock: true}, {isMock: true}, {evidenceLevel: 'mock'}]) {
    const invalid = makeValidEvidence(flag);
    assert.throws(
      () => assertNotepadLiveEvidence(invalid),
      (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('Mock evidence cannot be asserted'),
    );
    assert.equal(isNotepadLiveEvidence(invalid), false);
  }
});

test('assertNotepadLiveEvidence rejects non-win32 platforms', () => {
  for (const plat of ['linux', 'darwin', 'android', 'freebsd', '']) {
    const invalid = makeValidEvidence({platform: plat});
    assert.throws(
      () => assertNotepadLiveEvidence(invalid),
      (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('platform must be "win32"'),
    );
    assert.equal(isNotepadLiveEvidence(invalid), false);
  }
});

test('assertNotepadLiveEvidence rejects invalid capabilities', () => {
  for (const cap of ['notepad.write', 'computer.desktop.type', 'other', '']) {
    const invalid = makeValidEvidence({capability: cap});
    assert.throws(
      () => assertNotepadLiveEvidence(invalid),
      (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('capability must be'),
    );
    assert.equal(isNotepadLiveEvidence(invalid), false);
  }
});

test('assertNotepadLiveEvidence rejects missing or invalid confirmationGate', () => {
  // Missing confirmationGate
  assert.throws(
    () => assertNotepadLiveEvidence(makeValidEvidence({confirmationGate: undefined})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('confirmationGate must be a non-null object'),
  );

  // confirmed is false or missing
  assert.throws(
    () => assertNotepadLiveEvidence(makeValidEvidence({confirmationGate: {confirmed: false}})),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('confirmationGate.confirmed must be strictly true'),
  );

  // confirmedAt is invalid timestamp
  assert.throws(
    () => assertNotepadLiveEvidence(makeValidEvidence({
      confirmationGate: {confirmed: true, confirmedAt: 'invalid-time'},
    })),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('UTC ISO string'),
  );

  // empty source string
  assert.throws(
    () => assertNotepadLiveEvidence(makeValidEvidence({
      confirmationGate: {confirmed: true, source: '   '},
    })),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('non-empty string'),
  );
});

test('assertNotepadLiveEvidence rejects missing or empty readback digest/summary', () => {
  // Neither readbackSummary nor readbackDigest
  assert.throws(
    () => assertNotepadLiveEvidence(makeValidEvidence({
      readbackSummary: undefined,
      readbackDigest: undefined,
    })),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT' && err.message.includes('must contain readbackSummary or readbackDigest'),
  );

  // Empty string readbackSummary
  assert.throws(
    () => assertNotepadLiveEvidence(makeValidEvidence({
      readbackSummary: '   ',
      readbackDigest: undefined,
    })),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT',
  );

  // Object readbackSummary without digest
  assert.throws(
    () => assertNotepadLiveEvidence(makeValidEvidence({
      readbackSummary: {verified: true},
      readbackDigest: undefined,
    })),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT',
  );
});

test('planNotepadLiveAcceptance fails closed when running on non-win32 or without options', () => {
  // Default call with no arguments
  const defaultPlan = planNotepadLiveAcceptance();
  assert.equal(defaultPlan.closedLoop, false);
  assert.equal(defaultPlan.status, 'unavailable');
  assert.equal(defaultPlan.reason, NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON);
  assert.deepEqual(defaultPlan.pending, NOTEPAD_LIVE_ACCEPTANCE_PENDING_GATES);
  assert.deepEqual(defaultPlan.verifiedGates, []);
  assert.equal(defaultPlan.capability, NOTEPAD_LIVE_ACCEPTANCE_CAPABILITY);
  assert.equal(defaultPlan.limits.length > 0, true);

  // Explicit platform linux
  const linuxPlan = planNotepadLiveAcceptance({
    platform: 'linux',
    hasRealMachineEvidence: true,
    evidence: makeValidEvidence(),
  });
  assert.equal(linuxPlan.closedLoop, false);
  assert.equal(linuxPlan.status, 'unavailable');
  assert.equal(linuxPlan.reason, NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON);
  assert.equal(linuxPlan.platform, 'linux');
});

test('planNotepadLiveAcceptance strictly forbids fake success', () => {
  // Caller attempts to force closedLoop: true without passing prerequisites
  const fakeAttempts = [
    {closedLoop: true},
    {closedLoop: true, platform: 'linux'},
    {closedLoop: true, platform: 'win32'},
    {closedLoop: true, platform: 'win32', mock: true},
    {closedLoop: true, platform: 'win32', hasRealMachineEvidence: true, mock: true},
    {closedLoop: true, platform: 'win32', hasRealMachineEvidence: false, evidence: makeValidEvidence()},
    {closedLoop: true, platform: 'win32', hasRealMachineEvidence: true, evidence: makeValidEvidence({mock: true})},
  ];

  for (const fakeOption of fakeAttempts) {
    const plan = planNotepadLiveAcceptance(fakeOption);
    assert.equal(plan.closedLoop, false, `Fake option must not produce closedLoop: true: ${JSON.stringify(fakeOption)}`);
    assert.equal(plan.status, 'unavailable');
    assert.equal(plan.reason, NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON);
    assert.equal(plan.pending.length > 0, true);
  }
});

test('planNotepadLiveAcceptance throws when real evidence shape is corrupted', () => {
  assert.throws(
    () => planNotepadLiveAcceptance({
      platform: 'win32',
      hasRealMachineEvidence: true,
      evidence: {corrupted: true},
    }),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT',
  );
});

test('planNotepadLiveAcceptance keeps all required gates pending even with self-reported win32 evidence (no physical runner execution)', () => {
  // Evidence has F9 confirmation and pipe, but missing native readback and policy grant
  const partialEvidence = makeValidEvidence({
    nativeReadbackVerified: false,
    readbackSummary: {readbackDigest: validSha, verified: false},
    exactGrantConsumed: false,
    policyDecision: 'deny',
  });

  const plan = planNotepadLiveAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: partialEvidence,
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON);
  // All gates must strictly remain pending without genuine runner execution
  assert.equal(plan.pending.includes('f9_confirmation_gate'), true);
  assert.equal(plan.pending.includes('uia_write'), true);
  assert.equal(plan.pending.includes('independent_readback'), true);
  assert.equal(plan.pending.includes('policy_authorization'), true);
  assert.equal(plan.pending.includes('windows_host_pipe'), true);
  assert.deepEqual(plan.verifiedGates, []);
});

test('planNotepadLiveAcceptance supports custom pending items', () => {
  const plan = planNotepadLiveAcceptance({
    platform: 'linux',
    customPendingItems: ['custom_device_reboot_gate'],
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.pending.includes('custom_device_reboot_gate'), true);
});

test('planNotepadLiveAcceptance keeps closedLoop=false and all 5 gates pending even when all simulated win32 gates pass shape assertion', () => {
  // 依据 AGENTS.md 与真机可信验收规范：内存自报对象不构成独立于调用方的 Windows 实机物理执行证据。
  // 旧测试将纯 JS 形状等同于真机闭环属于不可信结论，收紧为 closedLoop: false，所有实机门控保持 pending。
  const fullEvidence = makeValidEvidence();
  const plan = planNotepadLiveAcceptance({
    platform: 'win32',
    hasRealMachineEvidence: true,
    evidence: fullEvidence,
  });

  assert.equal(plan.closedLoop, false);
  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.reason, NOTEPAD_LIVE_ACCEPTANCE_PENDING_REASON);
  assert.equal(plan.pending.length, 5);
  assert.deepEqual(plan.verifiedGates, []);
  assert.equal(plan.evidenceSummary?.readbackDigest, validSha);
  assert.equal(plan.evidenceSummary?.taskId, 'task-001');
  assert.equal(plan.evidenceSummary?.targetRef, 'target-1234');
});

test('limits describe offline constraints and manual Windows runner requirement', () => {
  assert.ok(NOTEPAD_LIVE_ACCEPTANCE_LIMITS.length >= 4);
  const text = NOTEPAD_LIVE_ACCEPTANCE_LIMITS.join('\n');
  assert.ok(text.includes('win32'));
  assert.ok(text.includes('closedLoop=false'));
  assert.ok(text.includes('tests/manual/windows/notepad-full-access-acceptance.mjs'));
});
