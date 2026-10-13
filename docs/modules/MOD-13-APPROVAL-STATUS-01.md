# MOD-13-APPROVAL-STATUS-01

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`
- 负责人：`zemeng`
- 基线：`main` / `73cf239`
- 状态：`review`（待非作者评审与集成）
- 所有权：`apps/desktop/src/features/admin/`、对应 Desktop 定向测试；不修改 Runtime、contracts、Policy 或 ToolGateway

## 目标

管理后台只根据冻结的 `approval.list` 脱敏快照显示工具、scope、状态与期限。待处理审批到期后在本地转为“已失效”并停止提供决定按钮；Renderer 不读取或显示原始工具参数、绝对路径、凭据或参数摘要哈希。

## 边界

- 不改变审批状态、revision、授权来源或 Runtime 的期限判断。
- 不自动批准，不增加持续授权，不绕过 `authorization.respond`。
- `argumentSummary: "redacted"` 只显示为固定的“已由 Runtime 脱敏”；即使输入对象意外携带 `arguments`，页面也忽略它。
- 到期显示由 `expiresAt` 与本机时间派生，只是 UI 的失败关闭提示；Runtime 仍是审批事实来源。

## 验收

- 有效 pending 项显示工具、scope、期限与允许一次/拒绝按钮。
- 已过期、期限无效、已允许或已拒绝项明确不可操作。
- 定向测试证明原始参数、绝对路径、凭据和 digest 不进入 HTML。
- Desktop 单元测试、语法检查和 `git diff --check` 通过；不做真实审批、云调用或真实用户数据读取。

## 本地证据

- Node `24.19.0`：定向测试 3/3、Desktop 单元测试 14/14 通过；当前机器未找到仓库 `.node-version` 指定的 `24.15.0`，该版本差异保留为评审说明。
- Desktop `typecheck` 通过；新增纯展示模块另以 Node 24 `--check` 验证。
- 隔离 Electron Fake Runtime 可见验收通过：有效项显示工具、scope、脱敏提示、期限和决定按钮；到期后同一项自动显示“已失效 / 不可操作”且决定按钮消失；无相关 console warning/error。
- 可见验收只注入公开形状的合成快照，未执行真实审批，未读取真实用户数据，也未调用云端。
