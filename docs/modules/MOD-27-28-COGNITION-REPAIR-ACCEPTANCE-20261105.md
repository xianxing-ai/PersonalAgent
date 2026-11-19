# MOD-27 与 MOD-28 认知重规划、版本图谱与 reportVersion: "1.2" 契约验收记录（2026-11-05）

<!-- current-design-20261015 -->
> 当前协作与分工入口：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人完成本模块实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。

- **责任人**：Flash（受 `zemeng5208` 委派，承接 Sonnet 任务包，经核心分配者 `69d0e30c-bbb9-4f72-89ce-32ed14bd7774` 授权）
- **基线 Commit**：`855a90c4e402ea298b4cbf301ef6ad0153be992c`
- **隔离工作树**：`D:/PersonalAgent/.worktrees/flash-voice-observability`
- **工作分支**：`codex/flash-voice-observability`
- **目标 Profile**：`huawei_ict_agentarts`
- **涉及模块**：
  - `packages/goals/`（MOD-27 目标与事实版本图谱、AtomicCoordinationStorePort）
  - `packages/cognition/`（MOD-28 因果影响分析、最小修复候选与审核）
  - `packages/agentarts/`（MOD-04B Owned 编排 World/Plan/Review 1.2 报告解析门禁）
  - `packages/coordination/`（协调器契约门禁、repairSources 与继续轮次）

---

## 一、 F03 世界状态、目标与局部重规划闭环（MOD-27 / MOD-28）

### 1. 原子批量提交与读回（AtomicCoordinationStorePort.appendBatch）
- **门禁特性**：
  - 单次 CAS 保护整个有序批量提交，提交前做纯纯预检（`appendVersions`）。
  - 严格校验 `expectedRevision`，一旦检测到图谱版本落后或竞争修改立即抛出 `REVISION_CONFLICT`，且不产生任何部分写入。
  - 事实撤回（`state: 'withdrawn'`）与到期事实通过版本追加记录历史，旧版本保持不可变且可回读（`store.read(revision)`）。
- **验证证据**：
  - `packages/goals/test/atomic-store.test.mjs` 增补测试：`AtomicCoordinationStorePort commits batch atomically with Fact withdrawal, expiry and readback`。
  - `@personal-agent/goals` 全部 20/20 测试通过（耗时约 320ms）。

### 2. 因果影响分析与最小修复候选（analyzeImpact / buildMinimalRepairCandidate / prepareReviewedRepair）
- **因果拓扑与传播**：
  - `analyzeImpact` 基于完整拓扑重放，当依赖的上游事实发生版本演进（superseded）、撤回（withdrawn）或失效（not_effective）时，精确将下游非 Fact 节点标记为 `RECHECK` 并记录因果项（`causes`）。
  - `buildMinimalRepairCandidate` 仅针对 `RECHECK` 节点重绑结构依赖版本，保留原有 summary 与 reason，不自动发明新节点，严格要求语义审查（`semanticReviewRequired: true`）。
  - `prepareReviewedRepair` 对审阅选项（`review.selectedOption`）及候选（`candidate`）做双重防伪与范围限制：
    - 校验 `review.graphRevision === snapshot.revision` 与 `expectedGraphRevision === snapshot.revision`，若版本落后抛出 `REVISION_CONFLICT`。
    - 范围限定在 `review.affected` 之内，严禁越界修改未受影响节点。
- **验证证据**：
  - `packages/cognition/test/reviewed-repair.test.mjs` 增补测试：`Fact withdrawal and expiry propagate to impact analysis and prepareReviewedRepair rejects revision conflict`。
  - `@personal-agent/cognition` 全部 241/241 测试通过（耗时约 3.1s）。

---

## 二、 Owned 编排 reportVersion: "1.2" 与 repairSources 契约门禁核验

### 1. 三阶段报告解析门禁（World -> Plan -> Review）
- **严格版本一致性**：
  - 含有 Goal target 时强制要求完整 `reportVersion: "1.2"`，`affected_items.kind` 必须为 `goal` 且与节点 kind 严格一致；仅 Decision/Plan target 允许使用 1.1。
  - Plan 报告的 `reportVersion` 必须与 World 报告完全相同，混版（如 World 1.1 + Plan 1.2 或 World 1.2 + Plan 1.1）在进入 Review 前直接被拒绝（`EXTERNAL_FAILURE`）。
  - Plan 报告的 `base_revision` 必须严格等于 `context.expectedGraphRevision`。
- **越界替换与未支持操作门禁**：
  - Plan 报告中修订步骤（`revised_steps`）只能落在 World 报告声明的 `affected` 范围内；若试图替换范围外的无关节点，抛出 `EXTERNAL_FAILURE`（Plan exceeds world impact scope）。
  - 若 Plan 包含删除（`removed_steps`）或后续本地动作（`local_next_actions`），由于当前公共候选仅支持摘要和依赖修订，明确返回 `UNSUPPORTED_CAPABILITY`（Plan requests operations outside the repair candidate contract），绝不伪装成成功。
- **验证证据**：
  - `packages/agentarts/test/report-parity.test.mjs` 增补用例：`Plan out-of-bounds substitution exceeding World impact scope is rejected with EXTERNAL_FAILURE`。
  - `packages/agentarts/test/report-parity.test.mjs` 全部 23/23 测试通过。

### 2. repairSources 延续轮次核验
- **sourceVersion: "1.0" 门禁**：
  - 检验 `repairSources` 的 `sourceVersion === "1.0"` 与 `expectedGraphRevision === context.expectedGraphRevision`。
  - 连续事实变化对（`changed_facts`）必须引用同时出现在 nodes 与 observed_facts 中的连续前后版本对，防止跳版本伪造。
- **验证证据**：
  - `packages/agentarts/test/continuation-sources.test.mjs` 全部通过。
  - `@personal-agent/coordination` 全部 241/241 测试通过。

---

## 三、 本机测试汇总

| 工作区 / 测试套件 | 测试数 | 结果 | 耗时 |
| --- | --- | --- | --- |
| `@personal-agent/goals` | 20 | 全部通过 (20 pass, 0 fail) | ~320ms |
| `@personal-agent/cognition` | 241 | 全部通过 (241 pass, 0 fail) | ~3.1s |
| `@personal-agent/coordination` | 241 | 全部通过 (241 pass, 0 fail) | ~2.5s |
| `packages/agentarts/test/report-parity.test.mjs` | 23 | 全部通过 (23 pass, 0 fail) | ~600ms |
| `@personal-agent/agentarts` 全量测试 | 240 | 全部通过 (240 pass, 0 fail) | ~3.7s |
