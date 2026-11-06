---
id: mod04b-agentarts-acceptance-plan
title: MOD-04B：AgentArts 多 Agent 结果与文字协调离线验收规划
status: unavailable
closedLoop: false
requiredEnvironments:
  - huawei_cloud
reason: 待真云验收
---

# MOD-04B：AgentArts 多 Agent 结果与文字协调离线验收规划（2026-11-07）

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

- Profile：`huawei_ict_agentarts`；负责人：`zemeng`（zemeng5208，核心架构 / 华为云端编排 / 整图协调）；状态：`review`。
- 工作树与分支：分支 `zemeng/mod04b-agentarts-acceptance-plan`，工作目录 `/workspace/mod04b-plan`，基于最新 `origin/main`。
- 协作与隔离边界：
  - 本 PR 避开在途堆叠与并行分支（避开 ZCode #578 F20、#580 F22/F26/F28、#582 Trace、#585 F14、#587 F18/F19、#590–#592、#600/#601/#603 等）；
  - **严禁且未修改** `apps/runtime`（goo Runtime/Policy 归属文件未动）、`apps/desktop`（lab Desktop 前端与接线未动）、业务连接器（`packages/connectors/*`），严禁且未修改根 `package.json`；
  - 不与 #596 部署读回（`packages/agentarts/src/deployment-readback-plan.ts`）重叠；
  - 纯离线纯函数 helper，不连接华为云，不读取任何云凭据或密钥；
  - 核心本地契约守则：**无真实华为云多 Agent / continuation 读回证据时 `closedLoop: false`，状态标记为 `unavailable`，原因统一标记为 `'待真云验收'`**。

---

## 1. 契约背景与核心边界

MOD-04B（Competition 文字协调消费实现）在华为比赛 Profile（`huawei_ict_agentarts`）下负责通过 `CloudAgentPort` / `CompetitionCoordinator` 协调 Runtime 与华为云 AgentArts 远端云原生多智能体网络（主协调器与专业子 Agent）的调用与多轮工具续答（continuation）。

历史 ROADMAP 台账确认：
- 离线审批工具循环已验证（PR #36、#49、#72 Workflow 输入、#80 continuation 边界均已合入 main）；
- 但在当前 HEAD 上，**真实 AgentArts 调用与多 Agent 协作结果仍未真实验收**。

根据 [AGENTS.md](../../AGENTS.md) 协作规范与比赛 Profile 准则：
1. **无真实云证据时不宣称闭环**：
   - 未在华为云真实账号与在线环境中获得真实端到端多 Agent 路由回执与受限 continuation 读回前，`closedLoop` 必须为 `false`，状态标记为 `unavailable`，原因统一标识为 `'待真云验收'`；
2. **真实缺项如实登记**：
   - 将尚未在华为云真实执行的 6 项核心能力显式挂起在 `pending` 列表中，每项均明确标为 `status: 'unavailable'` 与 `reason: '待真云验收'`；
3. **防 Mock 与伪造原则**：
   - 凡标记为 `mock: true`、`isMock: true`、`synthetic: true`、`simulated: true` 或 `evidenceLevel === 'mock'` 的输入，必须直接拒绝并抛出 `ProtocolError('INVALID_ARGUMENT')`；
   - 凡声称本地仅有执行（`localOnly: true` / `isLocalOnly: true` / `cloudEvidence: false`）却冒充云端多 Agent 闭环者，直接拒绝；
   - 严禁网关地址指向 `localhost`、`127.0.0.1`、`[::1]` 或主机名包含 `mock`/`fake`，严禁使用非安全协议（必须使用 `https:` 或 `wss:` 且无内嵌凭据）；
   - 多智能体协调要求至少识别到 2 位不同的非 Mock 协作智能体（`agents.length >= 2`），拒绝空组、单 Agent 冒充或重复角色；
   - 工具延续（continuation）要求提案标识非空非 Mock，且状态必须严格为 `'confirmed'`；
   - 严格因果时序校验：完成时间（`completedAt`）不得早于调用时间（`invokedAt`）。
4. **离线与零副作用**：
   - 本规划 helper 纯离线执行，不发起网络 I/O，不持有也不读取云凭据，不产生任何副作用。

---

## 2. 交付实现与接口定义

在 `packages/coordination/src/mod04b-agentarts-acceptance-plan.ts` 中实现，并通过 `packages/coordination/src/index.ts` 进行最小导出：

1. `assertMod04bAgentArtsEvidence(value: unknown): asserts value is Mod04bAgentArtsEvidence`：
   - 结构校验：必须为非空普通对象；
   - Profile 必须为 `'huawei_ict_agentarts'`，Capability 若指定必须为 `'competition_coordination'`；
   - TaskId、SessionId 与 CloudTraceId 必须为 1～128 字符非空合法标识；
   - 严格拦截 Mock（`mock`、`isMock`、`synthetic`、`simulated`、`evidenceLevel === 'mock'`）；
   - 严格拦截本地假冒（`localOnly`、`isLocalOnly`、`cloudEvidence: false`）；
   - 严格校验 `gatewayUrl`：必须为合法 HTTPS/WSS URL，禁止 localhost、127.0.0.1、IPv6 回环、含凭据或含 mock/fake；
   - 严格校验 ISO 时间戳有效性（防不可能日期如 `2026-02-31` 规整化）与时序因果（`completedAt >= invokedAt`）；
   - 严格校验多智能体角色网络（至少 2 位不同非 Mock Agent）与/或受限 continuation 形状（非空 proposalId、状态必须为 `confirmed`）；
   - 若两者皆缺失，明确拒绝。
2. `parseMod04bAgentArtsEvidence(value: unknown): Mod04bAgentArtsEvidence`：
   - 包装断言并返回强类型 `Mod04bAgentArtsEvidence`。
3. `planMod04bAgentArtsAcceptance(optionsOrEvidence?: unknown | PlanMod04bAgentArtsAcceptanceOptions): Mod04bAgentArtsAcceptancePlan`：
   - 纯离线纯函数 helper，不发起网络请求、不读取凭据；
   - 支持无参数调用（生成默认 6 项待真云验收挂起项）；
   - 支持传入完整参数选项对象或直接传入证据；
   - 传入证据时先执行 `assertMod04bAgentArtsEvidence` 严格校验；
   - 若无华为云真实多 Agent / continuation 验证证据，强制返回：
     - `closedLoop: false`
     - `status: 'unavailable'`
     - `reason: '待真云验收'`
     - `pending` 包含 6 大华为云端到端真实验收挂起项，各项均标明 `status: 'unavailable'` 与 `reason: '待真云验收'`：
       1. `agentarts_real_cloud_endpoint`：华为云 AgentArts 真实端点（HTTPS/WSS）与有效凭据（Authorization）端到端连通读回（非本地 Fake）；
       2. `agentarts_multi_agent_routing`：AgentArts 云端多智能体协作网络（主协调器与专业子 Agent）角色路由与分派结果真实读回；
       3. `agentarts_continuation_roundtrip`：基于真实提案 proposalId 的受限 continuation 工具结果回传与多轮续答闭环读回；
       4. `agentarts_tool_proposal_verification`：云端生成 ToolProposal 到本地 Policy/ToolGateway 授权审批与结果核实的双向读回；
       5. `platform_independent_trace_and_cost`：华为云平台独立 TraceId 关联、步骤耗时与 Token 消耗/计费真实读回（非本地模拟）；
       6. `local_cancellation_and_deadline_settlement`：真实网络延迟下的本地 deadline 与取消信号传播、不交付迟到结果的对账读回。
   - 校验 HEAD 提交对齐（`headCommit` 与 `sourceCommit`），失配时追加 `source_head_commit_alignment` 挂起项；
   - 仅当真实华为云多 Agent / continuation 证据齐备且代码提交对齐时，方可收敛至 `closedLoop: true`、`status: 'verified'`。

---

## 3. 验证结果

- **构建与类型检查**：
  `npm run build --workspace=@personal-agent/coordination` 成功，类型检查通过，生成对应 `.d.ts` 与 `.js` 产物。
- **定向测试**：
  `node --test packages/coordination/test/mod04b-agentarts-acceptance-plan.test.mjs` 21/21 全部通过：
  - 完整合法多 Agent 与 continuation 证据结构校验；
  - 最小合法多 Agent 证据校验；
  - 最小合法 continuation 证据校验；
  - 顶级 agents 数组与 continuations 数组合法校验；
  - 非普通对象输入拒绝（null、undefined、基本类型、数组）；
  - Mock 证据显式拦截专项（`mock`、`isMock`、`synthetic`、`simulated`、`evidenceLevel === 'mock'`）；
  - 本地仅有执行与 `cloudEvidence: false` 显式拦截；
  - Localhost、回环 IP、mock/fake、不安全协议（http/ws）及内嵌凭据拦截；
  - Profile 与 Capability 严格匹配；
  - TaskId、SessionId、CloudTraceId 边界校验；
  - runtimeName 命名规则与长度校验；
  - 规整化不可能日期识别与因果时序校验（调用时间先于完成时间）；
  - 多 Agent 约束校验（少于 2 位拒绝、重复 Agent 拒绝、mock Agent 拒绝）；
  - continuation 约束校验（空 proposalId 拒绝、mock proposalId 拒绝、非 confirmed 状态拒绝）；
  - 缺少多 Agent 与 continuation 详情时显式拒绝；
  - 无参调用安全生成默认 `unavailable` 验收规划；
  - 有证据但无真实云验证时保持 `closedLoop: false`、`status: unavailable`、`reason: '待真云验收'`；
  - HEAD Commit 失配探测与挂起项追加；
  - 真实云证据完整提供时的闭环收敛验证；
  - 自定义挂起项保留验证；
  - 通过 options 传入 mock 证据时的严格拦截。
- **工作区全量回归**：
  `npm test --workspace=@personal-agent/coordination` 262/262 全部通过。
- **架构门禁**：
  `npm run check:architecture` 3/3 全部通过。
- **代码规范检查**：
  `git diff --check` 0 异常。

---

## 4. 交付与台账状态

- 模块接口保持 `provisional`，未变更 Core wire Schema 或扩大冻结范围；
- ROADMAP 中 MOD-04B 补充本次离线规划小注，状态维持 `review`/`in_progress`（待后续华为云真实端到端执行证据）；
- 本次改动未修改 `apps/runtime`、`apps/desktop`、业务连接器或根 `package.json`，未修改 ZCode 评测/Demo 文件。

---

## 验收步骤

- 步骤 1：`agentarts_real_cloud_endpoint`：华为云 AgentArts 真实端点（HTTPS/WSS）与有效凭据（Authorization）端到端连通读回（非本地 Fake）
- 步骤 2：`agentarts_multi_agent_routing`：AgentArts 云端多智能体协作网络（主协调器与专业子 Agent）角色路由与分派结果真实读回
- 步骤 3：`agentarts_continuation_roundtrip`：基于真实提案 proposalId 的受限 continuation 工具结果回传与多轮续答闭环读回
- 步骤 4：`agentarts_tool_proposal_verification`：云端生成 ToolProposal 到本地 Policy/ToolGateway 授权审批与结果核实的双向读回
- 步骤 5：`platform_independent_trace_and_cost`：华为云平台独立 TraceId 关联、步骤耗时与 Token 消耗/计费真实读回（非本地模拟）
- 步骤 6：`local_cancellation_and_deadline_settlement`：真实网络延迟下的本地 deadline 与取消信号传播、不交付迟到结果的对账读回

---

## 证据要求

- 凭证 1：`Mod04bAgentArtsEvidence` 合规回执（含 gatewayUrl HTTPS/WSS、CloudTraceId、时序因果 completedAt >= invokedAt、至少 2 位不同非 Mock Agent 与/或 confirmed 状态 continuation）
- 凭证 2：华为云 AgentArts 平台独立 TraceId 关联、Token/计费在线读回与双向授权审计凭据

---

## 挂起项

- 挂起项 1：`agentarts_real_cloud_endpoint`（status: unavailable, reason: 待真云验收）
- 挂起项 2：`agentarts_multi_agent_routing`（status: unavailable, reason: 待真云验收）
- 挂起项 3：`agentarts_continuation_roundtrip`（status: unavailable, reason: 待真云验收）
- 挂起项 4：`agentarts_tool_proposal_verification`（status: unavailable, reason: 待真云验收）
- 挂起项 5：`platform_independent_trace_and_cost`（status: unavailable, reason: 待真云验收）
- 挂起项 6：`local_cancellation_and_deadline_settlement`（status: unavailable, reason: 待真云验收）

---

## 字段来源依据（Source References）

| 字段名称 | 结构化声明值 | 原规划来源依据（章节 / 行 / 原句） |
| :--- | :--- | :--- |
| `id` | `mod04b-agentarts-acceptance-plan` | 本文档标题及 §2（`packages/coordination/src/mod04b-agentarts-acceptance-plan.ts`） |
| `title` | `MOD-04B：AgentArts 多 Agent 结果与文字协调离线验收规划` | 本文档一级标题第 1 行 |
| `status` | `unavailable` | 本文档文首要点及 §1.1/§2.3（"状态标记为 `unavailable`"） |
| `closedLoop` | `false` | 本文档文首要点及 §1.1/§2.3（"无真实华为云多 Agent / continuation 读回证据时 `closedLoop: false`"） |
| `requiredEnvironments` | `['huawei_cloud']` | 本文档文首与 §1、§2.3（明确要求华为云在线真实多 Agent 环境，无真实云证据不闭环） |
| `reason` | `待真云验收` | 本文档文首要点及 §1.1/§2.3（"原因统一标记为 `'待真云验收'`"） |
| `acceptanceSteps` | 6 项核心端到端步骤 | 本文档 §2.3 明确定义的 6 大华为云端到端真实验收挂起项编号与原名 |
| `evidenceRequirements` | 2 项合规证据 | 本文档 §1.3/§2.1 明确规定的 `Mod04bAgentArtsEvidence` 回执要求与云平台 Trace 凭据 |
| `pending` | 6 项默认挂起项 | 本文档 §1.2/§2.3 声明的 6 大华为云端到端真实验收挂起项 |
