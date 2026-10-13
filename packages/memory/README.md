# @personal-agent/memory — provisional queries and fact feed Fake

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

This provisional Competition Profile package defines the first in-process
`MemoryQueryPort` slice: current effective facts, bounded history, exact immutable
versions, and an explicit `FakeMemoryHost`. It is not a wire protocol, production
database, Local Profile extension, or proof that Memory is available.

The trusted host provisions and binds a namespace. Binding requires an explicit,
non-empty enumeration of allowed sensitivities; no ordering such as “restricted
implies private” is inferred. The returned consumer port has no namespace, scope,
writer, task, scheduler, credential, or cloud method. Hidden and nonexistent exact
FactRefs produce the same fixed `SCOPE_DENIED` result.

Facts use stable ID/revision, source, canonical UTC observation and half-open validity,
sensitivity, active/withdrawn state, confirmation origin, and an exact correction
reference. Summary text is bounded to 4,096 characters and source references to 1,024.
Revision history is append-only inside the Fake. A withdrawn latest version is not
replaced by an older active version; a hidden latest version likewise does not expose
an older visible value as current.

`listCurrent` and `listHistory` return isolated copies with random opaque snapshot and
cursor tokens held only by the Fake host. Tokens bind namespace, exact scope set,
query kind, filter and watermark. New versions cannot appear in an older snapshot.
There is deliberately no default retention/expiry policy; unknown, mismatched or
cross-scope tokens are rejected uniformly. These in-memory tokens do not survive a
process restart and are not evidence of a persistent cursor implementation.

`readFactForImpact` is the minimal pure consumer: it requests one exact `FactRef`
through the public query port, verifies that reference and returns an isolated copy.
It assumes a conforming typed port and does not fully revalidate arbitrary hostile
port output. It does not import a
storage implementation, create tasks, modify a Goal graph, schedule work, execute a
tool or send data to AgentArts.

Malformed Fake inputs, including throwing getters or proxies, are reduced to the
same fixed validation error. This is fixture-boundary hardening, not a host-process
security sandbox.

Build and test this package directly after workspace dependency setup:

```powershell
npm.cmd run build --workspace=@personal-agent/memory
npm.cmd run test --workspace=@personal-agent/memory
```

The workspace is registered in the root build order and lockfile without adding
external dependencies.
The provisional `FactChangeFeedPort` adds host-bound, bounded bootstrap/change
batches without exposing internal sequence numbers. A reader has no ack method;
confirmation belongs to the trusted host and must match the complete delivered
batch and checkpoint. `parseFactChangeBatch` validates the fixed envelope and
isolates its references; it does not prove processing or advance consumption.
The Fake increment exercises protocol semantics only. The optional
`@personal-agent/memory/sqlite` entry now persists immutable fact versions, opaque
query snapshots/cursors, pending feed batches, checkpoints and idempotent receipts
in a dedicated SQLite database. It uses `@personal-agent/storage` migrations and
must not share a database file with another independent migration sequence.

Migration 2 adds a trusted-host mapping for explicitly imported public-demo sources.
`readPublicSourceHead` and `appendPublicSource` bind a stable source identity to the
current exact FactRef. The append, feed event, sequence and mapping share one SQLite
transaction; repeated current revisions return the stored fact without a new event.
Stale proposals fail with `REVISION_CONFLICT`. Source-owned facts cannot be changed
through ordinary `append`. These host methods do not register a Runtime capability
or authorize private data or cloud transfer.

Migration 4 adds a content-free operation receipt for host-only `reviseUserFact`.
After the trusted caller obtains user authorization, it supplies an exact head revision,
operation ID, user-action source reference and full next fact fields. A correction or
withdrawal appends one `user_confirmed` version and feed event in the same transaction
as the receipt. Exact retries return the saved version; stale heads or altered retries
fail. Public-source-owned facts require a separate source ownership decision and are
rejected here. Physical fact erasure removes these receipts with the fact. This port
does not authenticate a user or expose a Desktop/Runtime capability.

Migration 5 adds a content-free operation receipt for host-only `createUserFact`.
After the trusted caller confirms one private excerpt, this method appends its first
`user_confirmed` fact and feed event atomically. Exact retries return revision 1;
altered operation IDs or existing fact IDs cannot overwrite a fact. Physical fact
erasure removes the creation receipt. No Vault text is imported automatically.

Host-only `listUserFactHeads(namespace, request)` lists the latest user-confirmed
private heads, including withdrawn and expired records, so an admin can still find
and physically delete them after restart. It reuses bounded opaque snapshot/cursor
pagination; its tokens cannot be used with consumer queries or another namespace.
It never falls back to an older private head. Erasure invalidates affected admin
snapshots. `MemoryQueryPort.listCurrent` remains limited to effective active facts;
the management listing does not grant task consumption or cloud permission.

`withdrawPublicSource` records an append-only public tombstone with an expected Fact
revision and an idempotent withdrawal ID. The caller must first verify source removal
through its trusted source adapter and obtain authorization for that source; search
failure or an unavailable vault is not withdrawal evidence. The tombstone, feed event
and source mapping commit together. A later verified source revision may reactivate
the same Fact ID as a correction. The method is host-only, not a connector or wire
operation.

This adapter is not registered as a Runtime capability and does not make the ports
`frozen`. Its confirmation transaction covers only the memory-owned delivery journal;
Goal/cognition projection and feed confirmation are not yet one atomic host
transaction. Host-only `eraseUnboundFact` removes all versions and public-source
mapping for an exact head only when the namespace has never had a feed binding;
an empty deletion marker prevents reuse of the same fact ID. It invalidates
only query snapshots that contained the fact and rejects bound
namespaces. Host-only `beginFactErasure` records a durable pending intent for a
bound fact. It hides the fact from Memory queries and new feed reads, rewrites
mixed deliveries entry by entry, and keeps unrelated checkpoints. The fact's
  rows remain until Runtime projections are handled. A trusted
  consumer can read the revised durable delivery by exact token and atomically
  replace an unactivated Runtime staging record before replay. Host-only
  `completeFactErasure` accepts the matching durable Runtime receipt after its
  graph cleanup, checks that no target feed entry survives, and deletes all
  target versions and public-source mapping in one Memory transaction. Its
  `completed` marker describes the active Memory database, not user-level
  deletion. The SQLite host verifies `secure_delete=ON` and requires a successful
  `TRUNCATE` WAL checkpoint after the purge; a busy checkpoint is retryable with
  `STORAGE_UNAVAILABLE`. Older free-page traces and backup copies remain outside
  this guarantee. Retention/backup policy, real ingestion and production cognition/Runtime
projection remain unavailable. See
[ADR-0008](../../docs/adr/0008-fact-feed-consumption.md) (proposed) and
[ADR-0010](../../docs/adr/0010-memory-erasure.md) (proposed) and
[MOD-09C](../../docs/modules/MOD-09C-MEMORY-SQLITE-01.md).

For an isolated unbound namespace, `resumeCompletedErasureMaintenance(namespace)`
checks committed deletion markers for surviving fact/source/confirmation rows and
retries the WAL truncation after restart. It does not complete pending cross-store
erasures or manage backup copies. A busy reader keeps the call unavailable.

Feed transactions check cancellation/deadline after acquiring the write lock and
immediately before commit. Expired or cancelled work rolls back; a committed
confirmation returns its durable receipt. Synchronous SQLite lock waits cannot
be interrupted immediately. Recovery tests cover a second-process writer and
injected receipt-write failure without using private user data.
