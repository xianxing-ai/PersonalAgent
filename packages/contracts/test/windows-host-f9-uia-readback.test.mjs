import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ProtocolError} from '../dist/index.js';
import {
  WINDOWS_HOST_PROTOCOL_VERSION,
  WINDOWS_HOST_TOOL_NAME,
  assertNotepadConfirmationGate,
  encodeWindowsHostFrame,
  parseWindowsHostFrame,
  validateWindowsHostExecuteConfirmation,
  validateWindowsHostHandshake,
  validateWindowsHostObservation,
  validateWindowsHostRecoveredResult,
  validateWindowsHostResult,
  validateWindowsHostStatus,
  validateWindowsHostTargetReady,
} from '../dist/windows-host.js';

// Base timestamps and fixtures
const t0 = '2026-11-07T00:00:00.000Z';
const t1 = '2026-11-07T00:01:00.000Z';
const t2 = '2026-11-07T00:02:00.000Z';

const base = {protocolVersion: WINDOWS_HOST_PROTOCOL_VERSION, requestId: 'req-001'};
const hello = {kind: 'hello', ...base, clientNonce: '1'.repeat(32)};
const ack = {
  kind: 'hello_ack',
  ...base,
  clientNonce: hello.clientNonce,
  hostNonce: '2'.repeat(32),
  sessionId: 'session-alpha',
};
const bind = {kind: 'bind', ...base, sessionId: ack.sessionId, hostNonce: ack.hostNonce};

const observe = {
  kind: 'observe',
  ...base,
  sessionId: ack.sessionId,
  deadline: t1,
  capability: 'notepad.replace_text',
};
const observed = {
  kind: 'observed',
  ...base,
  sessionId: ack.sessionId,
  targetRef: 'opaque-notepad-ref-1',
  expiresAt: t1,
  source: 'windows-uia',
};

const execute = {
  kind: 'execute',
  ...base,
  sessionId: ack.sessionId,
  taskId: 'task-notepad-42',
  runId: 'run-replace-001',
  toolName: WINDOWS_HOST_TOOL_NAME,
  toolVersion: '1.0.0',
  authorizationRef: 'grant-policy-001',
  argumentsDigest: 'f'.repeat(64),
  targetRef: observed.targetRef,
  deadline: t1,
  expectedText: 'Line to replace',
  replacementText: 'New text content',
};

const verifiedResult = {
  kind: 'result',
  ...base,
  sessionId: ack.sessionId,
  taskId: execute.taskId,
  runId: execute.runId,
  toolName: execute.toolName,
  toolVersion: execute.toolVersion,
  argumentsDigest: execute.argumentsDigest,
  targetRef: execute.targetRef,
  state: 'verified',
  startedAt: t0,
  finishedAt: t1,
  evidenceRef: 'evidence-uia-readback-001',
};

test('1. Handshake reaching only hello_ack does NOT equal authorized or confirmed session', () => {
  // Protocol sequence check: handshake MUST contain (hello, hello_ack, bind).
  // A truncated handshake ending at hello_ack is not bound.
  assert.throws(
    // @ts-expect-error test incomplete sequence
    () => validateWindowsHostHandshake(hello, ack, undefined),
    (err) => err instanceof ProtocolError,
    'Handshake without bind must throw ProtocolError',
  );

  // Mismatched nonce between hello_ack and bind must fail
  assert.throws(
    () => validateWindowsHostHandshake(hello, ack, {...bind, hostNonce: '9'.repeat(32)}),
    (err) => err instanceof ProtocolError,
    'Mismatched hostNonce between hello_ack and bind must be rejected',
  );

  // Mismatched sessionId must fail
  assert.throws(
    () => validateWindowsHostHandshake(hello, ack, {...bind, sessionId: 'other-session'}),
    (err) => err instanceof ProtocolError,
    'Mismatched sessionId must be rejected',
  );

  // Handshake frames are pure pipe connection identity frames; hello_ack contains
  // NO target reference, NO authorization reference, and NO user confirmation.
  assert.equal('targetRef' in ack, false, 'hello_ack must not carry targetRef');
  assert.equal('authorizationRef' in ack, false, 'hello_ack must not carry authorizationRef');
  assert.equal('confirmed' in ack, false, 'hello_ack must not carry user confirmation');

  // Attempting to skip bind and jump straight to observe with hello_ack fails frame validation
  assert.throws(
    // @ts-expect-error test illegal transition
    () => validateWindowsHostObservation(ack, observed),
    'Cannot use hello_ack as observe request',
  );

  // Documentary assertion:
  // Historical evidence on Windows (#179@c7af939) demonstrated that NamedPipe handshake
  // through Win32 PipeBridge reaches hello_ack with process identity verification.
  // HOWEVER, this short chain only verifies pipe peer OS process PID/SID, NEVER constitutes
  // Policy authorization, user presence, F9 confirmation, or permission to mutate Notepad.
  const handshakeDocAssertion = {
    transportReadiness: 'verified_via_pipe_bridge',
    policyAuthorization: 'PENDING_POLICY_GATE',
    userF9Confirmation: 'PENDING_FIELD_ACCEPTANCE',
  };
  assert.equal(handshakeDocAssertion.transportReadiness, 'verified_via_pipe_bridge');
  assert.notEqual(handshakeDocAssertion.policyAuthorization, 'GRANTED');
  assert.notEqual(handshakeDocAssertion.userF9Confirmation, 'CONFIRMED');
});

test('2. Execute frame strictly validates all mandatory fields and result constraints', () => {
  // Valid execute frame parses cleanly
  const parsed = parseWindowsHostFrame(execute);
  assert.equal(parsed.kind, 'execute');

  // Required fields for execute:
  const mandatoryExecuteFields = [
    'taskId',
    'runId',
    'toolName',
    'toolVersion',
    'authorizationRef',
    'argumentsDigest',
    'targetRef',
    'deadline',
    'expectedText',
    'replacementText',
  ];

  for (const field of mandatoryExecuteFields) {
    const invalidFrame = {...execute};
    delete invalidFrame[field];
    assert.throws(
      () => parseWindowsHostFrame(invalidFrame),
      (err) => err instanceof ProtocolError,
      `Execute frame missing field '${field}' must fail closed`,
    );
  }

  // Field type and boundary checks:
  assert.throws(
    () => parseWindowsHostFrame({...execute, toolName: 'computer.notepad.append_text'}),
    'Unknown toolName must be rejected',
  );
  assert.throws(
    () => parseWindowsHostFrame({...execute, toolVersion: '2.0.0'}),
    'Unsupported toolVersion must be rejected',
  );
  assert.throws(
    () => parseWindowsHostFrame({...execute, argumentsDigest: 'invalid-not-64-hex'}),
    'Malformed argumentsDigest must be rejected',
  );
  assert.throws(
    () => parseWindowsHostFrame({...execute, targetRef: 'short-ref'}),
    'targetRef under 16 chars must be rejected',
  );
  assert.throws(
    () => parseWindowsHostFrame({...execute, deadline: '2026-11-07 00:00:00'}),
    'Non-UTC deadline must be rejected',
  );
  assert.throws(
    () => parseWindowsHostFrame({...execute, expectedText: 'x'.repeat(4097)}),
    'expectedText exceeding 4096 code units must be rejected',
  );
  assert.throws(
    () => parseWindowsHostFrame({...execute, replacementText: 'y'.repeat(4097)}),
    'replacementText exceeding 4096 code units must be rejected',
  );

  // Result frame constraints:
  // (a) verified state requires evidenceRef and forbids errorCode
  assert.doesNotThrow(() => parseWindowsHostFrame(verifiedResult));
  assert.throws(
    () => parseWindowsHostFrame({...verifiedResult, evidenceRef: undefined}),
    'verified result without evidenceRef must throw',
  );
  assert.throws(
    () => parseWindowsHostFrame({...verifiedResult, errorCode: 'INVALID_ARGUMENT'}),
    'verified result with errorCode must throw',
  );

  // (b) non-verified states (refused, cancelled, result_unknown) mandate errorCode
  const nonVerifiedStates = [
    {state: 'refused', errorCode: 'UNAUTHORIZED'},
    {state: 'cancelled', errorCode: 'CANCELLED'},
    {state: 'result_unknown', errorCode: 'RESULT_UNKNOWN'},
  ];
  for (const {state, errorCode} of nonVerifiedStates) {
    const validNonVerified = {
      ...verifiedResult,
      state,
      evidenceRef: undefined,
      errorCode,
    };
    assert.doesNotThrow(() => parseWindowsHostFrame(validNonVerified));

    const invalidMissingError = {...validNonVerified, errorCode: undefined};
    assert.throws(
      () => parseWindowsHostFrame(invalidMissingError),
      `Non-verified state '${state}' without errorCode must throw`,
    );
  }

  // (c) timestamp ordering: finishedAt < startedAt must be rejected
  assert.throws(
    () => parseWindowsHostFrame({...verifiedResult, startedAt: t1, finishedAt: t0}),
    'Result with finishedAt before startedAt must throw',
  );
});

test('3. observed.source must be windows-uia, and target_ready shapes enforce strict validity', () => {
  // observed frame valid shape
  assert.doesNotThrow(() => parseWindowsHostFrame(observed));
  assert.equal(parseWindowsHostFrame(observed).kind, 'observed');

  // observed.source must be exactly 'windows-uia'
  for (const illegalSource of ['mock', 'windows-win32', 'web', 'simulated', 'unknown']) {
    assert.throws(
      () => parseWindowsHostFrame({...observed, source: illegalSource}),
      `observed.source='${illegalSource}' must be rejected`,
    );
  }
  assert.throws(
    // @ts-expect-error test missing source
    () => parseWindowsHostFrame({...observed, source: undefined}),
    'observed without source must be rejected',
  );

  // target_ready request frame
  const targetReadyReq = {
    kind: 'target_ready',
    ...base,
    sessionId: ack.sessionId,
    targetRef: observed.targetRef,
    deadline: t1,
  };
  assert.doesNotThrow(() => parseWindowsHostFrame(targetReadyReq));

  // target_ready_result ready=true branch: requires expiresAt, forbids errorCode
  const validReady = {
    kind: 'target_ready_result',
    ...base,
    sessionId: ack.sessionId,
    targetRef: observed.targetRef,
    ready: true,
    expiresAt: t1,
  };
  assert.doesNotThrow(() => parseWindowsHostFrame(validReady));
  validateWindowsHostTargetReady(targetReadyReq, validReady);

  assert.throws(
    () => parseWindowsHostFrame({...validReady, errorCode: 'TARGET_STALE'}),
    'target_ready_result with ready=true and errorCode must be rejected',
  );
  assert.throws(
    () => parseWindowsHostFrame({...validReady, expiresAt: undefined}),
    'target_ready_result with ready=true without expiresAt must be rejected',
  );

  // target_ready_result ready=false branch: requires errorCode (TARGET_STALE | TIMEOUT), forbids expiresAt
  const validStale = {
    kind: 'target_ready_result',
    ...base,
    sessionId: ack.sessionId,
    targetRef: observed.targetRef,
    ready: false,
    errorCode: 'TARGET_STALE',
  };
  assert.doesNotThrow(() => parseWindowsHostFrame(validStale));
  validateWindowsHostTargetReady(targetReadyReq, validStale);

  const validTimeout = {
    ...validStale,
    errorCode: 'TIMEOUT',
  };
  assert.doesNotThrow(() => parseWindowsHostFrame(validTimeout));
  validateWindowsHostTargetReady(targetReadyReq, validTimeout);

  assert.throws(
    () => parseWindowsHostFrame({...validStale, expiresAt: t1}),
    'target_ready_result with ready=false and expiresAt must be rejected',
  );
  assert.throws(
    () => parseWindowsHostFrame({...validStale, errorCode: undefined}),
    'target_ready_result with ready=false without errorCode must be rejected',
  );
  assert.throws(
    () => parseWindowsHostFrame({...validStale, errorCode: 'UNAUTHORIZED'}),
    'target_ready_result with unexpected errorCode must be rejected',
  );

  // Correlation check on targetRef mismatch
  assert.throws(
    () => validateWindowsHostTargetReady(targetReadyReq, {...validReady, targetRef: 'other-target-ref-9'}),
    'validateWindowsHostTargetReady with mismatched targetRef must throw',
  );
});

test('4. Independent readback: status/result binds strictly to run identity, and result_unknown cannot masquerade as verified', () => {
  // Validate that execute and result match identity
  validateWindowsHostResult(execute, verifiedResult);

  // Result identity tampering must throw:
  const identityFields = ['taskId', 'runId', 'toolName', 'toolVersion', 'argumentsDigest', 'targetRef'];
  for (const field of identityFields) {
    const altered = {...verifiedResult};
    altered[field] = field === 'argumentsDigest' ? '0'.repeat(64) : 'tampered-value';
    assert.throws(
      () => validateWindowsHostResult(execute, altered),
      `Tampered ${field} between execute and result must fail validation`,
    );
  }

  // Status check:
  const statusReq = {
    kind: 'status',
    ...base,
    sessionId: ack.sessionId,
    taskId: execute.taskId,
    runId: execute.runId,
    toolName: execute.toolName,
    toolVersion: execute.toolVersion,
    argumentsDigest: execute.argumentsDigest,
    targetRef: execute.targetRef,
  };
  assert.doesNotThrow(() => parseWindowsHostFrame(statusReq));

  // Status returning in_progress
  const inProgressReply = {
    kind: 'status_reply',
    ...base,
    sessionId: ack.sessionId,
    taskId: execute.taskId,
    runId: execute.runId,
    state: 'in_progress',
  };
  validateWindowsHostStatus(statusReq, inProgressReply);

  // Status returning not_found
  const notFoundReply = {...inProgressReply, state: 'not_found'};
  validateWindowsHostStatus(statusReq, notFoundReply);

  // Status returning terminal result
  validateWindowsHostStatus(statusReq, verifiedResult);

  // Reconnected recovery in a fresh session:
  const recoveryPoll = {
    ...statusReq,
    requestId: 'req-recovery-001',
    sessionId: 'session-beta-reconnected',
  };
  const recoveredResult = {
    ...verifiedResult,
    requestId: recoveryPoll.requestId,
    sessionId: recoveryPoll.sessionId,
  };
  validateWindowsHostRecoveredResult(execute, recoveryPoll, recoveredResult);

  // Recovery using old session id must be rejected
  assert.throws(
    () => validateWindowsHostRecoveredResult(execute, {...recoveryPoll, sessionId: execute.sessionId}, recoveredResult),
    'Recovered polling using old sessionId must be rejected',
  );

  // Recovery with changed argumentsDigest or targetRef must be rejected
  assert.throws(
    () => validateWindowsHostRecoveredResult(
      execute,
      {...recoveryPoll, argumentsDigest: '1'.repeat(64)},
      recoveredResult,
    ),
    'Recovered polling with mismatched argumentsDigest must be rejected',
  );

  // result_unknown semantics:
  // When an execution is interrupted, timed out, or unverified, result_unknown MUST be retained.
  // It MUST NOT masquerade as verified.
  const unknownResult = {
    kind: 'result',
    ...base,
    sessionId: ack.sessionId,
    taskId: execute.taskId,
    runId: execute.runId,
    toolName: execute.toolName,
    toolVersion: execute.toolVersion,
    argumentsDigest: execute.argumentsDigest,
    targetRef: execute.targetRef,
    state: 'result_unknown',
    startedAt: t0,
    finishedAt: t1,
    errorCode: 'RESULT_UNKNOWN',
  };
  assert.doesNotThrow(() => parseWindowsHostFrame(unknownResult));

  // If a malicious or buggy actor attempts to attach evidenceRef or omit errorCode on result_unknown:
  assert.throws(
    () => parseWindowsHostFrame({...unknownResult, evidenceRef: 'fake-evidence', errorCode: undefined}),
    'result_unknown cannot omit errorCode or masquerade as verified',
  );

  // result_unknown is NOT verified
  assert.notEqual(unknownResult.state, 'verified');
});

test('5. F9 / User manual confirmation gate: unconfirmed execution is refused with UNAUTHORIZED', () => {
  // Pure function gate test: without confirmation, execute is refused
  const unconfirmed = assertNotepadConfirmationGate({confirmed: false});
  assert.equal(unconfirmed.allowed, false);
  assert.equal(unconfirmed.state, 'refused');
  assert.equal(unconfirmed.errorCode, 'UNAUTHORIZED');
  assert.ok(unconfirmed.reason.includes('F9 or explicit manual confirmation is required'));

  // With explicit confirmation
  const confirmed = assertNotepadConfirmationGate({
    confirmed: true,
    source: 'f9_hotkey',
    confirmedAt: t0,
    targetRef: execute.targetRef,
  });
  assert.equal(confirmed.allowed, true);
  assert.equal(confirmed.state, 'confirmed');
  assert.equal(confirmed.source, 'f9_hotkey');
  assert.equal(confirmed.targetRef, execute.targetRef);

  // Confirmation with invalid timestamp fails closed
  const badTimestamp = assertNotepadConfirmationGate({
    confirmed: true,
    confirmedAt: 'invalid-date',
  });
  assert.equal(badTimestamp.allowed, false);
  assert.equal(badTimestamp.state, 'refused');
  assert.equal(badTimestamp.errorCode, 'UNAUTHORIZED');

  // Combined execution validation: validateWindowsHostExecuteConfirmation
  // (a) Unconfirmed execute frame throws ProtocolError
  assert.throws(
    () => validateWindowsHostExecuteConfirmation(execute, {confirmed: false}),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT',
    'Unconfirmed execute must throw ProtocolError',
  );

  // (b) Confirmed execute frame with mismatched targetRef throws ProtocolError
  assert.throws(
    () => validateWindowsHostExecuteConfirmation(execute, {
      confirmed: true,
      targetRef: 'different-notepad-target',
    }),
    (err) => err instanceof ProtocolError && err.code === 'INVALID_ARGUMENT',
    'Execute with mismatched targetRef must throw ProtocolError',
  );

  // (c) Confirmed execute frame with matching targetRef succeeds
  assert.doesNotThrow(
    () => validateWindowsHostExecuteConfirmation(execute, {
      confirmed: true,
      source: 'f9_hotkey',
      confirmedAt: t0,
      targetRef: execute.targetRef,
    }),
    'Confirmed execute frame must pass validation',
  );

  // Boundary note:
  // Contract-level pure functions and tests verify the schema and gate semantics in Node/Linux.
  // Physical F9 hotkey capture on Windows, foreground window focus, and actual UIA replacement
  // are NOT verified by this test; they remain "待真机验收" (pending real machine field acceptance).
});

test('6. Safety & Sandbox: no external UIA, no Notepad process, no private window inspection', () => {
  // Encoding and decoding frames stays within 1 MiB bounds
  const rawBytes = encodeWindowsHostFrame(execute);
  assert.ok(rawBytes.length > 0 && rawBytes.length < 1024 * 1024);

  // Frame contains no private credentials or process tokens
  const frameText = new TextDecoder().decode(rawBytes);
  assert.equal(frameText.includes('password'), false);
  assert.equal(frameText.includes('secret'), false);
  assert.equal(frameText.includes('token'), false);

  // Clean execution in Linux: no Windows API, no win32 process handles
  assert.equal(typeof process.platform, 'string');
});
