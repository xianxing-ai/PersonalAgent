# F19 原 Issue 关闭与完整 configured worker

Competition Profile，工作树 `.worktrees/pr531-f19`，接续 `a8879f41` N04。
N01 → N02 → 原 F15/N03 发布 → 原 PR 合并/N04 独立原生回归 → N05 已形成实际 configured worker
消费链；Main 原生配置薄层和真实服务/设备验收仍另行完成。不能据本地 Fixture 合并 #531。

## 行为与公开接口

`createGitHubF18F19Tools` 仅在 `enableIssueClose:true` 时增加 `github.registered_close_issue`；
F18 默认工具集合不变。新工具独立 `github:write`、requiresPresence、非幂等、无自动重试。
输入绑定 repo、Issue、原 PR/head/base/merged SHA、原 Issue updatedAt 和 snapshotDigest。
先读回精确原 PR 的合并，再读原 Issue 版本和内容，持久原 write attempt 后仅一次 PATCH，
最后核对 PATCH 响应与 GET 的精确 closed/updatedAt/content。写后失败一律 unknown。

这里没有原子条件更新保证：GitHub 一般不支持写操作的条件请求，Issue update 也未声明
If-Match/CAS。[官方条件请求说明](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate)
与 [Issue 更新接口](https://docs.github.com/en/rest/issues/issues#update-an-issue)。前后检查不能
证明执行期间绝无外部并发变化；已观察到的变化和任何不确定结果均保留原记录，不重发。

`createDesktopF19IssueRepairPorts({...,closeIssue:true})` 在 publication/regression/关闭工具齐备时
启用完整 worker。`github.createTools(options)` 必须原样传递 opt-in 与原 `beforeWrite` callback，
不能继续忽略参数。工厂新增 `prepareCloseQuestion(scope,question)` / `confirmClosePresence(scope)`；
Main 接原审批/在场链。配置不是许可，元数据/结果 export、每个 write 的 Policy 与在场仍分别检查。

新增公开只读 `readRuntimeF19NativeRegression`，供 N04 与 N05 共同核验原 Runtime Gateway
及 native checkpoint；不新建任务、不执行命令、不签发授权。N05 执行前和结果导出后复核原
回归，结束时由原 N05 host 再派独立只读 `github.issue_close_readback`，版本不同不宣称完成。
未知 close 重开 SQLite 保持 `waiting_reconciliation`；目标恰好 closed 也不冒认原未知写成功。

## 验证与限制

- GitHub、Runtime 构建通过；架构 3/3；`git diff --check` 通过。
- 连接器 F18/F19 27/27：原默认集合、独立 scope/取消/期限、未合并/原 Issue 变化零 PATCH、
  一次原 attempt、响应丢失/写后读回变化 unknown，无自动重试。
- 最终完整图矩阵首次 5/6，正向因在原 60 秒任务里额外做 8 次破坏/恢复审计而达 61.49 秒。
  将这些只读持久证据审计移到产品任务终态之后，原期限、生产代码、全部拒绝断言保持；正向
  最终 1/1 通过。6 项行为均已通过：N04 兼容、完整 worker 成功、拒绝 close、原 Issue 变化、
  unknown PATCH、写后版本变化。成功只一次独立回归、一次 PATCH，原图终态 succeeded。
- 终态持久审计拒绝更换 native enforced/stopped/started/argumentsDigest/绑定摘要、root、
  merged SHA 和 recipe。失败写重开 SQLite 后仍 unknown，PATCH 次数不增加。
- GitHub 全模块加 F20/native/可选图兼容组合 159 项中 158 通过；F20 目录替换断言在默认
  沙箱 TEMP 报 rename EPERM，原代码/断言改用既有外部 TEMP 后 1/1 通过。未修改原断言或权限。
- 日志：`.cache/f19-complete-matrix.log`、`f19-complete-final-positive.log`、
  `f19-complete-compatibility.log`、`f19-complete-f20-external.log`。根统一跑最终全仓 check。

实际 OwnedWorkflowEngine、原 F15、Policy/ToolGateway、SQLite、Git、Node 与文件系统；Git 网络、
GitHub HTTP、模型、同意/在场、临时 reviewer 签名和 native isolation facts 明确 Fixture。
没有真实账号关闭、真实独立签名或真实 F19 PSEC 隔离验收，也没有替代 AgentArts 云端验收。
