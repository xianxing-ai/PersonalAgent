export {VoiceSessionError} from './errors.js';
export {createVoiceStartupController, createVoiceHostListeningPort} from './startup.js';
export type {ContinuousVoiceListeningPort, VoiceStartupRequest, VoiceStartupSnapshot,
  VoiceStartupController} from './startup.js';
export type {VoiceErrorCode} from './errors.js';
export {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  MAX_SPEECH_CHARACTERS,
  MAX_TRANSCRIPT_CHARACTERS,
  VOICE_AUDIO_FORMAT,
  MAX_FRAME_BYTES,
  MAX_QUEUE_BYTES,
  MAX_QUEUE_FRAMES,
} from './ports.js';
export type {
  SpeechOutputPort,
  SpeechOutputRequest,
  SpeechRecognitionPort,
  SpeechRecognitionRequest,
  SpeechRecognitionResult,
  TranscriptConsumerPort,
  TranscriptConsumptionRequest,
  TranscriptConsumptionResult,
  VoiceAudioClip,
  VoiceAudioFormat,
  VoiceOperation,
  VoiceOperationStopReason,
  VoicePcmCaptureBinding,
  VoicePcmCaptureSink,
  VoicePcmCaptureSubscription,
  VoicePcmFrame,
  VoicePcmFrameSourcePort,
  VoicePcmFrameSubscribeOptions,
  VoicePcmFrameSubscription,
  VoicePcmTerminalReason,
  SpeechKeywordCloseReason,
  SpeechKeywordCloseResult,
  SpeechKeywordDetectorPort,
  SpeechKeywordSession,
  SpeechKeywordStartOptions,
  WindowsSystemSpeechKeywordDetectorOptions,
} from './ports.js';
export {createVoicePcmFrameSourcePort} from './pcm-frame-source.js';
export {createVoicePcmBuffer} from './pcm-buffer.js';
export type {VoicePcmBuffer, VoicePcmBufferOptions} from './pcm-buffer.js';
export {
  UnavailableSpeechOutputPort,
  UnavailableSpeechRecognitionPort,
  UnavailableTranscriptConsumerPort,
  UnavailableSpeechKeywordDetectorPort,
} from './unavailable.js';
export {bindVoiceWake} from './wake-binding.js';
export type {VoiceWakeBinding, VoiceWakeBindingOptions} from './wake-binding.js';
export {WakeLifecycleController, createPcmKeywordWakeSignalSource} from '@personal-agent/voice-wake';
export {
  RuntimeClientTranscriptConsumer,
  createRuntimeClientTranscriptConsumer,
} from './runtime-consumer.js';
export type {RuntimeClientTranscriptConsumerOptions} from './runtime-consumer.js';
export {createWindowsSystemSpeechPorts} from './windows-system-speech.js';
export type {WindowsSystemSpeechPorts} from './windows-system-speech.js';
export {createWindowsSystemSpeechKeywordDetector} from './windows-system-speech-keyword.js';
export type {WindowsSpeechKeywordHostSpawner} from './windows-system-speech-keyword.js';
export {VoiceSessionManager} from './voice-session.js';
export {createHuaweiSisRecognitionPort, createHuaweiSisOutputPort} from './huawei-sis.js';
export type {
  HuaweiSisConfig,
  HuaweiSisOutputConfig,
  HuaweiSisRegion,
  HuaweiSisTokenPort,
  HuaweiSisRequestAuthPort,
  HuaweiSisWavPlaybackPort,
} from './huawei-sis.js';
export type {
  ReplyReceipt,
  SpeechPlaybackResult,
  StartVoiceSessionOptions,
  StopSpeakingResult,
  StopVoiceSessionResult,
  TranscriptReceipt,
  VoiceIdKind,
  VoiceSessionManagerOptions,
  VoiceSessionListener,
  VoiceSessionSnapshot,
  VoiceSessionState,
  VoiceSessionTerminalReason,
} from './voice-session.js';
