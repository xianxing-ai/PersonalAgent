import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  checkWakeHardwareAvailability,
  createPcmKeywordWakeSignalSource,
  evaluateWakeKeywordHit,
  isCooldownSuppressed,
  isPlaybackSuppressed,
  matchesWakeKeyword,
  normalizeWakeLexicon,
  normalizeWakePhrase,
} from '../dist/index.js';

test('normalizeWakePhrase trims whitespace, lowercases, and collapses whitespace', () => {
  assert.equal(normalizeWakePhrase('  HELLO   WORLD  '), 'hello world');
  assert.equal(normalizeWakePhrase('你好\t\n  小派 \u3000'), '你好 小派');
  assert.equal(normalizeWakePhrase(''), '');
  assert.equal(normalizeWakePhrase('   '), '');
  assert.equal(normalizeWakePhrase(null), '');
  assert.equal(normalizeWakePhrase(undefined), '');
  assert.equal(normalizeWakePhrase(12345), '');
  assert.equal(normalizeWakePhrase({}), '');
});

test('normalizeWakeLexicon normalizes, deduplicates, and filters empty/non-string items', () => {
  const input = ['你好小派', '  你好小派  ', 'HEY AGENT', 'hey agent', '', '   ', null, 99];
  const normalized = normalizeWakeLexicon(input);
  assert.deepEqual(normalized, ['你好小派', 'hey agent']);
  assert.ok(Object.isFrozen(normalized));

  assert.deepEqual(normalizeWakeLexicon(null), []);
  assert.deepEqual(normalizeWakeLexicon(undefined), []);
  assert.deepEqual(normalizeWakeLexicon(42), []);
  assert.deepEqual(normalizeWakeLexicon(new Set(['小派', '小派'])), ['小派']);
});

test('matchesWakeKeyword performs case-insensitive and whitespace-flexible matching', () => {
  const lexicon = ['你好小派', 'Hey PersonalAgent'];

  assert.equal(matchesWakeKeyword('你好小派', lexicon), true);
  assert.equal(matchesWakeKeyword('  你好 小派  ', lexicon), true);
  assert.equal(matchesWakeKeyword('HEY personalagent', lexicon), true);
  assert.equal(matchesWakeKeyword('  Hey   PersonalAgent  ', lexicon), true);

  assert.equal(matchesWakeKeyword('今天天气真好', lexicon), false);
  assert.equal(matchesWakeKeyword('小派', lexicon), false);
  assert.equal(matchesWakeKeyword('', lexicon), false);
  assert.equal(matchesWakeKeyword(null, lexicon), false);
  assert.equal(matchesWakeKeyword('你好小派', []), false);
  assert.equal(matchesWakeKeyword('你好小派', null), false);
});

test('isCooldownSuppressed correctly identifies active and elapsed cooldown windows', () => {
  assert.equal(isCooldownSuppressed(2000, 1500), true, 'timestamp before cooldown deadline must be suppressed');
  assert.equal(isCooldownSuppressed(2000, 2000), false, 'timestamp equal to cooldown deadline must not be suppressed');
  assert.equal(isCooldownSuppressed(2000, 2500), false, 'timestamp past cooldown deadline must not be suppressed');

  assert.equal(isCooldownSuppressed(null, 1500), false);
  assert.equal(isCooldownSuppressed(undefined, 1500), false);
  assert.equal(isCooldownSuppressed(0, 1500), false);
  assert.equal(isCooldownSuppressed(-100, 1500), false);
  assert.equal(isCooldownSuppressed(Number.NaN, 1500), false);
});

test('isPlaybackSuppressed returns true only when playbackActive is explicitly true', () => {
  assert.equal(isPlaybackSuppressed(true), true);
  assert.equal(isPlaybackSuppressed(false), false);
  assert.equal(isPlaybackSuppressed(undefined), false);
  assert.equal(isPlaybackSuppressed(null), false);
  assert.equal(isPlaybackSuppressed('true'), false);
  assert.equal(isPlaybackSuppressed(1), false);
});

test('evaluateWakeKeywordHit accepts unsuppressed keyword match', () => {
  const result = evaluateWakeKeywordHit({
    phrase: '你好小派',
    lexicon: ['你好小派'],
    playbackActive: false,
    cooldownUntilMs: null,
  });

  assert.deepEqual(result, {
    hit: true,
    matched: true,
    suppressed: false,
    accepted: true,
  });
  assert.ok(Object.isFrozen(result));
});

test('evaluateWakeKeywordHit suppresses match during active audio playback', () => {
  const result = evaluateWakeKeywordHit({
    phrase: '  Hey   Agent  ',
    lexicon: ['hey agent'],
    playbackActive: true,
  });

  assert.deepEqual(result, {
    hit: false,
    matched: true,
    suppressed: true,
    accepted: false,
    reason: 'playback_active',
  });
});

test('evaluateWakeKeywordHit suppresses match during active cooldown window', () => {
  const result = evaluateWakeKeywordHit({
    phrase: '你好小派',
    lexicon: ['你好小派'],
    cooldownUntilMs: 3000,
    nowMs: 2000,
    playbackActive: false,
  });

  assert.deepEqual(result, {
    hit: false,
    matched: true,
    suppressed: true,
    accepted: false,
    reason: 'cooldown_active',
  });
});

test('evaluateWakeKeywordHit allows match after cooldown has elapsed', () => {
  const result = evaluateWakeKeywordHit({
    phrase: '你好小派',
    lexicon: ['你好小派'],
    cooldownUntilMs: 3000,
    nowMs: 3001,
    playbackActive: false,
  });

  assert.deepEqual(result, {
    hit: true,
    matched: true,
    suppressed: false,
    accepted: true,
  });
});

test('evaluateWakeKeywordHit prioritizes playback suppression over cooldown', () => {
  const result = evaluateWakeKeywordHit({
    phrase: '你好小派',
    lexicon: ['你好小派'],
    cooldownUntilMs: 5000,
    nowMs: 2000,
    playbackActive: true,
  });

  assert.deepEqual(result, {
    hit: false,
    matched: true,
    suppressed: true,
    accepted: false,
    reason: 'playback_active',
  });
});

test('evaluateWakeKeywordHit reports no hit and no suppression for unmatched phrase', () => {
  const result = evaluateWakeKeywordHit({
    phrase: '请打开记事本',
    lexicon: ['你好小派'],
    playbackActive: true,
    cooldownUntilMs: 5000,
    nowMs: 1000,
  });

  assert.deepEqual(result, {
    hit: false,
    matched: false,
    suppressed: false,
    accepted: false,
  });
});

test('evaluateWakeKeywordHit handles empty or missing inputs gracefully', () => {
  assert.deepEqual(evaluateWakeKeywordHit(), {
    hit: false,
    matched: false,
    suppressed: false,
    accepted: false,
  });
  assert.deepEqual(evaluateWakeKeywordHit({}), {
    hit: false,
    matched: false,
    suppressed: false,
    accepted: false,
  });
});

test('checkWakeHardwareAvailability fails closed without capture hardware or speech recognizer', () => {
  assert.deepEqual(checkWakeHardwareAvailability(), {
    available: false,
    reason: 'hardware_unavailable',
  });
  assert.deepEqual(checkWakeHardwareAvailability({hasCaptureDevice: false, hasRecognizerEngine: true}), {
    available: false,
    reason: 'hardware_unavailable',
  });
  assert.deepEqual(checkWakeHardwareAvailability({hasCaptureDevice: true, hasRecognizerEngine: false}), {
    available: false,
    reason: 'engine_unavailable',
  });
  assert.deepEqual(checkWakeHardwareAvailability({hasCaptureDevice: true, hasRecognizerEngine: true}), {
    available: true,
  });
});

test('createPcmKeywordWakeSignalSource honors optional evaluateHit hook', async () => {
  let detectorCallback;
  let pcmClosedResolve;
  const pcmClosed = new Promise(resolve => { pcmClosedResolve = resolve; });
  const detectorClosed = new Promise(() => {});

  const pcm = {
    subscribe() {
      return {
        ready: Promise.resolve(),
        closed: pcmClosed,
        unsubscribe() {
          pcmClosedResolve();
        },
      };
    },
  };
  const detector = {
    start({onDetected}) {
      detectorCallback = onDetected;
      return {
        ready: Promise.resolve(),
        closed: detectorClosed,
        accept() {},
        stop() {},
      };
    },
  };

  const events = [];
  const evaluatedPhrases = [];
  let allowHit = false;

  const source = createPcmKeywordWakeSignalSource(pcm, detector, {
    evaluateHit(detail) {
      evaluatedPhrases.push(detail?.phrase);
      return {hit: allowHit};
    },
  });

  const abort = new AbortController();
  const subscription = await source.subscribe(e => events.push(e), {
    signal: abort.signal,
    deadlineAtMs: Date.now() + 5000,
  });

  // 1. Detection occurs with phrase when evaluateHit returns false -> suppressed
  detectorCallback({phrase: 'ignored'});
  assert.deepEqual(events, []);
  assert.deepEqual(evaluatedPhrases, ['ignored']);

  // 2. Detection occurs when evaluateHit returns true -> emitted
  allowHit = true;
  detectorCallback({phrase: '你好小派'});
  assert.deepEqual(events, [{kind: 'wake'}]);
  assert.deepEqual(evaluatedPhrases, ['ignored', '你好小派']);

  subscription.unsubscribe();
  abort.abort();
});
