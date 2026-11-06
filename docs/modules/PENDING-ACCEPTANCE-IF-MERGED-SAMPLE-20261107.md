# 假设合入离线输入汇总样例（PENDING ACCEPTANCE IF MERGED SAMPLE）

<!-- generatedAt: 2026-11-07T06:50:00.000Z -->

> [!CAUTION]
> # ⚠️ 核心红线与非真实验收声明
> 1. **仅假设这些文件合入后的离线输入汇总**：本文档的数据输入来源于未合并 PR（#594, #596, #598, #599, #602, #604, #605, #606, #607）的 `git show <head>:<path>` 离线快照，**当前主干（main）尚未合入这些文件**；
> 2. **非真实验收**：本文档记录的所有条目**均未在真实物理机、真实 Windows 11 环境、华为云真账号或权利人现场完成验证**；
> 3. **非已合并主干**：严禁作为发布依据或声称 PersonalAgent 已闭环；
> 4. **客观真实原则**：旧 WIP 自报的「8 valid」不可信（系通过猜关键词、把 true 改 false、用 pending 拼凑步骤伪造出来的虚假齐套）。本工具采用严格静态文本解析与逐字段 provenance，如实反映 18 份输入的真实字段缺失状况。

---

## 1. 离线快照扫描总览

对 `scripts/acceptance/__tests__/__fixtures__/unmerged-zemeng-plans/` 下 18 个未合并规划文件及 1 个 `MANIFEST.json` 执行严格静态文本扫描与契约校验，结果如下：

| 指标 | 数量 | 说明 |
| --- | --- | --- |
| **扫描快照文件总数** | 19 | 包含 9 个 PR 的 9 个代码规划、9 篇 Markdown 规划说明与 1 个 MANIFEST.json |
| **结构完整合规规划** | 0 | 严格静态文本解析下，无一虚假通过（0 虚假齐套） |
| **缺字段/无法确认项** | 18 | 18 份规划均如实报告缺失字段、多分支歧义 (ambiguous_closedLoop) 或缺环境声明 |
| **跳过的元数据索引** | 1 | `MANIFEST.json`（索引清单，非规划） |

---

## 2. 真实 18 份离线输入逐份判定与可确认性清单 (Coverage & Provenance)

| PR | 来源路径 | 文件类型 | 判定结果 | closedLoop 状态 | 缺失字段 | 无法确认原因 (cannot_confirm) | 详情与行号 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #594 | `docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md` | Markdown 规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: inferred_id_from_filename<br/>`closedLoop`: missing_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #594 | `scripts/release/packaged-sqlite-smoke.plan.mjs` | TS/MJS 代码规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, status, requiredEnvironments, evidenceRequirements` | `title`: missing_title<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #596 | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | Markdown 规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, status, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: inferred_id_from_filename<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #596 | `packages/agentarts/src/deployment-readback-plan.ts` | TS/MJS 代码规划 | 识别为规划候选 | `ambiguous` (多分支歧义) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: missing_id<br/>`title`: missing_title<br/>`closedLoop`: ambiguous_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 多分支赋值 closedLoop: L232 (false，状态标记为 unavailable'), L289 (false), L314 (true) |
| #598 | `docs/modules/MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107.md` | Markdown 规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: inferred_id_from_filename<br/>`closedLoop`: missing_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #598 | `scripts/release/release-install-upgrade-uninstall.plan.mjs` | TS/MJS 代码规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `title`: missing_title<br/>`closedLoop`: missing_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #599 | `docs/modules/MOD-16-NOTEPAD-LIVE-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: inferred_id_from_filename<br/>`closedLoop`: missing_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #599 | `packages/windows-client/src/notepad-live-acceptance-plan.ts` | TS/MJS 代码规划 | 识别为规划候选 | `ambiguous` (多分支歧义) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `title`: missing_title<br/>`closedLoop`: ambiguous_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 多分支赋值 closedLoop: L89 (false 且 status="unavailable"'), L244 (false), L245 (false.), L246 (false.), L247 (true without passing all real machine gates.), L286 (false), L357 (isClosedLoop) |
| #602 | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | Markdown 规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, status, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: inferred_id_from_filename<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #602 | `packages/goals/src/privacy-deletion-acceptance-plan.ts` | TS/MJS 代码规划 | 识别为规划候选 | `ambiguous` (多分支歧义) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: missing_id<br/>`title`: missing_title<br/>`closedLoop`: ambiguous_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 多分支赋值 closedLoop: L338 (false), L352 (true) |
| #604 | `docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: inferred_id_from_filename<br/>`closedLoop`: missing_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #604 | `packages/coding-tools/src/windows-sandbox-acceptance-plan.ts` | TS/MJS 代码规划 | 识别为规划候选 | `ambiguous` (多分支歧义) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `title`: missing_title<br/>`closedLoop`: ambiguous_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 多分支赋值 closedLoop: L111 (false 且 status="unavailable"'), L298 (false), L299 (false), L300 (false.), L301 (false.), L302 (true without passing all real machine gates.), L347 (false), L447 (isClosedLoop) |
| #605 | `docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, status, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: inferred_id_from_filename<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #605 | `packages/agentarts/src/f09-cloud-prefix-acceptance-plan.ts` | TS/MJS 代码规划 | 识别为规划候选 | `ambiguous` (多分支歧义) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: missing_id<br/>`title`: missing_title<br/>`closedLoop`: ambiguous_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 多分支赋值 closedLoop: L261 (false，状态标记为 unavailable'), L319 (false), L407 (false), L431 (true) |
| #606 | `docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, status, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: inferred_id_from_filename<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #606 | `packages/coordination/src/cloud-persistent-acceptance-plan.ts` | TS/MJS 代码规划 | 识别为规划候选 | `ambiguous` (多分支歧义) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `title`: missing_title<br/>`closedLoop`: ambiguous_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 多分支赋值 closedLoop: L367 (true'), L369 (false，状态标记为 unavailable，待真云关机验收'), L398 (false), L500 (false), L540 (pending.length === 0) |
| #607 | `docs/modules/MOD-04B-AGENTARTS-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | 识别为规划候选 | `missing` (未显式声明) | `closedLoop, status, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `id`: inferred_id_from_filename<br/>`closedLoop`: missing_closedLoop<br/>`status`: missing_status<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 无明确 requiredEnvironments 字面量数组（拒绝全文猜测） |
| #607 | `packages/coordination/src/mod04b-agentarts-acceptance-plan.ts` | TS/MJS 代码规划 | 识别为规划候选 | `ambiguous` (多分支歧义) | `closedLoop, requiredEnvironments, acceptanceSteps, evidenceRequirements` | `title`: missing_title<br/>`closedLoop`: ambiguous_closedLoop<br/>`requiredEnvironments`: missing_environment_declaration<br/>`acceptanceSteps`: missing_acceptance_steps<br/>`evidenceRequirements`: missing_evidence_requirements | 多分支赋值 closedLoop: L488 (true'), L490 (false，状态标记为 unavailable，待真云验收'), L517 (false), L606 (true), L666 (false) |

## 3. 逐字段提取规则与 Provenance 规范

- **ID / Title**：仅读取显式常量（`MOD..._CAPABILITY`、`PLAN_ID`）或静态属性，记录所在行号；
- **closedLoop**：严格静态检查所有赋值。若检测到多分支条件返回（如同时存在 `closedLoop: false` 与 `closedLoop: true` 或动态表达式），记录 `ambiguous_closedLoop` 与各分支行号，绝不盲推默认分支，绝不将 `true` 改为 `false`；
- **requiredEnvironments**：仅读取明确环境字面量数组（如 `export const REQUIRED_ENVIRONMENTS = [...]`），禁止通过全文出现 `profile` / `token` / `windows` 猜测；
- **acceptanceSteps / evidenceRequirements**：仅读取明确静态数组，禁止将 pending 项复制填充以制造虚假齐套。
