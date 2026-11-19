# 假设合入离线输入汇总样例（PENDING ACCEPTANCE IF MERGED SAMPLE）

<!-- generatedAt: 2026-11-07T12:46:04+08:00 -->

> [!CAUTION]
> # ⚠️ 核心红线与非真实验收声明
> 1. **仅假设这些文件合入后的离线输入汇总**：本文档的数据输入来源于未合并 PR（#594, #596, #598, #599, #602, #604, #605, #606, #607）固定 SHA 的离线快照，**当前主干（main）尚未合入这些文件**；
> 2. **非真实验收**：本文档记录的所有条目**均未在真实物理机、真实 Windows 11 环境、华为云真账号或权利人现场完成验证**；所有真实事项均处于待验收状态；
> 3. **非已合并主干**：严禁作为发布依据或声称 PersonalAgent 已闭环；
> 4. **客观真实原则**：本工具采用严格纯静态词法分析与对象作用域字段定位。对最新提交的 18 份快照进行纯静态分析，解析器在匹配前严格剥离注释与字符串/模板非代码区域，精确识别真实代码赋值，并通过对象字面量边界精准锚定所属计划对象的 `status`（杜绝启发式行距盲猜），实测得出 18 份全部合规规划（9 篇 Markdown 规划 + 9 份静态代码规划）。所有规划均声明 `closedLoop: false`，状态为待真实验收状态 (`unavailable`/`pending`)。齐套不等于真环境验收通过。

---

## 1. 离线快照扫描总览

对 `scripts/acceptance/__tests__/__fixtures__/unmerged-zemeng-plans/` 目录执行严格静态文本扫描与契约校验（索引元数据 `MANIFEST.json` 被扫描规则直接排除，不进入规划扫描统计），实际 CLI 扫描指标如下（与 JSON 输出完全一致）：

| 指标 | 数量 | 说明 |
| --- | --- | --- |
| **排除索引元数据** | 已排除 | `MANIFEST.json` 作为清单文件被扫描规则直接排除，不纳入规划扫描统计 |
| **扫描快照文件总数** | 18 | 包含 9 个 PR 的 9 个代码规划与 9 篇 Markdown 规划说明 |
| **结构完整合规规划** | 18 | 静态解析确认具备完整 id、title、closedLoop:false、status、环境、步骤与证据要求 |
| **缺字段/分支歧义项** | 0 | 词法剥离后消除 limits 字符串字面量误判，无歧义，真实代码均为单处 closedLoop:false 赋值 |
| **跳过的文件数** | 0 | 排除索引元数据后无其他杂质文件，跳过计数为 0 |

---

## 2. 真实 18 份离线输入逐份判定与可确认性清单 (Coverage & Provenance)

| PR | 来源路径 | 文件类型 | 判定结果 | closedLoop 状态 | 缺失字段 | 无法确认原因 (cannot_confirm) | 详情与行号 / 声明环境 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #594 | `docs/modules/MOD-19-PACKAGED-SQLITE-SMOKE-PLAN-20261107.md` | Markdown 规划 | **结构完整合规** | `false` (L5) | 无缺失 | 无 | 环境: `windows_real_machine`；id: `sqlite-packaged-electron-smoke`；状态: `unavailable` (L4) |
| #594 | `scripts/release/packaged-sqlite-smoke.plan.mjs` | TS/MJS 代码规划 | **结构完整合规** | `false` (L160) | 无缺失 | 无 | 环境: `windows_real_machine`；id: `sqlite-packaged-electron-smoke`；状态: `unavailable` (L159) |
| #596 | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | Markdown 规划 | **结构完整合规** | `false` (L5) | 无缺失 | 无 | 环境: `huawei_cloud, real_account`；id: `deployment-readback-plan`；状态: `unavailable` (L4) |
| #596 | `packages/agentarts/src/deployment-readback-plan.ts` | TS/MJS 代码规划 | **结构完整合规** | `false` (L392) | 无缺失 | 无 | 环境: `huawei_cloud, real_account`；id: `deployment-readback-plan`；状态: `unavailable` (L391) |
| #598 | `docs/modules/MOD-19-RELEASE-ACCEPTANCE-PLANS-20261107.md` | Markdown 规划 | **结构完整合规** | `false` (L5) | 无缺失 | 无 | 环境: `windows_real_machine`；id: `release-install-upgrade-uninstall`；状态: `unavailable` (L4) |
| #598 | `scripts/release/release-install-upgrade-uninstall.plan.mjs` | TS/MJS 代码规划 | **结构完整合规** | `false` (L255) | 无缺失 | 无 | 环境: `windows_real_machine`；id: `release-install-upgrade-uninstall`；状态: `pending` (L254) |
| #599 | `docs/modules/MOD-16-NOTEPAD-LIVE-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | **结构完整合规** | `false` (L5) | 无缺失 | 无 | 环境: `windows_real_machine, rights_holder_or_human`；id: `notepad-live-acceptance`；状态: `unavailable` (L4) |
| #599 | `packages/windows-client/src/notepad-live-acceptance-plan.ts` | TS/MJS 代码规划 | **结构完整合规** | `false` (L345) | 无缺失 | 无 | 环境: `windows_real_machine, rights_holder_or_human`；id: `notepad-live-acceptance`；状态: `unavailable` (L344) |
| #602 | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | Markdown 规划 | **结构完整合规** | `false` (L5) | 无缺失 | 无 | 环境: `rights_holder_or_human, windows_real_machine`；id: `privacy-deletion-acceptance-plan`；状态: `unavailable` (L4) |
| #602 | `packages/goals/src/privacy-deletion-acceptance-plan.ts` | TS/MJS 代码规划 | **结构完整合规** | `false` (L423) | 无缺失 | 无 | 环境: `rights_holder_or_human, windows_real_machine`；id: `privacy-deletion-acceptance-plan`；状态: `unavailable` (L424) |
| #604 | `docs/modules/MOD-18-WINDOWS-SANDBOX-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | **结构完整合规** | `false` (L5) | 无缺失 | 无 | 环境: `windows_real_machine`；id: `windows-sandbox-acceptance-plan`；状态: `unavailable` (L4) |
| #604 | `packages/coding-tools/src/windows-sandbox-acceptance-plan.ts` | TS/MJS 代码规划 | **结构完整合规** | `false` (L512) | 无缺失 | 无 | 环境: `windows_real_machine`；id: `windows-sandbox-acceptance-plan`；状态: `unavailable` (L511) |
| #605 | `F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | **结构完整合规** | `false` (L5) | 无缺失 | 无 | 环境: `huawei_cloud, real_account`；id: `f09-cloud-prefix-plan`；状态: `unavailable` (L4) |
| #605 | `packages/agentarts/src/f09-cloud-prefix-acceptance-plan.ts` | TS/MJS 代码规划 | **结构完整合规** | `false` (L481) | 无缺失 | 无 | 环境: `huawei_cloud, real_account`；id: `f09-cloud-prefix-plan`；状态: `unavailable` (L480) |
| #606 | `CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | **结构完整合规** | `false` (L5) | 无缺失 | 无 | 环境: `huawei_cloud`；id: `cloud-persistent-acceptance-plan`；状态: `unavailable` (L4) |
| #606 | `packages/coordination/src/cloud-persistent-acceptance-plan.ts` | TS/MJS 代码规划 | **结构完整合规** | `false` (L565) | 无缺失 | 无 | 环境: `huawei_cloud`；id: `cloud-persistent-acceptance-plan`；状态: `unavailable` (L564) |
| #607 | `MOD-04B-AGENTARTS-ACCEPTANCE-PLAN-20261107.md` | Markdown 规划 | **结构完整合规** | `false` (L5) | 无缺失 | 无 | 环境: `huawei_cloud`；id: `mod04b-agentarts-acceptance-plan`；状态: `unavailable` (L4) |
| #607 | `packages/coordination/src/mod04b-agentarts-acceptance-plan.ts` | TS/MJS 代码规划 | **结构完整合规** | `false` (L817) | 无缺失 | 无 | 环境: `huawei_cloud`；id: `mod04b-agentarts-acceptance-plan`；状态: `unavailable` (L816) |

---

## 3. 逐字段提取规则与 Provenance 规范

- **ID / Title**：严格要求仅从源码中的明确标记或字面量常量（如 frontmatter `id`、`title`、代码中的 `MOD..._CAPABILITY`、`PLAN_ID`、`PLAN_TITLE`）读取，并记录所在行号。**严禁以文件名或其它字段ID作为默认回填值**；若未显式声明，`id` / `title` 必须保持缺失并列入 `missingFields`，同时记录 `cannotConfirm`（`missing_id` / `missing_title`），文件名仅作为报告中的文件路径定位展示。
- **closedLoop**：采用字符级 Tokenizer 扫描所有代码 Token。严格静态检查所有代码赋值：若检测到多分支条件返回（如同时存在 `closedLoop: false` 与 `closedLoop: true`、同一行多赋值或动态表达式），记录 `ambiguous_closedLoop` 与各分支行号，绝不盲猜默认分支，绝不将 `true` 改为 `false`；
- **status**：基于规划对象字面量作用域 `{ ... }` 精确锚定。仅提取包含唯一 `closedLoop` 的规划对象内部显式声明的合法 `status` 字面量属性与行号；若该对象未显式声明，直接报 `missing_status`，**绝不用任何行距启发式去外部代码盲猜**；
- **requiredEnvironments**：仅读取明确环境字面量数组（如 `export const REQUIRED_ENVIRONMENTS = [...]` 或 frontmatter `requiredEnvironments`），禁止通过全文出现 `profile` / `token` / `windows` 猜测；
- **acceptanceSteps / evidenceRequirements**：仅读取明确静态数组或 Markdown 章节，禁止将 pending 项复制填充以制造虚假齐套；
- **齐套不等于真实验收通过**：合规的 18 份规划均明确 `closedLoop: false`，状态为 `unavailable` 或 `pending`，待真实环境验收执行。
