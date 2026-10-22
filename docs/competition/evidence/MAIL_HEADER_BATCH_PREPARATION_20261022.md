# 120-mail local header classification — preparation, 2026-10-22

Status: public fixtures and focused local audit tests verified; real Gmail send,
QQ receipt, Laya classification, conversation projection and OS show are **not_run**
in this increment. No private configuration/database was opened and no model or
real mail operation was started by the author.

## Authorization and fixture

The user approved the existing QQ INBOX headers for on-device Laya only: no body
read, cloud header export or mailbox modification. The user separately authorized
the integration owner to send multiple public samples from connected Gmail to QQ.
The runner has no send API. It keeps the former explicit public-only INBOX mode and
adds `approved_local_header_batch`; the receipt records that mode, with no address.
It does not claim the existing inbox is public-only.

Committed manifest:
`tests/manual/connectors/mail-header-batch-20261022.manifest.json`

```text
cohortId: pa-header-batch-ec0d7710-cc70-4026-95b0-d65d8a3493fe
120 cases; meeting/work/subscription/transaction/personal/other: 20 each
```

The classes are interleaved. Every subject is unique within the cohort; subjects
and bodies contain only fictitious public content, no recipient/address, private
person, URL, credential or tool instruction. The checked-in manifest is reproducible
with `createManifest(cohortId)`. A subsequent real send run must generate a fresh
cohort with `node tests/manual/connectors/mail-header-batch-fixture.cjs` rather than
reuse the same cohort. The generator prints only a public manifest and sends nothing.

## Original source and metadata bindings

The auditor derives the following from current production source, without reading
mail credentials or guessing an account namespace:

| Source | Actual binding used locally |
| --- | --- |
| `packages/connectors/mail/src/service.ts`, `messageToItem` | Subject is the suffix after the full-width header separator; optional missing-Date suffix is removed before exact public subject comparison. Body/analysis fields are not searched. |
| `apps/runtime/src/application/inbox-triage.ts` | `messageId = SHA256(JSON([accountRef, folder, externalId, dedupeKey]))` |
| Same pipeline | `sourceRevision = SHA256(JSON([dedupeKey, contentRef, occurredAt === fetchedAt ? null : occurredAt]))` |
| Same pipeline | `recordKey = SHA256(JSON([messageId, sourceRevision]))`; require `latest`, current `heads`, `observed`, private/header-only/mailbox binding, original receipt and classifier fingerprint. |
| Same pipeline | `storageKey = inbox-triage:v1:SHA256(JSON([namespace, labels, sortedMeetingLabels]))`; state is version 2 despite the key's v1 prefix. |
| `apps/desktop/electron/main.js` | Namespace is `${hostNamespace}:qq-inbox:${lowercaseUser}`. It is private and is neither guessed nor exported. |
| `mail-metadata-storage.js` / `encrypted-module-storage.js` | File is `mail-classification.json`, envelope `{version:1, encrypted}`; original host safeStorage decrypts it and original storage `get(key)` reads the matching derived state. No set/delete/encrypt call is made. |

Only exact original-watch `mail.inbox` executions that are confirmed, Policy-allowed
and actually started after `baseline_ready` contribute cases. Each source page is
still limited to 100. Repeated observations of the same message are deduplicated;
two different delivered messages with one public subject fail as duplicate delivery.
An unknown/reconciliation result or erased private copy stops the audit without
replaying a read/send. Metadata namespace ambiguity fails rather than selecting one.

Inside the original Electron host, a read-only safeStorage wrapper captures only
actual `inbox-triage:v1:<sha256>` keys while the original module storage loads its
encrypted map. The auditor reads only matching `records` and binding indexes; it
does not project analyses, header text, message IDs, account names or storage keys.
Only `caseIndex`, `expectedLabel`, `actualLabel`, `route`, `receiptId` and aggregate
counts/confusion matrix/observed wall-time throughput leave this audit. Throughput
includes delivery, polling and classification latency; it is not model-only speed.

## Integration-owner execution handoff

Keep the existing explicit live opt-in, isolated encrypted config copy, Electron
path, watch deadline/interval and complete notification policy inputs. Add:

```powershell
$env:PA_CHANGE_SOURCE = 'mail'
$env:PA_CHANGE_EVENT_PROVENANCE = 'controlled_public_mail'
$env:PA_CHANGE_MAIL_AUTHORIZATION_MODE = 'approved_local_header_batch'
$env:PA_CHANGE_APPROVED_LOCAL_HEADER_BATCH = '1'
$env:PA_CHANGE_MAIL_BATCH_MANIFEST = (Resolve-Path tests/manual/connectors/mail-header-batch-20261022.manifest.json).Path
node tests/manual/connectors/desktop-change-notification-live.cjs
```

The explicit mode represents the already-approved local header scope; it does not
grant a cloud export, body read or write. The runner verifies cloud mail analysis
stays disabled and only approves original, bounded `mail-local-batch` cards without
export requirements. Existing public-only runs can continue using
`PA_CHANGE_PUBLIC_MAILBOX_ONLY=1` without a batch manifest.

The owner waits for `baseline_ready` with the exact cohort ID before serial Gmail
send calls using each manifest subject/body and the separately authorized recipient.
Maintain a local send journal by case index. A send request is not a receipt: an
unknown result must be retained and investigated without resending that case.
Absence from QQ is not proof the send failed. This code does not send, retry or
reconcile Gmail operations. Do not publish recipient or provider body/header data.

The runner continues after the first notification until all 120 cases have real QQ
receipts and corresponding durable local classification receipts. More than 100
matched cases across at least two bounded pages are required. Delivery timing can
produce many small pages; no claim of an actual 100+20 arrival split is inferred.
Independently, a cohort event must retain its exact original source identity, real
Laya decision receipt, succeeded original main-conversation projection and native
show Evidence for that event's same interruption round. A private unrelated email
or a different event's conversation cannot satisfy this cohort's show gate.

No notify choice or label is forced. Null labels/review routes remain null/review
in the matrix. In particular, production `other` commonly abstains to review, so
it must not be rewritten into a correct `actualLabel=other`. After complete receipt
collection and the original stop/closed-SQLite gates, any review or disagreement
produces `completed_with_classification_review`, exit 1, not a blanket pass. An
incomplete cohort, missing native show or expired deadline is a failed required
gate. SIGINT/SIGTERM closes only this isolated application; stopping never grants
a new read or replay. The original stop-and-no-future-reads gate remains mandatory.

## Focused checks

```text
node --test tests/manual/connectors/mail-header-batch-audit.test.cjs apps/desktop/test/connector-live-runner.test.mjs
9 passed / 0 failed / 0 skipped
node --check tests/manual/connectors/desktop-change-notification-live.cjs
git diff --check
```

The fixtures cover 120 synthetic confirmed items in two pages, extra private
sentinels, exact original-event matching, missing/stale classification, ambiguity,
duplicate delivery, unknown-result fences and the original encrypted storage API
using an explicitly fake safeStorage codec. Both synthetic SQLite and encrypted
fixture bytes remain unchanged by the audit. These prove audit behavior and privacy
projection only; they do not prove Gmail delivery, QQ access, a real Laya model,
native OS delivery, physical human view/click or completion of the real batch.
