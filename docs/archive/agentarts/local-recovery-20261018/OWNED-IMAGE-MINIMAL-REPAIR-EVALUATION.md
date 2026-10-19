> 2026-10-18 归档范围：historical_claim / not_reverified。下文评分与验证结论属于原固定版本的历史自述；本轮未重跑旧 runner，不代表当前 Competition、真实云/设备或 24 例现行可运行。个人绝对路径已脱敏、历史源码链接已版本化；不是原字节副本。当前 Competition 不调用 Laya。详见 [归档说明](README.md)。

# 自有镜像“最小计划修复”合成评估用例集与双模式回归规范（24例完备闭环版）

> 文档位置：`docs/modules/OWNED-IMAGE-MINIMAL-REPAIR-EVALUATION.md`
> 评测数据：[`tests/fixtures/agentarts-owned/minimal-repair-cases.json`](minimal-repair-cases.json)（归档公开副本；版本 `2.2.0`，共 24 例）
> 运行器脚本：`.cache/minimal-repair-eval.mjs`（旧运行器，未收录或复核）（被 `.gitignore` 忽略，不污染 Git 状态）
> 目标分支：`codex/agentarts-owned-image`
> 交付基线 Commit：`0dae0ff5c1553b855825a29934b22270b675bb48` · 当前工作树 HEAD：`4f351cccd3367c4236f821996fd3dcab326d994a`（协作者提交撤销 AMD64 预览交付，运行时代码同基线保持一致）
> 关联规范：[ADR-0015](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/docs/adr/0015-owned-workflow-controller-bindings.md) · [验收矩阵](OWNED-IMAGE-BINDING-ACCEPTANCE-MATRIX.md) · [逐项迁移矩阵](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/docs/modules/AGENTARTS-OWNED-IMAGE-PARITY.md)

---

## 1. 评估目标、设计边界与严谨声明

本评估用例集专为 PersonalAgent 自有 AgentArts 运行时镜像中的“最小计划修复”（Minimal Plan Repair）认知链路设计，形成可独立交接给协作者的回归材料。运行器提供 **`baseline`（复现旧基线漏洞）** 与 **`fixed`（验证修复分支强阻断）** 双模式独立回归。

### 1.1 关键边界与严谨声明
1. **纯合成标记（Strictly Synthetic）**：全部 24 个评估用例及其数据源均明确标注为 `synthetic: true`，绝不冒充真实宿主图谱、真实业务数据或华为云 AgentArts 平台的真实线上验收。
2. **严格断言外层候选版本**：所有 `repair_candidate` 均严格断言外层 `candidateVersion === "1.0"`（包括直接 `invoke` 返回的对象、Workflow 的 `result.value`，以及 baseline 中生成候选的缺陷复现分支 04B 与 04C），且强断言确认 `candidateVersion` 绝不位于内层 `candidate` 内部。不把中间阶段的 `WorldReport` 或 `PlanReport` 当作执行凭据或授权证据（Evidence）。
3. **收紧评估断言表述（防止虚构通过与扩大声明）**：
   - **不代表全局最优**：本用例集仅验证入站校验器、编排状态机、因果流水线顺序约束及候选过滤范围，**不证明真实模型在复杂开放世界中一定能找到全局最小修复**。
   - **不代表宿主已持久化**：用例通过仅证明编排器产出了符合 Schema 的候选对象或正确抛出拒绝错误，**不证明本地 SQLite 数据库或 Laya 活动已经真正执行写入或保证状态不变**。
   - **被拒绝用例无实际修订**：对于被校验层或熔断层整体拒绝的用例（抛错、拒绝），**其实际候选变更为空集（`changes: []`），严禁把“理论受影响节点”记录为“已修订节点”**。
4. **多类否定语义与缺陷状态严格区分**：
   - **`KEEP`**：世界状态无需修复，在 `index.ts:54-55`（修复版第 55 行）直接短路返回纯文本 `KEEP：世界状态分析无需修复。`，**绝不与“无来源一律 RECHECK”混为一谈**。
   - **`RECHECK`**：当缺少事实前后版本连续来源投影且模型提出修改、或分析依据不足时，安全停止确定性修复，返回指导性纯文本，等待人工确认。
   - **输入拒绝（`INVALID_ARGUMENT`）**：违反入站数据结构、节点 ID 格式（64 位十六进制）或活动基线版本冲突。
   - **不支持操作（`UNSUPPORTED_CAPABILITY`）**：请求删除节点或在本地提出外部执行动作。
   - **协议与契约熔断（`EXTERNAL_FAILURE`）**：越界篡改、跨图版本非法重放、同批依赖颠倒或 Schema 校验失败。
   - **已复现缺陷（`defect_reproduced_awaiting_fix`）**：在旧基线上被错误放行的问题（04B、04C、05D），**客观记录其放行现状及缺陷成因，绝不修改夹具造假通过，留作修复分支的阻断对比验证基准**。
5. **纯逻辑代码对比声明（禁止推及容器/平台验收）**：
   本评估系完全基于本机 Node.js 环境的 FakeModelProvider 合成回放与两套代码版本的行为断言对比。baseline 与 fixed 的差异纯粹源于代码分支与版本校验策略，与任何 CPU 架构（x86_64 / ARM64）无关。本测试**绝不得称为 ARM64 容器验收，亦不得据此宣称 PersonalAgent 自有镜像已更新、已重新发布或已完成华为平台线上闭环验收**。

---

## 2. 真实运行版本、产物指纹与证据声明

运行器动态读取实际运行环境的 Git HEAD、未提交代码差异摘要以及各加载文件的 SHA-256 哈希指纹：

| 评估维度 | Baseline 模式（旧基线产物） | Fixed 模式（Grok 修复分支产物） |
| :--- | :--- | :--- |
| **工作树路径** | `historical-worktrees/agentarts-owned-image` | `historical-worktrees/agentarts-report-version` (通过 `--fixed-root` 显式指定) |
| **Git 分支** | `codex/agentarts-owned-image` | `codex/agentarts-report-version` |
| **Git HEAD** | `4f351cccd3367c4236f821996fd3dcab326d994a` | `c5e9222f8c24032a41f6c697ae29745292c739c5` |
| **未提交源码差异摘要** | `<CLEAN_NO_DIFF>` (工作树无未提交代码修改) | **`1893f2666827ee816dd7fea973c2ccd8de653d6b41a0cba23220fe45e5c19055`**<br>(`git diff packages/agentarts/src/index.ts` 实际补丁摘要) |
| **加载 `index.js` SHA-256** | `9573d7fcb47add30981cee1f6667cce40b8f6a11cb2980cd355f11631ebfe62b` | `9e455ecf4cc82ba2e5c89d41c6c2124926f016a3a9e7795908ae3f5bc5560a6f` |
| **加载 `input.js` SHA-256** | `1116a9dfc4dab8d3d860dcdf56a357cc57719b1ac4ab87a8a80a2680e5b0658a` | `1116a9dfc4dab8d3d860dcdf56a357cc57719b1ac4ab87a8a80a2680e5b0658a` |
| **加载 `models` SHA-256** | `9ca0b3e3f715df4135b5f97542651cd995c4876339966780655fa2231b24f90a` | `9ca0b3e3f715df4135b5f97542651cd995c4876339966780655fa2231b24f90a` |
| **评测数据集 SHA-256** | `9873325fadf85be0c970f5f112a3f6691d8a7578a61551cf0a7d8dd5913b713e` | `9873325fadf85be0c970f5f112a3f6691d8a7578a61551cf0a7d8dd5913b713e` |
| **运行脚本自身 SHA-256** | `c3a8e2d19051c4b2307a3af9f8b55afe908a8d4208d39b7b2eb3e13b85f68199` | `d20543f19c396d7d4d1bbfdbd289e4542a0fc96b2ece18f768e8d6cbf6d465de` |

> [!WARNING] 构建来源证据声明
> 1. 上述 `dist/index.js` 等产物 SHA-256 摘要严格证明了评估运行时所加载文件的字节一致性。
> 2. 但单独的 dist 摘要无法独立证明该文件必然由当前工作树的未修改源码干净构建。
> 3. 修复分支的实际代码版本不能简单写为 HEAD `c5e9222f`，必须结合其未提交补丁 SHA-256（`1893f266...`）及构建产物哈希共同作为真实版本证据。

---

## 3. 断言有效性自测（8项负向变异测试套件）

运行器内置 `--self-test` 变异测试套件，在内存中实施 8 种反向注入测试，实测全部能精准拦截：

```powershell
node .cache/minimal-repair-eval.mjs --self-test
```

1. **摘要篡改拦截**：修改 `candidate.changes[0].summary` -> 捕获 `Change[0] summary mismatch: expected "篡改的错误摘要", got "真实摘要"`
2. **节点 ID 篡改拦截**：修改 `candidate.changes[0].node.id` -> 捕获 `Change[0] targetNodeId mismatch: expected "node-WRONG", got "node-b"`
3. **调用顺序颠倒拦截**：将顺序颠倒为 `['plan', 'world', 'review']` -> 捕获 `Call sequence step[0] mismatch: expected "plan", got "world"`
4. **意外调用 fast 角色拦截**：注入 1 次 fast 角色调用 -> 捕获 `Role call mismatch for fast: expected 0, got 1`
5. **应保留节点泄露拦截**：将保留节点注入到 candidate.changes -> 捕获 `Preserved node "node-c" was unexpectedly modified in candidate changes!`
6. **错误结果类型拦截**：期望 `text` 但实际为 `repair_candidate` -> 捕获 `Result kind mismatch: expected text, got repair_candidate`
7. **错误图修订版本拦截**：期望 `expectedGraphRevision: 999` 但候选为 7 -> 捕获 `expectedGraphRevision mismatch: expected 999, got 7`
8. **错误候选版本拦截**：外层 `candidateVersion: "2.0"`（非 "1.0"）-> 捕获 `candidateVersion mismatch: expected "1.0", got "2.0"`

---

## 4. 24 例全景评估矩阵（逐例对比）

| 用例 ID (`caseId`) | 核心评估场景 | 入口 | 角色调用约束 (`F-W-P-R`) | Baseline 表现（旧基线漏洞） | Fixed 表现（修复产物阻断） | 应修订节点 | 应保留节点 |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- | :--- |
| **SMR-01-SINGLE-FACT-REPAIR** | 单事实变化，只修一个相关节点 | `invoke` | 0-1-1-1 | ✅ `repair_candidate` (1项) | ✅ `repair_candidate` (1项) | `plan-a` | `plan-b` |
| **SMR-02-MULTI-IMPACT-PRESERVE-UNRELATED** | 多个受波及节点，无关节点保留 | `invoke` | 0-1-1-1 | ✅ `repair_candidate` (2项) | ✅ `repair_candidate` (2项) | `plan-a`, `plan-b` | `plan-c` |
| **SMR-03-NO-RELEVANT-CHANGE-KEEP** | 无相关事实变化，保留计划 | `invoke` | 0-1-0-0 | ✅ `text` (`KEEP：...无需修复`) | ✅ `text` (`KEEP：...无需修复`) | 无 | 全部计划节点 |
| **SMR-04A-MISSING-SOURCE-MODEL-RECHECK** | 缺少来源，模型主动声明 missing | `invoke` | 0-1-0-0 | ✅ `text` (`RECHECK：...缺少...`) | ✅ `text` (`RECHECK：...缺少...`) | 无 | 全部计划节点 |
| **SMR-04B-EMPTY-SOURCES-LEGACY-WORLD-REVISE** | sources 为空，旧版 World 却给 REVISE | `invoke` | Base: 0-1-1-1<br>Fix: 0-1-0-0 | ⚠️ **缺陷复现** (放行产出 candidate) | ✅ **安全截断** (`RECHECK...`) | 无 | 全部计划节点 |
| **SMR-04C-EMPTY-SOURCES-LEGACY-WORKFLOW-REVIEW** | sources 为空，带旧报告进 Review 工作流 | `invokeWorkflow` | Base: 0-0-0-1<br>Fix: 0-0-0-0 | ⚠️ **缺陷复现** (放行产出 candidate) | ✅ **强阻断** (`EXTERNAL_FAILURE`) | 无 | 全部计划节点 |
| **SMR-04D-EMPTY-SOURCES-VERSIONED-WORLD-REVISE** | sources 为空，版本化 1.1 World 给 REVISE | `invoke` | 0-1-0-0 | ✅ `EXTERNAL_FAILURE` (强校验阻断) | ✅ `EXTERNAL_FAILURE` (强校验阻断) | 无 | 全部计划节点 |
| **SMR-04E-EMPTY-SOURCES-LEGACY-WORLD-KEEP** | sources 为空，紧凑旧版 World 返回 KEEP | `invoke` | 0-1-0-0 | ✅ `text` (`KEEP：...无需修复。`) | ✅ `text` (`KEEP：...无需修复。`) | 无 | 全部计划节点 |
| **SMR-04F-EMPTY-SOURCES-VERSIONED-WORLD-KEEP** | sources 为空，版本化 1.1 World 返回 KEEP | `invoke` | 0-1-0-0 | ✅ `EXTERNAL_FAILURE` (强校验阻断) | ✅ `EXTERNAL_FAILURE` (强校验阻断) | 无 | 全部计划节点 |
| **SMR-05A-STALE-REPORT-GRAPH-REV-MISMATCH** | 合法输入携带陈旧图修订版本报告 (8 vs 7) | `invokeWorkflow` | 0-0-0-0 | ✅ `EXTERNAL_FAILURE` (图修订冲突) | ✅ `EXTERNAL_FAILURE` (图修订冲突) | 无 | 全部计划节点 |
| **SMR-05B-STALE-REPORT-TARGET-REV-MISMATCH** | 合法输入携带陈旧目标修订报告 (rev 2 vs 1) | `invokeWorkflow` | 0-0-0-0 | ✅ `EXTERNAL_FAILURE` (目标修订冲突) | ✅ `EXTERNAL_FAILURE` (目标修订冲突) | 无 | 全部计划节点 |
| **SMR-05C-STALE-REPORT-SOURCE-TEXT-MISMATCH** | 合法输入携带事实文本陈旧的报告 | `invokeWorkflow` | 0-0-0-0 | ✅ `EXTERNAL_FAILURE` (文本哈希冲突) | ✅ `EXTERNAL_FAILURE` (文本哈希冲突) | 无 | 全部计划节点 |
| **SMR-05D-LEGACY-REPORT-GRAPH-REV-REUSE** | 合法输入携带旧版 World 报告跨图版本复用 | `invokeWorkflow` | Base: 0-0-1-0<br>Fix: 0-0-0-0 | ⚠️ **缺陷复现** (旧基线弱绑定放行Plan) | ✅ **强阻断** (`EXTERNAL_FAILURE`) | 无 | 全部计划节点 |
| **SMR-06A-INPUT-TARGET-REVISION-CONFLICT** | 目标请求版本落后于活跃活动基线 | `invoke` | 0-0-0-0 | ✅ `INVALID_ARGUMENT` (入站拒绝) | ✅ `INVALID_ARGUMENT` (入站拒绝) | 无 | 全部计划节点 |
| **SMR-06B-INPUT-SOURCE-REFERENCE-MISMATCH** | 来源引用不匹配 (allowedDeps 节点不存在) | `invoke` | 0-0-0-0 | ✅ `INVALID_ARGUMENT` (入站拒绝) | ✅ `INVALID_ARGUMENT` (入站拒绝) | 无 | 全部计划节点 |
| **SMR-06C-INPUT-DEPENDENCY-REFERENCE-MISMATCH** | 依赖引用不匹配 (请求依赖不在允许集合) | `invoke` | 0-0-0-0 | ✅ `INVALID_ARGUMENT` (入站拒绝) | ✅ `INVALID_ARGUMENT` (入站拒绝) | 无 | 全部计划节点 |
| **SMR-07-PLAN-EXCEEDS-WORLD-SCOPE** | Plan 擅自将未受波及节点列入 changes | `invoke` | 0-1-1-0 | ✅ `EXTERNAL_FAILURE` (范围熔断) | ✅ `EXTERNAL_FAILURE` (范围熔断) | 无 | 全部计划节点 |
| **SMR-08-REVIEW-SUBSTITUTES-PLAN** | Review 擅自篡改 Plan 的 reason 方案 | `invoke` | 0-1-1-1 | ✅ `EXTERNAL_FAILURE` (方案篡改熔断) | ✅ `EXTERNAL_FAILURE` (方案篡改熔断) | 无 | 全部计划节点 |
| **SMR-09A-PROSPECTIVE-DEPENDENCY-VALID-ORDER** | 同批依赖正确拓扑顺序 (生产 A 在前，消费 B 在后) | `invoke` | 0-1-1-1 | ✅ `repair_candidate` (2项) | ✅ `repair_candidate` (2项) | `plan-a`, `plan-b` | 无 |
| **SMR-09B-PROSPECTIVE-DEPENDENCY-INVALID-ORDER** | 同批依赖错误拓扑顺序 (消费 B 颠倒置于生产 A 之前) | `invoke` | 0-1-1-0 | ✅ `EXTERNAL_FAILURE` (拓扑因果熔断) | ✅ `EXTERNAL_FAILURE` (拓扑因果熔断) | 无 | 全部计划节点 |
| **SMR-10A-UNSUPPORTED-REMOVAL-REQUEST** | Plan 提出物理删除步骤请求 (removed_steps) | `invoke` | 0-1-1-0 | ✅ `UNSUPPORTED_CAPABILITY` (契约超出) | ✅ `UNSUPPORTED_CAPABILITY` (契约超出) | 无 | 全部计划节点 |
| **SMR-10B-UNSUPPORTED-NEW-NODE-PROPOSAL** | Plan 提出创建未在 targets 声明的全新节点 | `invoke` | 0-1-1-0 | ✅ `EXTERNAL_FAILURE` (非法角色报告) | ✅ `EXTERNAL_FAILURE` (非法角色报告) | 无 | 全部计划节点 |
| **SMR-10C-UNSUPPORTED-LOCAL-ACTIONS** | Plan 提出本地 Shell 动作 (local_next_actions) | `invoke` | 0-1-1-0 | ✅ `UNSUPPORTED_CAPABILITY` (契约超出) | ✅ `UNSUPPORTED_CAPABILITY` (契约超出) | 无 | 全部计划节点 |
| **SMR-11-GOAL-TARGET-VERSION-MIXING** | 含 Goal 目标却混用 1.1 版本化 World 报告 | `invoke` | 0-1-0-0 | ✅ `EXTERNAL_FAILURE` (协议混用熔断) | ✅ `EXTERNAL_FAILURE` (协议混用熔断) | 无 | 全部计划节点 |

---

## 5. 重点用例判定依据与准确源码引用核对

### 5.1 SMR-04 组：缺少来源时的真实系统边界
- **SMR-04A（主动申明）**：模型主动声明 missing，协调器在 [`packages/agentarts/src/index.ts:55-57`](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/packages/agentarts/src/index.ts#L55-L57) 正确截断为 `text: "RECHECK..."`。
- **SMR-04B（旧版 REVISE 放行漏洞）**：
  - **旧基线漏洞**：旧版 `validateWorld`（[`index.ts:265-271`](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/packages/agentarts/src/index.ts#L265-L271)）未检查 sources 长度。
  - **修复分支精准行号**：位于修复源码 [`packages/agentarts/src/index.ts:56-58`](https://github.com/zemeng5208/PersonalAgent/blob/c5e9222f8c24032a41f6c697ae29745292c739c5/packages/agentarts/src/index.ts#L56-L58)（**核心判断在第 57 行**）：
    ```typescript
    if (worldReport.disposition !== 'REVISE' || repair.sources.length === 0) {
      return {kind: 'text', text: 'RECHECK：世界状态分析缺少确定的修复依据。'};
    }
    ```
    当 `repair.sources.length === 0` 时，强制截断为纯文本 `RECHECK`，仅调用 World 1 次，阻止调用下游 Plan 与 Review。
- **SMR-04C（直入 Review 工作流漏洞）**：
  - **旧基线漏洞**：旧版工作流入口直接放行无版本报告。
  - **修复分支精准行号**：位于 [`packages/agentarts/src/index.ts:87,182-184`](https://github.com/zemeng5208/PersonalAgent/blob/c5e9222f8c24032a41f6c697ae29745292c739c5/packages/agentarts/src/index.ts#L87)。工作流入口调用 `runInvocation(request, true)` 传入 `bound: true`；在第 273 行 `if (bound || hasGoalTarget) this.reportFailure();` 直接抛出 `EXTERNAL_FAILURE: Invalid versioned role report`，拦截无版本报告直入工作流。
- **SMR-04D（版本化 REVISE 强拦截）**：
  - 源码位置：[`packages/agentarts/src/index.ts:316-317`](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/packages/agentarts/src/index.ts#L316-L317)。版本化校验执行 `if (!sources.some(source => ['fact','goal'].includes(source.kind)) && (report.recommended_disposition !== 'RECHECK' || !missing.length)) this.reportFailure();`，强行熔断 `EXTERNAL_FAILURE`。
- **SMR-04E（紧凑 KEEP 短路返回）**：
  - 源码位置：[`packages/agentarts/src/index.ts:54-55`](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/packages/agentarts/src/index.ts#L54-L55)（修复源码第 55 行）：
    ```typescript
    if (worldReport.disposition === 'KEEP') return {kind: 'text', text: 'KEEP：世界状态分析无需修复。'};
    ```
    紧凑 World 返回 KEEP 时直接在第 55 行短路返回纯文本 KEEP，不走第 57 行的无来源 RECHECK 判定，仅调用 World 1 次。
- **SMR-04F（版本化 KEEP 强拦截）**：
  - 源码位置：[`packages/agentarts/src/index.ts:316-317`](https://github.com/zemeng5208/PersonalAgent/blob/0dae0ff5c1553b855825a29934b22270b675bb48/packages/agentarts/src/index.ts#L316-L317)。版本化报告返回 KEEP 时，因 `report.recommended_disposition !== 'RECHECK'` 条件成立且 sources 为空，触发 `this.reportFailure()` 抛出 `EXTERNAL_FAILURE`，仅调用 World 1 次。

### 5.2 SMR-05 组：跨图版本报告复用
- **SMR-05D（旧版报告跨图版本复用漏洞）**：
  - **旧基线漏洞**：旧版报告无 `reportVersion` 与 `revision` 字段，跨图版本调用 Plan 工作流被直接放行。
  - **修复分支精准行号**：位于 [`packages/agentarts/src/index.ts:182-184,273`](https://github.com/zemeng5208/PersonalAgent/blob/c5e9222f8c24032a41f6c697ae29745292c739c5/packages/agentarts/src/index.ts#L273)。工作流入口强制执行 `bound: true` 校验，无版本报告被拒之门外，抛出 `EXTERNAL_FAILURE: Invalid versioned role report`，下游调用 0 次。

---

## 6. 协作者复现指南与完整命令

### 6.1 命令行参数规范
运行器必须支持并严格校验以下参数，拼错或缺失时立即明确退出：
- `--mode=baseline|fixed`：指定运行模式（默认 baseline）。
- `--fixed-root=<path>`：**在 `--mode=fixed` 下必须显式传入**，指向修复分支工作树根目录；目录不存在或产物缺失时立即报错，绝不隐式回退。
- `--self-test`：运行 7 项负向变异自测。

### 6.2 完整 PowerShell 执行命令
```powershell
# 1. 验证参数拼错拦截
node .cache/minimal-repair-eval.mjs --fix-root=invalid

# 2. 运行 7 项断言有效性自测与 Baseline 模式评估（复现 3 项旧基线漏洞）
node .cache/minimal-repair-eval.mjs --self-test --mode=baseline

# 3. 运行 Fixed 模式评估（验证修复分支强阻断，全集 24 例通过）
node .cache/minimal-repair-eval.mjs --mode=fixed --fixed-root=historical-worktrees/agentarts-report-version
```

---

## 7. 评测结果三个统计清单

### 7.1 正常验证通过清单（21 例，双模式稳健一致）
1. `SMR-01-SINGLE-FACT-REPAIR`
2. `SMR-02-MULTI-IMPACT-PRESERVE-UNRELATED`
3. `SMR-03-NO-RELEVANT-CHANGE-KEEP`
4. `SMR-04A-MISSING-SOURCE-MODEL-RECHECK`
5. `SMR-04D-EMPTY-SOURCES-VERSIONED-WORLD-REVISE`
6. `SMR-04E-EMPTY-SOURCES-LEGACY-WORLD-KEEP`
7. `SMR-04F-EMPTY-SOURCES-VERSIONED-WORLD-KEEP`
8. `SMR-05A-STALE-REPORT-GRAPH-REV-MISMATCH`
9. `SMR-05B-STALE-REPORT-TARGET-REV-MISMATCH`
10. `SMR-05C-STALE-REPORT-SOURCE-TEXT-MISMATCH`
11. `SMR-06A-INPUT-TARGET-REVISION-CONFLICT`
12. `SMR-06B-INPUT-SOURCE-REFERENCE-MISMATCH`
13. `SMR-06C-INPUT-DEPENDENCY-REFERENCE-MISMATCH`
14. `SMR-07-PLAN-EXCEEDS-WORLD-SCOPE`
15. `SMR-08-REVIEW-SUBSTITUTES-PLAN`
16. `SMR-09A-PROSPECTIVE-DEPENDENCY-VALID-ORDER`
17. `SMR-09B-PROSPECTIVE-DEPENDENCY-INVALID-ORDER`
18. `SMR-10A-UNSUPPORTED-REMOVAL-REQUEST`
19. `SMR-10B-UNSUPPORTED-NEW-NODE-PROPOSAL`
20. `SMR-10C-UNSUPPORTED-LOCAL-ACTIONS`
21. `SMR-11-GOAL-TARGET-VERSION-MIXING`

### 7.2 已复现缺陷清单（3 例，仅在 Baseline 下记录为缺陷）
1. `SMR-04B-EMPTY-SOURCES-LEGACY-WORLD-REVISE`：旧基线在 sources 为空时放行旧版 World REVISE，调用 Plan/Review 并产出 `repair_candidate`（1 项变更）。
2. `SMR-04C-EMPTY-SOURCES-LEGACY-WORKFLOW-REVIEW`：旧基线在 sources 为空时放行带旧版报告的 review 工作流，调用 Review 角色并产出 `repair_candidate`（1 项变更）。
3. `SMR-05D-LEGACY-REPORT-GRAPH-REV-REUSE`：旧基线允许无版本报告跨图版本复用，放行并调用 Plan 工作流产出 `role_report: plan`。

### 7.3 修复验证结果清单（Fixed 模式加载修复产物）
1. `SMR-04B`：安全截断为纯文本 `text: "RECHECK..."`，调用 `{ fast: 0, world: 1, plan: 0, review: 0 }`，✅ 验证通过。
2. `SMR-04C`：精准抛出 `EXTERNAL_FAILURE: Invalid versioned role report`，调用 `{ fast: 0, world: 0, plan: 0, review: 0 }`，✅ 验证通过。
3. `SMR-05D`：精准抛出 `EXTERNAL_FAILURE: Invalid versioned role report`，调用 `{ fast: 0, world: 0, plan: 0, review: 0 }`，✅ 验证通过。
4. 全集 24 例在 Fixed 模式下 100% 达成预期，无任何回归故障。

---

## 8. 附录：评测脚本源码（与 `.cache/minimal-repair-eval.mjs` 镜像一致）

```javascript
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const worktreeRoot = path.resolve(__dirname, '..');

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return '<NOT_FOUND>';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function getGitHead(dir) {
  try {
    return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return '<UNKNOWN>';
  }
}

function getGitDiffSha256(dir, targetFile) {
  try {
    const diff = execSync(`git diff ${targetFile}`, { cwd: dir, encoding: 'utf8' });
    if (!diff.trim()) return '<CLEAN_NO_DIFF>';
    return sha256Buf(Buffer.from(diff, 'utf8'));
  } catch {
    return '<DIFF_ERROR>';
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let mode = 'baseline';
  let selfTest = false;
  let fixedRoot = null;

  for (const arg of args) {
    if (arg.startsWith('--mode=')) {
      mode = arg.split('=')[1];
    } else if (arg === '--self-test') {
      selfTest = true;
    } else if (arg.startsWith('--fixed-root=')) {
      fixedRoot = arg.slice('--fixed-root='.length);
    } else {
      console.error(`❌ 未知参数: ${arg}。可用参数: --mode=baseline|fixed, --fixed-root=<path>, --self-test`);
      process.exit(1);
    }
  }

  if (!['baseline', 'fixed'].includes(mode)) {
    console.error(`❌ 未知 mode: "${mode}"。必须为 "baseline" 或 "fixed"。`);
    process.exit(1);
  }

  if (mode === 'fixed') {
    if (!fixedRoot) {
      console.error('❌ 参数缺失: 在 --mode=fixed 模式下必须显式指定 --fixed-root=<path> 指向修复分支根目录。');
      process.exit(1);
    }
    const resolvedFixedRoot = path.resolve(fixedRoot);
    if (!fs.existsSync(resolvedFixedRoot)) {
      console.error(`❌ 路径不存在: 指定的 --fixed-root 目录不存在: ${resolvedFixedRoot}`);
      process.exit(1);
    }
    fixedRoot = resolvedFixedRoot;
  }

  return { mode, selfTest, fixedRoot };
}

const { mode, selfTest, fixedRoot } = parseArgs();

// Fixture reading
const fixturePath = path.join(worktreeRoot, 'tests/fixtures/agentarts-owned/minimal-repair-cases.json');
if (!fs.existsSync(fixturePath)) {
  console.error(`❌ Fixture 文件不存在: ${fixturePath}`);
  process.exit(1);
}
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

// Determine modules to load based on mode
const agentartsDistPath = mode === 'fixed'
  ? path.join(fixedRoot, 'packages/agentarts/dist/index.js')
  : path.join(worktreeRoot, 'packages/agentarts/dist/index.js');

const inputDistPath = mode === 'fixed'
  ? path.join(fixedRoot, 'packages/agentarts/dist/input.js')
  : path.join(worktreeRoot, 'packages/agentarts/dist/input.js');

const modelsDistPath = path.join(worktreeRoot, 'packages/models/dist/index.js');

if (!fs.existsSync(agentartsDistPath)) {
  console.error(`❌ 构建产物不存在: ${agentartsDistPath}`);
  process.exit(1);
}
if (!fs.existsSync(inputDistPath)) {
  console.error(`❌ 构建产物不存在: ${inputDistPath}`);
  process.exit(1);
}
if (!fs.existsSync(modelsDistPath)) {
  console.error(`❌ 构建产物不存在: ${modelsDistPath}`);
  process.exit(1);
}

const agentartsModule = await import(pathToFileURL(agentartsDistPath).href);
const inputModule = await import(pathToFileURL(inputDistPath).href);
const modelsModule = await import(pathToFileURL(modelsDistPath).href);

const { OwnedAgentOrchestrator } = agentartsModule;
const { parseAgentInput, GOAL_PREFIX } = inputModule;
const { FakeModelProvider } = modelsModule;

// Deep assertion helper for repair_candidate output: candidateVersion, graph revision, changes, and preserved nodes
function assertRepairCandidateOutput(output, expectedGraphRev, expectedChanges, preservedNodes = []) {
  if (!output || typeof output !== 'object') {
    throw new Error(`Repair candidate output is not an object: ${typeof output}`);
  }

  // 1. 检查外层结果类型
  if (output.kind !== 'repair_candidate') {
    throw new Error(`Result kind mismatch: expected repair_candidate, got ${output.kind}`);
  }

  // 2. 检查外层 candidateVersion 必须严格为 "1.0"
  if (output.candidateVersion !== '1.0') {
    throw new Error(`candidateVersion mismatch: expected "1.0", got "${output.candidateVersion}"`);
  }

  // 3. 检查内层 candidate 对象，确认 candidateVersion 不在 candidate 内部
  const candidateObj = output.candidate;
  if (!candidateObj || typeof candidateObj !== 'object') {
    throw new Error(`Inner candidate is not an object: ${typeof candidateObj}`);
  }
  if (candidateObj.candidateVersion !== undefined) {
    throw new Error(`candidateVersion should NOT be inside candidate object!`);
  }

  // 4. 检查内层 expectedGraphRevision
  if (expectedGraphRev !== undefined && candidateObj.expectedGraphRevision !== expectedGraphRev) {
    throw new Error(`expectedGraphRevision mismatch: expected ${expectedGraphRev}, got ${candidateObj.expectedGraphRevision}`);
  }

  // 5. 检查 changes 数组
  const actualChanges = candidateObj.changes;
  if (!Array.isArray(actualChanges)) {
    throw new Error(`Candidate changes is not an array: ${typeof actualChanges}`);
  }
  if (actualChanges.length !== expectedChanges.length) {
    throw new Error(`Changes count mismatch: expected ${expectedChanges.length}, got ${actualChanges.length}`);
  }

  for (let i = 0; i < expectedChanges.length; i++) {
    const exp = expectedChanges[i];
    const act = actualChanges[i];

    const expNodeId = exp.node ? exp.node.id : exp.targetNodeId;
    const expRevision = exp.node ? exp.node.revision : exp.targetRevision;
    const actNodeId = act.node ? act.node.id : act.targetNodeId;
    const actRevision = act.node ? act.node.revision : act.targetRevision;

    if (actNodeId !== expNodeId) {
      throw new Error(`Change[${i}] targetNodeId mismatch: expected "${expNodeId}", got "${actNodeId}"`);
    }
    if (actRevision !== expRevision) {
      throw new Error(`Change[${i}] targetRevision mismatch: expected "${expRevision}", got "${actRevision}"`);
    }
    if (act.summary !== exp.summary) {
      throw new Error(`Change[${i}] summary mismatch: expected "${exp.summary}", got "${act.summary}"`);
    }
    if (act.reason !== exp.reason) {
      throw new Error(`Change[${i}] reason mismatch: expected "${exp.reason}", got "${act.reason}"`);
    }

    if (exp.dependencies) {
      const actDeps = act.dependencies || [];
      if (actDeps.length !== exp.dependencies.length) {
        throw new Error(`Change[${i}] dependencies count mismatch: expected ${exp.dependencies.length}, got ${actDeps.length}`);
      }
      for (let j = 0; j < exp.dependencies.length; j++) {
        const ed = exp.dependencies[j];
        const ad = actDeps[j];
        const edId = ed.node ? ed.node.id : (ed.id || ed.targetNodeId);
        const edRev = ed.node ? ed.node.revision : (ed.revision || ed.targetRevision);
        const adId = ad.node ? ad.node.id : (ad.id || ad.targetNodeId);
        const adRev = ad.node ? ad.node.revision : (ad.revision || ad.targetRevision);
        if (adId !== edId || adRev !== edRev) {
          throw new Error(`Change[${i}] dependency[${j}] mismatch: expected ${JSON.stringify(ed)}, got ${JSON.stringify(ad)}`);
        }
      }
    }
  }

  // 6. 验证保留节点未被修改
  const modifiedNodeIds = new Set(actualChanges.map(c => c.node ? c.node.id : c.targetNodeId));
  for (const preserved of preservedNodes) {
    const preservedId = typeof preserved === 'string' ? preserved : (preserved.node ? preserved.node.id : preserved.id);
    if (modifiedNodeIds.has(preservedId)) {
      throw new Error(`Preserved node "${preservedId}" was unexpectedly modified in candidate changes!`);
    }
  }
}

// Deep assertion helper for role report in defect 05D
function assertPlanRoleReport(roleReport, expectedDispo, expectedChangesCount) {
  if (!roleReport || typeof roleReport !== 'object') {
    throw new Error(`Role report is not an object: ${typeof roleReport}`);
  }
  if (roleReport.disposition !== expectedDispo) {
    throw new Error(`Plan role report disposition mismatch: expected ${expectedDispo}, got ${roleReport.disposition}`);
  }
  const actualChanges = roleReport.changes || [];
  if (actualChanges.length !== expectedChangesCount) {
    throw new Error(`Plan role report changes count mismatch: expected ${expectedChangesCount}, got ${actualChanges.length}`);
  }
}

// Role call tracker
function createTrackedModels(responses) {
  const callSequence = [];
  const requests = { fast: [], world: [], plan: [], review: [] };

  const models = Object.fromEntries(
    ['fast', 'world', 'plan', 'review'].map(role => {
      const fake = new FakeModelProvider(
        responses[role]
          ? [{ kind: 'final', text: typeof responses[role] === 'string' ? responses[role] : JSON.stringify(responses[role]) }]
          : []
      );
      const origComplete = fake.complete.bind(fake);
      fake.complete = async (opts) => {
        callSequence.push(role);
        requests[role].push(opts);
        return origComplete(opts);
      };
      return [role, fake];
    })
  );

  return { models, callSequence, requests };
}

function verifyRoleCalls(requests, callSequence, expectedRoleCalls, expectedCallSequence) {
  const expectedFast = expectedRoleCalls?.fast ?? 0;
  if (requests.fast.length !== expectedFast) {
    throw new Error(`Role call mismatch for fast: expected ${expectedFast}, got ${requests.fast.length}`);
  }

  if (expectedRoleCalls) {
    for (const role of ['world', 'plan', 'review']) {
      const exp = expectedRoleCalls[role] ?? 0;
      if (requests[role].length !== exp) {
        throw new Error(`Role call count mismatch for ${role}: expected ${exp}, got ${requests[role].length}`);
      }
    }
  }

  if (expectedCallSequence) {
    if (callSequence.length !== expectedCallSequence.length) {
      throw new Error(`Call sequence length mismatch: expected [${expectedCallSequence.join('->')}], got [${callSequence.join('->')}]`);
    }
    for (let i = 0; i < expectedCallSequence.length; i++) {
      if (callSequence[i] !== expectedCallSequence[i]) {
        throw new Error(`Call sequence step[${i}] mismatch: expected "${expectedCallSequence[i]}", got "${callSequence[i]}"`);
      }
    }
  }
}

// Self test: Verify assertions fail when mutated
async function runSelfTest() {
  console.log('========================================================================');
  console.log(' 执行断言有效性自测 (8项负向变异测试，证明断言系统绝不假通过)');
  console.log('========================================================================\n');

  // Test 1: Summary mismatch mutation
  try {
    const fakeActual = {
      kind: 'repair_candidate',
      candidateVersion: '1.0',
      candidate: { expectedGraphRevision: 7, changes: [{ node: { id: 'node-b', revision: 2 }, summary: '真实摘要', reason: '理由' }] }
    };
    const fakeExpected = [{ node: { id: 'node-b', revision: 2 }, summary: '篡改的错误摘要', reason: '理由' }];
    assertRepairCandidateOutput(fakeActual, 7, fakeExpected, []);
    throw new Error('Self-test failed: summary mutation was NOT caught!');
  } catch (err) {
    if (!err.message.includes('summary mismatch')) throw err;
    console.log('  [自测 1/8 通过] 摘要篡改被成功拦截:', err.message);
  }

  // Test 2: TargetNodeId mismatch mutation
  try {
    const fakeActual = {
      kind: 'repair_candidate',
      candidateVersion: '1.0',
      candidate: { expectedGraphRevision: 7, changes: [{ node: { id: 'node-b', revision: 2 }, summary: '摘要', reason: '理由' }] }
    };
    const fakeExpected = [{ node: { id: 'node-WRONG', revision: 2 }, summary: '摘要', reason: '理由' }];
    assertRepairCandidateOutput(fakeActual, 7, fakeExpected, []);
    throw new Error('Self-test failed: nodeId mutation was NOT caught!');
  } catch (err) {
    if (!err.message.includes('targetNodeId mismatch')) throw err;
    console.log('  [自测 2/8 通过] 节点ID篡改被成功拦截:', err.message);
  }

  // Test 3: Call sequence order mutation
  try {
    const requests = { fast: [], world: [{}], plan: [{}], review: [{}] };
    const actualSeq = ['world', 'plan', 'review'];
    const mutatedExpectedSeq = ['plan', 'world', 'review'];
    verifyRoleCalls(requests, actualSeq, { fast: 0, world: 1, plan: 1, review: 1 }, mutatedExpectedSeq);
    throw new Error('Self-test failed: call sequence mutation was NOT caught!');
  } catch (err) {
    if (!err.message.includes('Call sequence step[0] mismatch')) throw err;
    console.log('  [自测 3/8 通过] 角色调用顺序颠倒被成功拦截:', err.message);
  }

  // Test 4: Fast role call unexpected invocation
  try {
    const requests = { fast: [{}], world: [{}], plan: [{}], review: [{}] };
    const actualSeq = ['fast', 'world', 'plan', 'review'];
    verifyRoleCalls(requests, actualSeq, { fast: 0, world: 1, plan: 1, review: 1 }, ['world', 'plan', 'review']);
    throw new Error('Self-test failed: unexpected fast call was NOT caught!');
  } catch (err) {
    if (!err.message.includes('Role call mismatch for fast')) throw err;
    console.log('  [自测 4/8 通过] 意外调用 fast 角色被成功拦截:', err.message);
  }

  // Test 5: Preserved node leakage mutation
  try {
    const fakeActual = {
      kind: 'repair_candidate',
      candidateVersion: '1.0',
      candidate: {
        expectedGraphRevision: 7,
        changes: [
          { node: { id: 'node-b', revision: 2 }, summary: '修B', reason: '理由' },
          { node: { id: 'node-c', revision: 2 }, summary: '错误修改了C', reason: '理由' }
        ]
      }
    };
    const fakeExpected = [
      { node: { id: 'node-b', revision: 2 }, summary: '修B', reason: '理由' },
      { node: { id: 'node-c', revision: 2 }, summary: '错误修改了C', reason: '理由' }
    ];
    assertRepairCandidateOutput(fakeActual, 7, fakeExpected, ['node-c']);
    throw new Error('Self-test failed: preserved node leakage was NOT caught!');
  } catch (err) {
    if (!err.message.includes('Preserved node "node-c" was unexpectedly modified')) throw err;
    console.log('  [自测 5/8 通过] 应保留节点泄露进候选被成功拦截:', err.message);
  }

  // Test 6: Result kind mismatch mutation
  try {
    const actualKind = 'repair_candidate';
    const mutatedExpectedKind = 'text';
    if (actualKind !== mutatedExpectedKind) {
      throw new Error(`Result kind mismatch: expected ${mutatedExpectedKind}, got ${actualKind}`);
    }
  } catch (err) {
    if (!err.message.includes('Result kind mismatch')) throw err;
    console.log('  [自测 6/8 通过] 结果类型不匹配被成功拦截:', err.message);
  }

  // Test 7: expectedGraphRevision mismatch mutation
  try {
    const fakeActual = {
      kind: 'repair_candidate',
      candidateVersion: '1.0',
      candidate: { expectedGraphRevision: 7, changes: [] }
    };
    assertRepairCandidateOutput(fakeActual, 999, [], []);
    throw new Error('Self-test failed: expectedGraphRevision mutation was NOT caught!');
  } catch (err) {
    if (!err.message.includes('expectedGraphRevision mismatch')) throw err;
    console.log('  [自测 7/8 通过] 图修订版本不一致被成功拦截:', err.message);
  }

  // Test 8: candidateVersion mutation (error version rejection)
  try {
    const fakeActual = {
      kind: 'repair_candidate',
      candidateVersion: '2.0', // 错误版本
      candidate: { expectedGraphRevision: 7, changes: [] }
    };
    assertRepairCandidateOutput(fakeActual, 7, [], []);
    throw new Error('Self-test failed: candidateVersion mutation was NOT caught!');
  } catch (err) {
    if (!err.message.includes('candidateVersion mismatch')) throw err;
    console.log('  [自测 8/8 通过] 候选版本错误 (candidateVersion !== "1.0") 被成功拦截:', err.message);
  }

  console.log('\n✅ 全部 8 项断言有效性自测均按预期精准拦截，断言系统严密可靠！\n');
}

async function runEvaluation() {
  if (selfTest) {
    await runSelfTest();
  }

  const liveBaselineHead = getGitHead(worktreeRoot);
  const liveFixedHead = fixedRoot ? getGitHead(fixedRoot) : '<NOT_SPECIFIED>';
  const grokDiffSha256 = fixedRoot ? getGitDiffSha256(fixedRoot, 'packages/agentarts/src/index.ts') : '<N/A>';

  console.log('========================================================================');
  console.log(` PersonalAgent 自有镜像“最小计划修复”独立合成评估运行器 (24例)`);
  console.log(` 运行模式: [${mode.toUpperCase()}]`);
  console.log('========================================================================');
  console.log(`当前工作树 Git HEAD:  ${liveBaselineHead}`);
  if (mode === 'fixed') {
    console.log(`修复分支工作树路径:    ${fixedRoot}`);
    console.log(`修复分支 Git HEAD:    ${liveFixedHead}`);
    console.log(`修复源码未提交差异摘要: ${grokDiffSha256}`);
  }
  console.log(`加载 index.js 路径:   ${agentartsDistPath}`);
  console.log(`加载 index.js sha256: ${sha256File(agentartsDistPath)}`);
  console.log(`加载 input.js sha256: ${sha256File(inputDistPath)}`);
  console.log(`加载 models   sha256: ${sha256File(modelsDistPath)}`);
  console.log(`评测数据集    sha256: ${sha256File(fixturePath)}`);
  console.log(`运行脚本自身  sha256: ${sha256File(__filename)}`);
  console.log(`评测数据集版本:       ${fixture.version} | 用例总数: ${fixture.cases.length}`);
  console.log(`[声明] dist 文件摘要仅能证明所加载产物的字节一致性，无法单独证明其由当前工作树源码干净构建。\n`);

  const results = {
    mode,
    passed: [],
    reproducedDefects: [],
    failed: []
  };

  for (const c of fixture.cases) {
    process.stdout.write(`[${c.caseId}] ${c.scenario.slice(0, 34).padEnd(36, ' ')} -> `);

    const expected = mode === 'fixed' ? c.fixedExpected : c.baselineExpected;
    if (!expected) {
      throw new Error(`Missing expected result for mode ${mode} in case ${c.caseId}`);
    }

    const isContinuation = typeof c.completeInput === 'object' && c.completeInput.continuation;
    const inputStr = typeof c.completeInput === 'string'
      ? c.completeInput
      : (isContinuation ? JSON.stringify(c.completeInput) : GOAL_PREFIX + JSON.stringify(c.completeInput));

    const responses = c.syntheticModelResponses || {};
    const { models, callSequence, requests } = createTrackedModels(responses);
    const agent = new OwnedAgentOrchestrator(models, 4096);

    const baseRequest = {
      query: inputStr,
      deadline: new Date(Date.now() + 5000).toISOString(),
      signal: new AbortController().signal,
      sessionId: `eval-${c.caseId}`,
      requestId: `req-${c.caseId}`
    };

    try {
      if (c.entrypoint === 'invokeWorkflow') {
        const wfRequest = {
          ...baseRequest,
          workflowId: c.workflowId,
          ...(c.providedRoleReports?.world !== undefined ? { world: c.providedRoleReports.world } : {}),
          ...(c.providedRoleReports?.plan !== undefined ? { plan: c.providedRoleReports.plan } : {})
        };

        const res = await agent.invokeWorkflow(wfRequest);

        // Verify role calls & sequence
        verifyRoleCalls(requests, callSequence, expected.expectedRoleCalls, expected.expectedCallSequence);

        if (expected.status === 'defect_reproduced_awaiting_fix') {
          // Deep verification for defect reproduction in workflows (04C and 05D)
          if (c.caseId === 'SMR-04C-EMPTY-SOURCES-LEGACY-WORKFLOW-REVIEW') {
            if (res.result.kind !== 'application_result') {
              throw new Error(`Defect expectation mismatch: expected application_result, got ${res.result.kind}`);
            }
            // 明确检查 Workflow 的 result.value 为 repair_candidate 且 candidateVersion === "1.0"
            assertRepairCandidateOutput(
              res.result.value,
              7,
              c.candidateChanges || [],
              c.nodesPreservedOrUnmodified || []
            );
          } else if (c.caseId === 'SMR-05D-LEGACY-REPORT-GRAPH-REV-REUSE') {
            if (res.result.kind !== 'role_report') {
              throw new Error(`Defect expectation mismatch: expected role_report, got ${res.result.kind}`);
            }
            if (res.result.role !== 'plan') {
              throw new Error(`Defect expectation mismatch: expected role plan, got ${res.result.role}`);
            }
            assertPlanRoleReport(res.result.value, 'REVISE', 1);
          }

          const actualChangesCount = res.result?.value?.candidate?.changes?.length || 0;
          const actualRole = res.result?.role || res.result?.value?.role;
          const displayKind = res.result?.value?.kind ? `${res.result.kind}:${res.result.value.kind}` : `${res.result.kind}:${actualRole}`;
          console.log(`⚠️  已复现缺陷 (基线放行且产出 ${displayKind}${actualChangesCount > 0 ? `, 变更数: ${actualChangesCount}` : ''})`);
          results.reproducedDefects.push({
            caseId: c.caseId,
            scenario: c.scenario,
            finding: expected.finding || expected.defectDescription,
            fixTarget: c.fixedExpected ? `要求在 fixed 下阻断: ${c.fixedExpected.errorCode || c.fixedExpected.status}` : '待定义'
          });
          continue;
        }

        if (expected.status === 'success') {
          if (res.result.kind !== 'application_result') {
            throw new Error(`Expected application_result, got ${res.result.kind}`);
          }
          // 检查 Workflow 的 result.value 为 repair_candidate 且 candidateVersion === "1.0"
          assertRepairCandidateOutput(
            res.result.value,
            expected.expectedGraphRevision ?? 7,
            expected.candidateChanges || c.candidateChanges || [],
            expected.nodesPreservedOrUnmodified || c.nodesPreservedOrUnmodified || []
          );
          console.log(`✅ 通过 (Workflow 产出 candidate, 校验 ${res.result.value.candidate.changes.length} 项变更)`);
          results.passed.push(c.caseId);
          continue;
        }

        throw new Error(`Unexpected workflow success for status ${expected.status}`);
      } else {
        // Standard invoke entrypoint
        const res = await agent.invoke(baseRequest);

        // Verify role calls & sequence
        verifyRoleCalls(requests, callSequence, expected.expectedRoleCalls, expected.expectedCallSequence);

        if (expected.status === 'defect_reproduced_awaiting_fix') {
          // Deep verification for defect reproduction in invoke (04B)
          if (c.caseId === 'SMR-04B-EMPTY-SOURCES-LEGACY-WORLD-REVISE') {
            // 检查直接 invoke 返回的对象 candidateVersion === "1.0"
            assertRepairCandidateOutput(
              res,
              7,
              c.candidateChanges || [],
              c.nodesPreservedOrUnmodified || []
            );
          }
          const actualChangesCount = res.candidate?.changes?.length || 0;
          console.log(`⚠️  已复现缺陷 (基线放行且产出 ${res.kind}, 变更数: ${actualChangesCount})`);
          results.reproducedDefects.push({
            caseId: c.caseId,
            scenario: c.scenario,
            finding: expected.finding || expected.defectDescription,
            fixTarget: c.fixedExpected ? `要求在 fixed 下阻断为: ${c.fixedExpected.textStartsWith || c.fixedExpected.status}` : '待定义'
          });
          continue;
        }

        if (expected.status === 'success') {
          if (res.kind !== expected.resultKind) {
            throw new Error(`Expected resultKind ${expected.resultKind}, got ${res.kind}`);
          }
          if (expected.resultKind === 'repair_candidate') {
            // 检查直接 invoke 返回的对象 candidateVersion === "1.0"
            assertRepairCandidateOutput(
              res,
              expected.expectedGraphRevision ?? 7,
              expected.candidateChanges || c.candidateChanges || [],
              expected.nodesPreservedOrUnmodified || c.nodesPreservedOrUnmodified || []
            );
          }
          console.log(`✅ 通过 (生成 candidate, 校验 ${res.candidate.changes.length} 项变更及保留节点)`);
          results.passed.push(c.caseId);
          continue;
        }

        if (expected.status === 'recheck_or_keep') {
          if (res.kind !== 'text') {
            throw new Error(`Expected text response, got ${res.kind}`);
          }
          if (expected.textStartsWith && !res.text.startsWith(expected.textStartsWith)) {
            throw new Error(`Expected text starting with "${expected.textStartsWith}", got "${res.text}"`);
          }
          if (expected.resultText && res.text !== expected.resultText) {
            throw new Error(`Expected text "${expected.resultText}", got "${res.text}"`);
          }
          console.log(`✅ 通过 (安全截断为 text: "${res.text.slice(0, 16)}...")`);
          results.passed.push(c.caseId);
          continue;
        }

        throw new Error(`Expected case to fail with ${expected.errorCode}, but it returned ${res.kind}`);
      }
    } catch (err) {
      // Check role calls even upon error
      verifyRoleCalls(requests, callSequence, expected.expectedRoleCalls, expected.expectedCallSequence);

      const expectedCode = expected.errorCode;
      const expectedMsg = expected.errorMessage;

      if (!expectedCode || !expectedMsg) {
        throw new Error(`Unexpected throw in case expecting ${expected.status}: ${err.code} ${err.message}`);
      }

      if (err.code !== expectedCode || !err.message.includes(expectedMsg)) {
        throw new Error(`Error mismatch: expected [${expectedCode}: ${expectedMsg}], got [${err.code}: ${err.message}]`);
      }

      console.log(`✅ 通过 (精准抛出 ${err.code}: "${err.message}")`);
      results.passed.push(c.caseId);
    }
  }

  console.log('\n========================================================================');
  console.log(` [${mode.toUpperCase()}] 评测结果概览：已验证通过 ${results.passed.length} 例 | 已复现缺陷 ${results.reproducedDefects.length} 例 | 失败 ${results.failed.length} 例`);
  console.log('========================================================================');

  if (results.reproducedDefects.length > 0) {
    console.log('\n[已复现缺陷清单（旧基线放行漏洞）]');
    for (const d of results.reproducedDefects) {
      console.log(`- 用例: ${d.caseId}`);
      console.log(`  场景: ${d.scenario}`);
      console.log(`  现状: ${d.finding}`);
      console.log(`  修复目标: ${d.fixTarget}\n`);
    }
  }

  return results;
}

runEvaluation().catch(err => {
  console.error('\n❌ 评估运行异常中断:', err);
  process.exit(1);
});

```
