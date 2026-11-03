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
| **日常 Competition 选择写入 sampling 台账** | `packages/agentarts/src/ordinary-competition-sampling.ts`（`admitOrdinaryCompetitionSampling`、`ordinaryCompetitionSamplingKey`）；`owned-workflow-host-bridge.ts`（`readReceiptWithShadow`） | `runRuntimeOwnedWorkflowDriver`（`apps/runtime/src/application/owned-workflow-driver.ts`）在节点回读处优先调用 `options.bridge.readReceiptWithShadow`；`createRuntimeOwnedWorkflowHost` 透传 `options.shadow` 并在 worker capability 中注入 | `apps/runtime/test/owned-workflow-sampling-integration.test.mjs`；`packages/agentarts/test/owned-workflow-shadow.test.mjs` | **已完成最小接线**：基线驱动原本仅调用 `readReceipt`，现支持若 bridge 提供 `readReceiptWithShadow` 则优先调用，在日常决策确认时将台账写入真实 SQLite `task_checkpoints`。 |
| **台账只读读回与纯函数汇总** | `packages/agentarts/src/ordinary-competition-sampling-summary.ts`（`summarizeOrdinaryCompetitionSampling`、`collectOrdinaryCompetitionSamplingRecords`、`isOrdinaryCompetitionSamplingRecord`） | 供只读查询客户端、台账读回接口、状态统计工具调用；从 index 导出 | `packages/agentarts/test/ordinary-competition-sampling.test.mjs`；`apps/runtime/test/owned-workflow-sampling-integration.test.mjs` | **新增实现**：纯函数汇总机会总数、`run/defer/skip/need_teacher` 四状态分布、`sampled` 计数、`unknownRatio` 比例，保持 `totalBenefit` 与 `averageBenefit` 绝不隐式推断。 |
| **重启与重复读回幂等不重复计数** | Checkpoint key `owned-workflow:ordinary-sampling:${operationId}:${hash}` 经 `writeOnce` 持久化；汇总纯函数按 `${taskKey}:${decisionRef}` 去重 | `OwnedWorkflowHostBridge`、SQLite TaskRuntime | `packages/agentarts/test/ordinary-competition-sampling.test.mjs`；`apps/runtime/test/owned-workflow-sampling-integration.test.mjs` | **完整验证**：SQLite reopen 重启、多次重复扫描同一 checkpoint 记录，`totalOpportunities` 保持为 1，`duplicateRecordCount` 精确累加，不虚增机会与收益。 |
| **缺影子/缺资源计量保持 unknown 不伪造收益** | `admitOrdinaryCompetitionSampling`（`packages/agentarts/src/ordinary-competition-sampling.ts`）；`summarizeOrdinaryCompetitionSampling` | `OwnedWorkflowHostBridge.readReceiptWithShadow` | `packages/agentarts/test/ordinary-competition-sampling.test.mjs`；`packages/agentarts/test/workflow-shadow-policy.test.mjs` | **严格保持**：缺影子时 `comparison.status === 'unknown'`、`benefit === null`；纯函数汇总在无 `comparable` 记录时 `totalBenefit === null`、`averageBenefit === null`，`executedCount === 0`，`executed === false` 绝不伪造。 |
| **专项 compare 与 special-serial-pair 不入日常台账** | `admitOrdinaryCompetitionSampling` 拒绝非 `ordinary` 与 `special-serial-pair`；`readReceiptWithShadow` 仅在 `plan.mode === 'ordinary' && !comparisonRequested` 写入 | `OwnedWorkflowHostBridge`、`runRuntimeOwnedWorkflowDriver` | `packages/agentarts/test/ordinary-competition-sampling.test.mjs`；`apps/runtime/test/owned-workflow-sampling-integration.test.mjs` | **严格隔离**：`plan.mode === 'compare'` 执行时 checkpoint 不写入任何 `owned-workflow:ordinary-sampling:` 键。 |

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
ℹ tests 70
ℹ suites 0
ℹ pass 70
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2073.599193
```
全部 70 项测试（包含 9 项 ordinary sampling 专项单元测试、2 项 driver 真实 SQLite 集成测试）全量通过。

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
