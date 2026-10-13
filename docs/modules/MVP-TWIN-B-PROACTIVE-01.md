# MVP-TWIN-B-PROACTIVE-01

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile `huawei_ict_agentarts`; MOD-27/28 consumer increment; owner zemeng.
- Status `review`; registered non-author review and root integration pending.
- Ownership: cognition plus the new `proactive-cognition-host.ts` and dedicated test.
  Runtime public export, Desktop and AgentArts composition remain main-task work.
- Reuses PR #187 (`0dd49e5`). Remote main `a651585` was inspected before implementation.
- No wire capability, database migration, new dependency, scheduler or second task store.

## Intended product chain

Trusted changes → versioned Facts / Goal revision → affected dependencies → several
legal approaches → **Laya proactively selects → AgentArts orchestrates** → local
Runtime / Policy / ToolGateway execution and Evidence. Routine low-risk work should
proceed inside the current authorization scope; only major permissions prompt the
user. Laya does not issue permission, and its selection does not bypass AgentArts.

The host automatically consumes existing Memory confirmation/projection receipts,
records its review in TaskRuntime checkpoints and hands the chosen approach to the
existing AgentArts application path. It never directly commits a repair or invokes
a local repair tool. Private mailbox classifications cannot enter the public Fact
host or a cloud prompt simply because Laya analyzed them locally.

`buildMinimalRepairCandidate` retains existing text and dependency identities while
proposing exact new dependency revisions in topological order. Expired, future,
withdrawn or cyclic heads remain RECHECK. Changed meeting times may require new
plan text; a structural rebind is not semantic proof. The candidate is input for
AgentArts, not a completed repair. KEEP means no affected dependency in this scope;
RECHECK and REVISE are recorded approaches, not task or tool completion.

## Host interface

`createProactiveCognitionHost({application, facts, graphNamespace, bindingVersion,
chooser, prepareOptions?, selectionHandoff?})` exposes:

- `consumeAndReview({at, limit, afterGraphRevision, deadline, signal})`: bounded
  consumption plus persisted impact/review processing. Returns `reviews`,
  `nextGraphRevision`, feed `atWatermark` and independent `hasMoreReviews`.
- `reviewGoalRevision({expectedGraphRevision, previousGoal, currentGoal}, context)`.
- `readReview(taskId)`: trusted-host readback, not a raw Renderer or cloud payload.
- `handoffReview(taskId, context)`: recover the same AgentArts handoff without
  repeating a completed Laya choice.
- `close()`: stop this host; its Fact host remains owned by the caller.

Default approaches ask AgentArts to verify the change, defer/recheck, or evaluate
a minimal repair. Optional `prepareOptions(review, context)` supplies 2–16 specific
legal approaches `{id, revision, description, action: 'RECHECK' | 'REVISE', repair?}`.
Repair candidates are checked against exact graph revision and affected node refs,
then previewed without writing. Options never contain authorization or tool calls.
Laya selection scores retain `calibrated: false`.
The local decision context includes the changed facts and affected plan summaries.
The earlier demo-only 4,000-character context, 800-character option description,
three-node excerpt and cloud goal truncation limits are removed. Existing transport
body limits and actual server option-count constraints still apply. Local context
is not automatically copied into the independently approved cloud projection.

### First planning after a committed Goal creation

The host exposes `reviewGoalCreated({expectedGraphRevision, currentGoal}, context)`
with the same `{at, deadline, signal}` context as Goal revision review. The caller
uses a verified `goals.create` receipt with no previous Goal, then passes the current
graph revision and the receipt's exact Goal reference. The host requires that this
is still the current Goal head, revision 1, active and effective at the evaluation
time. A stale, non-Goal or inactive reference creates no review task.

The review records `subjectGoal` and an empty `affected` list: creation is not a
dependency failure. Laya receives the actual Goal description, validity and its
referenced background. Its offered routes are `plan` (prepare the first steps for
the already registered Goal), `recheck` (verify context and constraints first) and
`defer` (defer planning). All are RECHECK approaches with no repair payload, including
custom options. The chosen route uses the same persistent Runtime/Laya/AgentArts
handoff, uncertainty route and temporary-unavailability recovery. The stable initial
review identity uses the exact Goal ref rather than unrelated graph revisions.

Desktop owns consumption of the no-previous-Goal receipt, inclusion of `subjectGoal`
in the existing redacted projection and the `plan` strategy wording. The output is
a planning handoff; it does not claim that a Plan node was created or that the Goal
was executed. No Goal write, public wire operation or scheduler is added here.

Runtime build and three targeted cases passed: an actual public `createGoal` command
over SQLite followed by initial planning and restart deduplication; rejection of
non-Goal/stale/withdrawn refs before inference; compatibility with the existing Goal
revision path. Laya and AgentArts are explicit Fakes. Desktop consumption and real
cloud planning remain separate root integration checks.

### Consumption of committed graph Goals

At the existing feed watermark, an idle `consumeAndReview` pass also reads current
active, effective Goal heads from the bound graph. Revision 1 enters initial
planning; later revisions use the exact preceding Goal version and the existing
revision review. This covers public `goals.create` / `goals.revise` writes regardless
of whether they originated in the Desktop host-task list. A revision-1 Goal already
referenced by a current Decision or Plan is not given another initial-planning pass.

Goals without a recorded review are considered before older pending handoffs, with
initial planning first within each group. The existing request limit bounds pending
Goal work; completed reviews and accepted or expired handoffs do not consume it.
Selected routes waiting for an available handoff remain recoverable, and temporary
Laya failures retain the existing cooldown/successor chain. Goal scans leave the
Fact receipt cursor unchanged and add no scheduler, database, dependency or wire API.

Goal revision identity now binds exact previous/current Goal refs, excluding
unrelated graph appends. Existing UI reviews with the earlier key are found through
paginated Runtime INTENT checkpoints with a fixed snapshot sequence. Namespace,
binding version and exact refs must match. A legacy created task runs in place;
completed review and handoff receipts are reused across polling and SQLite restart.
This does not relax cloud permission checks or claim completion of a Goal or Plan.

Runtime build passed. Four focused host tests passed: command-created/revised Goal
discovery and UI/restart deduplication, legacy created-task recovery, and existing
Fact correction/expiry regressions. After the final priority fix, the two Goal cases
passed again, including limit=1 with an old unavailable handoff and a new Goal.
These use actual SQLite/public Goal commands and explicit Fake Laya/AgentArts;
live cloud-tool execution and Desktop loading remain root acceptance work.

### Time-only expiry consumption

`consumeAndReview` also detects current public Facts whose `validUntil` has elapsed,
even if the source feed has no new event. Once the feed reaches its watermark and
the receipt backlog is empty, an idle consumption pass uses the existing
`analyzeImpact` to select their affected Goal/Decision/Plan versions. A pass that
already processed Fact reviews leaves the expiry scan to the next existing tick.
The Desktop goal cognition host already calls this entry point; no new scheduler
or store is introduced.

An expiry review uses the same TaskRuntime intent/review checkpoints, Laya chooser
and AgentArts handoff. Its key binds exact expired Fact and consumer references,
excluding polling time, deadline and unrelated graph revision changes. It does not
advance the Fact receipt cursor. Only active, public, current Fact versions past
their end time qualify; future or superseded versions do not. Expiry offers RECHECK
and defer, without a local repair or an extension to the source validity period.
Custom options for this trigger must also remain RECHECK without a repair payload.

Targeted validation: Runtime build passed; the existing Fact correction and Goal
revision cases plus the new expiry-to-AgentArts case passed 3/3 using real SQLite
and explicit Fake Laya/AgentArts. The new case covers the expiry boundary, repeated
polling, restart and an unrelated graph append. No live cloud/model or Desktop
smoke was run for this host-only increment.

This consumes graph validity, not the separate knowledge-cache or interest helpers.
Those still need trusted providers: knowledge requires cache version, exact content
hash, successful-check time, bound changed/withdrawn receipts and exact consumer
references; interests require topic/interaction evidence, verified source transport,
tracking scope and revocation state. Public Fact summaries cannot supply these
fields. Do not derive a body hash from a summary or treat observation time as a
successful source check. No missing provider is replaced with a production Fake.

### Uncertain choices continue as machine review

An otherwise valid Laya `review/uncertain` response can follow an existing offered
`recheck` candidate to AgentArts for further reasoning. The original selection,
tentative candidate, scores and `eligibleForRuntime: false` remain unchanged.
`selectedOption` stays absent: the host records its routing decision separately as
`machineReview: {reason: 'uncertain', action: 'RECHECK', option: {id, revision}}`.
The referenced offered option must be `recheck`, have action RECHECK and no repair;
without that option the host does not manufacture a fallback. Cancelled, expired,
unavailable, invalid and high-risk responses do not enter this route.

The same existing handoff applies, including export preparation, current permission
checks and the persistent command ID. Legacy uncertain reviews without a HANDOFF
can gain this machine-review field before preparing their first handoff; an existing
handoff never rewrites its saved review or digest. This is machine reasoning rather
than user approval, and does not execute a repair. The Desktop projection must
explicitly accept `machineReview` and describe the uncertainty instead of claiming
that Laya confidently selected the fallback. That adapter remains root-owned.

This increment passed the Runtime build and four targeted cases: preserved uncertain
receipt and legacy SQLite recovery; unavailable/no offered recheck rejection;
cancellation during choice; export-scope denial. The tests use Fake Laya/AgentArts
and real SQLite. They do not establish live model or cloud availability.

### Recovering temporary Laya unavailability

A saved `abstain/unavailable` result is retained as an observation, rather than
treated as a completed decision that permanently consumes the change. The caller
receives `EXTERNAL_FAILURE`, so the existing Desktop error path leaves its Fact
cursor or new Goal marker unadvanced and applies its existing 30-second backoff.
An independent Runtime checkpoint also preserves that cooldown across ticks and
restart; calls inside the interval create no task and make no model call.

After the cooldown, the next consumption call creates or finds one successor by a
stable key bound to the prior task ID. Its intent records `retryOf`; the old terminal
task and Laya receipt remain intact. A new attempt checks validity at the current
request time; resuming an already-created attempt uses its own persisted time.
A call runs at most one new inference attempt,
and another unavailable result starts a new cooldown. The recovered decision uses
the original handoff path and command deduplication. Any existing HANDOFF, cancelled
or expired request, invalid response or other abstention reason is excluded from
this automatic retry. No task store, timer or retry-count limit is added.

The optional factory `now` dependency is a test clock and defaults to `Date.now`;
existing composition calls require no API change. Legacy unavailable reviews gain
their first cooldown when encountered. Fact history is encountered through existing
receipt replay. A legacy Desktop Goal marker must fall through to the existing
latest-Goal validation and `reviewGoalRevision` when its saved review is unavailable;
otherwise its old marker would continue suppressing calls. That adapter is root-owned.

Runtime build and four targeted cases passed: persistent cooldown/successor recovery,
unavailable/no recheck routing, cancellation and uncertain handoff compatibility.
The recovery case uses a controlled clock, real SQLite and Fake inference/cloud to
check repeated failure, restart, current evaluation time, preserved old receipts
and one successful AgentArts handoff. No real Laya or cloud request was made.

`selectionHandoff` implements:

```ts
prepare(review: ProactiveCognitionReview, context: MemoryReadContext): Promise<{
  exportPolicyVersion: string; goal: string;
} | undefined>;
read(commandId: string): TaskSnapshot | undefined;
dispatch(request: ProactiveSelectionHandoff, context: MemoryReadContext): Promise<TaskSnapshot>;
```

`ProactiveSelectionHandoff` contains `commandId`, `reviewTaskId`, `selectionDigest`,
`exportPolicyVersion`, `goal`, `deadline`. This is an internal host envelope, not a
new cloud protocol. Only the explicitly permitted, minimized `goal` should enter
the existing `CoordinationRequest`. `prepare` must check data egress permission and
return undefined when unavailable. `dispatch` must revalidate scope/revocation and
policy version, honor cancellation/deadline, and use existing Runtime idempotency
for the exact command. `read` only looks up an existing task and causes no network
activity. Never upload raw review checkpoints, Fact history, private headers or
authorization objects. Root owns the actual approved projection and cloud binding.

## Durability and boundaries

Memory staging/confirmation/projection retain their existing recovery protocol.
Review identity is bound to namespace, binding version and exact trigger. Existing
created review tasks resume the original intent; interrupted tasks with saved review
output are reconciled without another model call. Missing interrupted output is
explicitly not performed; cancellation and terminal failure do not reopen tasks.

The handoff envelope is saved before dispatch. Replay first reads the existing
AgentArts Runtime task, otherwise submits the same command and immutable payload.
An expired undispatched envelope returns `expired` without blocking the review
cursor or extending authorization. A callback failure can be retried via
`handoffReview`, which reuses the same envelope. Submitted is task acceptance only;
real AgentArts completion, local writes and Evidence need their own readback.
Cancellation during dispatch reads back the stable command: an existing task is
returned as submitted; otherwise `pending` makes the possible submission explicit.
Cancellation before an envelope is saved prevents dispatch. The root adapter must
forward the signal and check it immediately before actual Runtime/network submission.

## Validation and remaining work

Desktop consumes `machineReview` separately from a confirmed `selectedOption`.
The outgoing projection identifies host uncertainty escalation, fixes the requested
action to RECHECK, and explicitly records no confirmed choice or execution. The
existing session grant, graph revision and final HTTP-send checks remain in place.
The Desktop integration's four focused tests passed, including uncertain handoff,
grant revocation during credential loading, graph revision changes and duplicate
suppression. These use Fake cloud responses; real AgentArts acceptance is pending.
Desktop also recognizes legacy Goal markers whose saved choice is unavailable and
re-enters the existing review API. One additional targeted integration test passed:
the persisted cooldown survives a Desktop restart, a recovered Laya provider creates
a successor review and one cloud handoff, and the old terminal task stays unchanged.

Verification uses synthetic SQLite sources, Fake Laya and Fake AgentArts. No real
model process, cloud, mailbox, microphone, Electron or installer is started.
Available Node 26.3.0/npm 11.16.0 differs from required Node 24.15.x/npm 11.12.x;
the mismatch is recorded rather than changing global tools.

Completed checks: cognition build/typecheck, Runtime dependency build and Runtime
build passed; cognition workspace tests 51/51; dedicated proactive host tests 10/10;
architecture checks 3/3; `git diff --check` passed. The final host tests propagate
signal/remaining timeout into Client. The affected Laya choice test also passed
after removing demo text caps.
No full repository check was run for this bounded work package. Fake AgentArts
tests exercise the actual Client → Runtime Application → Coordination path, including
restart idempotency, export denial, expiry, cancellation/close, custom options and
scope rejection. They assert that the host itself never appends repaired plans.

Real source adapters, private Fact ingestion, Desktop source lifecycle, authorized
cloud projection, Laya/AgentArts live execution and later Policy/Evidence write
acceptance remain main integration/live-validation work. Interest policy from #187
is reusable, but this increment does not start permanent subscriptions or crawling.

## Current source wiring — 2026-10-07

Source baseline: `main@4b5ec61`. This section records the wiring present at that
revision; the earlier dates, toolchain observations and test counts remain the
historical results of their original increments.

[Runtime's existing proactive host](../../apps/runtime/src/application/proactive-cognition-host.ts)
implements initial Goal planning, Goal revision review, public Fact correction and
time-only expiry review. It also preserves uncertain choices as machine review and
recovers unavailable Laya choices through persisted cooldown/successor checkpoints.
[The existing Desktop Goal host](../../apps/desktop/electron/goal-cognition-host.js)
consumes current graph Goals through the same review API, including Goals committed
outside its UI command path, and handles the legacy unavailable markers. Its cloud
projection recognizes machine review and rechecks the current grant and graph;
[Desktop main](../../apps/desktop/electron/main.js) binds the existing host and final
cloud-send checks. These local consumers are already present, rather than pending
new hosts. The source scenarios are recorded in
[Runtime host tests](../../apps/runtime/test/proactive-cognition-host.test.mjs) and
[Desktop Goal host tests](../../apps/desktop/test/goal-cognition-host.test.mjs).

The separate knowledge/interest consumer and reviewed-repair wiring are also
present at this baseline; their current boundaries are recorded in
[MVP-TWIN-B-INTEREST-01](MVP-TWIN-B-INTEREST-01.md) and
[MOD-28-REVIEWED-REPAIR-01](MOD-28-REVIEWED-REPAIR-01.md). Their source evidence is
not synthesized from public Fact summaries. Missing or revoked providers/grants
still fail closed, and a submitted cloud task is not a verified local write.

This update is a source-wiring reconciliation. It adds no live-model, cloud,
private-source, Electron or installer acceptance and does not mark MOD/MVP done.

## Device consumer and field acceptance — 2026-10-07

At `main@4b5ec61`, [Desktop main](../../apps/desktop/electron/main.js) already binds
the existing [P5 composition](../../apps/desktop/electron/cognition-p5-composition.js)
to `DeviceAnomalyDecisionService`. Completed observation tasks enter through
[the observation source](../../apps/desktop/electron/p5-system-observation-source.js),
which rereads `readCurrentSystemObservationSample`: a current process-local
monitoring lease, successful `computer.system.observe` result, `node:os` origin and
nonempty Runtime Evidence are required. The separate older proactive composition
also displays system-pressure suggestions; its cards are not P5 delivery proof.

[P5 checkpoints](../../apps/desktop/electron/p5-runtime-checkpoints.js) use
`createHostStateStore('proactive-receipts')` in the existing Runtime SQLite database.
The anomaly state is namespace-bound and survives reopening. The existing
[notification host](../../apps/desktop/electron/p5-device-notification-host.js)
uses the separate `device-notifications` host-state binding in that same database;
its receipt store imports legacy files without creating another database. A saved
card is pending intent. Only native `show` confirms delivery; unsupported/failed
is undelivered, timeout/interruption is unknown, and user reading is unobserved.
`reconcileDeviceDeliveries` accepts only a persisted delivered/failed record matching
the exact source and pending delivery ID. Missing, pending or unknown records do
not clear the anomaly intent or authorize a resend.

The current core also rechecks the original signal/deadline after saving a new
delivery intent and before calling the notification port. Cancellation there
clears only this unattempted intent; attempted or historical unknown deliveries
remain available for trusted readback. Desktop stop aborts the tracked operation
and interrupts its notification host. Restarting the P5 consumer restores feedback;
it does not restore monitoring permission, load the shared model or create a new
delivery attempt.

This consumer check exposed a concrete checkpoint mismatch: clearing an intent by
assigning `undefined` made the state fail the actual host-state port's lossless JSON
validation. The core now removes that optional property when clearing a definite
outcome or the new unattempted intent. On Node 24.15.0, the new strict-JSON cases
failed for delivered, cancelled and reconciled outcomes before the fix, then the
device checks passed 19/19. An isolated existing-P5-composition check with actual
Runtime SQLite and explicit synthetic samples/chooser/notification passed:
cancel-before-delivery produced zero sends and no pending intent; reopening and
replaying produced zero sends; a fresh sample sent once and the next sample was
cooldown-suppressed. Four focused existing Fake-native host checks also passed for
show confirmation, timeout/late reconciliation, restart and stop without resend.
The first Runtime build lacked internal dependency artifacts; building only the
missing dependencies and Runtime resolved that setup failure without source changes
outside cognition. These checks prove local consumption and recovery, not live
device, model or OS notification behavior.

The remaining field checks follow this existing chain:

1. **P8 / MOD-11–13 owner zemeng:** load the integrated Desktop code in an isolated
   userData/runtime namespace and record its source revision. Verify Competition
   profile, P5 persistence/feedback availability and the absence of an automatically
   restored monitoring lease. Preserve any pre-existing unknown deliveries.
2. **Model/configuration owner goo122, with P8:** start the configured local Laya
   through its existing control and record the loaded-model identity/readiness.
   Do not substitute a Fake model or launch another model host. Then enable this
   session's computer monitoring through the existing settings/IPC; verify one
   active P5 subscription and its lease expiry.
3. **MOD-16/17 observation owner zemeng:** read a completed sample through the
   existing Runtime API and trace its task ID/Evidence into the P5 source. Check
   real `node:os` provenance and revoked/expired lease rejection. Ordinary low-load
   samples can verify the source chain; they cannot establish an anomaly trigger.
   A natural sustained high-load observation must additionally establish three
   consecutive qualifying samples, the Laya selection and its exact delivery ID.
4. **P8 with MOD-23 owner Potatos498:** reread that exact notification's native
   outcome and persisted receipt after `show`/`failed`. Verify that the anomaly
   feedback agrees and only confirmed delivery starts cooldown. Quiet/pause or an
   unavailable policy must suppress a new OS send. If only the native display needs
   isolation, use the existing
   [single synthetic native-receipt helper](../../apps/desktop/test/p5-device-native-receipt.mjs)
   with an isolated storage binding and its explicit one-notification flag; retain
   its synthetic-input, no-real-trigger/model/Evidence markers.
5. **P8 with the MOD-28 core owner zemeng:** disable monitoring during a pending
   choice or notification and verify cancellation/unsubscription. An already
   attempted delivery whose outcome is unknown must remain unknown across restart,
   without another `show`. A late or previously persisted definite outcome may
   reconcile only its matching pending ID; a user click or card alone cannot do so.

Record source revision, process/model identity, observation task/Evidence references,
delivery ID, native outcome and reopened feedback separately. A synthetic native
receipt does not prove real load detection; an injected consumer test does not
prove OS display. These field checks remain unperformed by this documentation
update, and MOD/MVP acceptance remains open.
