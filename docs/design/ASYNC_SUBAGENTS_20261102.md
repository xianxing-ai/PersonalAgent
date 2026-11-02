# 异步子智能体与可扩展类型

目标 profile：`huawei_ict_agentarts`。本文件只描述新增能力。同步工具 `subagent.dispatch` 的输入 Schema、五种内置角色和阻塞式执行保持原样。

证据等级：以下行为由 Runtime 内存/文件 SQLite 与显式 Fake worker 覆盖，属于 **Fixture**。没有真实模型、真实账号或桌面人工验收。

## 异步入场

新增工具：

| 工具 | 作用 |
| --- | --- |
| `subagent.spawn` | 用原 `submitTaskWithSubagentBinding` 和幂等键 `subagent-dispatch-${parentTask}-${subtaskId}` 创建子任务，立即返回句柄 |
| `subagent.instruct` | 以 `controlRevision` 追加后续指示；版本不一致拒绝 |
| `subagent.stop` | 调用现有 `requestCancel`。从未开始且没有工具执行的子任务再由现有 `confirmCancellation` 结束 |

子任务仍只有一层。父会话以 `desktop-subtask:` 开头时，spawn 与类型工具都拒绝。步骤上限沿用原来的 thinkingDepth 公式，最大 12；自定义类型只能把上限再收紧。截止时间不能晚于父任务。模型配置引用在创建时冻结，执行前若 F28 `getModelConfigurationRef` 变化，待执行子任务失败且不重跑。

入场使用现有 Scheduler，会话固定为 `async-subagent-admission`，不新建调度器。默认全局同时 3 个、每个父任务 3 个。超出的子任务保持 `created` 且没有 schedule。模型名包含 `laya` 的子任务全局同时只入场 1 个，避免这条新路径把 Laya 变成并行。

子任务进入 `succeeded`、`failed` 或 `cancelled` 后，用 `readRuntimeSubagentSummary` 生成回执，并以检查点 `async-subagent-report:${subtaskId}:${revision}` 只写入一次。进程重启后同一检查点不会再次唤醒父会话。`waiting_reconciliation` 只记录读回结论，`redo` 固定为 false，不再次 `runTask`。

启动时 `recover()` 重新扫描带 `async-subagent-spawn:v1` 且仍为 `created` 的子任务并入场。已经处于 `running` 的中断任务不在这里重做，仍交给原启动恢复；未知写入不能当成没发生。

## 自定义类型

五种内置角色仍是 `researcher`、`coder`、`reviewer`、`planner`、`coordinator`。自定义类型不能使用这些名字。持久绑定里的 `role` 仍是类型声明的 `baseRole`，因此旧的 `subtask-parent` 校验不用认识新名字。

每个类型包含名称、说明、系统提示、允许工具、基础角色、可选模型、可选步骤/时限，以及启用状态。允许工具必须是用户已经授予的工具名的子集；执行时再过滤一次，并且去掉 `subagent.*`，避免子任务继续派发。类型版本从 1 递增，删除后序号不回收。定义、启用状态变化后，绑定旧 version/digest 的未开始子任务在入场时失败。

主对话工具：

| 工具 | 生效时机 |
| --- | --- |
| `subagent.type.list` | 只读 |
| `subagent.type.create` / `update` / `enable` / `disable` / `delete` | 只生成待确认提案 |
| `subagent.type.confirm` | `requiresPresence`。摘要必须与提案一致，才会写入登记 |
| `subagent.type.import` | 解析用户给出的 JSON 文本并生成提案，不按模型自选路径读磁盘 |

示例见 [custom-subagent-type.json](examples/custom-subagent-type.json)。配置文件与对话工具使用同一校验。未确认的类型不能被 `subagent.spawn` 使用。`subagent.dispatch` 不接受 `typeName`，避免改变已发布 Schema。

桌面后台列表复用原完成提示和 `task.openSubagentConversation`。它只读取异步子任务，不新开任务。
