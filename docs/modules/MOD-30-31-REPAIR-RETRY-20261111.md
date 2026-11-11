# MOD-30 / MOD-31 失败自愈与可回放决策（2026-11-11）

目标 profile：`huawei_ict_agentarts`。负责人：zemeng5208。状态：`review`（失败路径、F13_N04 宿主确认和对话失败卡片已接；不是冻结接口，也不是真实云验收）。

## 行为

`packages/agentarts/src/repair-policy.ts` 是原先 owned workflow 里“等待用户算法”的那一处决定：

- 失败分成瞬时（超时、限流、网络）、可修正（参数、选择器、权限不足）和不可恢复。`retrySafe` 证明本身不是重试决定。
- 瞬时失败按指数退避再试，次数、经过时间、步数和 token 预算用尽后停止；父 agent 仍可接手时改为请求重新规划。
- 可修正失败按顺序换参数、换工具、降级到只读路径，最后请求父 agent 重新规划。
- 写入只在幂等、有幂等键或有补偿，并且结果已经确认没写上时才允许再试。结果未知先查状态；状态仍未知或已经写上，都不盲重试。
- 高风险动作的重试必须带已有批准。本模块不签发授权，也不调用工具。
- 每次尝试的分类、策略、原因和结果写入 trace。`replayRepairTrace` 只回放决策，`summarizeRepairFailure` 给出失败摘要。回放的工具、模型和写入计数都是 0。

Owned workflow 只对宿主标记了 `retrySafe` 的失败只读节点应用该决定。零延迟且已可执行的只读退避会换成新的 operation id（摘要带上已失败次数，第一次提案的 id 算法不变）。写节点、未知结果和高风险未批准的重试留在原失败上，不另发提案。

`packages/crew` 的父 agent 用 `replanChildTask` 消费同一形状的决定。只有父可以调用，而且只对已经失败的子任务。意图是派新任务时才入队；子驱动不会因此重跑。未知写入和非幂等盲重试在父边界再次被拒绝。

## 与 #531 的关系

`codex/image28-full-wiring`（PR #531）仍保留“Repair algorithm unavailable”，并准备把冻结 trace 的实现挪走。本次只给 `replayFrozenWorkflowTrace` 增加可选的 `repairTrace`，不改它原来的必填字段。Runtime 只加了 `onTaskFailed`。Desktop 只加当前对话的失败卡片。没有改 Policy 核心或业务连接器。

## Runtime 失败路径与 F13_N04

`TaskRuntime` 增加可选钩子 `onTaskFailed`。任务进入 `failed` 并提交之后，钩子才收到不含目标正文和参数的通知；回调抛错不会撤销已经提交的失败。结果仍待核实的任务不写这份记录，避免把决策当成未完成的副作用。`RuntimeApplication` 用它调用 `planRuntimeTaskFailure`，把记录写入 checkpoint `repair-decision:v1`。

`confirmF13HostRecovery` 只在宿主读回给出证据，并且结果是已生效或未写上时，才把恢复标成 `recovered`、`lockReleased: true`。结果未知或没有证据时保持 `needs_reconcile`。`taskResumed` 固定为 false：失败终态不重开。

外部写入在通知里标成高风险。界面不能自己打开批准。

## 一起查看

`replayFrozenWorkflowTrace` 可以带上 `repairTrace`。原冻结时间线保留，自愈尝试接在后面，`executedDuringReplay` 为 false，工具和模型次数不变。不带该字段时结果与原来相同。

## 界面

只在当前对话放一张失败卡片：分类、原因、每次尝试的时间线，以及当前真正能做的操作。只读且宿主不需要先查状态时显示“重试”；没有放弃时显示“放弃”；不是高风险且尚未放弃时显示“交给父 agent”。高风险只保留“放弃”，并说明要走原有授权。没有设置页，没有退避/预算控件，没有统计面板，没有第二处入口，也没有单独的批准按钮。重试只读会新提交一个任务，原失败任务保持失败。

## 明确没做

- 没有真实 AgentArts、真实工具或真实账号调用。Fake 通过不等于云端或设备验收。
- 不改公共 Core wire，不新增数据库迁移，不把接口标成 frozen。
- 桌面没有接入 crew 进程。交给父 agent 会记下重新规划，不会假装已经派发子任务。
