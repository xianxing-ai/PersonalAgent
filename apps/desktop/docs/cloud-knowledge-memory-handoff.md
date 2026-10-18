# Cloud P7 / PA020 portable handoff

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile: `huawei_ict_agentarts`. Implementation baseline: `origin/main@7ede5f5b0072870932653df6347009ab77a35f43`.
Branch: `codex/cloud-mvp-knowledge-memory`. No auto merge.

## Preserved source

The actual deltas from `knowledge-watch-full@1ffe991` and `81fe4bce9f51620df102a5929815ba4d32409e67`
are incorporated, including the raw mapper and persistent Runtime interest intake. The complete
PA020 source chain `0e17be3 → 3d6d918 → 8433d10 → e3a0d94 → aff97747bc3a16d375137d599e6fe17b854c87bc`
is incorporated, including exact accepted-delete-before-cancel, ephemeral task/config/source-bound
memory leases, precise task stop, original erasure markers, and the application-copy erasure contract.
The initial cloud memory controller was replaced with these handed-off controllers to keep one lifecycle.

No edits to main, preload, application exports, runtime-application, history, feeds-host,
Windows writer/sidecar, knowledge-source-controls, safeStorage, userData or user databases.
`apps/runtime/src/application/memory-learning.ts` is the handed-off PA020 implementation, unchanged by
cloud-specific patches; Cloud Runtime/P8 owns its shared composition and exports.

## New delta

- P2: `taskCurrent()` rechecks original Runtime task identity, cancelRequested, failed/cancelled/cancelling,
  the real clock/deadline and operation lifecycle. It runs after every interest-reader await,
  inside the actual commit lock and inside the completed-receipt write lock. Uncertain intake remains unknown.
- A resumed/new consumer can call `recheckCurrentSource(sourceId, {deadline, signal})`, or recover through
  `refreshSubscribedFeed` after a 304. Only an exact v2 head with trusted execution provenance is reusable.
  A new consumer gets its own workKey; old unknown work is retained without resubmission. Original
  observedAt, receipt identity and validUntil remain unchanged. Stale body proof is refused.
- `current_fact` requires matching v2 receipt and original Runtime execution provenance. Missing proof
  returns `source_evidence_unavailable`; a latest observation or delivery acknowledgement is never completion.
- Non-string/null feed summaries fail normalization. Per-item quote output includes original locator,
  item/page hash, source revision, sourceId, occurredAt and fetchedAt. No new v2 receipt wire fields.
- The private lease performs the synchronous `assertCopyManagement()` gate again during final
  `assertCloudSend`, after credential waits. An asynchronous gate is rejected. A native authorization
  lease remains authorization only; it is not evidence of completed cloud consumption.
- Memory public export `createControlledMemoryReader` reads an exact user-confirmed current head,
  obtains host consent and rereads that exact head. Private/restricted cloud use needs separate
  sensitiveCloudConsent. It performs no outbound send or task dispatch.
- Learning migration 3 adds selection-stop receipts and exact-source revocation fences to the existing
  learning database. Stop does not claim a running tool stopped. Revocation never selects an older workflow.
  `stopWorkflow` and `invalidateSource` are host-only; existing precise Runtime task cancellation stays separate.
  `createEvidenceWorkflowValidator` is an optional trusted-reader adapter for exact Skill revision/hash and
  confirmed policy-allowed tool/task evidence. It does not replace the existing fixed-Skill application verifier.

## P8 / Cloud Runtime public composition

| Consumer API | Required owner-provided input / guarantee |
| --- | --- |
| `createKnowledgeWatchHost({readInterestSignal, readTrackingGrant})` | Actual native source/grant readers. Signal source proof must preserve PRIVATE unless explicitly classified PUBLIC with evidence. Neither HTTPS nor sessionAllowed is classification/consent. |
| `readTrackingGrant({namespace, sourceId, taskId})` / `readTrackingGrantSnapshot({namespace, sourceId, taskId})` | `taskId` is the original trusted Runtime intake task persisted in `watch.consumer.intakeTaskId`, never the root checkpoint task, new work task or namespace-wide permission. Native readers validate original purpose, source/config and current lease; the host matches id/revision/expiry. Snapshot is synchronous and required for source commit/current-fact/recovery gates. |
| `createKnowledgeTrackingPorts({readTrackingGrant, readTrackingGrantSnapshot, layaChooser})` | Thin reader/chooser composition; no authority issuance, database, UI, sourceproof manufacture or grants. Laya is advisory; this is not AgentArts orchestration evidence. |
| `readFeedReceiptEvidence({namespace, sourceId, sourceReadTaskId, receiptId})` | Synchronous reader returning a v2 receipt rebuilt from the original confirmed execution. Root owns durable rootreceipt→actual task/run/query/scopeRef binding, not a boolean from Renderer. |
| `createKnowledgeFeedReceiptFromConfirmedExecution({namespace, sourceId, taskId, runId, toolVersion, query, scopeRef, runtime})` | New helper in knowledge-feed-receipt.ts. Uses original getTask/readToolExecutions/input digest match/tool-result checkpoint/readEvidence. Requires allow, executionStarted, confirmed, exact tool/version/query and original record accountRef/fetchedAt/classification. Returns v2 or undefined; never changes sensitivity. P8 adds the public application export. |
| `consumeInterestTask(taskId, {deadline, signal, feedCheck?})` | Actual accepted Runtime task; trusted reader alone supplies explicitEnable. Only this entry point attaches the real intake task to the persisted consumer. Caller scope/enablement/intakeTaskId is not permission. A replacement intake or lease increments the consumer revision. Root dispatches this bounded consumer and preserves unknown receipts. |
| `recheckCurrentSource(sourceId, {deadline, signal})` | Trigger after resume or new consumer. Uses original receipt with independently current grant/consumer, then original Runtime workPort and judgment gates. No 304 body fabrication. |
| `prepareCoordinationGoal({taskId, conversationId, publicGoal, deadline, signal})` | P8/Cloud Runtime calls consumptionHost.prepare after acceptance and before dispatch. Persist only publicGoal and metadata binding. Return private projected goal in memory only. |
| `beforeCompetitionSend(request)` | Call consumptionHost.assertCloudSend synchronously immediately before actual send, after credential waits. Never persist projected private lease body into goal, loops, events or history. ReleaseTask on finalization/cancel; restart requires fresh native consent. |
| `createPrivateMemoryErasureHost({listBindings, cancelTask, eraseTaskCopies, readCopyErasureReceipt})` | Use the aff9774 contract. Root enumerates stable actual parent/child task bindings and owns real result/event/checkpoint/toolargs/results/derived goal/assistantHistory redaction. Active/unknown work is durably withheld. Only an exact taskId/factId/bindingDigest/purged receipt permits deleted. Missing receipt means pending, not purged. |

The actual `@personal-agent/runtime/application` exports for PA020 application functions and receipt
helpers are P8's change. Portable hosts import only existing public package exports; do not deep-import
Runtime internals from Desktop. CloudBusiness's provider proof API and P8's native feed/grant descriptor
reader can be passed through the above existing signal/receipt readers without changing the public wire protocol.

## Local P7 grant compatibility continuation

The original d875 source was normally merged with the retained 1ffe/81fe local history. P7 then updated
only its knowledge host, dedicated intake cases and this handoff. All async and snapshot grant reads
use the same complete native tuple. Awaited reads are followed by exact current consumer/lease checks;
the queued interest commit rereads the grant and synchronous lease before checking task/cancellation/deadline.
No Renderer fields attach authority, no database or public Runtime wire schema was added.
The private intake ID stays in host persistence/schedule identity. Cognition RECHECK dependencies retain
the strict public `{id, revision}` consumer shape; the revision fences each original intake/lease binding.

Feed/source refresh and 304/recheck reuse require existing exact tracked consumer bindings. Native initial
source acquisition stays a separately admitted Runtime/ToolGateway read; a caller-supplied new task ID
cannot bootstrap a missing consumer or borrow its grant. Shared source batches validate every active
consumer separately and withhold the batch if any identity/lease is unavailable or changed. Revoked
consumers cannot be authorized by another consumer of the same source. Feed-check schedule identities
include the persisted intake ID; old due/recheck bindings fail after intake replacement. Pause/resume
also checks the exact native snapshot and cannot reactivate a revoked/expired lease.

Legacy checkpoints remain readable, but records without `consumer.intakeTaskId` cannot fetch, project
a current fact, bind a revision or recover due work under native ports. Completed/unknown old intake
receipts never fill in the missing identity or re-enable a watch; fresh trusted intake is required.

Prepared cases in `knowledge-watch-interest-task.test.mjs` cover strict tuple keys, original identity
after restart, wrong source/caller-task substitution, id/revision/expiry/revocation, queued lease
revocation, fired-task separation and consumer-revision replacement. They use explicit doubles and
were not executed in this source-only phase. P8's final integrated run must still prove actual native
consent, source/config binding, Runtime feed execution provenance and current-fact answer consumption.

## Local unified validation (not run here)

Cloud installed dependencies once before the user switched to source-only execution. After that switch,
no unit/integration/smoke tests, build, typecheck, benchmark, inference, provider trial or screenshots ran.
Static review, JavaScript syntax-only checks and diff whitespace checks only. No passing test claim for this cloud delta.

Root compiles the integrated application/exports once in its normal local build, then runs these owned cases:

```sh
node --test --test-name-pattern='cancellation, failure or deadline during the final reader' apps/desktop/test/knowledge-watch-interest-task.test.mjs
node --test apps/desktop/test/knowledge-watch-resume-receipt.test.mjs
node --test --test-name-pattern='confirmed execution reader|raw collect receipt' apps/runtime/test/knowledge-feed-receipt.test.mjs
node --test packages/memory/test/controlled-read.test.mjs packages/learning/test/lifecycle-evidence.test.mjs
```

Reuse the already accepted PA020/81fe evidence. Run additional integration cases only for the actual
P8 shared changes: private-native confirmation, final copy gate changes during credential wait,
exact parent/child copy purge/readback, original marker restart recovery, two consumers and v3/304,
confirmed execution mismatch, and main/Live `answer` consumption. Historic multi-citation tests that
expect current_fact without original execution proof require the genuine integrated reader; this new
gate must not be removed to make old doubles pass. No blanket whole-repository retest is requested.

## Remaining real inputs / acceptance

Root must supply actual PUBLIC source proof and native tracking grant with id/revision/expiry;
existing private feed configuration stays private. Root must register exact tool execution to source
receipt mapping and the real copy redactor/readback. Real local Skill execution, SQLite recovery,
native user consent, Windows Vault/source guards, safeStorage and main/Live integration are local acceptance.
Real AgentArts configured account/deployment/API/trace is required for cloud completion evidence;
the local advisory reevaluator is not a cloud fallback or proof. No private input or account credentials
were uploaded or used by this cloud work.

Migration 3 appends to the existing learning migration sequence; older versions retain their meaning.
Downgrading a migrated learning database to code without migration 3 is unsupported. Source fences retain
only exact source references; callers should use content-free binding identities. This does not implement
another Memory erasure system or claim erasure of backups/external copies.
