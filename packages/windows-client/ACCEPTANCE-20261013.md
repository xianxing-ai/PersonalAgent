# MOD-17：真实观测、Policy 与持久读回（2026-10-13）

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../../docs/design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../../docs/design/workflow-architecture-20261013/index.html) · [接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- Profile：`huawei_ict_agentarts`；负责人 zemeng；工作包状态 `review`。
- 工作树：`.worktrees/zemeng-windows-tools-completion`，分支 `codex/zemeng-windows-tools-completion`，起点 `5b581139`。
- 生产代码与接口未改；新增 [可重复 runner](../../tests/manual/windows/system-observation-acceptance.mjs)。
  不需要 Runtime/Desktop 新接线，不改共享 ROADMAP 或接口冻结状态。

历史 provider 直读和 2026-09-27 proactive-host 的真实记录仍有效于其原基线；本次补的是当前基线可重复执行入口。

## 本轮回执

Windows `10.0.26200.0`，Node `24.15.0`，npm `11.12.1`，PowerShell `7.6.6`。
在运行宿主检查 `WindowsPrincipal.IsInRole(Administrator)` 为 `false`；runner 自身不检测令牌。
`node tests/manual/windows/system-observation-acceptance.mjs` 退出码 0。
本地回执：`.cache/mod17-runtime-d7K0cW/receipt.json`，数据库在同目录，仅本地保存。

| 检查 | 读回 |
| --- | --- |
| 来源与次数 | 默认 `node:os`，恰好一次真实执行，输出 Schema 校验通过 |
| 时间 | `2026-10-13T01:31:54.353Z` 至 `2026-10-13T01:31:54.607Z` |
| 采样间隔 | 请求 250 ms，实际 253.58 ms |
| task | `8fc2f047-9461-428f-80e4-3f3bbc249fda` |
| Policy / execution | `allow`，`usesRemaining=0`，`confirmed`，`executionStarted=true` |
| Evidence | `host-tool-8fc2f047-9461-428f-80e4-3f3bbc249fda`，`conditional` |
| 拒绝路径 | 拒绝审批、审批前取消、缺 capability 均未执行 provider |
| 许可生命周期 | 停止后拒绝；同进程 Runtime/SQLite 重开后旧许可拒绝，历史记录不变 |

51 项定向回归通过、0 跳过：windows-client、Runtime 观测许可、Policy 集成、补丁 apply/reconcile 和 Runtime 恢复。
实际回执白名单不含 CPU/内存值、身份、进程列表或路径。SQLite 内有本地聚合观测，不公开提交或上传。

## 待联合验收

真实 AgentArts 提案、明确指标出云许可和云续答、正式 Desktop 展示尚未在本次运行。
现有 `apps/desktop/electron/public-connector-host.js` 注册公开工厂，
`product-tools-composition.js` 仍要求显式 export policy；本次不扩大系统指标出云范围。
进程归因、磁盘 I/O、温度和网络活动保持 unavailable；不能由 CPU/内存判断变慢原因。
本地闭环通过不代表 MOD-17/PA-011 或 Competition 全部完成。

PR 与合并分开记录：工作包可审查；合并须取得当前提交的一位非作者有效 Approve 及必要检查。
