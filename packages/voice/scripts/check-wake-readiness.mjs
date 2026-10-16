import {createWindowsSystemSpeechKeywordDetector, VOICE_AUDIO_FORMAT} from '../dist/index.js';

// Readiness only: the native engine receives generated silence over stdin.
// This script never opens a microphone, speaker, network connection or credential store.
const receipt = {
  checkedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  evidence: 'native-engine-with-synthetic-pcm',
  keyword: '你好小派',
  microphoneOpened: false,
  speakerOpened: false,
  networkUsed: false,
  ready: false,
  syntheticBytesAccepted: 0,
  detections: 0,
  releaseConfirmed: false,
};
const detector = createWindowsSystemSpeechKeywordDetector({keyword: receipt.keyword});
let session;
try {
  session = detector.start({signal: new AbortController().signal,
    deadline: new Date(Date.now() + 15_000).toISOString(),
    onDetected() {receipt.detections++;},
  });
  await session.ready;
  receipt.ready = true;
  const silence = new Uint8Array(3200);
  session.accept({sequence: 0, data: silence, format: VOICE_AUDIO_FORMAT});
  receipt.syntheticBytesAccepted = silence.byteLength;
} catch (error) {
  receipt.failureCode = ['UNSUPPORTED_CAPABILITY', 'TIMEOUT', 'CANCELLED', 'EXTERNAL_FAILURE']
    .includes(error?.code) ? error.code : 'EXTERNAL_FAILURE';
  process.exitCode = 1;
} finally {
  try {
    await session?.stop();
    if (session) receipt.closeReason = (await session.closed).reason;
    await detector.dispose();
    receipt.releaseConfirmed = true;
  } catch {
    receipt.failureCode = 'EXTERNAL_FAILURE';
    process.exitCode = 1;
  }
  console.log(JSON.stringify(receipt, null, 2));
}
