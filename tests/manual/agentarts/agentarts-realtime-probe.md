# AgentArts real audio probe

Import `runAgentArtsRealtimeProbe` and inject the production `AgentArtsRealtimeModelGateway` (or Runtime-compatible gateway with `connect(request)`). This helper reads no credentials and creates no transport. The caller owns real service authorization and credential injection. It never opens a microphone or plays audio.

Use `readRealtimeProbeFixture(absolutePath)` for an authorized public 16 kHz mono PCM16 WAV, or `{format:'pcm16le-16000-mono'}` for raw PCM. Pass returned `pcmBytes`, `deadline` (UTC ISO string), `signal`, and `gateway`. Default sending uses 100 ms sequential chunks at real audio pace followed by 1200 ms silence. `pace:false` is intended for Fake tests only. No automatic retry occurs.

The result reports `passed` only after session ready, final input transcript, final output transcript, output audio, turn complete and confirmed session close. Missing evidence is `unknown`; explicit gateway/connect/send errors are `failed`. Audio output is hashed and counted, without saving or playing it. Timings are milliseconds since runner start; `closeDurationMs` measures close itself. Transcripts in the result come from the supplied fixture and the model, so store results only in the authorized evidence location.

The production gateway exposes readiness via successful `connect()` and closure via `close()` fulfillment. This proves gateway event observations only, not playback, microphone operation, platform trace readback or independent transcript correctness. A separate reviewer should compare the input transcript with the known fixture words. Running this helper with a Fake establishes no real service acceptance.

Offline test: `node --test --test-isolation=none tests/manual/agentarts/agentarts-realtime-probe.test.mjs`.
