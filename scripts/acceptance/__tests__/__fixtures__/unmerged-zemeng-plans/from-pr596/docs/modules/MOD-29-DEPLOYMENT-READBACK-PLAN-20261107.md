---
id: deployment-readback-plan
title: MOD-29：AgentArts 部署当前 HEAD 端到端读回离线规划
status: unavailable
closedLoop: false
requiredEnvironments:
  - huawei_cloud
  - real_account
reason: 待真云验收
---

# MOD-29：AgentArts 部署当前 HEAD 端到端读回离线规划（2026-11-07）

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

- Profile：`huawei_ict_agentarts`；负责人：`zemeng`；状态：`in_progress`。
- 工作树：`.worktrees/zemeng-mod29-deployment-readback-plan`；分支：`zemeng/mod29-deployment-readback-plan`。
- 依赖：`packages/agentarts` 既有 8 Workflow / 3 Controller 绑定、`OwnedWorkflowHostBridge`、`@personal-agent/contracts`。
- 范围：MOD-29 赛题部署「固定 deployment 当前 HEAD 端到端读回」离线规划 helper，交付 `assertDeploymentReadbackReceipt` 与 `planDeploymentAcceptance`；不扩公共 wire Schema，不改 Runtime/Desktop/connectors，不连云、不读凭据，避开 Trace 主题文件。

## 1. 契约背景与边界

赛题-部署（MOD-29）在华为比赛 Profile（`huawei_ict_agentarts`）下负责将本地 Runtime/Desktop 装配与华为云 AgentArts 远端 Runtime 部署绑定。历史验收已确认 ARM64 自有镜像及固定部署版本（如 `arm64-v5-4aa8f93f-r1`）的目录与结构；但在当前 HEAD 代码上，完整的端到端真实调用、平台 Trace、计费与本地 Policy/ToolGateway/Evidence 闭环仍需华为云真实账号及在线环境读回。

根据 [AGENTS.md](../../AGENTS.md) 规则：
- **无真实云证据时不宣称闭环**：未连接华为云账号并获得真实认证读回前，`closedLoop` 必须为 `false`，状态标记为 `unavailable`；
- **真实缺项如实登记**：需华为云账号的真实验收项明确标为 `status: unavailable`，原因统一标识为 `待真云验收`；
- **防伪造原则**：本地测试使用显式 Fake / 离线结构校验，缺配置时不回退 Fake 冒充真实成功，不能用本地配置 hash 或合成回执替代云端读回；
- **只读与隔离**：本规划 helper 纯离线执行，不持有也不读取云凭据，不产生网络副作用。

## 2. 交付实现与接口定义

在 `packages/agentarts/src/deployment-readback-plan.ts` 中实现：

1. `assertDeploymentReadbackReceipt(value: unknown): asserts value is DeploymentReadbackReceipt`：
   - 严格校验读回回执结构：Profile 必须为 `'huawei_ict_agentarts'`；
   - 校验 `runtimeName`（1～64 位字母、数字、短横线、下划线）、`runtimeId`、`deploymentVersion`（1～128 位规范标识）；
   - 校验 `gatewayUrl`（严格 HTTPS origin，禁止查询参数、哈希、路径及内嵌凭据）；
   - 校验 `region`、`runtimeStatus`、源提交标识（`sourceCommit` / `sourceRevision` / `sourceCommitShort`）；
   - 可选字段（`observedAt`、`imageDigest`、`bindings`）合规校验，不合规抛出 `ProtocolError('INVALID_ARGUMENT')`。
2. `parseDeploymentReadbackReceipt(value: unknown): DeploymentReadbackReceipt`：
   - 包装断言并返回类型化回执对象。
3. `planDeploymentAcceptance(options?: PlanDeploymentAcceptanceOptions): DeploymentAcceptancePlan`：
   - 支持无参数/空输入调用，返回语义明确的默认离线规划（`closedLoop: false`，`status: 'unavailable'`，`reason: '待真云验收'`）；
   - 传入回执时严格执行 `assertDeploymentReadbackReceipt` 结构校验，比对当前 HEAD commit 对齐状态（`headMatches === true`，缺失或不匹配均挂起 `head_commit_alignment`）；
   - 严格核对 8 Workflow / 3 Controller（共 11 项）自有资产绑定覆盖率（`missingBindings.length === 0`，未全量覆盖时在 `owned_bindings_invocation_readback` 描述中明确保留缺失项）；
   - **输入门控防御与边界澄清**：
     - `realCloudEvidence` 仅支持结构化对象，严格删除 `boolean` 重载；运行时传入布尔直接拒绝抛错；
     - 结构核验要求必须完整声明 `authenticated`、`apiCallVerified`、`traceReadbackVerified` 与 `accountBound` 四项字段；
     - 当前规划 helper 为离线纯函数，具备契约形状与业务一致性校验，但缺乏对华为云在线服务、平台 TraceId 与计费凭据的独立验签能力；自报对象不构成真实独立验证。因此在缺乏真云环境独立凭证读回时，全链路闭环严格保持 `closedLoop: false`，`status: 'unavailable'`，`reason: '待真云验收'`；
   - 挂起（`pending`）六大华为云端到端真实验收项，每项均标明 `status: 'unavailable'` 与 `reason: '待真云验收'`：
     1. `huawei_cloud_credentials_readback`：华为云账号凭据认证与受信端点绑定读回；
     2. `runtime_head_deployment_verified`：当前 HEAD 提交对应的已发布 ARM64 Runtime 部署版本状态读回；
     3. `owned_bindings_invocation_readback`：8 工作流 / 3 控制器绑定在已发布 Runtime 的真实端到端调用读回；
     4. `multi_agent_routing_and_inference`：AgentArts 云端多智能体角色路由与模型推理真实回执；
     5. `platform_independent_trace_and_cost`：平台独立 TraceId 关联与 Token/计费读回（非本地应用日志）；
     6. `local_policy_evidence_closed_loop`：本地 Policy/ToolGateway 授权到真实目标读回与 Evidence 落盘的完整端到端闭环。

## 验收步骤

1. 华为云账号凭据认证与受信端点绑定读回（huawei_cloud_credentials_readback）
2. 当前 HEAD 提交对应的已发布 ARM64 Runtime 部署版本状态读回（runtime_head_deployment_verified）
3. 8 工作流 / 3 控制器绑定在已发布 Runtime 的真实端到端调用读回（owned_bindings_invocation_readback）
4. AgentArts 云端多智能体角色路由与模型推理真实回执（multi_agent_routing_and_inference）
5. 平台独立 TraceId 关联与 Token/计费读回（platform_independent_trace_and_cost）
6. 本地 Policy/ToolGateway 授权到真实目标读回与 Evidence 落盘的完整端到端闭环（local_policy_evidence_closed_loop）

## 证据要求

1. DeploymentReadbackReceipt 合规回执（Profile 为 huawei_ict_agentarts、HTTPS origin、HEAD commit 对齐、ARM64 deploymentVersion）
2. 华为云平台独立 TraceId 关联与 Token/计费在线读回回执（非本地应用日志）
3. 本地 Policy/ToolGateway 授权与真实目标读回 Evidence 审计记录

## 挂起项

- `huawei_cloud_credentials_readback`: 华为云账号凭据认证与受信端点绑定读回
- `runtime_head_deployment_verified`: 当前 HEAD 提交对应的已发布 ARM64 Runtime 部署版本状态读回
- `owned_bindings_invocation_readback`: 8 工作流 / 3 控制器绑定在已发布 Runtime 的真实端到端调用读回
- `multi_agent_routing_and_inference`: AgentArts 云端多智能体角色路由与模型推理真实回执
- `platform_independent_trace_and_cost`: 平台独立 TraceId 关联与 Token/计费读回
- `local_policy_evidence_closed_loop`: 本地 Policy/ToolGateway 授权到真实目标读回与 Evidence 落盘的完整端到端闭环

## 字段来源依据（Source References）

| 字段 | 机器取值 | 来源文件 | 章节/行号及原文依据 |
| --- | --- | --- | --- |
| id | `deployment-readback-plan` | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | L1, L9: `MOD-29：AgentArts 部署当前 HEAD 端到端读回离线规划`；代码 `PLAN_ID` |
| title | `MOD-29：AgentArts 部署当前 HEAD 端到端读回离线规划` | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | L1: `# MOD-29：AgentArts 部署当前 HEAD 端到端读回离线规划（2026-11-07）` |
| status | `unavailable` | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | §1: `状态标记为 unavailable`；§2.3: `status: 'unavailable'` |
| closedLoop | `false` | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | §1: `未连接华为云账号并获得真实认证读回前，closedLoop 必须为 false`；代码 L289 |
| requiredEnvironments | `['huawei_cloud', 'real_account']` | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | §1: `完整的端到端真实调用、平台 Trace、计费...仍需华为云真实账号及在线环境读回`；§2.3: `huawei_cloud_credentials_readback：华为云账号凭据认证` |
| acceptanceSteps | 6 项完整步骤 | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | §2.3: 六大华为云端到端真实验收挂起项列表 |
| evidenceRequirements | 3 项证据要求 | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | §2.1: `DeploymentReadbackReceipt` 形状断言；§2.3: TraceId 关联、Token/计费读回及本地 Policy/Evidence 回执 |
| reason / pendingItems | `待真云验收` | `docs/modules/MOD-29-DEPLOYMENT-READBACK-PLAN-20261107.md` | §1: `需华为云账号的真实验收项明确标为 status: unavailable，原因统一标识为 待真云验收`；代码 `DEPLOYMENT_ACCEPTANCE_PENDING_REASON` |

## 3. 验证结果

- 编译：`npm run build --workspace=@personal-agent/agentarts` 成功，类型检查无错误。
- 独立单元测试（本轮实测）：`node --test packages/agentarts/test/deployment-readback-plan.test.mjs` **16/16 全部通过 (0 失败)**：
  - 完整回执与最小回执合法校验；
  - 非对象、错误 Profile、非法名称/ID/版本/网关/提交哈希的严格拒绝；
  - 无参数/空输入生成默认离线规划，断言 `closedLoop: false`、`status: unavailable`、`reason: '待真云验收'`；
  - 显式 `mock` / `cloudEvidence: false` 拒绝伪造成闭环；
  - HEAD commit 对齐核验及失配挂起；
  - 8 工作流 / 3 控制器全覆盖与部分缺失比对；
  - 自报真实云对象不等于独立可信验证，收紧断言 `closedLoop: false` 并保留全部挂起项；
  - 跨审查项修复：删除 boolean 重载（运行时传布尔抛错）、missingBindings 门控、HEAD 对齐门控与结构化缺口可观测字段（`structuralVerification`）。
- 历史全量基线参考：历史记录 252/252 全部通过（本轮仅重跑受影响定向测试，未宣称本轮已跑全量）。
- 架构门禁：`npm run check:architecture` 3/3 全部通过。

## 4. 交付与台账状态

- 本模块公共接口无破坏性变更，保持 `provisional`；
- ROADMAP 中 MOD-29 维持 `in_progress`，等待后续真实华为云账号下的在线端到端读回；
- 本次改动未修改 Runtime、Desktop 或业务连接器，未修改 Trace/ShowOpsTrace 观测文件，未包含凭据。
