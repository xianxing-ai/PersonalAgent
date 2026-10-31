import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveDesktopVoiceFinalTranscript} from '../electron/voice-final-transcript-host.js';

test('incomplete Desktop final-transcript binding stays undefined (tools remain unregistered)', () => {
  assert.equal(resolveDesktopVoiceFinalTranscript(), undefined);
  assert.equal(resolveDesktopVoiceFinalTranscript(null), undefined);
  assert.equal(resolveDesktopVoiceFinalTranscript({}), undefined);
  assert.equal(resolveDesktopVoiceFinalTranscript({port: {}}), undefined);
  assert.equal(resolveDesktopVoiceFinalTranscript({
    port: {readFinal: async () => ({state: 'unavailable', reason: 'x'})},
    requiredScopes: [],
  }), undefined);
});

test('complete binding freezes the trusted final reader for Runtime injection', () => {
  const port = {async readFinal() {return {state: 'unavailable', reason: 'no receipt'};}};
  const options = resolveDesktopVoiceFinalTranscript({port, requiredScopes: ['voice.final_transcript']});
  assert.equal(options.port, port);
  assert.deepEqual(options.requiredScopes, ['voice.final_transcript']);
  assert.throws(() => {options.requiredScopes.push('x');});
});
