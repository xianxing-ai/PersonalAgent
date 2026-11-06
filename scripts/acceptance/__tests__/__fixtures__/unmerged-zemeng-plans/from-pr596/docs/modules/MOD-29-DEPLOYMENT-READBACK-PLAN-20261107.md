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
3. `planDeploymentAcceptance(options: PlanDeploymentAcceptanceOptions): DeploymentAcceptancePlan`：
   - 校验回执合法性，并比对当前仓库 HEAD commit 对齐状态；
   - 比对 8 Workflow / 3 Controller（共 11 项）自有资产绑定覆盖率；
   - **在无真实华为云账号执行证据时，强制返回 `closedLoop: false`，`status: 'unavailable'`，`reason: '待真云验收'`**；
   - 挂起（`pending`）六大华为云端到端真实验收项，每项均标明 `status: 'unavailable'` 与 `reason: '待真云验收'`：
     1. `huawei_cloud_credentials_readback`：华为云账号凭据认证与受信端点绑定读回；
     2. `runtime_head_deployment_verified`：当前 HEAD 提交对应的已发布 ARM64 Runtime 部署版本状态读回；
     3. `owned_bindings_invocation_readback`：8 工作流 / 3 控制器绑定在已发布 Runtime 的真实端到端调用读回；
     4. `multi_agent_routing_and_inference`：AgentArts 云端多智能体角色路由与模型推理真实回执；
     5. `platform_independent_trace_and_cost`：平台独立 TraceId 关联与 Token/计费读回（非本地应用日志）；
     6. `local_policy_evidence_closed_loop`：本地 Policy/ToolGateway 授权到真实目标读回与 Evidence 落盘的完整端到端闭环。

## 3. 验证结果

- 编译：`npm run build --workspace=@personal-agent/agentarts` 成功，类型检查无错误。
- 测试：`node --test packages/agentarts/test/deployment-readback-plan.test.mjs` 13/13 通过：
  - 完整回执与最小回执合法校验；
  - 非对象、错误 Profile、非法名称/ID/版本/网关/提交哈希的严格拒绝；
  - 离线规划无真实云时断言 `closedLoop: false`、`status: unavailable`、`reason: '待真云验收'`；
  - 显式 `mock` / `cloudEvidence: false` 拒绝伪造成闭环；
  - HEAD commit 对齐核验及失配拒绝；
  - 8 工作流 / 3 控制器全覆盖与部分缺失比对；
  - 模拟真实云证据时分支正确关闭 pending。
- 全包回归：`npm run test --workspace=@personal-agent/agentarts` 252/252 全部通过。
- 架构门禁：`npm run check:architecture` 3/3 全部通过。

## 4. 交付与台账状态

- 本模块公共接口无破坏性变更，保持 `provisional`；
- ROADMAP 中 MOD-29 维持 `in_progress`，等待后续真实华为云账号下的在线端到端读回；
- 本次改动未修改 Runtime、Desktop 或业务连接器，未修改 Trace/ShowOpsTrace 观测文件，未包含凭据。
