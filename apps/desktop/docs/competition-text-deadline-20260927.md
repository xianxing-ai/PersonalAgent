# Competition text deadline repair — 2026-09-27

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../../CONTRIBUTING.md) 和 [AGENTS](../../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Owner: zemeng / MOD-11. Profile: `huawei_ict_agentarts`.

## Cause and change

Desktop submitted conversations without a timeout option. Public Client therefore
created a 10-second request deadline, which Runtime persisted as the entire
coordination task deadline. An HTTP 200 response did not imply that the workflow
body had completed in that interval.

Desktop now submits Competition conversations with a 120-second deadline through
the existing public Client option. Queries retain their 10-second default;
cancellation, Policy, tool validation, cloud routing and Local behavior are unchanged.
No automatic retry or synthetic answer is added. There is no Schema or database migration.

## Real Desktop evidence

The original application was redeployed through the official AgentArts application
deployment flow to runtime v14 (2026-09-27 11:10:40 +08:00), resolving the earlier
v13 image-pull failure. This deployment repair is separate from the Desktop deadline fix.

After restarting the repaired Desktop with its existing encrypted credentials and
history, each previously failing text was submitted once through the actual panel:

| Input | Task | Read-back |
| --- | --- | --- |
| 输出99乘法表 | `9cf34fc2-d909-4cf0-9bca-9a88ab088fe2` | `succeeded`, completed `2026-09-27T03:24:44.215Z`; full table through 9×9=81 visible |
| 你现在能调用什么工具吗 | `14a8cc6d-91b1-4d81-89ee-7d2b986ab591` | `succeeded`, completed `2026-09-27T03:25:25.731Z`; answered with the published `workspace.read_text` capability |

The multiplication task deadline was `2026-09-27T03:26:28.615Z`, giving a
120-second budget. It completed in about 15.6 seconds, beyond the previous limit.
SQLite was opened read-only for these receipts. The responses retained the
`verification=unverified` marker; a capability description does not verify tool execution.

## Necessary checks and limitations

- `node --check apps/desktop/electron/main.js`: passed.
- `node --test apps/desktop/test/desktop.test.mjs apps/desktop/test/cancel.test.mjs`: 9 passed.
- `git diff --check`: passed.
- No full test suite, additional hello loop, tool side effect or voice recording.
- SIS service activation alone is not voice acceptance; secure IAM configuration and
  actual speech acceptance are still pending. This does not complete the whole MVP.
- Longer tasks can still expire at the declared deadline; the existing generic adapter
  error can obscure timeout classification in a race. It was not relaxed in this change.
