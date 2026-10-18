# MOD-27 Goal graph domain core

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Owner: zemeng. Provisional offline increment for the Competition Profile, based on
5944061 (domain slice merged in PR #37 as 41ea79d). No cloud access or runtime task transitions.

`createGraph(namespace)` creates an empty graph. `appendVersion(snapshot,
expectedRevision, node)` validates and returns a copied snapshot. Each Fact, Goal,
Decision and Plan carries provenance, validity, sensitivity, state and revision.
Dependencies refer to already recorded exact node versions. Thus the version graph
is acyclic; corrections do not silently move existing decisions to new facts.
Reusing an ID cannot change its kind. Withdrawal appends a version and keeps history.

`parseGraph` validates ordered history for JSON round trips. `graphAt` returns an
isolated historical snapshot; restore content through a new append to retain audit
history. `currentNodes` includes withdrawal records. `isEffective` evaluates the
half-open validity interval. These functions do not infer that claims are true.

For trusted physical erasure, a snapshot may also carry `erasedGraphRevisions`:
an ordered list of content-free missing graph positions. Legacy three-field
snapshots remain valid. Surviving nodes retain their exact revisions;
`graphAt(oldRevision)` returns the original time boundary without erased nodes,
and later appends continue above the prior revision high-water mark. The parser
rejects unaccounted gaps, duplicates and reused positions. Only a trusted host
may persist an erased graph; parsing one is not deletion authorization. This
provisional cross-module change requires the Goal owner's semantic review.

The pure expectedRevision check alone is not a concurrency lock. The provisional
`@personal-agent/goals/store` port and Fake now allow a host-bound namespace;
Runtime supplies atomic SQLite persistence using its existing database. Only the
trusted host can provision/bind stores. Namespaces alone are not user authorization.
MemoryQueryPort and FactChangeFeed now have provisional offline providers and a
recoverable projection; production automatic consumption and real fact sources
remain unavailable. See
[COORDINATION-STORE-01](../../docs/modules/COORDINATION-STORE-01.md) for semantics,
migration, synchronous-call limitations and acceptance.
MOD-28 will consume the explicit dependencies to analyze impact and repair plans.
Historical snapshots do not undo any external side effects.

Run `npm run test --workspace=@personal-agent/goals` and
`npm run typecheck --workspace=@personal-agent/goals`. Tests use synthetic in-memory
meeting data. The test script builds this new package because the root build list
now includes goals and cognition after PR #37. No third-party dependency is added.
Live AgentArts/consumer composition remains an integration handoff.

## Atomic store extension (provisional)

`@personal-agent/goals/store` additionally exports `AtomicCoordinationStorePort`,
which extends the unchanged `CoordinationStorePort` with
`appendBatch(expectedRevision, inputs)`. A nonempty ordered batch is validated
completely before one atomic replacement; invalid nodes or a revision conflict
must leave the durable snapshot unchanged. Each appended node still receives its
own graph revision, and later batch nodes may reference earlier batch versions.
`appendVersions(snapshot, expectedRevision, inputs)` performs the same operation
on an isolated in-memory candidate only. It is not a storage transaction.

The Fake bound store implements the extension; the Runtime host supplies the SQLite
transaction adapter. Old `read`/`append` providers remain valid, but consumers needing
atomic repair must require the new interface and must not emulate it with sequential
writes. No wire operation, authorization, database migration or cloud access is added.
This is synchronous small-graph storage, not an asynchronous cancellable execution
API or evidence that the proposed repair is semantically correct.

## Host-bound goal commands (provisional)

`@personal-agent/goals/commands` offers `createGoal`, `reviseGoal`, `getGoal`,
and `listGoals` for a host that already provisioned and authorized a bound
`CoordinationStorePort`. The host supplies a stable goal ID, `sourceRef`,
explicit validity, sensitivity, reason, and exact dependencies. Creation
rejects any reused ID, including a withdrawn one. Revision requires both
the graph revision and the current goal revision; the store's commit-time CAS
still decides a concurrent write. The write receipt contains the exact prior
Goal reference (or null on creation), the committed Goal version, and graph
revision so MOD-28 can analyze the persisted change. This is not a durable
event stream. A conflict is returned as `GraphError`
with `REVISION_CONFLICT`; the caller must reread and seek a fresh edit.
For MOD-28's provisional `selectGoalRevisionImpact`, a successful `reviseGoal`
receipt maps to `expectedGraphRevision: graphRevision`,
`previousGoal: previous`, and `currentGoal: {id: goal.id, revision: goal.revision}`.
The `previous` field is typed as non-null on revision. Goal creation has no
previous version and does not use that revision-impact selector.

`getGoal` returns one Goal or null without exposing unrelated graph nodes to
the caller. `listGoals` returns the latest version of each goal, including withdrawn
goals, with the graph revision. It can read an earlier graph revision without
changing current state. Commands preserve each source and all prior versions;
they do not establish that a source is authentic, authorize a user, delete
private history, or automatically repair dependent decisions. The Runtime and
Desktop user command/query path remains a separate integration task.

## Goal write tools (provisional)

`@personal-agent/goals/tool` exports `createGoalTools(boundStoreOrResolver)`, returning
`goals.create` and `goals.revise` `RegisteredTool` values (version `1.0.0`,
scope `goals:write`, `local_write`). The trusted host can pass an already bound
store or a callback that returns one stable, user-bound store after Runtime
construction. Registration does not call the callback; a missing or changed
store fails closed at execution. The host
binds the same graph used by its `hostUserNamespace`, generates or verifies `goal.sourceRef`,
and passes complete arguments through Runtime's host tool task and Policy.
Tool arguments contain no namespace. Renderer must not construct a store or
choose a namespace/source reference.

Inputs are `{expectedGraphRevision, goal}` for create and
`{expectedGraphRevision, expectedGoalRevision, goal}` for revise, where `goal`
is a complete `GoalInput`. An applied result contains `graphRevision`,
`previousGoal` (null on create), and `currentGoal`, after reading the committed
historical version back from storage. A stale write returns `kind: 'conflict'`
and the current graph revision; an invalid, confirmed no-write input returns
`kind: 'rejected'`. Unexpected write or readback failures remain unknown to
Runtime for reconciliation. The tool does not retry an uncertain write.

This package does not expose a host task or approval entrypoint itself.
Runtime's host tool task is currently a separate integration PR, and real
Desktop user writes need its review, composition, and one target-chain readback.
The current RuntimeApplication constructor registers descriptors without executing
host tools; Desktop must bind the store before exposing host commands or resuming
an approved task.
