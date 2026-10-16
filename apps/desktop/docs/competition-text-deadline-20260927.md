# Competition text deadline repair — 2026-09-27

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../../../docs/design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../../../docs/design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../../../docs/design/workflow-architecture-20261013/index.html) · [接口状态](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


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
