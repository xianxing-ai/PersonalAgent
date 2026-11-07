---
id: f09-cloud-prefix-plan
title: F09：订阅云前缀与会话授权端到端读回离线规划
status: unavailable
closedLoop: false
requiredEnvironments:
  - huawei_cloud
  - real_account
reason: 待真云验收
---

# F09：订阅云前缀与会话授权端到端读回离线规划（2026-11-07）

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

- Profile：`huawei_ict_agentarts`；负责人：`zemeng`（zemeng5208，云端编排）；状态：`in_progress`。
- 分工与协作边界：Potatos498 负责真实 feeds 提供者与后端口实现（`packages/connectors/feeds` 与 Desktop feeds-host）；zemeng5208 负责 AgentArts 云端托管运行时、前缀路由映射与云端联跑；2511375597-lab 负责桌面端 UI 消费与设置面板。本 PR **仅在 agentarts 模块内交付**，**严禁且未修改** `packages/connectors/feeds`、Desktop feeds-host、Runtime 或根配置。
- 工作树：当前工作树根目录；分支：`zemeng/f09-cloud-prefix-acceptance-plan`。
- 依赖：`packages/agentarts` 内部既有工作流模板（`owned-workflow-templates.ts` 中的 `F09_N01`～`F09_N04`）、`@personal-agent/contracts`。
- 范围：F09 工作流（订阅、信号发现与筛选）在 AgentArts 比赛 Profile 下的「云前缀网关路由映射与会话授权读回」离线契约与验收规划 helper，交付 `assertF09CloudPrefixReceipt` 与 `planF09CloudPrefixAcceptance`；不扩公共 wire Schema，不连云、不读凭据，避开其他在途 PR。

## 1. 契约背景与协作边界

F09 工作流（订阅、信号发现与筛选）包含 4 个核心节点：
1. `F09_N01`（`tool_exec`）：多源订阅流独立依赖（默认串行）拉取，消费 `feeds.collect` 工具与 RSS 订阅流资源；
2. `F09_N02`（`deterministic_check`）：确定性哈希去重与格式校验，消费 `feeds.validate_and_deduplicate` 宿主适配器；
3. `F09_N03`（`semantic_decision`）：决策模型语义相关性与价值判别，通过 AgentArts 代理的决策模型（如 DeepSeek/Laya）对候选条目进行价值分诊；
4. `F09_N04`（`complete`）：转入 F10 深度研究队列，消费 `runtime.enqueue_research` 宿主适配器。

在华为比赛 Profile（`huawei_ict_agentarts`）下，AgentArts 托管运行时需通过前缀网关（如 `/invocations/f09` 或 `/invocations/{custom_path}`）向本地 Desktop/Runtime 暴露公网端点，并完成基于会话租约（如 `feed-source-grant:` 前缀）的会话授权。

根据 [AGENTS.md](../../AGENTS.md) 核心开发规范：
- **无真云证据不宣称闭环**：未连接华为云账号并获得真实前缀与会话授权读回证据前，`closedLoop` 必须为 `false`，状态标为 `unavailable`，原因标为 `'待真云验收'`；
- **拒绝 Mock**：严格拒绝伪造或标记为 mock 的回执（`mock: true`、`evidenceLevel: 'mock'` 或 `isMock: true` 均直接抛出 `ProtocolError('INVALID_ARGUMENT')`），不把本地测试替身当成云端验证通过；
- **真实缺项如实登记**：将需华为云真实执行的缺项明确登记为 `pending` 数组，每项状态标为 `unavailable`，原因标为 `'待真云验收'`；
- **纯离线纯函数**：本规划 helper 纯离线执行，不连接华为云，不读取密钥凭据，无网络副作用。

## 2. 交付实现与接口定义

在 `packages/agentarts/src/f09-cloud-prefix-acceptance-plan.ts` 中实现并通过 `packages/agentarts/src/index.ts` 最小导出：

1. `assertF09CloudPrefixReceipt(value: unknown): asserts value is F09CloudPrefixReceipt`：
   - 校验回执基本结构：Profile 必须为 `'huawei_ict_agentarts'`，WorkflowId 必须为 `'F09'`；
   - 校验网关地址 `gatewayUrl`（严格 HTTPS origin，禁止查询参数、哈希、路径及内嵌凭据）；
   - 校验云前缀路径 `cloudPrefix`（必须以 `/` 开头，如 `/invocations/f09`，无空格/特殊字符）；
   - 校验运行时标识 `runtimeName`（1～64 位字母、数字、短横线、下划线）与 `prefixVerified`（布尔值）；
   - 校验会话授权 `sessionAuth`：必须包含非空 `sessionId`、非空 `authorizationRef`、非空字符串数组 `grantedScopes`（如 `feeds.collect` 等）、合法 ISO 时间戳 `expiresAt`、合法会话状态 `sessionState`（`'active' | 'authorized' | 'granted'`）；
   - **严格拒绝 Mock**：若回执或其内部 `sessionAuth` 包含 `mock: true`、`isMock: true` 或 `evidenceLevel === 'mock'`，立即拒绝并抛出 `ProtocolError('INVALID_ARGUMENT')`。
2. `parseF09CloudPrefixReceipt(value: unknown): F09CloudPrefixReceipt`：
   - 包装断言并返回类型化 F09 前缀回执对象。
3. `planF09CloudPrefixAcceptance(options?: PlanF09CloudPrefixAcceptanceOptions): F09CloudPrefixAcceptancePlan`：
   - 支持无参数调用（默认生成全量待真云验收规划）；
   - 若提供回执，严格断言回执形状及仓库 HEAD commit 对齐状态（`headMatches === true`，缺失或不匹配均挂起 `head_commit_alignment`）；
   - 校验 F09 全部 4 个节点（`F09_N01`～`F09_N04`）覆盖状态（`missingNodes.length === 0`，未全量覆盖时在 `workflow_nodes_coverage` 中明确保留缺失项）；
   - **输入门控防御与边界澄清**：
     - `realCloudEvidence` 仅支持结构化对象 `F09RealCloudEvidence`，严格删除 `boolean` 重载；运行时传入布尔直接拒绝抛错；
     - 结构核验要求必须完整声明 `authenticated`、`apiCallVerified`、`prefixRouteVerified`、`sessionAuthVerified` 与 `traceReadbackVerified` 五项字段；
     - `prefixVerified` 必须为严格的 `true`，若为 `false` 或 `undefined` 则产生结构告警；
     - 当前规划 helper 为离线纯函数，能够完成回执结构与会话租约形状断言，但在纯离线环境下无法产生华为云在线端点实际映射与真实会话验签凭据；自报对象不构成真实独立验证。因此在缺乏真实云环境独立凭证读回时，全链路闭环严格保持 `closedLoop: false`，`status: 'unavailable'`，`reason: '待真云验收'`；
   - 登记六大华为云端到端真实验收挂起项：
     1. `huawei_cloud_prefix_route_readback`：华为云 AgentArts 托管运行时前缀路由（`/invocations/*`）公网端点实际映射与读回；
     2. `cloud_session_auth_and_source_grant`：华为云端到端会话授权与 `feed-source-grant:` 租约凭据在线读回（非本地 mock）；
     3. `real_feeds_provider_binding`：真实 feeds 连接器（Potatos498 负责）多源订阅流拉取、增量 cursor 与去重校验；
     4. `agentarts_decision_model_inference`：AgentArts 代理决策模型（DeepSeek/Laya）对动态信号的语义相关性与价值判别在线推理；
     5. `enqueue_research_cross_workflow_handoff`：F09_N04 到 F10 深度研究队列的跨工作流真实任务投递与回执确认；
     6. `platform_independent_trace_and_cost`：AgentArts 平台独立 TraceId 关联与 Token/计费读回（非本地应用日志）。

## 验收步骤

1. 华为云 AgentArts 托管运行时前缀路由（/invocations/*）公网端点实际映射与读回
2. 华为云端到端会话授权与 feed-source-grant: 租约凭据在线读回（非本地 mock）
3. 真实 feeds 连接器多源订阅流拉取、增量 cursor 与去重校验
4. AgentArts 代理决策模型（DeepSeek/Laya）对动态信号的语义相关性与价值判别在线推理
5. F09_N04 到 F10 深度研究队列的跨工作流真实任务投递与回执确认
6. AgentArts 平台独立 TraceId 关联与 Token/计费读回（非本地应用日志）

## 证据要求

1. F09CloudPrefixReceipt 合规云前缀回执（含 gatewayUrl HTTPS origin、cloudPrefix 路径、runtimeName、prefixVerified=true 与 sessionAuth 租约）
2. AgentArts 平台独立 TraceId 关联、Token/计费在线读回与真实 feeds 数据落盘审计

## 挂起项

- `huawei_cloud_prefix_route_readback`: 华为云 AgentArts 托管运行时前缀路由公网端点实际映射与读回
- `cloud_session_auth_and_source_grant`: 华为云端到端会话授权与 feed-source-grant 租约凭据在线读回
- `real_feeds_provider_binding`: 真实 feeds 连接器多源订阅流拉取、增量 cursor 与去重校验
- `agentarts_decision_model_inference`: AgentArts 代理决策模型在线推理
- `enqueue_research_cross_workflow_handoff`: F09 到 F10 深度研究队列跨工作流任务投递与回执
- `platform_independent_trace_and_cost`: AgentArts 平台独立 TraceId 关联与 Token/计费读回

## 字段来源依据（Source References）

| 字段 | 机器取值 | 来源文件 | 章节/行号及原文依据 |
| --- | --- | --- | --- |
| id | `f09-cloud-prefix-plan` | `docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | L1: `F09：订阅云前缀与会话授权端到端读回离线规划`；代码 `PLAN_ID` |
| title | `F09：订阅云前缀与会话授权端到端读回离线规划` | `docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | L1: `# F09：订阅云前缀与会话授权端到端读回离线规划（2026-11-07）` |
| status | `unavailable` | `docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | §1: `状态标为 unavailable`；§2.3: `status: 'unavailable'` |
| closedLoop | `false` | `docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | §1: `未连接华为云账号并获得真实前缀与会话授权读回证据前，closedLoop 必须为 false`；代码 L319, L407 |
| requiredEnvironments | `['huawei_cloud', 'real_account']` | `docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | §1: `未连接华为云账号并获得真实前缀与会话授权读回证据前`；§2.1: `校验会话授权 sessionAuth` |
| acceptanceSteps | 6 项完整步骤 | `docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | §2.3: 登记六大华为云端到端真实验收挂起项列表 |
| evidenceRequirements | 2 项证据要求 | `docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | §2.1: `assertF09CloudPrefixReceipt` 形状校验条件；§2.3: 独立 TraceId 与 Token 计费读回 |
| reason / pendingItems | `待真云验收` | `docs/modules/F09-CLOUD-PREFIX-ACCEPTANCE-PLAN-20261107.md` | §1: `原因标为 '待真云验收'`；代码 `F09_ACCEPTANCE_PENDING_REASON` |

## 3. 验证结果与证据

- 编译构建：`npm run build --workspace=@personal-agent/agentarts` 成功，类型检查及构建产物无错误。
- 独立单元测试（本轮实测）：`node --test packages/agentarts/test/f09-cloud-prefix-acceptance-plan.test.mjs` **18/18 全部通过 (0 失败)**：
  - 完整回执与最小回执合法校验；
  - 非对象、错误 Profile、错误 WorkflowId 严格拒绝；
  - 非法网关 HTTPS URL（非 HTTPS、含凭据、含路径、含查询参数）严格拒绝；
  - 非法 cloudPrefix（缺少前导斜杠、含空格、含查询/哈希）严格拒绝；
  - sessionAuth 字段结构与时间戳格式严格校验；
  - **Mock 拒绝专项**：回执 `mock: true`、`isMock: true`、`evidenceLevel: 'mock'` 以及 `sessionAuth.mock: true` / `isMock: true` 均被严格拦截；
  - 无回执直接调用时生成默认 `unavailable` 离线规划；
  - 有回执但无真实云证据时安全返回 `closedLoop: false`、`status: unavailable`、`reason: '待真云验收'`；
  - `cloudEvidence: false` 或 `prefixVerified: false` 时强制保持 `unavailable`；
  - HEAD commit 对齐核验及失配挂起；
  - 自定义 pending 项追加支持；
  - 跨审查项修复：删除 boolean 重载（运行时传布尔抛错）、prefixVerified 门控、missingNodes 工作流节点覆盖门控与结构化缺口可观测字段（`structuralVerification`）；
  - 模拟真实云端读回对象时，全链路闭环严格保持 `closedLoop: false`，全部挂起项保持 pending。
- 历史全量基线参考：历史记录 256/256 全部通过（本轮仅重跑受影响定向测试，未宣称本轮已跑全量）。
- 架构门禁：`npm run check:architecture` 3/3 全部通过。
- 代码格式：`git diff --check` 0 异常。

## 4. 交付与台账状态

- 本模块公共接口无破坏性变更，保持 `provisional`；
- ROADMAP 中 MOD-29 维持 `in_progress`，等待后续真实华为云账号下的在线端到端联跑读回；
- 本 PR 未修改 `packages/connectors/feeds` 或 Desktop feeds-host，不侵犯 Potatos498 的业务所有权；未修改 Desktop、Runtime 或根 package.json。
