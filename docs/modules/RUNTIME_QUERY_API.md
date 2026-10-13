# 批次 A：Runtime 公开查询接口

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

状态：**Core Runtime Profile 1 已冻结**。实现提交 `e5e20cad16566c6bdf821b7880efad96f0513ef1` 已由 `zemeng` 非作者批准，Foundation CI 通过，并随 PR #34 合并为 `bcbeaa2`。协议线版本保持 `1.0.0`；本批只增加向后兼容的只读 operation 和 TaskSnapshot 可选字段。

这里的冻结仅覆盖下列任务、会话和审批查询语义，不代表整套 wire、事件通道、模型、工具或连接器接口均已冻结。完整边界见[当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。

本查询面是 Huawei ICT AgentArts Competition Profile 的共享 Runtime 底座；若 Local Profile 以后被明确启用，也复用同一查询面。它只提供 Runtime 事实快照，不表示 AgentArts 已接入；后续 Competition UI 可用它恢复 profile、deployment/trace 引用，但新增字段仍须经过契约流程。

## 公开操作

| operation | 用途 | 主要过滤 | 分页与恢复 |
| --- | --- | --- | --- |
| `task.get` | 按 taskId 读取单个完整任务快照 | `taskId` | 原有接口；快照新增可选 `goal`、`conversationId`、`attachmentRefs` |
| `task.list` | 重启后恢复任务、按会话或状态查询 | `conversationId`、`states` | `limit`、`beforeSequence`、`snapshotSequence` |
| `conversation.list` | 列出会话或精确读取一个会话的完整任务历史 | `conversationId` | `limit`、`beforeSequence`、`snapshotSequence` |
| `approval.list` | 列出审批或用 approvalId/taskId 精确查询 | `approvalId`、`taskId`、`state` | `limit`、`beforeRowId`；返回事件 `snapshotSequence` |

首次读取 `task.list` 或 `conversation.list` 时不传 `snapshotSequence`。Runtime 返回当前 `snapshotSequence`；后续页必须回传该值，并使用 `nextBeforeSequence` 继续读取。同一轮快照完成后，客户端从该水位读取 `tasks` 事件流。Desktop 已采用此流程：启动先恢复任务和待审批快照，再重置 EventCursor 并续订，避免快照和订阅之间漏事件。

`conversation.list` 返回 UI 完整任务历史；它不替代 Runtime Application 内部的模型上下文读取策略。模型上下文仍只读取同会话、当前任务之前、最近成功且有结果的任务。

## 安全边界

审批查询只返回 `approvalId`、`taskId`、审批 revision、动作名、受限 scopes、到期时间、状态、参数摘要哈希和固定的 `argumentSummary: "redacted"`。不返回原始工具参数、checkpoint、模型提案或凭据。Desktop 已停止调用 `runtime.getApproval()` 和 `loadCheckpoint('agent-loop')`。

`authorization.respond.expectedRevision` 仍指审批实体 revision。任务 revision 与审批 revision 不再由 UI 混用；Fake 场景也保留已处理审批，重复决定返回 `REVISION_CONFLICT`。

## 当前限制

- 本批没有新增会话重命名、归档、删除或显式创建操作；conversationId 仍随 `task.submit` 由可信客户端提供。
- 结果正文、模型身份、usage 和 verification 的结构化投影不在本批，仍需后续工作包替换 `resultSummary` 元数据尾缀。
- Evidence 内容查询、设置管理、Artifact/媒体协议不在本批。
- `approval.list` 的参数摘要哈希可用于参数绑定和一致性检查，不代表原始参数可向 UI 展示。

## 验收

- contracts：17 个 operation 正例及非法 limit/state 反例。
- Runtime：任务分页、固定水位续页、会话隔离与顺序、审批脱敏。
- Testkit：显式 Fake 的任务/会话恢复和审批查询。
- Desktop：仅通过 Client 公共 operation 恢复任务和审批，不再读取 Runtime 私有状态。
