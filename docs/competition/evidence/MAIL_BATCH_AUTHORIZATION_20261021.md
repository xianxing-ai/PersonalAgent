# Mail batch authorization integration — 2026-10-21

Scope: the existing `huawei_ict_agentarts` Desktop composition's manually started **local inbox-header classification batch**. This test does not add cloud-analysis permission, a mailbox provider, an authorization layer, a production behavior change, or a page/total-message budget.

The new `apps/desktop/test/mail-batch-authorization.integration.test.mjs` composes the production `createQQMailTriageHost`, original `MailReadSessions`, Runtime Application, `AuthorizationQuestions`, Desktop question host, Policy, ToolGateway, SQLite state, mail configuration and encrypted local classification store. Only `QQMailProvider.fetchPage` and the classifier transport are explicitly Synthetic. Credentials and messages are Synthetic; no real mailbox, model, network, Electron window or native process is exercised.

The provider fixture contains 101 Synthetic messages, yielding two original Runtime pages (100 then 1), so the existing per-request limit remains 100 and the total stays unknown in the actual card. This finite fixture is not a new production total limit. The intended assertions cover one initial card with old session consent false; two distinct original task/run/argument-bound single-use grants and confirmed local results; original batch/deadline/parent-decision derivation without a second card; account/folder/query/generation/deadline substitution rejection; and invalidation by configuration replacement, resource-generation rotation, revocation, cancellation and original session expiry. Local classification must leave cloud consent false and create **zero export leases**; this is not cloud-export or real Laya acceptance.

Source checkpoint: based on integration commit `3022a63ad7dc29f8c68e903742cc1614a74029ae`, in isolated branch `codex/mail-batch-authorization-test`. Source and fixture corrections were normally merged into the owner's integration branch before each run. The initial checkpoint did not claim execution; the final run below uses the integration tree's own current build outputs.

Initial run at integrated head `2e0f445e8cadd6377d2bc0e3d9c6095f5566e75e` with Node 24.15.0: six cases stopped during fixture construction with `INVALID_ARGUMENT: Invalid trusted host user namespace`, before any mailbox or authorization execution. The Synthetic namespace incorrectly contained spaces; the test fixture is corrected to `synthetic-mailbox-user`. No production validation was relaxed. This setup failure is retained separately from the final rerun.

Second run at integrated head `3b9403eeb1d17abcb1b64635e0bfb3fb7507b89a`: all six cases reached the first confirmed page, then correctly rejected the test's mistaken one-item expectation (actual 2). Production `MailService` aggregates provider subpages to the requested limit; two fixture messages with provider page size 1 were a single Runtime page. The fixture is corrected to 101 messages with provider page size 100. The real per-request limit, aggregation, automatic pagination and authorization remain unchanged.

## Final integrated run

Actual source head: `5951d8e4521082d4e9600df618bc5c96660b4a13`, clean integration tree `D:/worktree/24cd/PersonalAgent/.worktrees/unified-authorization-474-475`. Node `v24.15.0`; that tree's owner-built dependencies and Runtime outputs, with no installation, rebuild, external account, cloud/model call, UI or native process started by this test.

```powershell
& D:/PersonalAgent/.cache/toolchains/node-v24.15.0-win-x64/node.exe --test --test-concurrency=1 apps/desktop/test/mail-batch-authorization.integration.test.mjs
```

Result: **6 passed, 0 failed, 0 skipped**, duration `1831.8905 ms`. The two-page case completed 101 Synthetic headers as 100 then 1; both original executions were Policy `allow`, `executionStarted: true`, `confirmed`. Each exact grant was observed with `usesRemaining: 0`, matching its original task/tool/argument digest/deadline. The existing session remained false, only the original card was visible, and the next-page decision was derived from its consumed result. The five additional cases stopped before another page after revocation, account/configuration replacement, resource-generation rotation, cancellation or expiry. Same-batch account/folder/query/generation/deadline replacements were rejected.

Readonly post-run SQLite readback of the two-page fixture (`run-djcm3h`) retained these Synthetic identifiers and separate argument bindings:

| Original task / run suffix | Argument digest | Confirmed page |
| --- | --- | --- |
| `292896fc-238a-4d91-8073-e6d2974d7b79` | `0fc0a527a77d0b35992dfad38170e1dc4b29e7087243a732fefc29df89a8c154` | first, 100 headers |
| `af5f8d12-8145-4d69-83ea-f0cc88da62c5` | `596411aaee1591a8caf5d958f4b2f407294d56da9cfe5ba948663951a9e61d4f` | second, 1 header; cursor `1725686400:100` |

Runs use the original `host-tool-<taskId>` identifiers. Both checkpoints bind batch `d719830c-ab9a-4198-8cdf-a563879f029a` and deadline `2026-10-21T14:31:10.394Z`. The second-page derived checkpoint binds its exact argument digest and parent question `af76dc1f-d503-4d15-b54e-b9c5d112e513`; its internal derived question `068dcf27-ac30-406d-95b7-5258f5ba9d2a` is hidden from the ordinary card list. Both receipts contain only `tool` and `connector_session` requirement kinds. The fixture has **zero `authorization-question-export:*` checkpoints**; cloud analysis consent and cloud lease remained absent throughout. Local raw SQLite/encrypted message files stay ignored and are not public evidence.

This proves the current fixed local mailbox batch's composed authorization and failure paths under explicit Synthetic provider/classifier input. It does not prove a real QQ account, live Laya service, network availability, mail body access/writes, cloud analysis, renderer interaction, all mailbox sizes or the entire product.
