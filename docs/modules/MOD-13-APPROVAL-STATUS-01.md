# MOD-13-APPROVAL-STATUS-01

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

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
