# MOD-18 P8：Runtime patch reconciliation 接线

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；三位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

本增量依赖 PR #217（`codex/zemeng/mod18-patch-reconcile`，head `1b9d352`）提供的
`reconcileWorkspacePatchApply`。P8 不复制 patch helper、marker 或进程查询，也不改变公共
wire schema；它把该 API 接到已有 `RuntimeApplication` host-task 恢复入口。

## 受信边界

- Runtime 只从持久化 `host-tool-intent` 读取原始相对文件路径，并要求同一
  `workspace.apply_text_patch@1.0.0`、同一 task/run、原始 input digest、已允许且已启动的执行记录。
- Desktop 主进程从已固定且 ACL 检查过的工作区、恢复目录和 PowerShell 闭包注入 P8 port。
  Renderer、模型和 wire 请求不能提供恢复目录、PID、进程 start-time 或新的授权引用。
- #217 的 `running` 保留 marker；`applied` 原子投影到同一执行记录并完成任务；`not_applied`
  进入既有失败终态；`unknown` 保持 `waiting_reconciliation`。不会重开任务、重放工具或发起新授权。

## 验收范围

`apps/runtime/test/workspace-patch-reconciliation.test.mjs` 使用显式 Fake port 覆盖同一持久任务的
applied、not_applied、unknown、running、marker 缺失、输入变更和重复调用。它证明任务、执行记录和
现有 Evidence 的读回一致性；不构成真实 Windows、PowerShell、SQLite 生产数据库、凭据或云端验收。
