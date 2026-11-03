# CW-07 任务分配与主控升级：本地可验证覆盖与真实验收记录（2026-11-04）

- **工作包编号**：CW-07（任务分配与主控升级）
- **对应 MOD**：MOD-04B（多智能体协同与委派）、MOD-31（高级主控升级）
- **唯一负责人**：zemeng5208
- **目标 Profile**：`huawei_ict_agentarts`（Competition Profile）
- **分支与基线**：分支 `zemeng/cw07-parent-child-teacher`，基于 PR #543 head `codex/pr531-cloud-persistent`

---

## 1. 调查结论与现有覆盖情况

本轮对 CW-07「实际 parent-child 报告 / 进度 / 原授权内 teacher 建议消费」在 `packages/coordination`、`packages/agents`、`packages/agentarts` 以及 `apps/runtime` 中的实现、装配与测试进行了完整调查，结论如下：

### 1.1 核心机制覆盖矩阵与依据

| 验证项 | 生产实现位置 | 测试 / 夹具依据 | 机制与安全边界说明 |
| --- | --- | --- | --- |
| **父子持久绑定** | `apps/runtime/src/application/subagent-host.ts`<br>`apps/runtime/src/application/delegation-controller.ts`<br>`apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/runtime/src/application/user-task-delegation.ts`<br>`apps/runtime/src/application/subagent-conversation.ts` | `apps/runtime/test/subagent-host.test.mjs`<br>`apps/runtime/test/delegation-controller.test.mjs`<br>`apps/runtime/test/proactive-workflow-application.test.mjs`<br>`apps/runtime/test/user-task-delegation.test.mjs`<br>`apps/runtime/test/subagent-conversation.test.mjs` | 子任务在 `subtask-parent` 持久检查点中记录 `parentTaskId`、`parentDeadline` 及 subtask 定义；子任务会话严格绑定 `desktop-subtask:${parentTaskId}` 与幂等键 `subagent-dispatch-${parentTaskId}-${subtaskId}`；非法挂载直接报 `UNAUTHORIZED` / `SCOPE_DENIED`。 |
| **报告引用与持久化** | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/runtime/src/application/delegation-controller.ts` | `apps/runtime/test/proactive-workflow-application.test.mjs`<br>`apps/runtime/test/delegation-controller.test.mjs`<br>`tests/manual/agentarts/test-version-delegation.test.mjs` | `ingestSubtaskFeedback` 生成 `runtime:subtask-report:${childTaskId}:${revision}` 引用与摘要，写入不可变事件日志；`delegation-controller` 以 `toolArgumentsDigest` 在子任务落盘 `delegation:controller:${reportId}`，并在父任务建立 `delegation:child:${subtaskId}` 引用。 |
| **task.progress 到父任务等待端** | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/runtime/src/application/delegation-controller.ts`<br>`apps/runtime/src/application/runtime-application.ts` | `apps/runtime/test/proactive-workflow-application.test.mjs`<br>`apps/runtime/test/delegation-controller.test.mjs` | `ingestSubtaskFeedback` 调用 `runtime.recordProgress(parentTaskId, ...)`；`consumeOriginalChildControllerAdvice` 在父任务原子投递 `task.progress`；父任务在等待子任务期间状态投射为 `waiting_approval` / `waiting_reconciliation`，子任务终态后通过 `resumeTask` 唤醒。 |
| **teacher 建议受限于原授权** | `apps/runtime/src/application/delegation-controller.ts` | `apps/runtime/test/delegation-controller.test.mjs`<br>`tests/manual/agentarts/test-version-delegation.test.mjs` | 当主控决策为 `request_controller` 时，强校验子任务初始冻结的 `subtask-tools-binding`；建议的 `nextTool` 必须在原绑定清单内，未注册或漂移报错 `UNSUPPORTED_CAPABILITY`；**全程严禁调用 `policy.grant`，不扩大或新造任何权限**。 |
| **旧 revision 与状态冲突拒绝** | `apps/runtime/src/application/proactive-workflow-application.ts`<br>`apps/runtime/src/application/delegation-controller.ts` | `apps/runtime/test/proactive-workflow-application.test.mjs`<br>`apps/runtime/test/delegation-controller.test.mjs`<br>`tests/manual/agentarts/test-version-delegation.test.mjs` | `expectedRevision` 与子任务实际 `child.revision` 不一致时抛出 `REVISION_CONFLICT`；父任务或子任务处于 `cancelling` / `cancelled` 或父任务已终态时，均拒绝受理新报告。 |
| **取消 / 终态 / 超时处理** | `apps/runtime/src/application/delegation-controller.ts`<br>`apps/runtime/src/application/proactive-workflow-application.ts` | `apps/runtime/test/delegation-controller.test.mjs`<br>`tests/manual/agentarts/test-version-delegation.test.mjs` | `signal.aborted` 报 `CANCELLED`；deadline 耗尽报 `TIMEOUT`；重复调用且处于未决状态时返回 `RESULT_UNKNOWN` 要求核实，不盲目重放模型调用。 |
| **无 controller consumer 诚实返回** | `apps/runtime/src/application/proactive-workflow-application.ts` | `apps/runtime/test/proactive-workflow-application.test.mjs`<br>`apps/desktop/test/proactive-controller-wiring.test.mjs` | 当 `options.controller` 未提供时，`ingestSubtaskFeedback` 返回 `{state: 'pending', unavailable: 'controller_consumer'}`，绝不假装已确认；`reconcileControllerReport` 抛出 `UNSUPPORTED_CAPABILITY` 拒绝假读回。 |

### 1.2 生产装配与测试 Helper 真实调用方划分

1. **生产装配中的真实调用方**：
   - `apps/runtime/src/application/runtime-application.ts`：
     - 当公开工具 `subagent.dispatch` 成功返回并确认时（行 1134-1142），自动遍历子任务并调用 `proactive.ingestSubtaskFeedback`。
     - 当子任务执行进入终态（`onSubagentTerminal`，行 5113-5118）且父任务未取消时，自动触发 `proactive.ingestSubtaskFeedback`。
     - 父任务在派发执行期间保存 `subagent-parent-wait`，状态转入 `waiting_approval`，并在子任务终态后通过 `resumeTask` 恢复父任务执行循环。
   - `apps/desktop/electron/main.js`（行 1978）：
     - 将 `createDesktopProactiveControllerHost({getRuntime: () => runtimeApplication?.runtime})` 注入主动工作流应用。注意：Desktop 当前 facade 仅根据子任务 `state === 'failed' ? 'request_controller' : 'continue'` 进行确定性状态归档并返回 receiptRef，不伪造复杂大模型推理。
2. **测试 Helper / 离线原型与生产边界**：
   - `apps/runtime/src/application/delegation-controller.ts` 的 `consumeOriginalChildControllerAdvice`：
     - 实现了 CW-07 规格中完整的持久报告消费、教师建议原工具约束检查（`subtask-tools-binding`）与进度原子落盘。该函数由 `delegation-controller.test.mjs` 直接测试，目前未在 Desktop 前端暴露，避免在缺少真实云端高级主控时以 Fake 冒充生产能力。
   - `tests/manual/agentarts/test-version-delegation.mjs` 中的 `createTestVersionDelegationTools`：
     - 文件明确注明 `Test-host tools only`，用于模拟离线模型及自适应选择器测试，不作为生产包暴露。

---

## 2. 本地可验证补充与测试覆盖

为确保生产装配中「无 controller consumer 时明确返回 pending/unavailable 而不是假装已读」具备完备的回归保护，在 `apps/runtime/test/` 补充了针对性 fixture 验证：

1. **`apps/runtime/test/proactive-workflow-application.test.mjs`**：
   - 新增测试用例：`without controller consumer, bound child report is pending and unavailable: controller_consumer, and reconciliation rejects`。
   - 验证在没有配置 `controller` 的场景下：
     - 子任务终态后自动触发的反馈使 `controllerReports[eventId]` 进入 `pending` 状态且无 `receipt`；
     - 向父任务写入 `task.progress`；
     - 重入反馈返回 `RESULT_UNKNOWN`；
     - 尝试调用 `reconcileControllerReport` 诚实抛出 `UNSUPPORTED_CAPABILITY`，不假造回执。
2. **`apps/runtime/test/delegation-controller.test.mjs`**：
   - 补充对缺少 `ports.advise` 时抛出 `UNSUPPORTED_CAPABILITY` 的断言；
   - 补充父任务取消（`parent.cancelRequested`）时拒绝新报告（`REVISION_CONFLICT`）的断言。

---

## 3. 本地实际运行与检查结果

| 命令 | 检查项 | 结果 |
| --- | --- | --- |
| `npm run build --workspace=@personal-agent/runtime` | Runtime TypeScript 编译与类型检查 | 成功（0 错误） |
| `npm run test --workspace=@personal-agent/agents` | Agent 工作区测试 | 40 passed, 0 failed, 0 skipped |
| `node --test apps/runtime/test/delegation-controller.test.mjs apps/runtime/test/user-task-delegation.test.mjs apps/runtime/test/subagent-host.test.mjs apps/runtime/test/subagent-conversation.test.mjs apps/runtime/test/proactive-workflow-application.test.mjs tests/manual/agentarts/test-version-delegation.test.mjs` | Runtime 与委派/主控/会话端到端夹具测试 | 79 passed, 0 failed, 0 skipped |
| `npm run test --workspace=@personal-agent/coordination` | Coordination 工作区测试 | 243 passed, 0 failed, 0 skipped |
| `npm run check:architecture` | 架构边界与分层门禁检查 | 3 passed, 0 failed |
| `git diff --check` | 差异格式、空白与冲突标记校验 | 洁净通过，无警告 |

---

## 4. 仍需真实验收项（线下/平台环境）

以下项目受限于本地环境、账号与网络边界，本轮未予宣称完成，保持 `in_progress` 或 `unavailable`：

1. **真实模型分配与决策质量**：
   - 本地测试全部使用 `FakeModelProvider` 或结构化决策桩；真实运行中基于华为盘古/大模型的角色分配、规划质量及复杂上下文推理需在线验收。
2. **真实高级主控 Receipt 消费**：
   - Desktop facade 目前仅提供轻量状态映射；真正的高级主控（由独立云端 Agent 角色消费子任务结构化报告并给出下一步执行策略）尚未接入真实模型，保持真实 unavailable。
3. **AgentArts 真实协同联跑**：
   - 真正的云端 AgentArts 多 Agent 工作流编排、trace 读回与评估集打分需依赖真实云凭据与平台端点。
4. **`tests/manual/agentarts/test-version-delegation.test.mjs` 真实版本运行**：
   - 该测试文件在本机使用 Fake 模型已 7/7 通过；其实体云版本需要真实华为云 AgentArts 运行时与有效配置，受硬性限制要求未连接真实云环境。
