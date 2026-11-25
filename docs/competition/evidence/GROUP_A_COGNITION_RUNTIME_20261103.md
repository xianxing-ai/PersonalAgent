# A 组认知与 Runtime 侧遗留（2026-11-03）

目标 Profile：`huawei_ict_agentarts`。侧分支相对 `codex/image28-full-wiring`。以下只记录本轮实际代码与本机夹具，不是真机、真实账号或 AgentArts 验收。

## 已在夹具中跑通

- F03：`cognition.commit_repair` 在图 CAS 前写入 `local-repair-commit-intent`。CAS 已提交但工具回执未落盘时，`reconcileCommittedLocalRepair` 只投影原回执，不再 `appendBatch`。CAS 前崩溃则保持原 revision。测试注入 `RESULT_UNKNOWN`，不是操作系统杀进程。
- CW-03：可选 `sourceResponsibilityBinding` 让一个注入来源只携带生命周期为 current 的显式责任。未激活时连接器批次不提交游标。夹具 advance 不包含另一条未绑定责任。不是真实业务账号。
- CW-05：`createRuntimeProactiveControlPort` 把 enter/return 交到既有 `host.control`，并读回原 checkpoint。同一 return 不重复 advance，deadline 不变。没有关机后的云持续，也没有物理设备。
- CW-07：`consumeOriginalChildControllerAdvice` 消费已绑定 child 的报告。旧 revision 拒绝。teacher 的 `nextTool` 必须属于原 `subtask-tools-binding`，且不调用 `policy.grant`。决策与建议是同步 Fake，不是真实模型。

## 未完成

- 真实 AgentArts、真实 GitHub、真实邮箱/订阅来源、物理麦克风与 Windows 主机均未验收。
- F19 正向整链本 PR 未改生产期限，也未重跑 Desktop F19 整链。基线记录见 `IMAGE531_CHECK_PROGRESS_20261101.md`：夹具在提交时给过 120 秒，生产期限仍沿调用方 deadline。该记录不是本轮新测结果。
- MOD-27/28 的领域图与 MOD-04B 的协调包没有重写。通用目标依赖重规划仍暂停。
- 连接器事件已经生成提案之后，再执行 enter 并撤回尚未开始的提案，本轮没有单独再验；已有 pause/enter 测试仍覆盖原控制路径。

## 本机命令

Node `v24.15.0`（`.node-version` 为 24.15.0）。

```text
npm run build --workspace=@personal-agent/runtime
node --test apps/runtime/test/proactive-workflow-application.test.mjs apps/runtime/test/reviewed-local-repair.test.mjs apps/runtime/test/delegation-controller.test.mjs
```

结果：30 项通过，0 失败，0 跳过。`git diff --check` 通过。未跑全仓 `npm run check`，也未把该结果写成 CI 通过。
