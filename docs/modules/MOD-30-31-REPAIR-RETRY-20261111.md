# MOD-30 / MOD-31 失败自愈与可回放决策（2026-11-11）

目标 profile：`huawei_ict_agentarts`。负责人：zemeng5208。状态：`review`（离线决策与 crew 父派单已接；不是 F13_N04 宿主确认恢复，也不是冻结接口）。

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

`codex/image28-full-wiring`（PR #531）仍保留“Repair algorithm unavailable”，并把只读 `trace-replay` 改成从 agentarts 再导出。本次不改 `apps/agentarts-runtime/src/trace-replay.mjs`，也不改 Desktop、Runtime 核心、Policy 核心或业务连接器。自愈回放是旁边的 `repair-replay.mjs`，避免和 #531 的冻结 trace 搬家叠在一起。

## 明确没做

- F13_N04 `runtime.confirmed_recovery` 的宿主确认恢复仍然没有。本决定不释放锁、不把任务标成完成。
- 没有真实 AgentArts、真实工具或真实账号调用。Fake 通过不等于云端或设备验收。
- 不改公共 Core wire，不新增数据库迁移，不把接口标成 frozen。
