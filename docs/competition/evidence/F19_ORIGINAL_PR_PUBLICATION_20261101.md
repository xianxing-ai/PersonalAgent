# F19 原 F15 → Git commit/push → PR 发布第二段

Competition Profile，工作树 `.worktrees/pr531-f19`；在 `0d91f71d` 第一段上继续。
本段交付原发布链，F19 全图仍 unavailable。没有真实 GitHub 账号写入、实际远端 merge/close、
真人独立签名或完整 AgentArts 云端验收；不得因此合并 #531 或标记 F19 完成。

## 公共行为与接线

`readRuntimeCodingRepairPublishedSource` 只读核验原 dispatcher/F15 child、N05 原 Gateway
allow/started/confirmed 回执与 N06 原 CAS 发布。返回冻结的身份和 before/after 文件哈希，
不把模型 summary、任意 taskId 或 `verified:true` 当作发布证明。嵌套 command 的 `evidenceRefs`
在 N05 返回时可以为空；原事实来源是已确认 N05 run，且 N06 发布 evidence 必须引用它，
并精确匹配原 snapshot、有效 verification run 与 CAS 文件哈希。

Desktop 工厂可接原生 `publication` 配置，其固定仓库、真实 Git remote、分支、路径白名单和
配置摘要必须与原 selection 一致。N03 在原 F15 完成后，经同一个 business bridge 依次调用：

1. 原 `workspace.git.head` 与固定 `workspace.run_allowed_command`；
2. 原 `workspace.git.commit`，只提交 F15 CAS 已发布的确切文件；
3. 原 `workspace.git.push`，保留已有新远端分支检查和精确 ref 保护；
4. 原 `github.pr.create`，绑定原 push SHA，创建 Draft PR。

每个操作有独立持久子任务和 Policy。commit、push、PR 创建还分别经过原导出许可及原生
在场复核；工厂提供 `preparePublicationQuestion` / `confirmPublicationPresence` 给 Main。
F15 发布后即便文件被替换、固定 checker 仍返回 0，也不能提交：原 command 的完整文件证据
必须精确等于原 F15 CAS afterSha。PR 正文固定关联原 Issue 与 artifact 摘要，**没有自动关闭
Issue 的关键词**，不能绕过后续原 merge/独立 bug 回归。

复用原 `GitPublicationPort` 实现，F16 的默认键和约束保留，F19 使用独立 checkpoint namespace。
`developer-tools-host.configureF19Publication(port)` 只按原 host lineage 路由；真正授权/参数/
两跳来源仍由原端口精确复核。未改变 Git 执行器、TaskRuntime 调度、公共 Schema、数据库迁移
或 F16 工厂行为。N03 在配置发布时显式声明 external_write。

Main 后续安装 `ports.publication` 到同一个 developer host 的 `configureF19Publication`，把审批
和 presence 回调接入原卡即可；目前不要把 `available=false` 改为 true。配置传入的
`readConfiguration` 可复用 developer host 现有 `readF16PublicationConfiguration`，它返回固定
Git 配置而不产生权限；不同工作流仍使用各自 publisher。单独注册原 `github.pr.create`、Git
工具和命令，避免与 F18 重复注册 `github.issue_snapshot`。Main 本次未修改。

原 write receipt 在 SQLite 保存，未知 PR 响应保留原 waiting_reconciliation，重开不发第二次
POST，不推送第二次，也不关闭 Issue。未知 Git/PR 原动作不允许靠新 run 再试；人工或独立只读
检查仍须保留原归属，不能把其他人的目标效果当作本次成功。

## 验证

- Runtime 构建通过。
- F19、F16/F17、developer-tools-host、Git tools 组合 **80/80** 通过；包括 F16 独立批准、
  原生在场、export 后变化、unknown push→SQLite 重开无重放、Git 目录替换和 UTF-8 拒绝路径。
  日志 `.cache/test-f19-publication-regression.log`。
- 最终增加 Git remote 与原 GitHub repo 精确对应门禁后，成功发布和异仓 remote 拒绝 **2/2**
  通过；日志 `.cache/test-f19-publication-final.log`。
- F19 使用实际 OwnedWorkflowEngine、原 F15 全图、Policy/ToolGateway、SQLite、真实隔离文件、
  PowerShell patch、Node checker、CAS 和 Git commit。Git 网络 push/ls-remote 与 GitHub HTTP、
  模型、用户同意/在场、临时 Ed25519 reviewer 均为明确 Fixture；没有账号写入。
- 独立 commit/push/PR 创建拒绝分别阻断后续动作；成功仅一次 push/POST；未知 PR 保留原 child；
  F15 发布后的文件替换即便 checker 通过仍拒绝；presence 期间撤销拒绝；不产生 Issue close。

首次默认沙箱 TEMP 下实际 Git `read-tree` 报 `fatal: unable to write new index file`，日志保留。
原源码/原断言使用独立外部 TEMP 并通过正常执行授权后成功，没有修改 Git 或 sandbox 校验。
外部目录为 `C:\Users\李广威\AppData\Local\Temp\pa-pr531-f19-check-20261101`。
最终完整 `npm run check` 按根任务协调由集成树统一执行，避免并发整仓重复运行。

## 未完成边界

N04 尚须原 PR 的实际 merged SHA 读回与独立 bug 回归。已选定预先配置的独立验证工作区，
使用现有 Git HEAD 和原 native 固定 recipe；checkout SHA 不符即拒绝，不自动 checkout，
不触碰开发工作区。N05 必须再走独立 Policy 和精确 Issue 读回。没有这些证据不能 close。
本段的 baseSha 是原 commit 的 base，不是已验证的当前远端合并结果；任何后续验收必须读取
原 PR 的真实 merge 数据。真签名、受限原生包、账号和用户授权缺失时继续 unavailable。

后续 N04 接线及其独立验证见 [合并后原生回归增量](F19_MERGED_NATIVE_REGRESSION_20261101.md)，
不改变本段交付时的证据范围。
