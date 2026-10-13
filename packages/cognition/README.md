# @personal-agent/cognition — MOD-28 local impact core

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Owner: zemeng. Profile: huawei_ict_agentarts. Pure local domain increment with
an optional host-bound persistent-store consumer; no AgentArts, Memory,
scheduler, tool execution or TaskRuntime state transition.

`ReviewedMeetingFactConsumer` consumes a trusted completed Fact projection and
the existing Runtime reviewedRepair host. It persists the original review/tool
identity and impact digest, keeps uncertainty unchanged, and requires tool
Evidence plus graph readback before reporting applied. It never writes the graph
from a policy callback. `createCommittedMeetingProjectionReader` binds existing
Fact receipts to an authorized source revision readback.

Meeting receipt stores bind the complete namespace/source/event ID tuple. New
file receipts use tuple-hashed keys; legacy delimiter-hashed files are read only
when all three stored fields match the query. Legacy files stay intact, while
canonical records take precedence in queries and deduplicated receipt lists.
Older builds still read legacy hashes and can see stale states after an upgrade;
retaining those files does not make downgrade automatic. Back up before upgrading
and use the existing rollback procedure to restore the matching receipt history.

`createInboxPageConsumer` adds bounded page backpressure and pause/resume to the
existing Runtime InboxTriagePipeline. Cursor, fingerprint, receipt cache and
private storage remain with that pipeline. `measureTriageClassifier` measures
actual public classify awaits only. See [cloud ports and local acceptance](CLOUD-MVP-COGNITION.md)
for exact caller injection, migration and verification limits.

`prepareReviewedRepair(snapshot, at, review, candidate?)` validates an exact
offered, eligible REVISE candidate against the current affected scope. It uses
the existing repair preflight and binds target/dependency refs and canonical
digests; uncertain/RECHECK/unsupported scopes cannot create an execution binding.
Runtime composes the resulting trusted adapter into the existing
`cognition.commit_repair` Policy/CAS path. It is not a wire operation or authority.
See [`MOD-28-REVIEWED-REPAIR-01`](../../docs/modules/MOD-28-REVIEWED-REPAIR-01.md).

`buildMinimalRepairCandidate(snapshot, at, {expectedGraphRevision, targets})`
builds an isolated dependency-only repair for a trusted RECHECK subset. It
orders changes by dependency, retains text and dependency identities, and
reports targets that still need RECHECK. Withdrawn, expired, future or cyclic
heads are not silently rebound. A candidate is not proof that existing plan
text remains correct after a semantic change. `semanticReviewRequired` means
trusted semantic validation is needed; it does not require interrupting the
user for each routine action. Laya selects among legitimate approaches and
passes its choice to AgentArts for orchestration. Low-risk actions within a
current, revocable host authorization can then run through Policy; Laya cannot
grant that authorization or bypass AgentArts. Runtime's provisional proactive
host composes existing Fact receipts, task checkpoints and a minimized host-approved
AgentArts handoff; it does not directly commit repairs. See
[`MVP-TWIN-B-PROACTIVE-01`](../../docs/modules/MVP-TWIN-B-PROACTIVE-01.md).

`buildInterestOptions(input)` derives legitimate approaches from the existing
interest policy. `LayaInterestDecisionService.choose(input, context)` asks Laya to
select among those approaches for AgentArts orchestration. A one-off question has
no tracking option; revocation cannot be overridden by a model. Tracking proposals
bind current public source, evidence, scope and expiry, and always require fresh
host validation before any actual subscription. No watcher or permanent memory is
created here. See [`MVP-TWIN-B-INTEREST-01`](../../docs/modules/MVP-TWIN-B-INTEREST-01.md).

`planKnowledgeReevaluation({namespace, freshness, dependencies, checkpoint})`
turns existing freshness decisions into exact source/version/content-bound
consumer rechecks. Stable work keys survive JSON checkpoint replay and repeated
polls. A confirmed content change or withdrawal remains invalid for that cached
identity, even after a later unchanged check. Persist each nonduplicate work key
through the existing Runtime before saving the returned consumption checkpoint.
No source fetch, task store or permission is created. See
[`MVP-TWIN-B-KNOWLEDGE-01`](../../docs/modules/MVP-TWIN-B-KNOWLEDGE-01.md).

`prepareTriageDispatch({namespace, messages, labels, results})` validates the
same-call `LayaTriageService` input/receipt binding and returns metadata-only
label groups, `mainAgent` and machine `review` queues, and deferred items with
their original required route. Stable work keys use the existing Runtime
idempotency boundary. This does not read or write mail, grant permission, or
export content. See [`MVP-TWIN-B-TRIAGE-01`](../../docs/modules/MVP-TWIN-B-TRIAGE-01.md).

`analyzeImpact(graph, evaluatedAt)` validates and replays the complete MOD-27
graph. It returns current Goal/Decision/Plan references with KEEP or RECHECK,
reasons and exact causal references. Superseded, withdrawn and out-of-validity
versions propagate through pinned dependencies. Old unresolved changes remain
visible; unrelated new facts do not invalidate every plan. Time is explicit UTC
so expiry and JSON replay are deterministic. Withdrawn plans KEEP their inactive
state; KEEP is not an assertion of truth, task success or authorization.

`selectGoalRevisionImpact(snapshot, evaluatedAt, {expectedGraphRevision,
previousGoal, currentGoal})` takes two consecutive Goal references already
present in one trusted graph snapshot. It reuses `analyzeImpact` and returns
only current RECHECK items causally pinned to the superseded Goal version;
unrelated Fact changes and old historical items stay outside this subset.
`previewGoalRevisionRepair(boundStore, evaluatedAt, {...selection, changes})`
applies caller-authored changes only to that subset on an isolated copy via
the existing repair preflight. It neither chooses new plan text nor writes.
The complete impact report can still contain other RECHECK items, and a partial
preview does not imply complete repair. See
[`MOD-28-GOAL-REVISION-01`](../../docs/modules/MOD-28-GOAL-REVISION-01.md).

`proposePlanRevision(graph, evaluatedAt, {expectedGraphRevision, plan: {id,
revision}, summary, reason})` validates an explicit candidate for an affected
active plan. It returns REVISE with one before/after summary change. It rejects
stale revisions, unchanged text, unaffected plans and extra fields. This is only
a candidate, not a semantic judgment that the new text solves the problem.
It does not rebind dependencies, clear RECHECK, append versions or execute actions.
Host review, fresh revision checks, atomic persistence and Runtime/Policy remain
required before accepting or acting on any proposal. Proposal text is untrusted
data and output identifiers must remain within the host's privacy boundary.

Only the public `@personal-agent/goals` export is consumed. These provisional
types are NOT a frozen PlanPatch wire contract or invented FactChangeFeed.
The MOD-27 source was integrated separately. This package consumes only its public
exports and the host-bound provisional store export; both increments still require
their own review evidence before production use.

Tests: `npm test --workspace=@personal-agent/cognition`. Synthetic meeting data
covers propagation, stale historical paths, expiry, withdrawal, unrelated plans,
deduplication, deterministic replay, revision checks and summary-only proposals.
The module build first builds goals; root production build ordering remains
goo122 integration work. Workspace lock entries are included for clean CI installs.
No new third-party dependency is introduced.
Full-history validation/copying and cause expansion target small graphs; large
graph performance and cloud-assisted semantic plan repair are not delivered.

## Runnable local replay

Run `npm run demo --workspace=@personal-agent/cognition` to replay a synthetic
meeting correction through impact analysis, explicit candidate, manual fixture
version rebinding and reanalysis. The JSON report shows three affected nodes,
two after rebinding only the goal, and zero after the full explicit repair.
It asserts stale candidate rejection, unchanged unrelated plan, historical
snapshot preservation and deterministic JSON replay. All edits are to in-memory
fixture copies. `mock` is deliberate: no host approval, storage, scheduling or
external reminder execution is demonstrated. KEEP means no detected dependency
or validity issue, not that the fixture's chosen times are semantically proven.

## Local evaluation baseline

Run `npm run evaluate --workspace=@personal-agent/cognition` for a fixed synthetic
impact-classification evaluation using the existing meeting replay. Four stages
are scored against explicit expected RECHECK sets and a deliberately simple
recheck-everything reference. The JSON reports confusion counts, precision/recall
(null for zero denominators), accuracy and unnecessary rechecks. Repeated runs
measure determinism only, not independent statistical samples.

This is a `mock` local-domain baseline, not AgentArts/model quality evaluation,
measured latency or token savings. It performs no network calls, external actions
or persistent writes. See [the work package](../../docs/modules/MOD-31-LOCAL-EVALUATION-01.md).

## Bound persistent-store consumer

`analyzeStoredImpact(boundStore, evaluatedAt)` reads and analyzes the exact
snapshot returned by a host-bound provisional `CoordinationStorePort`.
`commitStoredPlanRevision(boundStore, evaluatedAt, request)` revalidates an
explicit Plan candidate, then appends one version with caller-selected exact
dependencies. A stale graph or a commit-time race returns `kind: 'conflict'`
with a fresh snapshot and impact report. A stale Plan `NodeRef` revision keeps
the `proposePlanRevision` `REVISION_CONFLICT` error instead of returning a
graph-conflict object whose graph revisions are equal. It never retries the
write. Invalid, unaffected or extra-field requests are rejected before reading
the bound store. Returned snapshots and proposals are isolated copies. The
consumer cannot select a namespace and does not receive the Runtime host.

An applied result only proves durable domain append. It does not approve text,
change task state, schedule a reminder, execute a tool, or clear RECHECK unless
the caller explicitly rebound the complete affected dependency chain. The Fake
tests run with the workspace suite. The SQLite restart scenario lives at
`tests/integration/mod-27-28-persistent-cognition.test.mjs` and is run after the
root build; it uses only temporary synthetic data.

## Explicit multi-node repair consumer

`previewStoredRepair(boundStore, evaluatedAt, request)` validates a non-empty,
ordered set of explicit Goal/Decision/Plan changes against the original
RECHECK report and applies them only to an isolated graph copy. Each candidate
keeps the current node's source, sensitivity, validity window, state and kind;
only summary, reason and explicitly supplied dependencies can differ. Missing,
future-ordered or otherwise invalid dependency references are rejected by the
public graph append preflight. The preview never calls `append` or
`appendBatch`, and does not provide semantic approval or automatic rebinding.

`commitStoredRepair(atomicStore, evaluatedAt, request)` repeats that preview and
submits its ordered inputs through exactly one `AtomicCoordinationStorePort`
`appendBatch` CAS. An old store port without `appendBatch` is rejected rather
than falling back to partial writes. A graph CAS conflict returns one fresh,
isolated snapshot and impact report without retrying; a stale node reference
with an otherwise matching graph remains `REVISION_CONFLICT`. An applied result
proves only the durable graph append. It does not approve repair text, change
task state, schedule or execute actions, rebind dependencies automatically, or
claim cloud/real execution evidence.

## Provisional Laya advice consumer

`ProactiveDecisionService` takes a bounded local decision model.
`LayaDecisionModel` and `LocalLayaHttpTransport` connect it to an authenticated
loopback Laya server supplied by a trusted host. The service returns suggestions
only; uncalibrated suppression or execution labels, low confidence, and model
failure escalate to AgentArts instead of changing task, approval or tool state.

`decideProjectedFactImpact(decision, {graphNamespace, projection, impact, deadline, signal})`
accepts the committed receipt from Runtime's existing memory projection and a
matching impact report. The trusted host binds `graphNamespace`; each cause's
`currentRevision` must match the projected Fact node revision. It asks the
decision service only for Fact changes that caused RECHECK, with at most four
links per call. Empty and unrelated batches still check cancellation and
deadline without calling the model. This adapter neither polls the
feed nor starts the Laya process. The synthetic local probe is
`examples/projected-fact-laya-probe.mjs`; it requires an already running local
server plus `LAYA_PORT` and `LAYA_API_KEY` in its process environment. The
Desktop production Fact consumer has not been connected yet. See
[`MOD-28-LAYA-DECISION-01`](../../docs/modules/MOD-28-LAYA-DECISION-01.md).

`selectProjectedRepairScope(snapshot, at, {graphNamespace, projection})`
accepts the existing committed Runtime Fact projection receipt and recomputes
impact for its exact graph revision. It returns only current RECHECK nodes
caused by the projected Fact versions. `previewProjectedRepair(boundStore, at,
{graphNamespace, projection, changes})` restricts an explicit repair candidate
to that subset on one isolated snapshot. It does not poll the feed, ask
AgentArts, acknowledge a batch, approve or commit changes. See
[`MOD-28-PROJECTED-REPAIR-01`](../../docs/modules/MOD-28-PROJECTED-REPAIR-01.md).

## Bounded local inbox triage

`LayaTriageService(inference, options).classify({messages, labels, deadline, signal})`
classifies host-approved local projections. Each message provides `source`,
`messageId`, `sourceRevision`, `text` (up to 4000 characters), and optional trusted
`highImpact`. `labels` is a caller-defined whitelist of 2–16 labels with meanings.
The service does not fetch mail, parse a connector's concatenated header into
invented structured fields, or modify the original source.

Results preserve input identity and order. `label` may be grouped as local metadata;
`route` is `group`, `review`, or `main_agent`. Meeting/deadline/commitment changes
route to the main agent for source-backed analysis, never directly to calendar
writes. `unavailable`, `invalid_response`, `cancelled`, and `deadline` mark unfinished
items; callers must not advance ingestion cursors past them. `uncertain` is a valid
review-queue outcome, with retained scores. Neither result creates authorization.

The existing `LocalLayaHttpTransport` supports `batching: 'multi_question'` (default):
at most four messages share one state and multiple choice questions. This is not
SDK multi-state batching. For the project-owned batch server, explicitly inject
`LocalLayaBatchHttpTransport(port, getApiKey)` with `batching: 'multi_state'`.
It uses `/v1/systemone/batch`, keeps each message in its own state, and validates
every echoed request identity before attaching results. A missing batch endpoint
fails visibly; no implicit per-message fallback occurs. Both modes process chunks
serially, with deadline/cancellation and isolated per-item malformed-result handling.

Choice `confidence` from the installed SDK is normalized entropy concentration.
`answer_confidence` is maximum class probability. The service retains both under
explicit names and retains the probability distribution and top-two margin.
`calibrated: false` always applies: no project-specific email calibration dataset
has established correctness probabilities. The default probability/margin gates
(0.7/0.15, configurable) are routing rules, not a claimed accuracy guarantee.
Do not use these labels to silently delete, move, send mail or suppress important
messages. Locally visible grouping is permitted; original content remains intact.

Each result includes a local correction receipt containing source/version linkage,
candidate label IDs, fixed prompt version, context and criteria digests, and the
score/reason fields. No original text or private headers enter the receipt. The
source owner can link user corrections to the same version without publishing
private training data. No training pipeline or measured model improvement is claimed.

The existing intervention service still offers seven genuine labels, including
defer, merge, remind, request decision and AgentArts escalation. These are advisory
intervention choices; no runtime executable-action candidate set is created by
triage, and an uncalibrated `EXECUTE` choice still escalates.

See [`scripts/laya/README.md`](../../scripts/laya/README.md) for the optional local
batch adapter. Compilation and one combined Fake test cover batching, attribution,
partial failures, cancellation and redacted receipts. No model was loaded for this
increment; throughput and real mailbox classification quality remain unverified.

## Concrete action selection

`LayaActionChoiceService(inference).choose({context, candidates, deadline, signal})`
compares 2–16 concrete host-owned candidates. Each supplies stable `id/revision`,
`kind` (`tool/noop/defer/escalate`), approved description, exact source/goal refs,
scope, expiry and risk. Tool candidates include the actual tool name/version and
arguments, their canonical SHA-256 `argumentsDigest`, and a host-provided grant
summary (state, reference digest, same scope/argument digest, expiry). Raw arguments
and authorization references never enter the model payload. `actionArgumentsDigest`
uses the existing ToolGateway canonical JSON convention.

Duplicate IDs, mismatched argument or authorization bindings are rejected. Expired
or unauthorized candidates are excluded; fewer than two valid alternatives yields
`insufficient_candidates` without calling the model. A model chooses an opaque
candidate key which is mapped back to the original ID/revision. All candidates
remain in the receipt; excluded or unavailable scores are `null`, never invented
probabilities. Low-score/low-margin answers and high-risk candidates route to review.
These thresholds are conservative routing rules, not task-specific calibration.

`state: 'selected'` and `eligibleForRuntime: true` mean a low-risk selection can be
considered by the host under its existing permission. They are **not authorization**.
The host resolves the exact selected revision in its immutable candidate registry,
rechecks the real grant and current source/goal revisions, and passes the original
tool/arguments through Runtime/ToolGateway. Runtime is still responsible for
task/run identities, Policy consumption, cancellation and Evidence. A `noop`,
`defer` or `escalate` candidate likewise needs its host-defined handler; this module
does not create schedules or cloud calls from a label.

The receipt includes every candidate reference and digest, context digest, prompt
version, distribution and reason. It can be joined to later local user corrections;
it contains no private source text, tool arguments or usable grant. This provides
traceable decision metadata, not an implemented training pipeline or verified
execution loop. The existing seven-label intervention API remains compatible.
## Durable Fact projection handoff

`decideDurableFactProjection(boundStore, decision, scopedHost, input)` is the local
cognition handoff after a public Fact batch has been durably projected and its
impact processed. The trusted Runtime caller supplies the projection receipt;
the fixed-scope host reads the completed impact report for the same `batchToken`.
An unscoped impact array cannot establish that this batch completed. This entry
checks the original and current graph revisions and recomputes impact from the
bound store before selecting only the projected Facts' RECHECK scope and asking
for bounded Laya advice. The returned scope can be passed to the existing
explicit `previewProjectedRepair` path. It does not poll or confirm a feed,
write the graph, perform a repair, or execute any suggested action. DEP02's
`readCompletedImpact(batchToken)` exposes the required shape for its fixed
consumer. For a recovered older batch, the entry verifies the persisted report
against the graph at its original revision, then computes the current impact at
the caller's explicit `at`. A superseded Fact version cannot trigger advice;
another graph append during advice causes a revision conflict. Production
composition and joint acceptance are still pending. Module tests use synthetic
data only.

`previewDurableFactRepair(boundStore, scopedHost, at, {graphNamespace,
projection, changes})` uses the same durable completion and historical report
check for an explicit candidate after advice. It reuses `previewProjectedRepair`
on the current graph, so unrelated graph revisions can advance without losing
the affected subset. The projected Fact must still be the current version;
candidate targets must be the current affected node versions and retain their
original dependency IDs. A changed Fact or target is a revision conflict, and
an unrelated dependency replacement is not applicable. This remains a read-only
preview; approval, source Evidence and graph CAS are enforced by the existing
local repair task before any write.

The entry first calls that exact scoped durable read. A pending batch gives `NOT_APPLICABLE`;
another consumer's batch remains the host's `NOT_FOUND`. The trusted caller
must recover the original projection receipt and batch token across restart.
DEP02's `listImpactReceipts({afterGraphRevision,limit})` now pages pending and
completed receipts for the fixed consumer from the existing projection records.
Production composition must replay them before advancing the feed and only
advance its existing task checkpoint after accounting for each handoff.
`drain()` alone reports only a batch count and watermark. The module has not
been connected to a real source trigger or restart flow yet.

## Bounded local inbox triage

`LayaTriageService(inference, options).classify({messages, labels, deadline, signal})`
classifies host-approved local projections. Each message provides `source`,
`messageId`, `sourceRevision`, `text` (up to 4000 characters), and optional trusted
`highImpact`. `labels` is a caller-defined whitelist of 2–16 labels with meanings.
The service does not fetch mail, parse a connector's concatenated header into
invented structured fields, or modify the original source.

Results preserve input identity and order. `label` may be grouped as local metadata;
`route` is `group`, `review`, or `main_agent`. Meeting/deadline/commitment changes
route to the main agent for source-backed analysis, never directly to calendar
writes. `unavailable`, `invalid_response`, `cancelled`, and `deadline` mark unfinished
items; callers must not advance ingestion cursors past them. `uncertain` is a valid
review-queue outcome, with retained scores. Neither result creates authorization.

The existing `LocalLayaHttpTransport` supports `batching: 'multi_question'` (default):
at most four messages share one state and multiple choice questions. This is not
SDK multi-state batching. For the project-owned batch server, explicitly inject
`LocalLayaBatchHttpTransport(port, getApiKey)` with `batching: 'multi_state'`.
It uses `/v1/systemone/batch`, keeps each message in its own state, and validates
every echoed request identity before attaching results. A missing batch endpoint
fails visibly; no implicit per-message fallback occurs. Both modes process chunks
serially, with deadline/cancellation and isolated per-item malformed-result handling.

Choice `confidence` from the installed SDK is normalized entropy concentration.
`answer_confidence` is maximum class probability. The service retains both under
explicit names and retains the probability distribution and top-two margin.
`calibrated: false` always applies: no project-specific email calibration dataset
has established correctness probabilities. The default probability/margin gates
(0.7/0.15, configurable) are routing rules, not a claimed accuracy guarantee.
Do not use these labels to silently delete, move, send mail or suppress important
messages. Locally visible grouping is permitted; original content remains intact.

Each result includes a local correction receipt containing source/version linkage,
candidate label IDs, fixed prompt version, context and criteria digests, and the
score/reason fields. No original text or private headers enter the receipt. The
source owner can link user corrections to the same version without publishing
private training data. No training pipeline or measured model improvement is claimed.

The existing intervention service still offers seven genuine labels, including
defer, merge, remind, request decision and AgentArts escalation. These are advisory
intervention choices; no runtime executable-action candidate set is created by
triage, and an uncalibrated `EXECUTE` choice still escalates.

See [`scripts/laya/README.md`](../../scripts/laya/README.md) for the optional local
batch adapter. Compilation and one combined Fake test cover batching, attribution,
partial failures, cancellation and redacted receipts. No model was loaded for this
increment; throughput and real mailbox classification quality remain unverified.

## Concrete action selection

`LayaActionChoiceService(inference).choose({context, candidates, deadline, signal})`
compares 2–16 concrete host-owned candidates. Each supplies stable `id/revision`,
`kind` (`tool/noop/defer/escalate`), approved description, exact source/goal refs,
scope, expiry and risk. Tool candidates include the actual tool name/version and
arguments, their canonical SHA-256 `argumentsDigest`, and a host-provided grant
summary (state, reference digest, same scope/argument digest, expiry). Raw arguments
and authorization references never enter the model payload. `actionArgumentsDigest`
uses the existing ToolGateway canonical JSON convention.

Duplicate IDs, mismatched argument or authorization bindings are rejected. Expired
or unauthorized candidates are excluded; fewer than two valid alternatives yields
`insufficient_candidates` without calling the model. A model chooses an opaque
candidate key which is mapped back to the original ID/revision. All candidates
remain in the receipt; excluded or unavailable scores are `null`, never invented
probabilities. Low-score/low-margin answers and high-risk candidates route to review.
These thresholds are conservative routing rules, not task-specific calibration.

`state: 'selected'` and `eligibleForRuntime: true` mean a low-risk selection can be
considered by the host under its existing permission. They are **not authorization**.
The host resolves the exact selected revision in its immutable candidate registry,
rechecks the real grant and current source/goal revisions, and passes the original
tool/arguments through Runtime/ToolGateway. Runtime is still responsible for
task/run identities, Policy consumption, cancellation and Evidence. A `noop`,
`defer` or `escalate` candidate likewise needs its host-defined handler; this module
does not create schedules or cloud calls from a label.

The receipt includes every candidate reference and digest, context digest, prompt
version, distribution and reason. It can be joined to later local user corrections;
it contains no private source text, tool arguments or usable grant. This provides
traceable decision metadata, not an implemented training pipeline or verified
execution loop. The existing seven-label intervention API remains compatible.

## Interest and knowledge freshness

`decideInterest` and `decideKnowledgeFreshness` provide pure, evidence-bound host
advice. They do not start tracking, grant permission or fetch sources. See
[`docs/interest-policy.md`](docs/interest-policy.md) for revocation, source validation
and cache expiry semantics. No real model, background watcher or next-day freshness
acceptance is claimed.
