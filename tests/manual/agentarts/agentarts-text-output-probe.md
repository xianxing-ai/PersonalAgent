# Public text → real voice probe

`runAgentArtsTextOutputProbe` accepts an injected **production** gateway. It never reads credentials, creates a transport, opens a microphone, plays sound or writes a file. Use a dedicated new session with no startup greeting, other text turns or audio input. The trusted caller supplies existing authorized AgentArts transport/configuration; do not invent credentials or substitute another provider.

After the `speakText` implementation is merged and dependencies built:

```js
import {runAgentArtsTextOutputProbe} from './tests/manual/agentarts/agentarts-text-output-probe.mjs';
const chunks=[];
const receipt=await runAgentArtsTextOutputProbe({gateway:productionGateway,
  text:'这是一条公开的文字转语音验收消息。',
  deadline:new Date(Date.now()+30_000).toISOString(),signal:new AbortController().signal,
  onAudio:chunk=>chunks.push(chunk)});
```

`productionGateway` must come from the existing trusted host factory and real authorized configuration. This is an injection example, not a standalone executable or credential setup flow. No `sendAudio` occurs. The method's accepted receipt is recorded separately and cannot establish audio delivery. Complete gateway evidence requires a ready session, submitted text, final output transcript, nonempty even-length audio, completed turn and confirmed close. Errors are classified without echoing remote messages. Output is capped at 60 seconds of PCM by default, with no retry.

`onAudio` receives copies of the actual returned PCM chunks. Keep them in trusted memory or an explicitly selected ignored artifact path; concatenate in order. The production protocol format is signed PCM16 little endian, mono, 24 kHz. The receipt hashes these **raw PCM bytes**, not a WAV header. A reviewer can wrap these same bytes in WAV, verify its payload hash against `outputAudioSha256`, decode/play it through Chromium, and compare the audible words and final transcript to the public input. Do not generate substitute waves. Playback success establishes browser consumption; human audible output and platform trace remain separate checks. The gateway event has no text-turn ID; a dedicated uncontended session is required for attribution, and this probe cannot independently prove server-side origin or exact words.

Offline regression (explicit synthetic gateway; no service/playback claim):

```sh
node --test tests/manual/agentarts/agentarts-text-output-probe.test.mjs
```
