---
id: cloud-persistent-acceptance-plan
title: cloudPersistent：关机后云持续离线契约与验收规划
status: unavailable
closedLoop: false
requiredEnvironments:
  - huawei_cloud
reason: 待真云关机验收
---

# cloudPersistent：关机后云持续离线契约与验收规划（2026-11-07）

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

- Profile：`huawei_ict_agentarts`；负责人：`zemeng`（zemeng5208，核心架构 / 华为云端编排 / 整图协调）；状态：`in_progress`。
- 工作树与分支：分支 `zemeng/cloudpersist-acceptance-plan`，工作目录 `/workspace/mod-cloudpersist-plan`，基于最新 `origin/main`。
- 协作与隔离边界：
  - 本 PR 避开在途堆叠（独立于 #543 及其在途栈，不改动 #543 文件）；
  - 严格避开其他在途分支及 PR（如 ZCode #578/#580/#581/#582/#584/#585/#587/#588/#590–#592/#600/#601/#603 等）；
  - **严禁且未修改** `apps/runtime`（goo Runtime/Policy 归属文件不改）、`apps/desktop`（lab Desktop 前端与接线不改）、业务连接器（`packages/connectors/*`），严禁修改根 `package.json`；
  - 纯离线纯函数 helper，不连接华为云，不读取密钥或凭据；
  - 核心本地契约守则：**无关机后云证据时 `closedLoop: false`，状态标记为 `unavailable`，原因标记为 `'待真云关机验收'`**。

---

## 1. 契约背景与核心边界

`cloudPersistent`（关机后云持续）是华为 ICT 比赛 Profile（`huawei_ict_agentarts`）与主动责任流程（CW-05 Scheduler 与常驻）中的核心关键能力：当宿主设备因关机、休眠或离线（`localDevice: false`）导致本地不可用时，系统需将执行会话安全交接至 AgentArts 云端常驻宿主（`cloudPersistentHost: true`），由云端自主调度器持续执行只读巡检与云端能力调用，待设备恢复上线后完成双向对账。

根据 [AGENTS.md](../../AGENTS.md) 长期协作准则与 IMAGE28 待办约定：
1. **真实缺项如实登记，严禁假成功**：
   - `docs/competition/OWNED_CONVERSATION_WIRING_20261018.md`：“无真实 `cloudPersistentHost` 不能宣称关机继续执行；等待设备是合法状态，不是完成”；
   - `docs/competition/PROACTIVE_RUNTIME_WIRING_20261018.md`：“这不承诺机器关机后继续工作；缺 `cloudPersistentHost` 仍不可用”；
   - `docs/competition/evidence/PRODUCTION_WIRING_UNAVAILABLE_FACES_20261028.md`：“cloudPersistentHost 未注入 | 有真实云持久 port 后再传；当前关机后继续 unavailable”；
   - `docs/competition/evidence/IMAGE28_COLLABORATOR_OPEN_WORK_20261031.md`：“cloudPersistent（有关机后云证据才允许；Desktop 组合由 lab 在口齐后接线）”；
   - `docs/demo/web-demo/capability-status.json`：“需真实云证据（关机后云持续）才允许启用；Desktop 组合由 lab 在口齐后接线”。
2. **严防 Mock 与本地伪造**：
   - 凡标记为 `mock: true`、`isMock: true`、`synthetic: true`、`simulated: true` 或 `evidenceLevel === 'mock'` 的证据，必须直接拒绝并抛出 `ProtocolError('INVALID_ARGUMENT')`；
   - 凡声称本地仅有执行（`localOnly: true` / `isLocalOnly: true` / `cloudEvidence: false`）却冒充关机持续者，直接拒绝；
   - 严禁宿主地址指向 `localhost`、`127.0.0.1`、`[::1]` 或名称包含 `mock`/`fake`，严禁使用非安全协议（必须使用 `https:` 或 `wss:` 且无内嵌凭据）；
   - 严格因果时序校验：云端接管开始时间（`cloudExecutionStartedAt`）不得早于设备关机时间（`deviceShutdownAt`），完成时间不得早于开始时间。
3. **未关机真实验收时强制 fail-closed**：
   - 缺乏真实华为云关机执行读回时，`planCloudPersistentAcceptance()` 必须返回 `closedLoop: false`、`status: 'unavailable'`、`reason: '待真云关机验收'`，挂起全部 6 项真实验收项。

---

## 2. 交付实现与接口定义

在 `packages/coordination/src/cloud-persistent-acceptance-plan.ts` 中实现，并通过 `packages/coordination/src/index.ts` 进行最小导出：

1. `assertCloudPersistentEvidence(value: unknown): asserts value is CloudPersistentEvidence`：
   - 结构校验：必须为非空普通对象；
   - Profile 必须为 `'huawei_ict_agentarts'`，Capability 必须为 `'cloud_persistent'`；
   - TaskId 与 SessionId 必须为 1～128 字符合法标识；
   - 严格拒绝 Mock（`mock`、`isMock`、`synthetic`、`simulated`、`evidenceLevel === 'mock'`）；
   - 严格拒绝本地假冒（`localOnly`、`isLocalOnly`、`cloudEvidence: false`）；
   - 严格校验 `cloudPersistentHost`：必须为合法 HTTPS/WSS URL 或规范标识符，禁止 localhost、127.0.0.1、IPv6 回环、含凭据或含 mock/fake 字符；
   - 严格校验 ISO 时间戳有效性（防不可能日期如 `2026-02-31` 规整化）；
   - 严格执行因果时序：`startMs >= shutdownMs` 与 `completeMs >= startMs`；
   - 校验平台独立 TraceId（`cloudTraceId`，1～128 字符）。
2. `parseCloudPersistentEvidence(value: unknown): CloudPersistentEvidence`：
   - 包装断言并返回强类型 `CloudPersistentEvidence`。
3. `planCloudPersistentAcceptance(optionsOrEvidence?: unknown | PlanCloudPersistentAcceptanceOptions): CloudPersistentAcceptancePlan`：
   - 纯离线纯函数 helper，不发起网络请求、不读取凭据；
   - 支持无参数调用（生成默认 6 项待真云关机验收挂起项）；
   - 支持传入完整参数选项对象或直接传入证据；
   - 传入证据时先执行 `assertCloudPersistentEvidence` 严格校验；
   - 若无华为云真实关机证据或证据标为未验证，强制返回：
     - `closedLoop: false`
     - `status: 'unavailable'`
     - `reason: '待真云关机验收'`
     - `pending` 包含 6 项挂起项，各项均标明 `status: 'unavailable'` 与 `reason: '待真云关机验收'`：
       1. `device_shutdown_detection`：本机桌面系统关机/休眠/离线事件捕获与状态读回（localDevice=false）；
       2. `cloud_persistent_host_handover`：向 AgentArts 云端常驻宿主（cloudPersistentHost）原子交接执行会话与检查点恢复；
       3. `unattended_cloud_autonomous_dispatch`：关机脱机期间云端自主调度器（Scheduler）唤醒与工具执行（非本机轮询驱动）；
       4. `cloud_checkpoint_persistence`：关机持续运行期间任务状态、阶段时间线与回执在华为云端的原子持久化读回；
       5. `device_reconnect_reconciliation`：宿主机开机重新连接后云端执行结果与本地 TaskRuntime 状态双向对账读回；
       6. `platform_independent_trace_and_cost`：华为云 AgentArts 平台独立 TraceId、调用耗时与计费读回（非本机应用模拟日志）。
   - 校验 HEAD 提交对齐（`headCommit` 与 `sourceCommit`），失配时追加 `source_head_commit_alignment` 挂起项；
   - 仅当真实华为云证据齐备且对齐时，方可收敛至 `closedLoop: true`、`status: 'verified'`。

## 验收步骤

1. device_shutdown_detection：本机桌面系统关机/休眠/离线事件捕获与状态读回（localDevice=false）
2. cloud_persistent_host_handover：向 AgentArts 云端常驻宿主（cloudPersistentHost）原子交接执行会话与检查点恢复
3. unattended_cloud_autonomous_dispatch：关机脱机期间云端自主调度器（Scheduler）唤醒与工具执行（非本机轮询驱动）
4. cloud_checkpoint_persistence：关机持续运行期间任务状态、阶段时间线与回执在华为云端的原子持久化读回
5. device_reconnect_reconciliation：宿主机开机重新连接后云端执行结果与本地 TaskRuntime 状态双向对账读回
6. platform_independent_trace_and_cost：华为云 AgentArts 平台独立 TraceId、调用耗时与计费读回（非本机应用模拟日志）

## 证据要求

1. CloudPersistentEvidence 合规回执（含 cloudPersistentHost HTTPS/WSS URL、严格时序因果 cloudExecutionStartedAt >= deviceShutdownAt 与 cloudTraceId）
2. AgentArts 平台独立 TraceId 关联、双向对账回执与华为云持久化检查点读回记录

## 挂起项

- `device_shutdown_detection`: 本机桌面系统关机/休眠/离线事件捕获与状态读回
- `cloud_persistent_host_handover`: 向 AgentArts 云端常驻宿主原子交接执行会话与检查点恢复
- `unattended_cloud_autonomous_dispatch`: 关机脱机期间云端自主调度器唤醒与工具执行
- `cloud_checkpoint_persistence`: 关机持续运行期间任务状态与回执在华为云端的原子持久化读回
- `device_reconnect_reconciliation`: 宿主机开机重新连接后云端执行结果与本地对账读回
- `platform_independent_trace_and_cost`: 华为云 AgentArts 平台独立 TraceId 与计费读回

## 字段来源依据（Source References）

| 字段 | 机器取值 | 来源文件 | 章节/行号及原文依据 |
| --- | --- | --- | --- |
| id | `cloud-persistent-acceptance-plan` | `docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | L1: `cloudPersistent：关机后云持续离线契约与验收规划`；代码 `PLAN_ID` |
| title | `cloudPersistent：关机后云持续离线契约与验收规划` | `docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | L1: `# cloudPersistent：关机后云持续离线契约与验收规划（2026-11-07）` |
| status | `unavailable` | `docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | §1: `状态标记为 unavailable`；§2.3: `status: 'unavailable'` |
| closedLoop | `false` | `docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | §1: `无关机后云证据时 closedLoop: false`；代码 L398, L500 |
| requiredEnvironments | `['huawei_cloud']` | `docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | §1: `将执行会话安全交接至 AgentArts 云端常驻宿主（cloudPersistentHost: true），由云端自主调度器持续执行` |
| acceptanceSteps | 6 项完整步骤 | `docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | §2.3: 包含 6 项挂起项（device_shutdown_detection, cloud_host_handover 等） |
| evidenceRequirements | 2 项证据要求 | `docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | §2.1: `assertCloudPersistentEvidence` 形状校验；§2.3: 独立 TraceId 与对账回执 |
| reason / pendingItems | `待真云关机验收` | `docs/modules/CLOUD-PERSISTENT-ACCEPTANCE-PLAN-20261107.md` | §1: `原因统一标记为 '待真云关机验收'`；代码 `CLOUD_PERSISTENT_PENDING_REASON` |

---

## 3. 验证结果

- **构建与类型检查**：
  `npm run build --workspace=@personal-agent/coordination` 成功，类型检查通过，生成对应 `.d.ts` 与 `.js` 产物。
- **定向测试**：
  `node --test packages/coordination/test/cloud-persistent-acceptance-plan.test.mjs` 16/16 全部通过：
  - 完整合法证据校验与字段提取；
  - 最小合法证据校验；
  - 非普通对象输入拒绝（null、undefined、基本类型、数组）；
  - Mock 证据显式拦截专项（`mock`、`isMock`、`synthetic`、`simulated`、`evidenceLevel === 'mock'`）；
  - 本地仅有执行与 `cloudEvidence: false` 显式拦截；
  - Localhost、回环 IP、mock/fake、不安全协议（http/ws）及内嵌凭据拦截；
  - Profile 与 Capability 严格匹配；
  - TaskId、SessionId、CloudTraceId 边界校验；
  - 规整化不可能日期识别与时序因果校验（关机先于云端启动、云端启动先于完成）；
  - 无参调用安全生成默认 `unavailable` 验收规划；
  - 有证据但无真实关机证据时保持 `closedLoop: false`、`status: unavailable`、`reason: '待真云关机验收'`；
  - HEAD Commit 失配探测与挂起；
  - 真实云关机证据闭环收敛验证；
  - 自定义挂起项保留验证。
- **工作区全量回归**：
  `npm test --workspace=@personal-agent/coordination` 257/257 全部通过。
- **架构门禁**：
  `npm run check:architecture` 3/3 全部通过。
- **代码规范检查**：
  `git diff --check` 0 异常。

---

## 4. 交付与台账状态

- 模块接口保持 `provisional`，未变更 Core wire Schema 或冻结范围；
- ROADMAP 中 MOD-04B 补充本次离线规划索引，整体状态维持 `review`/`in_progress`（待后续华为云真实关机端到端执行证据）；
- 本次改动未修改 `apps/runtime`、`apps/desktop`、业务连接器或根 `package.json`，未修改 ZCode 评测/Demo 文件。
