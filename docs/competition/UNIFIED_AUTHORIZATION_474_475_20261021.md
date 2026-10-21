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

## Integrated entry points

All application decisions below use the conversation question port. Settings retain real credentials, account/resource configuration, policy selection and rule revocation; configuring these is not a permission grant. Old session-allow and managed approval-response IPC cannot mint a grant. System microphone consent, external OAuth and operating-system elevation remain separate system/account boundaries and are not impersonated by this card.

| Actual entry point | Integrated consumer and boundary |
| --- | --- |
| Tool writes and connector data/export | Original Runtime proposal/Policy/ToolGateway, exact question requirements and bounded result projection; Todo, Feeds, Calendar and Mail use the original consumer ports. |
| Manual Mail batch | Same original account/folder/query/session through its existing pagination; each page receives an exact derived authorization, not global session permission. |
| Workspace, command and coding repair | Workspace configuration is not consent. External command/repair execution additionally requires a currently verified native backend; source reads retain their original source/version/exact-export proof. |
| Memory, Skill, experience, workflow, facts and notification management | Trusted host-only intent records the user's decision; original business callback still performs its own current-state/CAS checks and audit. |
| Public reference/Skill reference, knowledge, remote MCP and Obsidian pairing | Static published descriptors are distinguished from private catalog metadata; private material and pairing/configuration decisions use the same question port. |
| Voice capture and approval guidance | Application capture permission uses the card; oral yes/no can focus or explain the original card and cannot grant tool permission. Actual system microphone permission and release verification remain required. |
| Developer/Harness model and result export | A bounded original operation shares one card, with a separate exact payload/run lease per send. The history summarizer binds the entire original Runtime source range/configuration/cutoff, so its segments share a decision while a different range cannot inherit it. |

Application-policy permissions do not claim OS containment. The default trusted application profile allows a first question without visiting Settings or configuring Node. Only external-process work requires native helper/root/configuration readiness. The Windows PSEC executor is actually wired through the original command factory and rechecks the exact lease before resume; unavailable containment never falls back to bare spawn. Explicit full access remains ordinary-user execution with `backend=none`, `enforced=false`.

No Core wire enum/version or database migration is introduced. Durable question/rule/resource-generation metadata uses the existing trusted host state. Historic process-local session booleans are not promoted to reusable global rules; saved capability preferences and credentials remain configuration. New explicit permanent decisions are visible and revocable. Rollback must preserve the database: an older application does not understand these new rules and must not infer permission from them.

## Validation and remaining boundaries

The saved Runtime expiry increment and its actual tests are recorded in [approval lifecycle evidence](evidence/APPROVAL_LIFECYCLE_475_20261021.md).

The host foundation source checks are historical increments. The integration now has its own installed dependencies and 31 sequential Runtime/Desktop dependency builds, actual Runtime/Policy/ToolGateway/Todo and no-cloud-management combinations, original F15 isolated workflow checks, and exact signed-projection readback. Details, initial failures and bounded retries are in [integration evidence](evidence/UNIFIED_AUTHORIZATION_INTEGRATION_20261021.md).

The UI/time, native executor and permission callbacks have been normally merged into this integration branch. [Actual Electron QA](evidence/AUTHORIZATION_RENDERER_QA_20261021.md) preserves the initial first-screen visibility failure and the later successful viewport/keyboard/settings check. [Actual native integration](evidence/AUTHORIZATION_NATIVE_INTEGRATION_20261021.md) separately proves the original card/Policy/Gateway/PSEC command chain; neither is used as a substitute for the other.

The package remains provisional, not frozen. Complete repository CI and independent GitHub approval are separate delivery gates. Real AgentArts/model/account, physical microphone and installer acceptance are not claimed by these Synthetic/local checks. PR #484 remains Draft while its remaining focused consumer checks and current-head CI are being completed; component PRs are not independent merge candidates.
