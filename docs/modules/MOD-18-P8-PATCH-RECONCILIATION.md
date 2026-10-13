# MOD-18 P8：Runtime patch reconciliation 接线

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一语义决策默认国内MaaS，责任图/并行/后台影子按当前设计；旧Laya默认和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


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
