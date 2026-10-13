# MOD-14 voice session foundation

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

This package is the provisional in-process voice-session boundary for the
`huawei_ict_agentarts` Competition Profile. It implements a push-to-talk lifecycle
with explicit Fake/Unavailable adapters. It does not choose an ASR/TTS vendor, open a
microphone, persist audio or transcripts, upload data by itself, submit Runtime tasks,
or advertise the public `voice.start` / `voice.stop` wire operations.

## Public flow

1. A trusted caller starts one bounded session with an ISO UTC deadline and an
   `AbortSignal`.
2. The caller supplies one PCM S16LE, 16 kHz, mono clip to `recognizeAudio`. The maximum
   is 60 seconds and 1,920,000 bytes. The private copy is zeroed after the adapter call.
3. Recognition returns an opaque transcript receipt. No Runtime or task action occurs.
4. The caller explicitly calls `consumeTranscript` with a restricted
   `TranscriptConsumerPort`. The stable transcript ID is also its deduplication input.
   This port may submit to a future Runtime adapter, but its stop operation only ends the
   local wait and must not call `task.cancel`.
5. A bounded reply stays private until the caller explicitly invokes `speakReply`.

`stopSpeaking`/`interrupt` stops only the current output operation and returns the
session to listening. It neither stops recognition nor changes a Runtime task. `stop`
terminates the voice session, is idempotent, aborts active operation signals, invokes
their idempotent release handles, clears in-memory transcript/reply material and reports
whether those handles released successfully. A parent cancellation or deadline does the
same with `cancelled` or `expired` state. Starting another session replaces the previous
one; late provider callbacks are discarded.

`subscribe(listener)` is a provisional, in-process read-only state feed for trusted host
composition. It emits an independently frozen snapshot after the initial session becomes
observable and after each revision change, including playback stop and terminal states.
Unsubscribe is idempotent. Listener failures are contained, and subscriptions added while
an update is being delivered begin with the next update. The feed opens no device, grants
no authorization, submits no task and is not the public wire event protocol.

Each session snapshot contains state and booleans only, never audio, transcript or reply
text. Public failures use fixed messages and do not expose provider or listener errors.
Adapters own provider configuration, credentials, upload consent and transport. No
provider is the default: recognition and output return `UNSUPPORTED_CAPABILITY`.

## Provisional wake composition

`bindVoiceWake({wake, voice})` is an explicit, in-process trusted-host binding to the
provisional `@personal-agent/voice-wake` lifecycle. The host wires the wake controller's
`onWake` callback to `binding.handleWake(event)`. The binding translates only a current,
unexpired, authorized wake session with an in-window event timestamp into `voice.start()`,
propagates the finite wake expiry as the voice deadline, aborts the corresponding voice
parent when wake listening ends or expires, and synchronizes voice `playbackActive` back
to wake suppression.

The binding never enables a device, grants authorization, submits a task, or owns the
supplied controllers. `dispose()` only removes its subscriptions and aborts the voice
parent it created; it does not dispose the wake controller or voice manager. This is not
a public wire protocol and is not evidence of real microphone, wake-word, ASR, TTS,
Desktop, Runtime, or AgentArts integration.

## Windows System.Speech adapters

`createWindowsSystemSpeechPorts()` returns provider-specific recognition and output ports
for the installed Windows `.NET Framework` `System.Speech` engine. The implementation
starts one hidden native Windows child per explicit operation using a fixed in-module host
executable (`packages/voice/host/windows-system-speech-host.exe`), fixed `zh-CN` culture and
fixed `--mode recognize` / `--mode speak` mode. Callers cannot provide a command, path,
executable, device or execution policy. Executing a native executable directly avoids
PowerShell script execution policy restrictions (such as `Restricted`) without employing
any policy modification, execution-policy bypass, or `-Command`/`IEX` workarounds. PCM or
UTF-8 text uses bounded stdio; stdout is one bounded JSON result; stderr is drained without
logging. There is no file, network, credential or automatic retry path.

Deadline, parent abort, `stop()` and adapter disposal terminate the exact child and wait
for its close. The adapter copies and later zeroes its audio input. Recognition responses
are restricted to 8,000 characters and all process/provider failures use fixed local
errors. The helper uses open dictation for recognition and the installed `zh-CN` default
audio voice for speech.

Source availability is not runtime availability. This adapter implementation does not
verify dictation accuracy, microphone capture, speaker playback, or audio devices. Binaries
are not committed to the repository. If the fixed native host executable is not built and
deployed, or if installed Chinese speech components are missing, the ports explicitly return
unavailable (`UNSUPPORTED_CAPABILITY`). Desktop and Runtime must keep their Unavailable
ports and UI state until authorized production setup and real-device acceptance pass.

### Building the native host

The minimal reproducible native host is defined by single source file
`packages/voice/host/WindowsSystemSpeechHost.cs`. It requires no external package
dependencies and is compiled into `packages/voice/host/windows-system-speech-host.exe`
via the module build script (`scripts/build-host.mjs`).

To build or verify the native host directly:

```powershell
npm.cmd run build:host --workspace=@personal-agent/voice
```

Native host compilation is also integrated into:

```powershell
npm.cmd run build --workspace=@personal-agent/voice
```

The build script automatically detects whether the target binary is missing or stale
relative to `WindowsSystemSpeechHost.cs`:
- If the binary is current (`output.mtime >= source.mtime` and size > 0), compilation is
  skipped to avoid redundant compiler runs.
- If the binary is missing, empty, or stale, the script locates the Windows `.NET Framework`
  C# compiler (`csc.exe`) and `System.Speech.dll` at fixed controlled system paths under
  `SystemRoot` and compiles via `execFile` (with `shell: false`, `windowsHide: true`, and
  no PowerShell policy bypass).
- On non-Windows platforms, host compilation is cleanly skipped, preserving cross-platform
  build portability.
- If `csc.exe` or `System.Speech.dll` is missing, or if compiler execution fails, the build
  script produces a clear bounded error and unlinks any stale executable so an outdated
  binary is never mistaken for current.

### Native host limitations

1. **Host environment requirements**: Native Windows System.Speech execution requires a
   Windows system with installed `.NET Framework` 4.x components (providing `csc.exe` and
   `System.Speech.dll`). Non-Windows platforms cleanly skip build and report
   `UNSUPPORTED_CAPABILITY` at runtime.
2. **Fixed controlled paths**: Only verified system locations under `SystemRoot` are searched.
   Arbitrary compiler paths, executable locations, or user commands are not accepted.
3. **Voice components**: The host strictly requires installed Chinese (`zh-CN`) speech
   recognition and speech synthesis voice components. If missing on the machine, the host
   exits with code 2 and surfaces `UNSUPPORTED_CAPABILITY`.
4. **Adapter startup verification**: `createWindowsSystemSpeechPorts()` verifies that
   `windows-system-speech-host.exe` exists, is non-empty, and is not stale compared to
   `WindowsSystemSpeechHost.cs`. If absent or stale, the adapter reports `UNSUPPORTED_CAPABILITY`
   (`Windows System.Speech is unavailable`) through the existing error shape.
5. **Hardware and devices**: The adapter does not verify microphone capture, physical speakers,
   or audio routing devices.


## Authorized PCM streaming port (`VoicePcmFrameSourcePort`)

`createVoicePcmFrameSourcePort(binding)` creates a module-local streaming port bound to a
concrete authorized host capture binding.

### Trust boundary

The voice package never opens a microphone, queries OS device permissions, or issues capture
authorization. No audio capture starts by default. The trusted host (MOD-11 Desktop main process)
must perform its own explicit permission checks, manage physical media device lifecycles, and
pass an already-authorized capture binding. The Renderer cannot grant authorization or sign tokens.
The host capture binding must attach to ONE physical `getUserMedia` capture source as a
refcount/fanout attachment, supporting concurrent subscribers (e.g. wake word detection and speech
recognition) rather than opening a new microphone per subscriber.

### Handoff for MOD-11 physical track release

Subscribing to the port (`port.subscribe({signal, deadline, onFrame, onEnd})`) returns
`{ready: Promise<void>, unsubscribe(): void, closed: Promise<void>}`.
1. `ready` resolves only after the host capture binding has successfully returned a valid release
   handle and confirmed capture availability. If start throws, rejects, returns an invalid handle,
   or if the subscription terminates before ready, `ready` rejects with a fixed `VoiceSessionError`.
2. When a subscription terminates (via caller `unsubscribe()`, parent `signal` abort, ISO UTC
   `deadline` timeout, queue overflow, capture revocation, device unavailability, or port disposal):
   - Callback delivery halts immediately with no late `onFrame` callbacks.
   - All buffered/queued PCM frames are immediately zeroed in memory (`.fill(0)`) and discarded.
   - The port invokes the subscription's upstream `release()` handle (including any late-returned
     handle from an in-flight async start).
   - The `closed` promise awaits the release of that subscription's attachment. `closed` resolves
     only after successful release and rejects with `EXTERNAL_FAILURE` if release fails or start
     failure prevents release proof. Proves only that this attachment was detached; physical capture
     continues if other subscribers remain active.
   - `port.dispose()` awaits all attachments and serves as the whole-source release receipt under the
     host contract. If any release failed, `dispose()` rejects with `EXTERNAL_FAILURE` and remembers
     this failure for subsequent calls.
   - The trusted host binding must clean up its own partial capture resources on start failure; the
     host must not infer physical track release from an `onEnd` callback alone.

### Frame and queue guarantees

- **Format and sequence**: Frames use `VOICE_AUDIO_FORMAT` (16 kHz mono PCM S16LE) with monotonic
  sequence numbers starting from 0.
- **Frame bounds**: Non-empty, even byte length, maximum 3,200 bytes (100 ms).
- **Isolation**: Each subscriber receives an independent private copy; buffer modifications or
  zeroization do not affect other subscribers.
- **Queue limits**: Bounded at 4 frames / 12,800 bytes. Overflow terminates the subscription
  immediately with terminal reason `'overflow'` (no silent drop or truncation).
- **Terminal reasons**: Exactly one terminal callback (`onEnd`) with reason `'cancelled'`,
  `'deadline'`, `'revoked'`, `'device_unavailable'`, `'overflow'`, or `'disposed'`.
- **Privacy and wire boundary**: No audio or text logs. The public wire capabilities `voice.start`
  and `voice.stop` remain separate and unpublished.

## Explicit Runtime transcript consumption

`RuntimeClientTranscriptConsumer` is a trusted-host `TranscriptConsumerPort` adapter for
an already connected public `@personal-agent/client`. It remains idle until the caller
explicitly invokes `consumeTranscript`. That call submits the transcript as the
`task.submit` goal with the configured `conversationId` and a stable bounded idempotency
key, then reads `task.get` until Runtime reports a terminal state. Submission acceptance,
`waiting_approval`, and every other non-terminal state are not treated as a reply.

Only a successful task's bounded `resultSummary` becomes reply text. Runtime and transport
failures use fixed local errors without external messages. Deadline, parent abort, and
`VoiceOperation.stop()` bound submit, polling, and non-cooperative Client promises, but
they stop only this adapter's local wait: the adapter never calls `task.cancel`, retries a
submission, starts Runtime directly, or invents terminal state. Real local Runtime
composition remains a separate host-level acceptance step.

## Bounded PCM accumulation

`createVoicePcmBuffer()` is a synchronous trusted-host helper for the bytes collected by
an external push-to-talk source. It never opens a microphone or file and accepts only
non-empty, even-length PCM S16LE chunks for the package's fixed 16 kHz mono format.
Every append is copied immediately into one lazily allocated, capacity-bounded contiguous
buffer, so arbitrarily small chunks cannot create unbounded retained-object overhead.
Total bytes are bounded by both the public 60-second limit and an optional smaller
duration; capacity overflow fails without truncation.

`finish()` returns one independent `VoiceAudioClip`, derives its duration from the fixed
32 bytes per millisecond rate, and then zeroes and releases the retained buffer.
`dispose()`, parent abort, and the required deadline also zero and release retained audio;
the deadline timer remains active while the buffer is idle and all terminal paths detach
the timer and abort listener. This helper owns no session or Runtime state, emits no audio
logs, and cannot translate cancellation into `task.cancel`.

## Fake use and verification

`@personal-agent/voice/testing` exports Fake recognition, explicit transcript consumer
and speech output ports. They retain only call metadata (byte/character counts, deadline,
locale and signal), not private content.

Run:

```powershell
npm.cmd run test --workspace=@personal-agent/voice
npm.cmd run typecheck --workspace=@personal-agent/voice
```

The root build now runs this workspace after its registered dependencies, and the single
root lock file registers the voice workspace/link; no external dependency was added or
upgraded. A trusted integration owner must still wire the Desktop/Runtime composition
and keep the public wire capability unavailable until production adapters and
real-device acceptance exist.

## Authorized PCM Frame Source Port

`createVoicePcmFrameSourcePort(binding)` provides bounded, authorized PCM delivery
using a trusted host's pre-authorized microphone capture source. The voice module
never opens a microphone or grants OS permission itself.

**Shared-source contract:** `VoicePcmCaptureBinding.start(sink)` attaches to one
physical host capture with refcount/fanout, allowing simultaneous wake and ASR
subscribers. It must not open a separate microphone per subscription.

`subscription.ready` resolves only after `start(sink)` returns a valid release
handle and the subscription is still active, unrevoked and before its deadline.
Async readiness, new frames and queued frame delivery each recheck that lifecycle;
a delayed deadline timer cannot extend capture delivery. The subscription is
registered before host start, so synchronous reentrant disposal includes it.

`closed` proves only that this subscription's attachment was released. Other
subscribers may keep the physical capture active. Whole-source shutdown requires
`port.dispose()` to await every attachment and the host to confirm the last track's
release. Release failure remains `EXTERNAL_FAILURE`, not a false success receipt.
Frames are 16 kHz mono PCM S16LE, at most 3200 bytes each, with at most four queued
frames/12800 queued bytes. Delivered and discarded local copies are zeroed; this
port neither submits nor cancels Runtime tasks. Real device acceptance is separate.

## Speech Keyword Detector

`createWindowsSystemSpeechKeywordDetector({keyword})` consumes the same authorized
PCM frames through `SpeechKeywordSession.accept(frame)`. The fixed native host
uses a single trusted, control-free phrase as grammar data; it opens no second
microphone, uploads no audio, and never returns recognition text. Its `ready`
resolves only after the installed zh-CN recognizer, restricted grammar and streaming
recognition have started. Missing language components remain explicitly unavailable.
Only the empty `onDetected()` callback and a detection count leave the detector.

Frames use the existing 16 kHz mono PCM S16LE format, monotonically increasing
sequence numbers and at most 3200 bytes per frame. The queue is bounded to four
frames/12800 bytes with one in-flight packet. Overflow, malformed host envelopes,
unexpected child exit, cancellation or expiry stop further delivery and clear
owned queued/in-flight data. `stop()` and `dispose()` wait for the exact child to
close; requesting a stop is not itself release confirmation.

Sessions are registered before the host spawner runs, so synchronous reentrant
disposal includes the newly started child. Close/error handlers are installed
before delivering a pending stop, and parent cancellation is rechecked after
spawn. Readiness, detection and queued PCM dispatch independently recheck the
current deadline; delayed timers cannot extend the authorized lifetime.

Fake keyword sessions and an explicit unavailable port support local tests.
Controlled-child tests and C# compilation do not establish real microphone capture,
Chinese keyword accuracy, false-positive rates, echo suppression or Desktop
acceptance. This remains a provisional local adapter; public voice capability is
not enabled by importing it.
