# Cloud business completion — local integration handoff

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Status: review; Competition Profile business source ports. This is source delivery, not a product/AgentArts/real-account acceptance claim.

Initial checkout: origin/main 7ede5f5b0072870932653df6347009ab77a35f43. Delivery parent updated to current origin/main 3ed97516195ed490b3662fa98ce7ed7720e92527; its intervening changes do not overlap owned files. PR230, PR253 and PR256 were checked as merged and their current source inspected. Work branch: codex/cloud-mvp-business-completion. P8 source inspected read-only at origin/codex/zemeng/p8-mvp-final-integration 1431595c30e3580cfa892f0596c2cb3c7c934e44. No Desktop or runtime application files are changed here. P8 owns Desktop consumption, P5 owns classification/Laya, root owns integration and local acceptance.

## Public ports and consumers

| Package export | Call / result | Consumer and required binding |
| --- | --- | --- |
| @personal-agent/mail: register | mail.fetch_inbox(account?, folder?, cursor?, limit?) returns existing InboxPage / ConnectorItem; scopes mail:read | P5/P8 consume stable ascending UID pages. Cursor is uidValidity:lastUid. Epoch changes return CURSOR_EXPIRED, not an empty successful page. Date fallback is labeled; header projection stays private. Message-ID is normalized by existing provider into the existing dedupeKey, without adding fields to ConnectorItem. |
| MailService.fetchInbox | fetchInbox(accountRef, {folder?, cursor?, limit?, signal?}) | Source polling; actual last returned UID determines cursor even when provider overfetches. No classifier/model is installed here. |
| mail.mark_seen | {account?, folder, uid}; scope mail:write | P5 routes its own approved classification result to this tool through ToolGateway. Uses context.runId; IMAP flag readback required. |
| mail.save_draft | {account?, to, subject, text}; scope mail:draft | Registered only for providers exposing saveDraft. P5 supplies draft content; QQ uses in-memory MIME composition and IMAP APPEND, never SMTP. Runtime must persist action/input binding and block unknown writes. recoverySupport=false intentionally. |
| mail.reconcile_send | {account?, messageId, idempotencyKey}; scope mail:read | Service checks its original send record and/or trusted provider identity binding before reconciliation. QQ also checks key/Message-ID before any IMAP access. Exact Sent envelope Message-ID confirms only that bound send; absent/fuzzy match remains unknown. No send retry is performed. |
| MailProvider / MailAccountRegistry | optional saveDraft(accountRef,input,context?), assertSendIdentity(accountRef,messageId,idempotencyKey), reconcileSend(accountRef,messageId,idempotencyKey); markSeen(accountRef,input,context?) | Context adds signal/deadline/trusted now without changing existing two-argument write callers. Reconciliation callers must now pass the original key; without an original record or identity check the capability returns UNSUPPORTED_CAPABILITY. QQ reports unknown send with deterministic Message-ID retained in ConnectorAction.externalId. |
| @personal-agent/calendar: CalendarService | refreshKnownItems(accountRef, previousConnectorItems) returns changed current ConnectorItems | P5/P8 persist known UID baseline and route changes through existing fact/event ports. Explicit cancelled event is delivered; NOT_FOUND is not silently inferred cancellation. Calendar list validates progressing pages. |
| CalDavProvider | existing list/get public provider methods | Selects one UID version by SEQUENCE, then LAST-MODIFIED before window filtering; conflicting same version errors. Existing timezone conversion retained. RECURRENCE-ID requires an instance-aware public identity contract and returns UNSUPPORTED_CAPABILITY. |
| @personal-agent/feeds: register / FeedService | isPaused?(subscriptionId), trackRevisions? | Trusted host supplies persisted pause state; pause rejects before/after fetch without advancing caller cursor. Default revision mode remains off for existing callers; P8 must opt into trackRevisions=true for changed GUID delivery. Save nextCursor only after accepting the page. |
| @personal-agent/research: ResearchService | existing search/material projection and cache metadata | Actual provider completion time is recorded, cache invalidates on TTL/clock rollback, cancellation cannot return cache success or write a late response. Existing real provider/source attribution retained. |
| @personal-agent/weather: OpenMeteoProvider | options geocodeCacheTtlMs?, now?; default TTL 24h | Geocode cache expires separately from existing forecast cache. Existing observation/source/fetch projection retained. No paid service added. |
| @personal-agent/notifications: NotificationService | drain(), acknowledge(batchId), planSchedules(conversationId) | Quiet/pause applies to unacknowledged batches after restart, IDs retained. Host acknowledges only after actual delivery; optional deliveredAt records first receipt. Pause-end schedule uses run_once. |

All new mail tool outputs reference existing protocol/1.0.0 ConnectorAction. No root protocol, manifest, lock, migration, model or agent change. Existing action evidenceRefs in older mail methods are labels, not automatically valid persistent Runtime Evidence IDs; the trusted runtime must create/read actual evidence. New draft actions use empty evidenceRefs until the trusted runtime supplies evidence.

2026-09-30 final mail repairs: arbitrary Message-ID A plus original key B is rejected with INVALID_ARGUMENT before Sent transport, both with service records and after service/provider recreation via QQ deterministic identity. Missing identity capability remains unsupported. Write ToolContext flows through Service/Registry into QQ: connect/list/lock/search/envelope/MIME await continuations and synchronous APPEND/STORE entry check cancellation and deadline. Acquired locks are released on prewrite rejection. Once APPEND/STORE has started, readback can still confirm; APPEND disconnection stays unknown with same-key replay, and unverified STORE returns RESULT_UNKNOWN with retryable=false. This does not add IMAP command interruption, persistent mail records, SMTP calls or protocol Schema fields. Prepared offline cases were added to existing cloud-business.test.mjs; final repair validation is syntax/diff only, no build/npm/test or real-mail calls were run.

## P7 / P8 Feed source binding and citations

Public package exports from @personal-agent/feeds:

- FeedSourceReceipt, FeedTransportReceipt, FeedItemCitation (types).
- feedConfigBinding(subscription: {id, url, sensitivity?}, source: string): string.
- feedItemContentSha256(item: {record: ConnectorItem, title, summary}): string.
- assertFeedSourceReceiptMatches(receipt, page: {items}, binding: {subscriptionId, configBinding}): void.
- readFeedTransportReceipt(providerResult): FeedTransportReceipt | undefined (same-process original object identity only).
- FeedService.readSourceReceipt(subscriptionId): FeedSourceReceipt | undefined (last full-body page, cloned, volatile; restart requires recollection).
- CollectResult.sourceReceipt?: FeedSourceReceipt, declared in the formal feeds.collect output Schema. It is an optional additive module output contract, not a private wire or a modification to ConnectorItem. P7 must consume this exported contract; root must coordinate any CloudKnowledge contract changes outside this owned package.

The receipt records providerId=http-feed-provider-v1, record.source, subscriptionId, an opaque SHA-256 configBinding, declared sensitivity, publicFetch, sourceRevision (SHA-256 of decoded fetched document), contentSha256 (SHA-256 of ordered per-item hash array), transport and citations. Each citation binds existing externalId/contentRef to sourceRevision/contentSha256. Item hash tuple is [source, accountRef, externalId, occurredAt, contentRef, dedupeKey, title, summary]. Binding tuple is ['feed-config-v1', source, trimmed subscription ID, normalized URL.href, trimmed sensitivity or existing public default]. These are change/integrity hashes, not signatures or access grants.

P8 construction and consumer sequence:

1. Instantiate the real HttpFeedProvider with its native default fetch, from trusted subscription configuration; register(provider, subscriptions, isPaused, trackRevisions:true). Do not override the provider with a fixture in production. P8 host-only source binding getter computes feedConfigBinding from that same actual configuration and provider.source; never returns URL or credentials.
2. Runtime executes the already registered feeds.collect through Policy/ToolGateway. Obtain the exact returned page and sourceReceipt from this trusted execution path. A JSON receipt supplied by renderer, model, remote result or a provider label is untrusted. The validator checks integrity only and cannot authenticate arbitrary JSON.
3. Compare subscriptionId/configBinding to the current host binding and call assertFeedSourceReceiptMatches on the exact page. For PUBLIC ingestion additionally require receipt.publicFetch=true, nativeFetch=true, credentialFree=true, declared sensitivity=public, and an independently issued native once-PUBLIC grant. Tracking requires its own current native tracking grant bound to that same source configuration. Getter/source facts never grant permission; sessionAllowed=PUBLIC is not a substitute.
4. Pass per-item citations and original transportFetchedAt to CloudKnowledge through its coordinated public port. transportFetchedAt is actual HTTP completion wall time, independent of the injected service clock and feed publication time. Do not relabel cloud HTTP reads as local Desktop observations. If CloudKnowledge lacks the typed receipt/grant port, it stays unavailable until root/P7 connects it; do not create a parallel private DTO.
5. Persist accepted source receipt/cursor in the trusted host if needed. A 304 returns no new sourceReceipt; readSourceReceipt retains the prior full-body receipt and its original timestamp. Do not regenerate citations/time from 304, display an old receipt as fresh, or export an empty 304 as newly observed content. Each paginated full-body response cites only its returned page; consumers aggregate pages explicitly.

publicFetch=true is emitted only for native credential-omitting HTTPS fetch with credential-free URLs at every redirect hop and a subscription declared public. Capability/query/fragment URLs, literal IP/private-host labels, injected transport and private declarations cannot prove publicFetch. This package does not resolve DNS to certify network address ranges; subscription endpoints remain trusted host configuration. No credentials/session tokens or raw configured URL are included in the receipt. Content projection scrubs configured credentials and session-bearing embedded URLs; secret-bearing response validators are dropped. Credential-bearing redirects are rejected; a private host-managed transport is required for those sources. This does not declassify private content or establish legal/public ownership of content.

## Local acceptance entry points (prepared, not run in cloud)

Use the repository's required Node/npm versions and existing root dependency workflow. The following scoped commands are for the root's LOCAL workspace only:

~~~sh
npm run build --workspace=@personal-agent/storage
npm run build --workspace=@personal-agent/contracts
npm run build --workspace=@personal-agent/client
npm run build --workspace=@personal-agent/testkit
npm run build --workspace=@personal-agent/mail --workspace=@personal-agent/calendar --workspace=@personal-agent/feeds --workspace=@personal-agent/notifications --workspace=@personal-agent/research --workspace=@personal-agent/weather
npm run test --workspace=@personal-agent/mail --workspace=@personal-agent/calendar --workspace=@personal-agent/feeds --workspace=@personal-agent/notifications --workspace=@personal-agent/research --workspace=@personal-agent/weather
~~~

Each affected package has test/cloud-business.test.mjs alongside its existing tests. Fixtures are explicitly offline, not production fallback. Cases cover mailbox epoch/order/progress, draft APPEND unknown/no resend/exact readback, scope discovery, CalDAV UID/timezone/cancellation, Feed revision/304/pause and receipt tamper/private/injected transport checks, restarted notification quiet/pause/receipt, research completion/TTL/cancel and geocode TTL/key collision. Root should run existing tests too and fix concrete failures, then its cross-package acceptance as coordinated.

Actual cloud verification: source/interface inspection and full diff review; git diff --check. Before the latest user instruction prohibiting cloud builds, a narrow dependency install (ignore scripts, no lock write) and storage/contracts/client/testkit builds completed. Mail build then found a sideEffect enum and MIME Buffer union error; source corrections were made, but no rerun is claimed. No unit/integration/smoke, supplier trial, model benchmark, GUI or final module build was run. No real email was sent. Runtime evidence/Account/AgentArts verification is not claimed.

## Root-owned follow-ups and unavailable inputs

- Real CalDAV URL/account credentials and QQ IMAP/SMTP authorization code are absent here. Providers remain unavailable when host configuration is absent; no Fake account is injected. Readback of cancellation, timezone, real mailbox paging/draft and sent reconciliation requires authorized LOCAL accounts. Actual external send requires a separate real-user send authorization.
- Public HTTP weather/research/feed providers are source implemented; latest instruction forbids cloud vendor calls. Network and real source acceptance remain LOCAL. Desktop notifications, wake/sleep timer handling, persistent grants and restart wiring are P8/root owned; model CPU/native Windows/microphone acceptance is root owned.
- The requested packages/connectors/todo directory does not exist on this baseline; actual todo public service is packages/productivity, outside the explicitly enumerated ownership. Existing create/update/cancel/reminder ports were inspected, not rewritten. Root patch for packages/productivity/src/triggers.ts applyReminderDispatches: ignore items whose status is not open before marking reminder fired; dedupe IDs within one dispatch batch before updates so duplicate refs do not create multiple updates. Add local tests for a cancelled item receiving an old dispatch and duplicate refs, while retaining the existing scheduled state and reminderScheduleId timestamp match. P8 must persist reminder state and use existing run_once trigger/recovery, rather than rebuild it here.
- PR253 manual audit was rechecked against fresh main before publication: PR265 (9efbf8a) has already corrected the trailing slash regex, wrapped StructuredToolProvider in ModelGateway and replaced the direct raw tool path with Runtime Application/Policy/ToolGateway and persistent evidence readback. Those original audit leads are therefore no longer open source patch requests on delivery main. No duplicate model/manual fix is included. Live model/API acceptance remains unrun.

No private data, DB, userData, secure storage or local machine files were read/uploaded. No root shared manifest/lock or application file was changed. Author delivery remains review; root performs coordinated review, integration and merge.

Root-owned minimal reminder patch (apply locally, not applied by this branch):

~~~diff
--- a/packages/productivity/src/triggers.ts
+++ b/packages/productivity/src/triggers.ts
@@
   const updated: TodoItem[] = [];
+  const processed = new Set<string>();
   for (const dispatch of dispatches) {
     for (const item of items) {
+      if (item.status !== 'open' || processed.has(item.id)) continue;
       if (!item.reminder || item.reminder.state !== 'scheduled') continue;
       if (reminderScheduleId(item.id, item.reminder.remindAt.utc) !== dispatch.scheduleId) continue;
+      processed.add(item.id);
~~~
