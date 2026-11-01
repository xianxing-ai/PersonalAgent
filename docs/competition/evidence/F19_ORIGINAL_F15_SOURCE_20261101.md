# F19 原 Issue → 原 F15 子任务第一段

目标为 `huawei_ict_agentarts`，工作树 `.worktrees/pr531-f19`，基线 `6627f63c`。
本段只交付原 Issue、N02 原候选与原 F15 子任务的持久来源链；F19 全图仍 unavailable，
不能据此关闭 Issue、合并 PR 或标记 #531 全部验收完成。

## 行为和兼容边界

- N01 原来只导出 `count`，N02 无法消费 Issue 内容。现在只接受原 `github.issue_snapshot`
  独立 Policy child 的 confirmed 回执，导出原 repo/issueId/updatedAt、已去凭据的标题/正文及内容摘要。
  仍经过原导出许可；模型收到的 Issue 是不可信数据。
- N03 原 `verifyEnqueueBinding:boolean` 和任意 `repairTaskId` 回调被替换为原
  `coding.repair.workflow` business child 引用。Runtime 核对原 task/run/scope、精确参数、
  allow/started/confirmed 执行记录、原 request、稳定幂等 child ID、`subtask-parent`、
  progress 输入摘要，以及真实 F15 graph/原任务结果。公开只读函数
  `readRuntimeCodingRepairDispatchChild(application, reference)` 返回冻结的原 child 身份，
  不调度、不批准、不恢复、不重试，也不作为 PR 合并或 bug 已消失的证明。
- Desktop `createDesktopF19IssueRepairPorts` 使用懒取的原 Application、固定 actionKey 和原
  business bridge。N02 必须选择同一 snapshotDigest、原 Issue ID、非 duplicate 的 bug 候选；
  duplicate/不足证据须 abstain，不能修复或关闭其他 Issue。原生 selection 固定 allowedPaths；
  模型不能提交工具名、命令或新范围。N03 在原 SQLite checkpoint 冻结来源，然后独立批准原 F15
  dispatcher；沿原 F15 worker、签名审查、验证和 CAS 发布执行，不新增任务库或执行循环。
- 同一个原 N03 先后两次读回只消费同一个 bridge child。原 F15 未完成、等待审批、取消、未知，
  均不能成为 N03 的成功回执；导出期间撤销保留已经完成的原 child，不重放操作。
- 原 F19 工厂为 provisional 且生产尚未配置。本次调整 N01 输出和 N03 端口是显式兼容变化，
  不修改 F18 行为/工厂、Main、公共 Schema 或数据库迁移。新工厂的 configured worker 保持
  `available=false`，完整 requiredTools 包括缺失的 N04/N05；不能从目录启动已知不完整的修复。

## 本机验证

基线 `npm run build`、修改后 Runtime 构建通过。F18 及 optional-graph-hosts 24 项回归通过。
F19 定向测试使用实际 OwnedWorkflowEngine、configured worker、Policy、ToolGateway、SQLite、
graph/business bridge、原 F15 dispatcher/Engine、真实隔离文件、PowerShell patch、Node 检查和 CAS。
仅测试夹具显式允许不完整的 F19 worker 达到 N03；N04 是拒绝完成的 Unavailable。

覆盖原 Issue/候选→唯一真实 F15 child、双向绑定与参数/期限/会话篡改拒绝、SQLite 重开只读证明、
原独立审批拒绝、取消、候选摘要替换、导出期间撤销。成功路径原 N03 两次读回仍只有一次 GitHub GET、
一个 F15 child、一次 dispatcher 批准；保留用户无关编辑。所有负例均无 Issue close。
定向日志在本树 `.cache/test-f19-final.log`；首次组合测试有只读重开 host namespace 夹具错误，
修复为原 namespace 后重开测试通过，未改生产身份断言。

GitHub transport、模型候选/selector、用户导出同意、独立 reviewer 的临时 Ed25519 签名均为明确 Fixture。
这些不是真实 GitHub 账号、真人签名、AgentArts 云端部署或原生 sandbox 独立 bug 回归验收。
没有真实 PR/Issue 写入。全量检查另记实际结果，不以本段定向通过代替全仓通过。

## 下一段

F15 目前只 CAS 发布本地文件，不自动建立 PR。后续沿原 N03 及同一 business bridge，独立 Policy
调用已有 Git commit/push 与 `github.pr.create`，持久原 F15→commit→PR write receipts；复用现有
Git publication port 并保留 F16 的约束。N04 要求原关联 PR 实际 merge 读回、精确 merged checkout
SHA、固定独立 bug 回归 recipe 和完整原 native sandbox 证据。缺真人签名、受限包、账号或配置时
仍 unavailable；N05 在这些原证明和独立 Policy 全部通过后才可关闭原 Issue 并精确读回。
