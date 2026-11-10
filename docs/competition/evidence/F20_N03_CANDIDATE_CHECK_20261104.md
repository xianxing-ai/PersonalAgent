# F20 N03 候选检查 Schema 与 Worker 信任闭环验收证据（2026-11-04）

> 目标 Profile：`huawei_ict_agentarts`  
> 责任人：`zemeng5208`（依据 `IMAGE28_COLLABORATOR_OPEN_WORK_20261031.md` 编号 3、6 项）  
> 关联依据：`docs/competition/evidence/F20_WORKER_TRUST_GAPS_20261029.md`

---

## 1. 覆盖矩阵（核实「可继续的实现方向」1-4 与「接口和代码改动边界」1-6）

| 规范条目 | 规范要求核心 | 实现文件 | 测试覆盖文件及测试名 | 状态 |
| --- | --- | --- | --- | --- |
| **方向 1a** | 受限候选格式定义（版本 1、docMarkdown、sampleSnippet，禁止模型注入路径/recipe/凭据） | `packages/contracts/schema/f20-candidate.json`<br>`packages/contracts/src/f20-candidate.ts`<br>`packages/contracts/src/f20-candidate.schema.ts`<br>`packages/contracts/src/f20-candidate.generated.ts` | `packages/contracts/test/f20-candidate.test.mjs`：<br>1. `F20 candidates contain bounded text only; host bindings cannot be supplied by the model`<br>2. `F20 candidate rejects non-object, missing required fields, and validates schema definition` | 已完整覆盖 |
| **方向 1b** | 候选与原始选择回执绑定，拒绝 abstain、重复 ID、越界候选 | `apps/runtime/src/application/f20-candidate-frontier.ts` (`assertF20CandidateSelection`)<br>`apps/runtime/src/application/f20-trial-binding.ts` (`readTrialBinding`, `f20ReviewContext`) | `apps/runtime/test/f20-candidate-frontier.test.mjs`：<br>1. `assertF20CandidateSelection succeeds on valid bound candidate selection`<br>2. `assertF20CandidateSelection rejects invalid task, operation or selection identifiers`<br>3. `assertF20CandidateSelection enforces task lifecycle and readOnlyRecovery states`<br>4. `assertF20CandidateSelection rejects drifted checkpoints or foreign operations`<br>5. `assertF20CandidateSelection rejects abstain, duplicates, outside IDs and context drift`<br>`apps/runtime/test/owned-workflow-worker-runtime.test.mjs`：<br>6. `F20 refuses a replaced document before semantic review or completion`<br>7. `a substituted sample never reaches the trial even after the original source and candidate approvals` | 已完整覆盖 |
| **方向 1c** | 两份 HostBridge 读取结果（schemaFile, codeFile）与原始配置绑定，对源变化和候选替换 fail-closed | `apps/runtime/src/application/f20-trial-binding.ts` (`readBinding`)<br>`apps/runtime/src/application/owned-workflow-worker-capability.ts` (`verifyCompletion`)<br>`apps/runtime/src/application/f20-verify-completion.ts` (`verifyF20HarnessCompletion`) | `apps/runtime/test/f20-verify-completion.test.mjs`：<br>1. `verifyF20HarnessCompletion rejects digest drift and accepts bound trials`<br>2. `F20 refuses foreign trials, substituted candidates and unbound verification receipts`<br>`apps/runtime/test/owned-workflow-worker-runtime.test.mjs`：<br>3. `actual Runtime reads both sources and resumes original graph host approvals`<br>4. `changing the fixed case while the first source approval is pending cannot widen the next read`<br>5. `unknown second source stays on its original HostTask and the image does not advance`<br>`apps/runtime/test/owned-workflow-worker-capability.test.mjs`：<br>6. `a changed second-source readback stops before the graph advances`<br>7. `image cannot submit a source outside the fixed case` | 已完整覆盖 |
| **方向 2a** | 候选示例转换为精确 baseline 和受限路径的隔离 patch，走 coding.repair.trial / Policy / ToolGateway | `apps/runtime/src/application/f20-trial-binding.ts` (`readTrialBinding`)<br>`apps/desktop/electron/workspace-config-host.js` (`getRepairHost`, `harnessRepairHost.check`)<br>`packages/agentarts/src/owned-workflow-templates.ts` (`F20_N03`) | `apps/desktop/test/workspace-config-host.test.mjs`：<br>1. `F20 workspace provider runs the exact isolated TypeScript sample and never publishes it`<br>`apps/runtime/test/owned-workflow-worker-runtime.test.mjs`：<br>2. `actual Runtime reads both sources and resumes original graph host approvals`<br>`packages/agentarts/test/f20-n03-template.test.mjs`：<br>3. `F20 workflow template binds N03 to coding.repair.trial and defines bounded candidate schema` | 已完整覆盖 |
| **方向 2b** | 校验绑定的 recipe 针对该候选与选定契约执行，不能冒充原代码检查 | `apps/desktop/electron/f20-typescript-recipe.js` (`createF20TypeScriptRecipe`)<br>`apps/desktop/electron/f20-typescript-check.cjs`<br>`apps/runtime/src/application/f20-verify-completion.ts` (`verifyF20HarnessCompletion`) | `apps/desktop/test/f20-typescript-recipe.test.mjs`：<br>1. `fixed F20 recipe compiles the isolated sample against its contract and rejects phantom fields or bypasses`<br>`apps/runtime/test/f20-verify-completion.test.mjs`：<br>2. `verifyF20HarnessCompletion rejects exit-code-only checks and missing trials` | 已完整覆盖 |
| **方向 3a** | N03/N04 frontier 校验原始 task、operation、参数、source/candidate digest 和确认回执 | `apps/runtime/src/application/f20-trial-binding.ts` (`readRuntimeF20TrialBinding`, `f20ReviewContext`, `verifyF20ReviewCompletion`)<br>`apps/desktop/electron/f20-workflow-worker-ports.js` (`assertFrontier`) | `apps/runtime/test/owned-workflow-worker-runtime.test.mjs`：<br>1. `F20 semantic review uses the original local sources and trial with a bound typed decision receipt`<br>`apps/desktop/test/f20-workflow-worker-ports.test.mjs`：<br>2. `F20 ports require a current deployment, local reviewer, exact source frontier and explicit export grant` | 已完整覆盖 |
| **方向 3b** | Completion 校验原始状态与受限 export authorization | `apps/runtime/src/application/owned-workflow-worker-capability.ts` (`verifyCompletion`, `authorizeExport`)<br>`apps/runtime/src/application/f20-verify-completion.ts`<br>`apps/desktop/electron/workspace-config-host.js` (`authorizeF20Export`)<br>`apps/desktop/electron/f20-workflow-projection.js` | `apps/desktop/test/workspace-config-host.test.mjs`：<br>1. `F20 source export consumes the original explicit question and rejects substitution, drift and revocation`<br>`apps/desktop/test/f20-workflow-worker-ports.test.mjs`：<br>2. `F20 trial projection excludes source content, extra diagnostics and synthetic execution claims`<br>`apps/runtime/test/owned-workflow-worker-runtime.test.mjs`：<br>3. `explicit export and frontier denials cannot be treated as successful guards` | 已完整覆盖 |
| **方向 3c** | 保留未知结果及取消语义，进程重启不重放未知写 | `apps/runtime/src/application/owned-workflow-worker-capability.ts` (L305-307)<br>`apps/runtime/src/application/f20-trial-binding.ts` (`readRuntimeF20RecoveryBinding`) | `apps/runtime/test/owned-workflow-worker-runtime.test.mjs`：<br>1. `unknown original F20 command is not replayed`<br>2. `unknown second source stays on its original HostTask and the image does not advance`<br>3. `a Synthetic trusted readback resumes the held original worker without replaying its unknown source`<br>4. `F20 native recovery follows the original SQLite trial across process restart without execution or success promotion` | 已完整覆盖 |
| **方向 4** | 补齐替换候选、源漂移、越界路径、缺检查、未知结果不重放、授权撤销、Schema 边界定向测试 | 见上述各测试套件 | 全部 33 项定向单元与集成测试均本地执行通过 | 已完整覆盖 |
| **边界 1** | F20_N03 改为 `coding.repair.trial`，不使用 `workspace.run_allowed_command` | `packages/agentarts/src/owned-workflow-templates.ts` (L73) | `packages/agentarts/test/f20-n03-template.test.mjs` | 已完整覆盖 |
| **边界 2** | `decision.choose_candidate` 原 context 校验，N02/N04 绑定 Schema | `packages/agentarts/src/owned-workflows.ts` (L156-158)<br>`apps/runtime/src/application/f20-candidate-frontier.ts` | `packages/agentarts/test/f20-n03-template.test.mjs`<br>`apps/runtime/test/f20-candidate-frontier.test.mjs` | 已完整覆盖 |
| **边界 3** | 公开 Schema 与生成类型 `parseF20DocumentCandidate` | `packages/contracts/src/f20-candidate.ts` | `packages/contracts/test/f20-candidate.test.mjs` | 已完整覆盖 |
| **边界 4** | F20 构造真实 `HarnessCandidateContext`，绑定 `f20-typescript-sample` recipe | `apps/runtime/src/application/f20-trial-binding.ts`<br>`apps/desktop/electron/workspace-config-host.js` | `apps/desktop/test/workspace-config-host.test.mjs` | 已完整覆盖 |
| **边界 5** | `verifyCompletion` 校验 read, check, sourceReads 及 bound tasks | `apps/runtime/src/application/owned-workflow-worker-capability.ts`<br>`apps/runtime/src/application/f20-verify-completion.ts` | `apps/runtime/test/f20-verify-completion.test.mjs` | 已完整覆盖 |
| **边界 6** | Desktop 仅在固定部署与 case 已配置时注入 ports，不绕过 Policy | `apps/desktop/electron/f20-workflow-worker-ports.js`<br>`apps/desktop/electron/main.js` (L2663, L2970) | `apps/desktop/test/f20-workflow-worker-ports.test.mjs`<br>`apps/desktop/test/workspace-config-host.test.mjs` | 已完整覆盖 |

---

## 2. 本次改动文件清单与目的

经核对，生产代码已完全满足 fail-closed 架构要求且逻辑闭环无缺口；本次改动严格遵循「不改无关生产代码，只补覆盖与 Evidence」的规范原则：

1. `packages/contracts/test/f20-candidate.test.mjs`
   - **目的**：补充 F20 候选 Schema 边界测试（空文档、超长文档截断、控制字符/空字节 `\0`、注入额外未知字段、非对象输入如 null/数字/数组及缺失必填字段校验）。
2. `packages/agentarts/test/f20-n03-template.test.mjs`（新增文件）
   - **目的**：对 `packages/agentarts` 中的 F20 图模板进行直接声明性契约测试，验证 F20_N03 工具为 `coding.repair.trial`（禁止 `workspace.run_allowed_command`）、F20_N02 与 F20_N04 均绑定 `f20DocumentCandidateSchema()`，以及 N01->N02->N03->N04 的严格线性拓扑。
3. `apps/runtime/test/f20-candidate-frontier.test.mjs`（新增文件）
   - **目的**：对 `assertF20CandidateSelection` 进行独立定向单元测试，覆盖非法标识符、任务取消/终态、`readOnlyRecovery` 状态限制、Checkpoints 篡改（operation/intent/parent 身份不符）、弃权选项（abstain）选择拒绝、候选 ID 重复、候选 ID 越界及上下文字段漂移。
4. `apps/runtime/test/f20-verify-completion.test.mjs`
   - **目的**：扩充 `verifyF20HarnessCompletion` 边界校验，覆盖非 isolated session 模式、非空 parentArtifactDigests（防父任务继承成功欺骗）、recipeFingerprint 漂移、验证状态非 VALID、验证退出码非 0、包标识不匹配、各类非法 samplePath（越界 `../`、相对同级 `./`、非 `.ts` 后缀、空字符及与原工程文件重名）、缺少 codeFile 以及主源读取漂移。
5. `docs/competition/evidence/F20_N03_CANDIDATE_CHECK_20261104.md`（本文件）
   - **目的**：记录覆盖矩阵、本地实际运行通过的测试命令及未完真实验收清单。

---

## 3. 本地实际运行通过的检查

所有检查均在当前工作树（分支 `zemeng/f20-n03-candidate-check`）执行并全部通过：

### 3.1 跨 workspace 依赖与构建
- **命令**：`npm run build --workspaces --if-present`
- **结果**：全部 28 个 workspace 构建成功（Exit Code: 0），TypeScript 类型检查与产物生成无报错。

### 3.2 契约生成与 Schema 校验
- **命令**：`npm run check:generated --workspace=@personal-agent/contracts`
- **结果**：`node scripts/generate.mjs --check` 检查通过，无 Schema 漂移（Exit Code: 0）。

### 3.3 架构门禁检查
- **命令**：`npm run check:architecture`
- **结果**：3 项测试全部通过（Exit Code: 0）：
  - `workspace dependencies obey the documented architecture boundaries`
  - `the standard check gates root integration tests after workspace build and tests`
  - `the integration runner serially discovers every root integration test without filtering failures`

### 3.4 F20 核心单元与集成测试（共 33 项，33/33 通过）
- **命令**：
  ```bash
  node --test \
    packages/contracts/test/f20-candidate.test.mjs \
    packages/agentarts/test/f20-n03-template.test.mjs \
    apps/runtime/test/f20-candidate-frontier.test.mjs \
    apps/runtime/test/f20-verify-completion.test.mjs \
    apps/runtime/test/owned-workflow-worker-capability.test.mjs \
    apps/runtime/test/owned-workflow-worker-runtime.test.mjs \
    apps/desktop/test/f20-case-config-host.test.mjs \
    apps/desktop/test/f20-typescript-recipe.test.mjs \
    apps/desktop/test/f20-workflow-worker-ports.test.mjs
  ```
- **输出明细**：
  ```text
  ✔ native-selected case is encrypted, bound to its workspace and fixed recipe, and never grants authority (29.737337ms)
  ✔ fixed F20 recipe compiles the isolated sample against its contract and rejects phantom fields or bypasses (8554.577419ms)
  ✔ F20 ports require a current deployment, local reviewer, exact source frontier and explicit export grant (3.922191ms)
  ✔ F20 trial projection excludes source content, extra diagnostics and synthetic execution claims (46.129347ms)
  ✔ assertF20CandidateSelection succeeds on valid bound candidate selection (1.67178ms)
  ✔ assertF20CandidateSelection rejects invalid task, operation or selection identifiers (0.601586ms)
  ✔ assertF20CandidateSelection enforces task lifecycle and readOnlyRecovery states (0.357512ms)
  ✔ assertF20CandidateSelection rejects drifted checkpoints or foreign operations (0.300343ms)
  ✔ assertF20CandidateSelection rejects abstain, duplicates, outside IDs and context drift (0.485085ms)
  ✔ verifyF20HarnessCompletion rejects exit-code-only checks and missing trials (1.991159ms)
  ✔ verifyF20HarnessCompletion rejects digest drift and accepts bound trials (18.07852ms)
  ✔ F20 refuses foreign trials, substituted candidates and unbound verification receipts (5.010646ms)
  ✔ F20 fails closed when its trusted verifier is unavailable (20.13978ms)
  ✔ model arguments cannot supply paths, commands, receipts or a different graph (14.290645ms)
  ✔ image cannot submit a source outside the fixed case (34.774304ms)
  ✔ a settled image cannot submit a command (20.672079ms)
  ✔ a command frontier without the original N01 graph receipt fails before submit (20.032123ms)
  ✔ image settled without locally confirmed operations cannot produce a worker receipt (25.668762ms)
  ✔ a changed second-source readback stops before the graph advances (23.841812ms)
  ✔ actual Runtime reads both sources and resumes original graph host approvals (328.987584ms)
  ✔ F20 semantic review uses the original local sources and trial with a bound typed decision receipt (245.191491ms)
  ✔ F20 refuses a replaced document before semantic review or completion (206.847491ms)
  ✔ missing F20 provider is not advertised in Runtime catalog (30.399387ms)
  ✔ a substituted sample never reaches the trial even after the original source and candidate approvals (123.639326ms)
  ✔ explicit export and frontier denials cannot be treated as successful guards (171.481978ms)
  ✔ unknown original F20 command is not replayed (136.035311ms)
  ✔ F20 native recovery follows the original SQLite trial across process restart without execution or success promotion (1519.172246ms)
  ✔ unknown second source stays on its original HostTask and the image does not advance (93.90665ms)
  ✔ a Synthetic trusted readback resumes the held original worker without replaying its unknown source (216.873631ms)
  ✔ changing the fixed case while the first source approval is pending cannot widen the next read (60.968153ms)
  ✔ F20 workflow template binds N03 to coding.repair.trial and defines bounded candidate schema (1.55588ms)
  ✔ F20 candidates contain bounded text only; host bindings cannot be supplied by the model (6.262027ms)
  ✔ F20 candidate rejects non-object, missing required fields, and validates schema definition (0.344046ms)
  ℹ tests 33
  ℹ suites 0
  ℹ pass 33
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ```

---

## 4. 仍未完成的真实验收

本轮为本地契约、Schema、隔离试验及状态机闭环的单体与合成验证。按比赛基线规范，以下真实环境与服务级验收**仍未完成**，保持明确 unavailable / unverified 状态：

1. **AgentArts 平台部署上的 F20 整图真实调用**：
   - 依赖真实 AgentArts 华为云线上环境已部署的固定部署版本镜像与真实 WebSocket 编排调用；目前仅完成本地合成与驱动契约测试。
2. **真实 Windows PSEC（Process Security / Job Object）隔离执行与中断恢复**：
   - 在真实 Windows 宿主下使用 `PA_TEST_JOB_HOST_EXE` 与实际 PSEC 限制执行独立 TypeScript 编译器，并验证进程树终止、句柄清理和关机/崩溃后基于 SQLite Checkpoint 的原状态精确读回。
3. **真实端侧 / 本地 Laya 语义判断**：
   - 目前 N02 与 N04 使用合成 ModelGateway 回执与确定性桩，尚未与真实 Laya 本地模型推理接入进行多轮文档对比和无幻觉字段事实评估。
4. **真实文档站点及 Git 写回验收**：
   - 最终文档写回（`targetDoc`）与发布动作仍处于 disabled 状态（`published: false`），需在真实文档仓库与真人 Ed25519 签名在场授权后验证。

---

## 5. 结论

**无生产代码缺口**。  
F20「N03 候选检查 Schema 与 Worker 信任闭环」在 `@personal-agent/contracts`、`@personal-agent/agentarts`、`@personal-agent/runtime` 以及 `@personal-agent/desktop` 的所有本地可验证环节均已具备完整实现及测试闭环，保持 fail-closed 语义与未验外部真实服务状态。
