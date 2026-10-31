# F06/F07 configured business workers — 2026-10-31

Profile: `huawei_ict_agentarts`. Worktree: `.worktrees/pr531-business`, branch `codex/pr531-business-20261031`.
This is a reviewable wiring increment, not full IMAGE28 or PR #531 acceptance.

## Production composition

`createBusinessWorkflowWorkerPorts()` in `apps/desktop/electron/business-workflow-worker-ports.js` returns
`{tools, hosts, configuredWorkflowWorkerPorts, unavailable}`. The configured ports deliberately omit `image`;
the root AgentArts composition must supply its real pinned image binding. Main wiring is owned by the integration branch.

Required constructor inputs are `runtimeModule`, lazy `getApplication`, original `businessTools`,
original `competitionToolExports`, the existing `prepareCompetitionToolExport`, `authorizeExport`, and
`readBusinessAvailability(workflowId, scope) -> {ready, bindingId}`. F06 additionally uses the original Todo and
notification application hosts. An absent dependency/export policy leaves the corresponding worker unavailable.
The availability binding is pinned to the original task/deadline and rechecked on every frontier, host action and completion.
No production callback defaults to granting permission or to a Fake provider.

- `workflow.business.f06`: fixed `{todoTitle, remindUtc, due?}` request. Its original `todo.create` child crosses
  Policy independently, and N03 now returns the actual `revision` needed by N04. N03 retains the original item and schedule identity.
  N04 accepts the scheduler's single `revision + 1` transition only when the entire item is the exact
  `applyReminderDispatches` result, the original schedule fired successfully, and its original durable notification round
  has a confirmed banner receipt. Edits, cancellation, rescheduling, an unrelated delivery or unknown delivery fail closed.
  N05 reconciles that original notification; it never sends again. The completion result is currently `{todoId, delivered: true}`.
- `workflow.business.f07`: fixed `{title, slot: {startUtc, endUtc, location?}, calendarReadArguments: {fromUtc, toUtc, limit?}}`.
  The original complete calendar window, semantic decision, exact freshness receipt, slot overlap check and original creation
  receipt are all required. Freshness executes three distinct read actions (execution, before export, after export).
  The creation has its own Policy child; completion rereads its original execution/arguments/Policy evidence and provider result.
  The result is `{eventId, eventCreated: true, externalInviteHeld: false}`. The bounded window version is not an account-wide
  atomic concurrency lease and does not claim to eliminate a concurrent external write after the last read.

Cloud node states cannot replace original receipts. Required predecessor and completion nodes need their exact original tool
receipts, including the semantic decision. Direct business writes proposed by the image are rejected; only fixed trusted host
action mappings may submit child business tools. Unknown original child results are retained without replay.

## Original authorization and export path

The factory lazily constructs `createWorkflowBusinessToolBridge` with the actual RuntimeApplication instance, preserving its
execution-guard identity. It uses `readConfiguredWorkflowBinding`, not a guessed configured-worker checkpoint namespace.
Before any graph receipt export it invokes the corresponding original host's `authorizeReceipt`, where present.
Original business tool results separately consume their existing export binding:
`preflight accepts -> prepare projection -> project -> exact projection equality -> final accepts`.
The graph export callback then applies its separate exact-payload permission.

The integration branch's `prepareWorkflowHostPreflight` is copied unchanged from `b5c1130b` (helper and tests only; no Main edits).
Its same helper is exercised by both Runtime integration tests. Connector dependency `01ad0980` is cherry-picked as `4fa21508`;
the integration branch already has that change and must not duplicate it.

Todo's `question-todo-bounded-v3` adds only the original succeeded Host result path: it verifies command/tool/version/run,
deadline, original arguments and exact confirmed result, then calls the existing `assertConsumedResult('todo-session')`
and `authorizeConsumedExport('todo-export')`. Running execution/export checks stay unchanged. It does not reopen a task or grant a tool.
Existing saved task receipts/descriptors are not rewritten; an old incomplete binding never gains relaxed revision handling.

## Verification

- Full `npm run check`: exit 0, 6,544 tests, 6,499 passed, 45 skipped, 0 failed. Includes Desktop 2,328 tests
  (2,315 passed, 13 skipped), Runtime and the 57 cross-module integration checks.
  Log: `.cache/pr531-business/business-worker-full-check.log`.
  This full run preceded the final confirmed-Todo-export change and the imported connector/preflight dependencies.
- Final affected tests after those changes: 61/61 passed.
  Log: `.cache/pr531-business/business-question-final-tests.log`.
- Final architecture check: exit 0, 3/3 passed.
  Log: `.cache/pr531-business/business-question-architecture.log`.
- Runtime build and `git -c core.whitespace=cr-at-eol diff --check` passed. The whitespace flag preserves tracked CRLF files.

The final F06 integration uses actual delegated Runtime, SQLite, Policy, AuthorizationQuestions, original preflight,
Todo storage, scheduler, notification application host and durable notification port. Only image, semantic inference and
native show events are explicit fixtures. The clock is never advanced: a genuinely elapsed reminder is created, its real
schedule fires, its revision advances once, and an extra tick causes no second delivery. The original confirmed Todo result
can be projected again without execution; substituted results/commands and revoked resource generation are rejected.

The final F07 integrations use actual delegated Runtime, configured worker, Policy, original preflight,
connector conversation wrapper and AuthorizationQuestions. The calendar provider, image and inference are explicit fixtures.
The success case independently approves four calendar reads and one creation and consumes their real wrapper export policies.
Additional cases verify denied child approval (zero writes), unknown original write (one attempt, no success continuation),
and denied original child export (retained write, no graph success).

## Remaining acceptance and next increment

No real CalDAV account, AgentArts deployment/evaluation or actual OS notification has been accepted by these tests.
No real email was sent or archived. The exact integrated PR head still needs its complete required CI and real-service acceptance.

At this increment F06's template still makes N05 unconditionally required, so future reminder requests fail before creation
with `UNSUPPORTED_CAPABILITY`; they do not simulate a clock or report delivery. The next separately authorized F06 increment
will add a truthful scheduled branch using the existing persistent scheduler, distinguishing `scheduled` from `delivered`
and testing later delivery/cancellation/edit/recovery. It will not keep the original graph alive past its deadline or add a scheduler.

F08/F11/F12 configured workers, optional question/deferred/replan branches and their real-service acceptance remain separate
unfinished work; their existing host/port increments do not by themselves make the full graphs available or PR #531 mergeable.
