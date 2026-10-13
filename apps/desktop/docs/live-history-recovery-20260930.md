# Live history recovery work package / P8 handoff

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile: `huawei_ict_agentarts`. Owner: `codex/cloud-mvp-live-history` cloud executor,
under zemeng's explicit ownership grant. Baseline: main
`7ede5f5b0072870932653df6347009ab77a35f43`. Released portable source was consumed from
`749d72029c96845f92cc649139df11ec1c55e890` (parent `e23b4cd33a2a6fc85e4d2797466f8a60c29f8096`).
Final PR targets `codex/zemeng/p8-mvp-final-integration` reference
`d2a23bea182a0a61104f601a6769d6ac16d7db5b`, whose host/helper already contains the e23 changes.
Those fixes are reused, not replaced with the earlier cloud draft. Status: ready for root
composition and local validation, not product acceptance or verified real audio.

## Delivered source and behavior

- `electron/live-voice-host.js` and the released `electron/live-voice-history.js`:
  session/role/provider-message ID binds each transcript;
  revisions retain its creation time. The 20-message UI window is independent of pending
  persistence. Closing or reopening Live does not clear pending history. History errors
  do not terminate normal WS/audio turns. `read_context` includes bounded pending messages
  as data and does not grant new permissions.
- `electron/live-history-queue.js`: trusted synchronous recovery port with stable-ID
  upsert, ordered replay, bounded capacity (1024 messages / 8 MiB), acknowledgement after
  the existing history sink succeeds, and retained pending revisions. A corrupt/unreadable
  cache is not overwritten. Cache failure remains visible even if the sink later succeeds.
  Flush snapshots its work so reentrant sinks cannot cause an unbounded drain.
- `electron/live-history-file-store.js`: the optional host-owned file adapter atomically replaces a version-1 JSON **recovery
  cache**, fsyncs the temporary file, then renames it; it never falls back to overwriting
  the last committed cache on rename failure. It contains transcript metadata/text only,
  no audio, secrets, tasks, approvals or executable requests. Single writer required.
- Each `request_work` call gets its own consumer/client binding and task ID. The session
  retains the original goal and result promise for its request ID, including failed and
  unknown results. A repeated ID replays the same local result, and changed input is rejected.
  It does not retry `task.submit` or tools. Runtime remains the authority and the consumer's
  existing stable submission idempotency key is unchanged. Accepted task metadata failures
  cannot lose the request's task ID; they appear as a Desktop association error.
- Consumer construction/consume exceptions are contained inside that request and restore
  the phase after all concurrent waits finish. Defensive `task.get` checks the exact task
  ID and is bounded even when a client ignores cancellation. Unknown results explicitly
  remain awaiting reconciliation. Stop only ends audio/local waits, never calls task.cancel.
- Synchronous resource-release exceptions are collected and keep release status unknown;
  late startup errors cannot stop a newer session.
- P2 increment: all Live tool entrances, read_context returns, cached-call replay and
  every model/task await delivering data recheck the same active record, abort signal,
  and session deadline. Task waits additionally use the request's 120-second deadline.
  Expired late callbacks/PCM are discarded. Cleanup awaits still finish after cancellation.

## Exact P8 composition seam (root owns main.js)

This PR deliberately does not edit main/preload/Renderer/sharedRuntime/config/model packages.
In `initializeLiveVoice()` add the following trusted host injection alongside its existing
options; retain the current `onTranscript: message => conversations.addLiveMessage(message)`
and `createGateway: config => runtimeApplication.createLiveVoiceModel(config)`.

```js
import {createLiveHistoryFileStore} from './live-history-file-store.js';

// In createLiveVoiceHost({...existing options}):
historyStore: createLiveHistoryFileStore(
  path.join(app.getPath('userData'), 'live-history-recovery.json')),

// Immediately after assigning liveVoice, recover without opening microphone/network:
liveVoice.flushHistory();
```

`path` and `app` already exist in the main composition. These are root-owned changes,
not modifications in this branch. Without this injection, the host retains pending records
across stop/start in the same process but reports `durable: false`; it **does not** claim
process-restart recovery. No real userData path or content was accessed in cloud development.
The completed file adapter can be injected directly, or P8 may supply an existing trusted
cache implementation conforming to the same port; no second database is required.

### Port contract

- `historyStore.read(): Message[]` and `write(messages): void` are synchronous. Writes must
  atomically commit the complete snapshot or throw; no asynchronous acknowledgement.
- Message: `{id, sessionId, role: 'user'|'assistant', text, createdAt}`. Sink is the existing
  synchronous Conversations upsert, which deduplicates by ID and preserves task ownership.
- Optional `historyQueue`: `enqueue(message)`, `flush(sink)`, `snapshot()`, `messages()`;
  host-local seam, not a wire capability. Default is memory only; absent `onTranscript`
  is explicitly unavailable rather than a successful no-op sink.
- `flushHistory()` returns `{pending, durable, degraded, rejected}` and publishes the UI
  snapshot. `snapshot().historyPersistence` exposes the same metadata, with no extra secrets.
  Existing `reason` describes pending cached records or warns that memory-only recovery is
  not confirmed. A later successful message cannot clear errors while earlier records remain.
- The existing sole overlay getter is `liveVoice.historyMessages({conversationId,
  cutoff, deadline, signal})`. No-argument calls remain compatible. `conversationId`
  defaults to `desktop-panel`; any other conversation returns an empty overlay. `cutoff`
  is an optional ISO date, inclusive on original creation time. Cancellation/deadline
  are checked before and after collection, including while Live is stopped. It returns
  copies of `{id,sessionId,role,text,createdAt}`, including pending records beyond the UI
  window. This is raw local history data, not cloud export permission.
- P8 owns the single `readConversationContext({taskId,conversationId,deadline,signal})`
  caller: merge Runtime succeeded tasks and Conversations with this overlay by the same
  ID, apply the task cutoff, filter current private-derived withheld markers and current
  sourcewatch answers, then recheck at the Runtime-selected beforeSend hook. Private bodies
  are not automatic history and source excerpts must not become persistent goals or context
  authorization. This package adds no alternative Runtime factory/hook name. The P8 d2
  reference still drops message IDs in its `readContext` map and saves metadata before
  setting taskGoals; root must retain IDs and set taskGoals before metadata persistence.
  P8 also owns Conversations.history overlay/cutoff merge. No production caller acceptance
  is claimed here.
- Retry uses one bounded 2-second timer in the existing Live host; no Runtime/model/tool loop.
  `stop()` retains recovery, `dispose()` makes a final flush and releases the retry timer.
  P8 must use `dispose()` for application shutdown, not just `stop()`.
- On capacity overflow the incoming record is explicitly rejected, `rejected` increments,
  Live stops receiving more audio/transcripts and existing pending records remain intact.
  This prevents unlimited silent dropping. If both history storage and recovery cache fail,
  process death can still lose memory-only records; the host makes no false durability claim.

## Compatibility and migration

Existing wire contracts/exports, Runtime/Policy/ToolGateway/Coordination and task DB remain
unchanged. No dependencies, lockfile changes, DB migrations or provider fallback were added.
The new optional cache has version 1 and is created on first use. P8 Conversation versions 1/2/3
are unchanged. Do not delete the recovery cache while records are pending. If an older binary
is restored, it will not consume this cache; preserve it until the recovery implementation
is reinstated. Privacy deletion of conversation data must also remove corresponding recovery
records under the trusted user's explicit deletion flow (P8/root integration concern).

Provider remains the existing native realtime ModelGateway/QwenOmniRealtime source, never
ASR+TTS presented as native Live. Mic-to-editable-input, F8 toggle, audio interruption, original
model configuration and safeStorage are untouched and remain local bridge responsibilities.

## Local unified validation entry

No installs, builds, vendor calls, model benchmark, frontend screenshot or smoke were performed.
After the user's 19:51 instruction, **no tests were run**. Regression cases were prepared for:
concurrent request identity, repeated/changed IDs, consumer constructor failure, over-20 failed
transcripts, reopening and timer recovery, read-context visibility, overflow, cancellation
during noncooperative reads, unknown-result replay, cache restart/revision upsert, lost ack
deduplication, corrupt cache preservation and reentrant revisions.

Root runs the focused command after taking back this source and applying the P8 injection:

```powershell
node --test apps/desktop/test/live-voice-host.test.mjs apps/desktop/test/live-voice-history.test.mjs apps/desktop/test/live-history-queue.test.mjs apps/desktop/test/live-voice-recovery.test.mjs
```

Before the revised execution instruction, one intermediate
`node --test apps/desktop/test/live-voice-host.test.mjs` run had 5 passes and 1 failure:
the old test expected only the new message to be saved after storage recovered. The revised
test requires BOTH the earlier failed message and the new message, checks their texts/order,
and preserves the revision assertion. This is the required changed behavior, not a green
claim. The final implementation and new tests have **not** been executed.

Only static source/interface/diff review and `git diff --check` are cloud handoff evidence.
Node is v24.19.0; root engines specify 24.15.x. Local unified checks should use the agreed
project environment; no version/dependency upgrade was made here.

## Local hardware/account acceptance still needed

Root owns the trusted userData cache path/lifecycle injection, overlay/cutoff/privacy beforeSend composition, local file permissions,
conversation UI/status readback, actual Windows microphone and native permission confirmation,
speaker playback/interruption, shortcut toggle, safeStorage and cloud account configuration.
Using the existing local keys, confirm real native QwenOmniRealtime WS, multiple audio turns,
voice work submitted to the same AgentArts Runtime task, text/voice shared history, storage
failure/recovery and application restart deduplication. No keys/private audio should be sent
to this cloud workspace. Old audible speech, synthetic ports and this source change do not
prove that full chain. Root reviews/merges; this executor does not auto-merge.
