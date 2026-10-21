# Unified conversation authorization — Issues 474/475

Profile: `huawei_ict_agentarts`. This is an integration work package, not a completed product/platform acceptance report.

## Host-only compatibility contract (provisional)

The existing Runtime, TaskRuntime database, Policy and ToolGateway remain authoritative. No second task store, scheduler, model harness or authorization service is introduced. `AuthorizationQuestions` stores bounded decision/rule metadata through the existing `trusted_host_state` complete-value CAS port. It issues decision receipts, not execution grants.

`AuthorizationQuestionRequest` binds task, proposal, run, tool/version, arguments digest, original deadline and each independent tool/export/connector requirement. Trusted Main supplies the selected sandbox reference/revision and original configuration identities. Renderer receives a safe view and submits only `{questionId, expectedRevision, decision}`. The once/permanent/deny decision is checked against the same original proposal while legitimately waiting for approval. Actual execution requires a separately issued, exact Policy grant and the original running state; it does not treat waiting as permission to write.

The question's answer window is bounded by the earlier approval TTL/original deadline. An accepted decision is not silently invalidated merely because that answer window later closes: further result use remains bounded by the original operation deadline, profile revision, resource generation and confirmed execution. Each actual Policy grant retains its own effective expiry and one use. Permanent rules match stable tool/scope/resource/configuration-generation/projection identities; transient task/run/deadline/arguments bindings belong to each newly derived grant. Missing stable resource rules disable permanent matching rather than treating a global boolean as consent.

Private Desktop IPC:

- `authorization.question.respond({questionId, expectedRevision, decision})`
- `authorization.sandbox.read()` and `.select({profileRef, expectedRevision})`
- `authorization.rule.revoke({ruleId, expectedRevision})`

The existing Core approval wire remains unchanged. Legacy session-allow IPC is rejected in the new composition. Credentials and real external account login/configuration remain separate from application permission.

## Original task and batch lifecycle

Runtime creates the original approval, enters `waiting_approval`, awaits the trusted question host, revalidates the original invocation and derives the one-use Policy grant before continuing that same worker. The public authorization response cannot race a host-owned pending question to mint a second grant. Expiry, cancellation, restart or stale configuration resolves the original waiting state through Runtime; unknown prior execution remains `waiting_reconciliation`.

Mail batch derivation is restricted to the existing `MailReadSessions`. The first question states the fixed account/folder/query, actual per-page limit, unknown total count and original expiry. A later page requires the same original session checkpoint and current-page membership, original namespace/account/folder/limit/deadline, the first consumed decision and live resource generation. Each page receives a new exact run/args grant; no global session `allowed=true` is set and no new total-page constant is imposed. A separate read-only assertion permits bounded local processing of the already confirmed original result; it cannot execute a tool. Existing per-page TaskRuntime approvals/anchors retain the audit record when completed transient question pages are compacted.

## Existing callbacks without a business task

The hidden `desktop.authorization.intent` tool is a compatibility adapter for trusted memory/Skill/configuration callbacks. Hidden catalog visibility is not its security boundary: a persisted original `submitHostToolTask` intent, fixed action enum, original command/owner and exact payload/scope hashes are required. Public `tool.invoke` rejects this tool. Renderer cannot provide an origin, task identity or arbitrary permission payload. Its tool result only records that the authorization decision completed; a subsequent business save/erase/install still uses its original storage/CAS/readback audit and is not reported as executed by this decision task.

## Checkpoint validation and remaining integration

The saved Runtime expiry increment and its actual tests are recorded in [approval lifecycle evidence](evidence/APPROVAL_LIFECYCLE_475_20261021.md).

At the host foundation checkpoint, 7 question lifecycle cases plus 3 Main-host cases pass by loading the actual TypeScript source with Node 24's type transformation; the 4 approval projection/status cases pass. Main and the intent helper parse successfully; `git diff --check` passes. This does not replace the pending Runtime closure build/typecheck, consumer integration tests, actual Electron card rendering or native execution combination.

The UI/time branch and the native executor branch are to be normally merged into this one integration branch. The provisional profile currently remains unavailable until the actual native helper/root/configuration probe is wired. Public reference, knowledge, remote MCP, pairing and voice adapters are being migrated independently; memory/Skill/workflow/fact/workspace and shared Main/Runtime/IPC integration remain with the integration owner. No Ready PR or complete “all authorization unified” claim is justified at this checkpoint.
