// F02 语音防回声闸 / final 回执 / 设备证据定向测试。
// 真机（扬声器-麦克风互扰、误触、回声实测、物理释放）待真机验收；本文件只验软件语义。
// 运行：node --test packages/voice/test/echo-guard.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVoiceEchoGuard,
  buildFinalTranscriptReceipt,
  verifyFinalTranscriptReceipt,
  buildVoiceDeviceEvidence,
} from '../dist/echo-guard.js';

test('TTS 输出窗口内与尾静音期内：麦克风输入判为疑似回声，不交付', () => {
  let clock = 1_000;
  const guard = createVoiceEchoGuard({tailMs: 350, now: () => clock});
  const window = guard.beginSpeechOutput('reply-1');
  assert.equal(guard.inspect().reason, 'during_speech_output');
  assert.equal(guard.inspect().deliverable, false);
  assert.equal(guard.inspect().echoSuspected, true);

  clock = 1_500;
  assert.equal(guard.endSpeechOutput('reply-1'), true);
  const duringTail = guard.inspect();
  assert.equal(duringTail.reason, 'within_output_tail');
  assert.equal(duringTail.deliverable, false);
  assert.ok(duringTail.guardRemainingMs > 0 && duringTail.guardRemainingMs <= 350);

  clock = 1_500 + 349;
  assert.equal(guard.inspect().deliverable, false, '尾静音期内仍不交付');
  clock = 1_500 + 351;
  const after = guard.inspect();
  assert.equal(after.deliverable, true);
  assert.equal(after.echoSuspected, false);
  assert.equal(after.reason, 'no_active_output');
  assert.deepEqual(guard.activeWindows(), [], '过期窗口被清理，状态不积压');
  assert.ok(window.replyId === 'reply-1');
});

test('多窗口：任一未结束/未过期都保持闸合；窗口上限 8 防积压', () => {
  let clock = 0;
  const guard = createVoiceEchoGuard({tailMs: 100, now: () => clock});
  guard.beginSpeechOutput('a');
  guard.beginSpeechOutput('b');
  clock = 10;
  guard.endSpeechOutput('a');
  assert.equal(guard.inspect().deliverable, false, 'b 仍在输出，闸合');
  clock = 200;
  assert.equal(guard.inspect().deliverable, false, 'b 仍未结束，闸合');
  guard.endSpeechOutput('b');
  assert.equal(guard.inspect().deliverable, false, 'b 的尾静音期内不交付');
  clock = 200 + 101;
  assert.equal(guard.inspect().deliverable, true, '全部窗口过期后放行');
  for (let i = 0; i < 12; i++) guard.beginSpeechOutput(`w${i}`);
  assert.ok(guard.activeWindows().length <= 8, `窗口数有界（实际 ${guard.activeWindows().length}）`);
  assert.equal(guard.endSpeechOutput('nonexistent'), false, '未知 replyId 不能结束别人窗口');
});

test('非法 tailMs 拒绝；未配置时默认 350ms', () => {
  assert.throws(() => createVoiceEchoGuard({tailMs: -1}), RangeError);
  assert.throws(() => createVoiceEchoGuard({tailMs: 5000}), RangeError);
  const guard = createVoiceEchoGuard();
  guard.beginSpeechOutput();
  assert.equal(guard.inspect().reason, 'during_speech_output');
});

test('final 回执：缺回执/畸形/空证据/零时长/过期 → unverified，不作为已确认用户输入', () => {
  const now = () => Date.parse('2026-11-07T08:00:00Z');
  const receipt = buildFinalTranscriptReceipt({
    sessionId: 'session-1', durationMs: 1200, evidenceRefs: ['pcm-ref-1'], deviceId: 'mic-0',
    capturedAt: '2026-11-07T07:59:50Z',
  });
  assert.equal(verifyFinalTranscriptReceipt(receipt, {now}).verified, true);
  assert.equal(verifyFinalTranscriptReceipt(receipt, {now}).reason, 'verified');

  assert.equal(verifyFinalTranscriptReceipt(undefined, {now}).reason, 'missing_receipt');
  assert.equal(verifyFinalTranscriptReceipt({...receipt, version: 2}, {now}).reason, 'malformed');
  assert.equal(verifyFinalTranscriptReceipt({...receipt, capturedAt: 'not-a-time'}, {now}).reason, 'malformed');
  assert.equal(verifyFinalTranscriptReceipt({...receipt, evidenceRefs: []}, {now}).reason, 'empty_evidence');
  assert.equal(verifyFinalTranscriptReceipt({...receipt, durationMs: 0}, {now}).reason, 'non_positive_duration');
  assert.equal(verifyFinalTranscriptReceipt({...receipt, capturedAt: '2026-11-07T07:00:00Z'}, {now}).reason, 'stale');
  assert.throws(() => buildFinalTranscriptReceipt({sessionId: 's', durationMs: 1, evidenceRefs: []}), TypeError);
  assert.throws(() => buildFinalTranscriptReceipt({sessionId: '', durationMs: 1, evidenceRefs: ['e']}), TypeError);
});

test('设备证据：指纹稳定且随描述变化；非法 format 拒绝；显式 pending_real_device 标记', () => {
  const format = {sampleRate: 16_000, channels: 1, bitDepth: 16};
  const a = buildVoiceDeviceEvidence({deviceId: 'mic-0', format});
  const b = buildVoiceDeviceEvidence({deviceId: 'mic-0', format});
  const c = buildVoiceDeviceEvidence({deviceId: 'mic-1', format});
  assert.equal(a.descriptorSha256, b.descriptorSha256);
  assert.notEqual(a.descriptorSha256, c.descriptorSha256);
  assert.equal(a.acceptance, 'pending_real_device', '真实设备验收显式待定，不宣称已验');
  assert.match(a.descriptorSha256, /^[0-9a-f]{64}$/);
  assert.throws(() => buildVoiceDeviceEvidence({deviceId: '', format}), TypeError);
  assert.throws(() => buildVoiceDeviceEvidence({deviceId: 'mic-0', format: {...format, sampleRate: 0}}), TypeError);
});
