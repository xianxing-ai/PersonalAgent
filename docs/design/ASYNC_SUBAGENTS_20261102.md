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

子任务进入 `succeeded`、`failed` 或 `cancelled` 后，用 `readRuntimeSubagentSummary` 生成回执，并以检查点 `async-subagent-report:${subtaskId}:${revision}` 只写入一次。桌面把这条回执写成父会话的一条 live 消息，标识是 `async-report:` 加稳定摘要；同一标识和同一正文再次投递不会再插一条。进程在检查点写入之后、消息写出之前停掉，下次 `recover` / `pump` 仍会补上这一条，但不会再触发第二次 `onReport`。`waiting_reconciliation` 只记录读回结论，`redo` 固定为 false，不再次 `runTask`。

有已启用的健康远端主机时，`createRemoteAwareSubagentStarter` 把子任务交给 `createRemoteRunnerService.submit`（kind `async-subagent`）。远端只有在主机配置的模型命令以退出码 0 结束时才算成功，父任务记下命令输出和「远端执行」。命令失败或超时时子任务失败，不改到本地重跑。主机没有模型命令时回执是 `needs-config`，父任务改走原来的本地 worker，并写明原因。回执未知时进入 `waiting_reconciliation`，由 `verifyUnknownWrite` 读回，不在本地重跑。没有健康主机、主机心跳过期或传输失败时，仍走原来的本地 worker，并在回报里写明「本地执行」和原因。`developerDutyRemoteRunner()` 不传服务时仍是显式的无主机 stub。

完成回报记在派发时的父任务会话上，检查点是 `async-subagent-parent-conversation:v1`。只有这个会话已经不存在时，才改送到当前主对话，并在正文里说明。同一条消息标识冲突会记到日志和 `async-report-delivery` 检查点。

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

桌面后台列表只读取异步子任务，并用原来的 `task.openSubagentConversation` 打开子对话。完成提示仍只有父会话里的那一条 live 消息，列表不再另画一条完成通知。样式表由组件插入 `link[data-background-tasks]`，和目标视图的做法一样。

这些工具进入主对话的模型可见目录，需要同时出现在 `competitionToolAvailability` 和 `competitionToolExports`，并且已经注册。`goal-with-tools-json` 仍要求这两份绑定都非空；这里只是往现有数组里追加，不放宽那条检查。子会话（`desktop-subtask:`）里这些工具的 `available` 为 false。
