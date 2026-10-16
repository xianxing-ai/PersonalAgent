# Huawei Cloud SIS adapter (MOD-14, Competition Profile)

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-13）：以 [CONTRIBUTING](../../CONTRIBUTING.md) 为准；当前提交须取得一位非作者有效 Approve，并满足必要检查。禁止管理员绕过或虚构批准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Status: **offline tested / real service and devices not accepted**. This adapter is a
thin, opt-in implementation of the existing `SpeechRecognitionPort` and
`SpeechOutputPort`. It does not change the default Unavailable provider or publish
the public `voice.start` / `voice.stop` wire capability.

## Trusted-host composition

The public `@personal-agent/voice` entry exports
`createHuaweiSisRecognitionPort` and `createHuaweiSisOutputPort`. A trusted host
must explicitly select one of the official supported SIS regions (`cn-north-4`
or `cn-east-3`), supply its matching project ID, and inject a
`HuaweiSisTokenPort` that provides a **SIS-scoped IAM X-Auth-Token**. The
AgentArts runtime bearer is not a SIS credential and must not be passed to
this port. No credential or environment-variable reader lives in
this package; missing configuration is an explicit error, never a local speech
fallback. Credential acquisition, refresh, storage, regional permission and
outbound-audio consent remain trusted-host responsibilities.

The ASR port sends only a caller-supplied, explicitly captured 16 kHz / 16-bit /
mono raw PCM clip (at most 60 seconds or 1,920,000 bytes) to the region's
official HTTPS `POST /v1/{project_id}/asr/short-audio`, using Base64 `data` and
`config.audio_format=pcm16k16bit`, `property=chinese_16k_general`. Only `zh-CN`
is currently mapped; other locales fail explicitly. It neither opens a
microphone nor submits a Runtime task. The host must preserve visible
push-to-talk authorization and revoke it on cancellation.

The TTS port calls `POST /v1/{project_id}/tts` only after the existing
`speakReply` flow explicitly requests output. It requests 16 kHz WAV, decodes
the bounded Base64 result and passes bytes to an injected, local
`HuaweiSisWavPlaybackPort`. This package does not open a speaker device.
The existing voice contract allows up to 8,000 characters, so the adapter
splits longer replies at Unicode code-point boundaries, preferring sentence
boundaries, into sequential requests of at most the official 500-character
limit. Each segment is a separate potentially billable SIS call; the next is
not sent until the prior local playback has completed and released. A stop or
deadline prevents remaining segments. The default voice property is
`chinese_xiaoyu_common`; a host may choose another official property for its
region. There is no automatic retry or secondary provider.

Both operations carry the caller's cancellation signal and deadline through
token resolution, HTTPS and local playback. Stops are idempotent and do not
call `task.cancel`. Provider errors and response bodies are not echoed to the
user; no audio, transcript, reply, token or full provider response is logged.
The HTTPS transport rejects redirects so its SIS token is not forwarded to a
different destination.
Wall time is rechecked after asynchronous boundaries so a delayed timer cannot
permit an expired upload, playback or result. A response arriving after transport
cancellation has its body cancelled even if the injected transport ignored the signal.
Each playback handle shares one release promise between completion, failure and
interruption. Audio bytes are cleared after that release settles; a failed release
remains visible to `VoiceSessionManager`, which prevents another session.
SIS response `trace_id` is not yet exposed because the current voice ports have
no safe receipt field for it; changing that shared interface needs separate
coordination. HTTP success would not by itself prove microphone, playback or
end-to-end task acceptance.

The factories and their types are exported from the existing package root.
`package.json`, the public contracts and root lock file are unchanged. Desktop's
existing `initializeSisVoice()` composition consumes these ports; this package
change needs no new IPC or main-process wiring. Configuration status was not
inspected and no real SIS request or recording was performed in this increment.

The 2026-10-13 [delivery and device acceptance record](ACCEPTANCE-20261013.md)
contains the current commands and evidence. `test/huawei-sis.test.mjs` uses only
generated PCM/WAV, injected token/HTTP/playback fakes, and the real voice manager.
It covers request bounds, fixed endpoints, no retries, deadline/cancellation,
error sanitization, ordered Unicode segmentation and confirmed/failed release.

## Official protocol references

- [SIS API overview](https://support.huaweicloud.com/api-sis/sis_03_0005.html)
- [Short-audio ASR request, limits, formats and response](https://support.huaweicloud.com/api-sis/sis_03_0094.html)
- [Synchronous TTS request and response](https://support.huaweicloud.com/api-sis/sis_03_0111.html)
- [Regional endpoints](https://support.huaweicloud.com/api-sis/sis_03_0004.html)
- [SIS IAM authentication](https://support.huaweicloud.com/api-sis/sis_03_0058.html)
