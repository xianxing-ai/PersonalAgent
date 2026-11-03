# CW-06 主影选择收益：日常任务 Sampling 接线与台账汇总证据（2026-11-04）

> 目标 Profile：`huawei_ict_agentarts`  
> 任务包：CW-06「主影选择收益：日常任务的 sampling 接线」  
> 责任人：zemeng5208  
> 工作分支：`zemeng/cw06-daily-sampling`（基于 PR #543 head `codex/pr531-cloud-persistent`）  
> 依据文件：[COLLABORATOR_WIRING_PACKAGE.md](../COLLABORATOR_WIRING_PACKAGE.md) 第 42/59 行、[OWNED_CONVERSATION_WIRING_20261018.md](../OWNED_CONVERSATION_WIRING_20261018.md) 第 47 行、[CW02_CW06_F23_F26_CODE_20261103.md](CW02_CW06_F23_F26_CODE_20261103.md)。

---

## 1. 基线核实与覆盖矩阵

核查日常（非 `compare`、非 `special-serial-pair`）Competition 选择在生产执行路径（Runtime/Desktop 执行 owned workflow 时）中的写入、只读读回汇总、幂等去重与收益边界：

| 校验条目 | 核心实现 | 生产调用者 | 测试覆盖 | 结论与基线状态 |
| --- | --- | --- | --- | --- |
| **日常 Competition 选择写入 sampling 台账** | `packages/agentarts/src/ordinary-competition-sampling.ts`（`admitOrdinaryCompetitionSampling`、`ordinaryCompetitionSamplingKey`）；`owned-workflow-host-bridge.ts`（`readReceiptWithShadow`） | `runRuntimeOwnedWorkflowDriver`（`apps/runtime/src/application/owned-workflow-driver.ts`）在节点回读处优先调用 `options.bridge.readReceiptWithShadow`；F20 worker capability 透传该方法，但**创建 host 时未传 `shadow`**（`owned-workflow-worker-capability.ts` 第 139–140 行），见 §1.1 | `apps/runtime/test/owned-workflow-sampling-integration.test.mjs`；`packages/agentarts/test/owned-workflow-shadow.test.mjs` | **仅完成驱动侧接线**：基线驱动原本仅调用 `readReceipt`，现在 bridge 提供 `readReceiptWithShadow` 时优先调用。只有调用方给 host 配置了 `options.shadow` 时才会写台账（集成测试自行构造带 shadow 的 host）；**F20 生产路径目前写入 0 条台账**，见 §1.1。 |
| **台账只读读回与纯函数汇总** | `packages/agentarts/src/ordinary-competition-sampling-summary.ts`（`summarizeOrdinaryCompetitionSampling`、`collectOrdinaryCompetitionSamplingRecords`、`isOrdinaryCompetitionSamplingRecord`） | 供只读查询客户端、台账读回接口、状态统计工具调用；从 index 导出 | `packages/agentarts/test/ordinary-competition-sampling.test.mjs`；`apps/runtime/test/owned-workflow-sampling-integration.test.mjs` | **新增实现**：纯函数汇总机会总数、`run/defer/skip/need_teacher` 四状态分布、`sampled` 计数、`unknownRatio` 比例，保持 `totalBenefit` 与 `averageBenefit` 绝不隐式推断。 |
| **重启与重复读回幂等不重复计数** | Checkpoint key `owned-workflow:ordinary-sampling:${operationId}:${hash}` 经 `writeOnce` 持久化；汇总纯函数按 `JSON.stringify([taskKey, decisionRef])` 分组去重，同一机会多版本按 §1.2 规则确定性合并 | `OwnedWorkflowHostBridge`、SQLite TaskRuntime | `packages/agentarts/test/ordinary-competition-sampling.test.mjs`；`apps/runtime/test/owned-workflow-sampling-integration.test.mjs` | **完整验证**：SQLite reopen 重启、多次重复扫描同一 checkpoint 记录，`totalOpportunities` 保持为 1，`duplicateRecordCount` 精确累加，不虚增机会与收益。 |
| **缺影子/缺资源计量保持 unknown 不伪造收益** | `admitOrdinaryCompetitionSampling`（`packages/agentarts/src/ordinary-competition-sampling.ts`）；`summarizeOrdinaryCompetitionSampling` | `OwnedWorkflowHostBridge.readReceiptWithShadow` | `packages/agentarts/test/ordinary-competition-sampling.test.mjs`；`packages/agentarts/test/workflow-shadow-policy.test.mjs` | **严格保持**：缺影子时 `comparison.status === 'unknown'`、`benefit === null`；纯函数汇总在无 `comparable` 记录时 `totalBenefit === null`、`averageBenefit === null`，`executedCount === 0`，`executed === false` 绝不伪造。 |
| **专项 compare 与 special-serial-pair 不入日常台账** | `admitOrdinaryCompetitionSampling` 拒绝非 `ordinary` 与 `special-serial-pair`；`readReceiptWithShadow` 仅在 `plan.mode === 'ordinary' && !comparisonRequested` 写入 | `OwnedWorkflowHostBridge`、`runRuntimeOwnedWorkflowDriver` | `packages/agentarts/test/ordinary-competition-sampling.test.mjs`；`apps/runtime/test/owned-workflow-sampling-integration.test.mjs` | **严格隔离**：`plan.mode === 'compare'` 执行时 checkpoint 不写入任何 `owned-workflow:ordinary-sampling:` 键。 |

### 1.1 F20 生产路径的实际行为（2026-11-04 交叉审阅后更正）

此前本文与 PR 描述写“`createRuntimeOwnedWorkflowHost` 透传 `options.shadow` 并在 worker capability 中注入”“F20 台账只会记 defer 和 unknown”，**都不准确**。核实结果如下：

- F20 worker capability 调用 `createRuntimeOwnedWorkflowHost(application,{receiptSecret,parentTaskId,assertActive})` 时**没有传 `shadow`**（`apps/runtime/src/application/owned-workflow-worker-capability.ts` 第 139–140 行）。
- `OwnedWorkflowHostBridge.readReceiptWithShadow` 只在 `this.options.shadow` 存在的分支里调用 `admitOrdinaryCompetitionSampling`，并写入 `owned-workflow:ordinary-sampling:*`（`packages/agentarts/src/owned-workflow-host-bridge.ts` 第 227–259 行）。
- 没有 shadow 时：
  - 只写一条 `owned-workflow:shadow-evaluation:*`，内容为 `policy.action='defer'`、`reason='trusted_shadow_policy_host_unavailable'`、`comparison.status='unknown'`（第 225–226 行、第 268 行）；
  - receipt 中加入 `shadowEvaluation`，proof 加入 `shadowDigest` 并重签。
- **结论：当前 F20 生产路径写入的日常 sampling 台账为 0 条。** 台账要等可信 shadow host 在组合层接入后才会产生。本 PR 只把驱动的读回入口打通。集成测试 `owned-workflow-sampling-integration.test.mjs` 自行用 `app.createOwnedWorkflowHost({shadow})` 构造 bridge，不经过 F20 worker capability。
- F20 路径的行为变化需要 goo122 确认，即上述 shadow-evaluation checkpoint、重签 proof，以及 deadline 校验带来的新失败模式。镜像侧对重签 proof 的兼容性未验证。

### 1.2 汇总合并规则与 fail-closed 说明（2026-11-04 补充）

- **去重 key**：`JSON.stringify([taskKey, decisionRef])`。原来的 `taskKey:decisionRef` 拼接会把 (`a:b`,`c`) 与 (`a`,`b:c`) 误判为同一个机会。
- **同一机会有多条不同记录**时（例如 `refreshShadowReceipt` 或重启后重新评估），按下面的规则确定性合并：
  1. `comparable` 优先于 `unknown`。后到的已验证反事实覆盖缺失的反事实；unknown 不能抹掉已验证收益，也不会推断收益。
  2. 状态相同时，取规范化 JSON 字典序最小的一条。
  3. 不使用“最新”：记录里没有可信时间戳。
- 合并结果与输入顺序无关。新增 `conflictingOpportunityCount` 字段，统计出现多版本的机会数，使冲突可见。
- **fail-closed 是有意设计。** `isOrdinaryCompetitionSamplingRecord` 遇到 kind/version 匹配但执行标记缺失或不正确的记录时，会抛 `INVALID_ARGUMENT`，`collect…` 和 `summarize…` 随之整体失败。这类记录只可能来自台账损坏或伪造；静默跳过会让台账看起来更小、更“干净”。其他形状不匹配的记录返回 false 并跳过。这一行为已写入 JSDoc，并有测试覆盖。
- 生产中目前没有按前缀列出台账 key 的只读入口，调用方需要自行提供 key（需要 goo122 在 Runtime 侧补充）。

---

## 2. 改动文件与目的说明

本次改动严格遵守 `AGENTS.md` 架构边界与硬性限制：不修改他人正在改动的 4 个文件（`owned-workflow-data.ts`、`workflow-adapters.ts`、`workflow-keys.ts`、`proactive-host-proofs.ts`）；不修改前端 Renderer 与业务连接器；Policy 与 Runtime 保持最小接线，不放宽授权，不调用 `policy.grant`，不注入 `ownedWorkflowWorker`，不读凭据不连云。

1. **`packages/agentarts/src/ordinary-competition-sampling-summary.ts`**（新增）：
   - 提供 `isOrdinaryCompetitionSamplingRecord` 类型防护，严格拦截 `executed: true` 的虚假执行声明；
   - 提供 `summarizeOrdinaryCompetitionSampling` 纯函数汇总，计算 `totalOpportunities`、`actions` 分布（`run`, `defer`, `skip`, `need_teacher`）、`sampledCount`、`comparisons`（`unknown`, `comparable`）、`unknownRatio`；无可比证据时 `totalBenefit: null`、`averageBenefit: null`，`executedCount: 0`、`executed: false`、`admissionIsNotExecution: true`；
   - 提供 `collectOrdinaryCompetitionSamplingRecords` 纯函数辅助工具，从 checkpoint 存储中安全读回台账记录。
2. **`packages/agentarts/src/index.ts`**（修改 1 行）：
   - 增加 `export * from './ordinary-competition-sampling-summary.js';`，公开导出只读汇总纯函数与接口。
3. **`apps/runtime/src/application/owned-workflow-driver.ts`**（修改 7 行）：
   - 扩展 `RuntimeOwnedWorkflowDriverOptions['bridge']` 类型，允许包含可选的 `readReceiptWithShadow`；
   - 在主循环执行 `host-readback` 阶段，优先调用 `options.bridge.readReceiptWithShadow`（若可用），回退调用原 `options.bridge.readReceipt`，打通日常 Competition 选择节点的 sampling 写入链。
4. **`apps/runtime/src/application/owned-workflow-worker-capability.ts`**（修改 1 行）：
   - 在包装 `bridge` 对象时补充透传 `readReceiptWithShadow: host.readReceiptWithShadow.bind(host)`。
5. **`packages/agentarts/test/ordinary-competition-sampling.test.mjs`**（扩充测试）：
   - 覆盖汇总纯函数统计、重复记录幂等去重、`special-serial-pair` 与 `compare` 模式拦截、缺影子保持 unknown、无可比样本时 benefit 恒为 null、伪造 executed 严格拒绝、checkpoint 提取工具功能验证。
6. **`apps/runtime/test/owned-workflow-sampling-integration.test.mjs`**（新增集成测试）：
   - 在真实 SQLite TaskRuntime 环境中，通过 `runRuntimeOwnedWorkflowDriver` 驱动包含决策节点的 owned workflow，验证 `readReceiptWithShadow` 被调用并将 sampling 台账持久化至 SQLite `task_checkpoints`；
   - 验证纯函数汇总与重启 reopen 后重复读回的幂等性；
   - 验证 `compare` 模式不污染日常台账。

---

## 3. 本地实际运行命令与结果

### 3.1 架构门禁检查
```bash
npm run check:architecture
```
输出：
```
✔ workspace dependencies obey the documented architecture boundaries (88.058691ms)
✔ the standard check gates root integration tests after workspace build and tests (0.751707ms)
✔ the integration runner serially discovers every root integration test without filtering failures (0.162054ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
```

### 3.2 Workspace 构建
```bash
npm run build --workspace=@personal-agent/agentarts
npm run build --workspace=@personal-agent/runtime
```
两项构建均 0 警告 0 错误顺利完成，TypeScript 类型定义（`dist/*.d.ts`）同步生成。

### 3.3 单元与集成测试运行
```bash
node --test --test-isolation=none \
  packages/agentarts/test/ordinary-competition-sampling.test.mjs \
  packages/agentarts/test/owned-workflow-shadow.test.mjs \
  packages/agentarts/test/workflow-shadow-policy.test.mjs \
  packages/agentarts/test/workflow-shadow-release.test.mjs \
  apps/agentarts-runtime/test/trace-replay.test.mjs \
  apps/runtime/test/owned-workflow-sampling-integration.test.mjs \
  apps/runtime/test/owned-workflow-driver.test.mjs \
  apps/runtime/test/owned-workflow-host-bridge.test.mjs
```
输出摘要：
```
✔ exact historical read returns original record/result/Evidence without new execution or counterfactual claims (3.146738ms)
...
✔ owned workflow driver wiring invokes readReceiptWithShadow, checkpoints ordinary sampling into SQLite, and summarizes truthfully (39.971694ms)
✔ compare mode does not write ordinary competition sampling ledger in SQLite (29.156332ms)
✔ an ordinary run admission records unknown benefit and is not execution (0.249592ms)
✔ same-baseline qualities keep the host benefit; a special serial pair is rejected (0.232307ms)
✔ summarizeOrdinaryCompetitionSampling aggregates actions and preserves unknown counterfactual ratio (0.245253ms)
✔ deduplication is idempotent across restarts and repeated readbacks (0.186152ms)
✔ special-serial-pair and compare modes are excluded from ordinary ledger and rejected (0.1737ms)
✔ missing shadow and missing resources keep comparison unknown without inferred benefit (0.115828ms)
✔ summary accurately aggregates verified benefit only when comparable evidence exists (0.223682ms)
✔ forged execution claims in records are strictly rejected by summary (0.112808ms)
✔ collectOrdinaryCompetitionSamplingRecords safely retrieves records from checkpoint port (0.201693ms)
...
ℹ tests 73
ℹ suites 0
ℹ pass 73
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
2026-11-04 复跑：全部 **73/73** 通过（Node v24，`--test-isolation=none`，命令见上）。各文件的通过数如下：

- ordinary-competition-sampling：12（含新增 3 项：顺序无关合并、冒号不碰撞、损坏记录 fail-closed）
- owned-workflow-shadow：14
- workflow-shadow-policy：7
- workflow-shadow-release：15
- trace-replay：10
- sampling-integration：2
- owned-workflow-driver：11
- owned-workflow-host-bridge：2

原 PR 描述中的 “57/57” 无法按任何记录过的文件组合复现，已作废。

Runtime 回归：`apps/runtime/test/{owned-workflow-*,f20-verify-completion,proactive-task-driver,workflow-f24-*}.test.mjs` 共 88 项，87 通过、0 失败、1 跳过（F24 用例原本即为 SKIP）。Desktop `f20-workflow-worker-ports`：2/2 通过。

### 3.4 格式与空白检查
```bash
git diff --check
```
无任何空白异常输出，退出码为 0。

---

## 4. 仍未完成的真实验收与边界声明

> [!IMPORTANT]
> **台账准入（Admission）绝不等于执行（Execution），台账记录不构成收益验收。**

当前代码仅实现了日常竞争任务在本地受控宿主环境中的采样策略评估、持久化台账记录与只读纯函数汇总读回。以下真实生产与平台验收项**尚未完成**，后续继续保持 `not_performed` / `unknown`：

1. **真实资源计量**：
   当前夹具与测试中的资源快照（`mainPriorityAvailable`、`shadowAllowed`、`taskValueEligible`）由宿主测试策略提供，未接入实体 Windows/Linux 宿主的真实 CPU/内存压力读数、GPU 利用率和模型网关 Token 实际消耗监控。
2. **真实质量分判定**：
   质量打分（`qualityScore`、`wallMs`、`modelCalls`）目前来自固定夹具；真实场景中依赖华为 AgentArts 评测任务或真实代码/测试验证回执的读回打分。
3. **同版本反事实真实执行**：
   影子分支在日常任务中仅作为准入记录（`executed: false`），尚未在物理隔离的镜像/工作区中并行或异步执行真实影子候选，因此反事实比较状态必须保持 `comparison: { status: 'unknown', reason: 'missing_counterfactual' }`，绝不虚构基线差异或正向收益。
4. **真实线上机会分布与采样调优**：
   自适应采样率公式（`adjustmentRate * (wins - losses) / n`）已具备历史持久化与纯函数计算能力，但真实收益样本依赖后续生产数据积累，目前无真实业务样本。
5. **AgentArts 平台评估读回**：
   未调用华为云 AK/SK，未触发 AgentArts 远端真实评估任务流水线；真实平台验收按既定路线在受控实机环境单独执行。
