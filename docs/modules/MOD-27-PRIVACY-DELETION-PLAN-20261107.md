---
id: privacy-deletion-acceptance-plan
title: MOD-27：隐私删除与私人数据授权离线验收规划
status: unavailable
closedLoop: false
requiredEnvironments:
  - rights_holder_or_human
  - windows_real_machine
reason: 待真人/真机验收
---

# MOD-27：隐私删除与私人数据授权离线验收规划（2026-11-07）

<!-- current-design-20261015 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

- Profile：`huawei_ict_agentarts`；负责人：`zemeng`；状态：`review`。
- 工作树：`/workspace/mod27-privacy-plan`；分支：`zemeng/mod27-privacy-deletion-plan`。
- 依赖：`packages/goals` 图谱领域核心、`GraphError`、`parseGraph` / `erasedGraphRevisions`。
- 范围：MOD-27 隐私删除与私人数据授权「离线验收规划」helper，交付 `assertPrivacyDeletionReceipt`、`parsePrivacyDeletionReceipt` 与 `planPrivacyDeletionAcceptance`；不扩公共 wire Schema，不改 Runtime/Desktop/connectors，不改 MOD-28 文件（严格避开 ZCode #581 `reviewed-meeting-source` 等），不连网、不读真实私人数据。

## 1. 契约背景与安全边界

根据 [MOD-27/28 本地消费者集成交接](MOD-27-28-INTEGRATION-HANDOFF.md) 与 [ROADMAP](../ROADMAP.md) 的既定边界：
1. **真实个人数据授权、删除与恢复读回不能由离线图测试代替**：当前内存图谱的 `state: 'withdrawn'` 仅为追加逻辑版本、保留旧摘要与审计历史，**严禁把撤回称为物理删除**；
2. **物理删除与隐私抹除约束**：物理删除在图谱层体现为受信任宿主擦除后的 `erasedGraphRevisions`（内容清空、旧版本位置移除且不被别名混淆）以及持久化存储底座的真实物理擦除；
3. **无真人/真机证据不宣称闭环**：未取得真人用户现场授权凭证与删除现场读回证据前，`closedLoop` 必须为 `false`，状态统一标记为 `status: 'unavailable'`，原因统一标为 `待真人/真机验收`；
4. **防伪造原则**：严禁使用 `mock` / `fake` / `synthetic` 冒充全链路闭环；
5. **离线纯净与隐私保护**：本规划 helper 纯离线执行，严禁读取真实私人数据，严禁建立网络连接。

## 2. 交付实现与接口定义

在 `packages/goals/src/privacy-deletion-acceptance-plan.ts` 中实现并通过 `packages/goals/src/index.ts` 最小导出：

1. `assertPrivacyDeletionReceipt(value: unknown): asserts value is PrivacyDeletionReceipt`：
   - 校验回执基础结构（`receiptId`、`namespace`、`targetId`、`action`、`graphRevision` 非空/非负安全整数）；
   - **严格区分撤回历史 vs 隐私删除**：
     - 当 `action === 'withdrawal'` 时：禁止将撤回称为物理删除（若带有 `physicalErasure: true`、`isPhysicalDeletion: true`、`physicalDeletion: true` 或包含 `erasedGraphRevisions`，立即抛出 `GraphError('INVALID_ARGUMENT')`）；
     - 当 `action === 'privacy_deletion'` 时：必须设置 `physicalErasure: true`（或不显式传 false），若包含 `erasedGraphRevisions` 则必须为已排序、严格递增的正整数数组；
   - 严格校验可选字段（`nodeRevision`、`timestamp` 必须为 UTC ISO-8601、`evidenceLevel` 限 `'mock' | 'conditional' | 'verified'`、`realUserAuthorization`、`realDeletionReadback`）。
2. `parsePrivacyDeletionReceipt(value: unknown): PrivacyDeletionReceipt`：
   - 包装断言并返回类型化回执对象。
3. `planPrivacyDeletionAcceptance(options?: PlanPrivacyDeletionAcceptanceOptions | unknown): PrivacyDeletionAcceptancePlan`：
   - 支持空参或接收包含 `receipt`、`realUserAuthorization`、`realDeletionReadback`、`evidenceLevel` 等选项；
   - **输入门控防御与语义隔离**：
     - `realAuthorizationEvidence` 仅支持结构化对象，严格删除 `boolean` 重载；运行时传入布尔直接抛错；
     - 撤回回执（`action: 'withdrawal'`）严格禁止声称物理删除读回门控，只有 `action: 'privacy_deletion'` 且 `physicalErasure === true` 才能核验物理删除结构；
   - **无真人现场授权与现场物理删除读回审计前，强制返回**：
     - `closedLoop: false`
     - `status: 'unavailable'`
     - `reason: '待真人/真机验收'`
     - `pending`: 挂起五项现场验收核心门限，每项均标明 `status: 'unavailable'` 与 `reason: '待真人/真机验收'`：
       1. `human_user_privacy_authorization`：真人用户隐私授权与敏感范围审查（现场明确授权访问与删除范围，严禁模型代签或自动放行）；
       2. `on_site_deletion_readback`：删除现场物理读回与存储清零验证（核实持久化存储中已物理抹除，非仅图谱版本追加或逻辑撤回）；
       3. `graph_dependency_erasure_integrity`：图谱依赖级联处理与断链校验（被删除节点后继依赖清理与一致性核验，旧版本不混淆别名）；
       4. `durable_storage_restart_verification`：持久化存储进程重启后现场读回（重启后被抹除数据不可恢复，合规性审计凭证完备）；
       5. `cloud_boundary_and_leak_prevention`：云端与跨进程边界防泄露核验（私人正文绝不上传云端，错误回显与日志不泄露敏感数据）；
   - **真实证据可信边界澄清**：当前规划 helper 为离线纯函数，能够完成回执结构与撤回/物理删除语义断言，但在纯离线环境下无法产生真人用户现场授权凭据（realUserAuthorization）或持久化存储物理删除现场读回（realDeletionReadback）；自报字段不构成真实独立验证，待真人现场明确授权与存储物理清零现场审计验证。因此全链路闭环严格保持 `closedLoop: false`，且 5 项核心验收门限持续处于 `pending` 状态。

## 验收步骤

1. human_user_privacy_authorization：真人用户隐私授权与敏感范围审查（现场明确授权访问与删除范围，严禁模型代签或自动放行）
2. on_site_deletion_readback：删除现场物理读回与存储清零验证（核实持久化存储中已物理抹除，非仅图谱版本追加或逻辑撤回）
3. graph_dependency_erasure_integrity：图谱依赖级联处理与断链校验（被删除节点后继依赖清理与一致性核验，旧版本不混淆别名）
4. durable_storage_restart_verification：持久化存储进程重启后现场读回（重启后被抹除数据不可恢复，合规性审计凭证完备）
5. cloud_boundary_and_leak_prevention：云端与跨进程边界防泄露核验（私人正文绝不上传云端，错误回显与日志不泄露敏感数据）

## 证据要求

1. PrivacyDeletionReceipt 合规物理删除回执（包含 receiptId、namespace、targetId、action='privacy_deletion'、physicalErasure=true、有序 erasedGraphRevisions）
2. 真人用户现场授权凭证（realUserAuthorization）与持久化存储物理擦除现场读回回执（realDeletionReadback）

## 挂起项

- `human_user_privacy_authorization`: 真人用户隐私授权与敏感范围审查
- `on_site_deletion_readback`: 删除现场物理读回与存储清零验证
- `graph_dependency_erasure_integrity`: 图谱依赖级联处理与断链校验
- `durable_storage_restart_verification`: 持久化存储进程重启后现场读回
- `cloud_boundary_and_leak_prevention`: 云端与跨进程边界防泄露核验

## 字段来源依据（Source References）

| 字段 | 机器取值 | 来源文件 | 章节/行号及原文依据 |
| --- | --- | --- | --- |
| id | `privacy-deletion-acceptance-plan` | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | L1: `MOD-27：隐私删除与私人数据授权离线验收规划`；代码 `PLAN_ID` |
| title | `MOD-27：隐私删除与私人数据授权离线验收规划` | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | L1: `# MOD-27：隐私删除与私人数据授权离线验收规划（2026-11-07）` |
| status | `unavailable` | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | §1: `状态统一标记为 status: 'unavailable'`；§2.3: `status: 'unavailable'` |
| closedLoop | `false` | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | §1: `未取得真人用户现场授权凭证与删除现场读回证据前，closedLoop 必须为 false`；代码 L338 |
| requiredEnvironments | `['rights_holder_or_human', 'windows_real_machine']` | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | §1: `无真人/真机证据不宣称闭环：未取得真人用户现场授权凭证与删除现场读回证据前...原因统一标为 待真人/真机验收` |
| acceptanceSteps | 5 项完整步骤 | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | §2.3: 五项现场验收核心门限（human_user_privacy_authorization, on_site_deletion_readback 等） |
| evidenceRequirements | 2 项证据要求 | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | §2.1: `assertPrivacyDeletionReceipt` 回执校验条件；§2.3: 真人授权与删除现场读回凭证 |
| reason / pendingItems | `待真人/真机验收` | `docs/modules/MOD-27-PRIVACY-DELETION-PLAN-20261107.md` | §1: `原因统一标为 待真人/真机验收`；代码 `PRIVACY_ACCEPTANCE_PENDING_REASON` |

## 3. 验证结果

- 编译：`npm run build --workspace=@personal-agent/goals` 成功，类型检查无错误；
- 独立单元测试（本轮实测）：`node --test packages/goals/test/privacy-deletion-acceptance-plan.test.mjs` **12/12 全部通过 (0 失败)**：
  - 合法逻辑撤回与物理隐私删除回执形状校验；
  - 严禁把撤回称为物理删除（`physicalErasure: true`、`isPhysicalDeletion: true`、`physicalDeletion: true`、`erasedGraphRevisions`）的阻断断言；
  - 非法隐私删除参数（`physicalErasure: false`、未排序/非正整数 `erasedGraphRevisions`）的拒绝；
  - 畸形/缺失字段的严格拒绝；
  - 默认无参调用输出 `closedLoop: false`、`status: 'unavailable'`、`reason: '待真人/真机验收'`；
  - 带有回执但无真实验收证据时保持 `closedLoop: false`；
  - 显式 `mock` 或 `evidenceLevel: 'mock'` 冒充闭环的坚决拒绝；
  - 部分证据（仅授权或仅读回）的挂起项核验；
  - 选项中传入非法回执的即时抛错；
  - 跨审查项修复：删除 boolean 重载（运行时传布尔抛错）、撤回（withdrawal）严格阻断物理删除验证与读回、5 项现场门控离线无条件保持 pending，并通过 `structuralVerification` 明确结构结果与逐项缺失字段。
- 历史全量基线参考：历史记录 30/30 全部通过（本轮仅重跑受影响定向测试，未宣称本轮已跑全量）。
- 架构门禁：`npm run check:architecture` 3/3 全部通过。
- 差异检查：`git diff --check` 无空白或格式问题。

## 4. 交付与台账状态

- 本模块公共接口无破坏性变更，遵循最小导出原则；
- [ROADMAP](../ROADMAP.md) 中 MOD-27 状态维持 `review`，小注记录补充 2026-11-07 离线规划 helper，真机/真人授权与现场物理删除读回仍待现场验收；
- 本次改动未修改 `apps/desktop`、`Runtime`、连接器或根 `package.json`，严格避开了 MOD-28 相关日历主题文件。
