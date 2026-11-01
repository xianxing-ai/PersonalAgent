# F19 原生配置与原部署消费

Competition Profile，隔离工作树 `.worktrees/pr531-f19`，接续 `89e3d697`。
这是 Main 前的配置适配器；Main imports、settings IPC、原审批卡消费由集成工作包接线。
不新增执行器、任务库、授权层或凭据库，不以配置选择证明执行授权。

## 原生选择与生命周期

`createF19IssueConfiguration({userData,safeStorage,readWorkspace,readRepositoryBinding,selectFile})`
复用本机文件选择和 Electron safeStorage。`readWorkspace()` 返回原
`codingWorkspace.readDeveloperConfiguration()`；`readRepositoryBinding()` 返回原部署的
`{repository,bindingId}`，其中 bindingId 使用原工作区绑定代际。
`selectFile()` 仅由 Main 原生 JSON 选择器提供路径；不接受 Renderer 任意路径或模型路径。

选择文件只允许以下字段：

```json
{
  "selection": {
    "repo": "owner/repository",
    "issueId": 19,
    "expectedUpdatedAt": "2026-11-01T00:00:00Z",
    "allowedPaths": ["feature.cjs"],
    "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "verificationRecipeId": "original-selected-recipe",
    "publication": {"branch": "codex/issue-repair", "base": "main"}
  },
  "regression": {
    "rootPath": "C:\\IndependentRegression",
    "sourceBranch": "original-merged-fixture",
    "checkerPath": "C:\\TrustedCheckers\\original-bug.cjs",
    "checkerSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
}
```

该例仅说明结构，不是可用配置。原工作区 recipe 必须已经存在，回归目录须独立于开发目录，
checker 必须在两者之外且真实摘要相符。原产品不会预配 checkout 或自动 checkout/fetch。
Node 来自 `codingWorkspace.readWorkspaceBinding().nodeExecutable`，回归 argv 固定为
`[checkerPath, rootPath]`；不接受 executable、argv、任务、回执、verified 或 approved 字段。

方法为 `selectFromNativeDialog()`、受信宿主用 `configureFromNativeSelection(value)`、
`snapshot()`、`createPorts(options)` 与 `close()`。snapshot 只有 `{configured:false}` 或
`{configured:true,revision,repo,issueId}`；不返回命令、文件路径、许可或凭据。
选择文件严格 UTF-8、64 KiB 上限、原文件身份/链接检查；配置以加密 envelope 原子保存为
`userData/f19-issue-selection.json`。安全存储、工作区/仓库代际、配置 revision、checker 内容
或路径身份失效均拒绝。相同父目录只在一次同步验证中复用检查，绝不跨验证或 await 缓存。
selection 绑定读取只复核私有已验证配置、revision、安全存储和原环境代际；出版与回归的
effect guard 每次仍完整检查当前路径、身份、hash 和原工作区/部署，关闭也经原出版与回归
证明复核。不是缓存 Runtime 证据或当前文件证明；审批 await 返回后照常复核。

已有 worker 捕获原 revision；新选择会撤销旧 worker，使用原部署/Runtime 重建生命周期激活
新配置。不会热替换原出版绑定或恢复未知写；重启重新读加密配置，原 SQLite 证据照常保留。

## Main 装配接口

`createConfiguredDesktopF19IssueRepairPorts({getApplication,codingWorkspace,developerDeployment,
issueConfiguration,nativeExecutionHost,authorizeExport,requestPresence,now?})` 返回原完整工厂结果。
`getApplication()` 只在运行时读取，构造期间不访问尚未建立的 Runtime。缺任一原 provider 或
原配置时返回空 tools/worker 和明确 unavailable，不能以 Fake 填补。

完整配置提供 10 个工具：

- `github.issue_snapshot`、`github.merged_pr_readback`、`github.issue_close_readback`、
  `github.registered_close_issue`。
- `workflow.host.f19_n01`、`workflow.host.f19_n03`、`workflow.host.f19_n04`、`workflow.host.f19_n05`。
- `workspace.f19_regression_head`、`workspace.f19_regression_command`。

提供一个 `configuredWorkflowWorkerPorts`：`workflow.f19.issue_repair`。原目录还必须有
`decision.choose_candidate`、`coding.repair.workflow`、`workspace.git.head`、
`workspace.run_allowed_command`、`workspace.git.commit`、`workspace.git.push`、`github.pr.create`；
工厂继续核验 requiredTools、固定 frontier、原结果导出和完成读回。

返回原 `publication`、`readOriginalPublication` 及六个原审批适配方法：

- `preparePublicationQuestion(scope,question)` / `confirmPublicationPresence(scope)`。
- `prepareRegressionQuestion(scope,question)` / `confirmRegressionPresence(scope)`。
- `prepareCloseQuestion(scope,question)` / `confirmClosePresence(scope)`。

Main 仍将原 `workspace.f19_regression_command` 交现有 nativeExecutionHost.prepare 消费；
N04 原卡等待独立审核/合并和预配原 merged SHA，再实际读取 PR、HEAD、命令和隔离证据。
原卡不代替这些读回。publication 使用原 `readF16PublicationConfiguration` 公开端口和
`configureF19Publication` 绑定；回归使用原 nativeExecutionHost，不新增执行入口。

`developer-deployment-config.js` 的真实 `host.createF18F19Tools(options)` 现在转发
`issueRepairOnly`、`enableIssueClose`、`beforeWrite`。新 adapter 内部将
`github.createTools(options)` 原样传给此入口，Main 不应丢弃 options 或构造另一组裸工具。
F18 默认门槛与六工具集合不变；F19 显式 issue-only 不注册 F18 merge/gate，关闭仍单独 opt-in。

两个工厂的三个共有只读工具来自同一 developerDeployment.host，工厂未包装专属 execute。
Main 在拼接**实际已配置** F18/F19 tools 时，只对上述三个共有 read 名称在 descriptor 完全一致
时保留一份；保留原部署 ready/assertCurrent/Session/Policy。F18 merge/gate 和 F19 close
各自保留原 beforeWrite，不去重、不替换、不把 unavailable 工具当可用共享实现。

## 验证与边界

配置/F18/F16/真实 deployment options 转发/GitHub 定向组合 70 项中 69 通过、1 个原
token 文件符号链接权限跳过；本包目录 junction 拒绝测试实际通过。一次普通沙箱 token
创建该 junction 报 EPERM，按原普通 Windows token 环境运行相同断言后通过，未删除断言。
默认 F15 双轮失败恢复与原 N05 审批 SQLite 重启 2/2，原 round=1/check=2 断言不变。
GitHub 构建通过，架构 3/3；全仓 check 由根集成树统一执行。

首次把 native 配置插入整图时，在原 60 秒期限内到 N05 前后或完成导出时超时，保留日志。
临时性能观测得到 121,293 次 lstat / 12.48 秒；单次同步父目录去重后为 56,020 / 5.62 秒。
原公共 F15 Fake image 还故意先修为 2 再修为 3，本包新增显式 `firstAttemptSuccess`，
仅 F19 完整正向使用；默认故障恢复不变，全部实际 F15 节点、原测试及独立回归仍执行。
根重负载退出后原期限仍曾失败（N05 已成功、最终图完成复核超时），所以没有归为偶发负载；
随后按上述职责减少选择读取的重复配置解析，动作原安全复核保持。
N05 同一次同步复核内部复用 regression.read 已现读验证的 publication，避免另读一遍原
出版链；不跨 await 保存。N04 外部 proof、结果 Schema、出口投影保持，私有 publication
与修复内容不添加到外部回执。

最后一轮必要验证 3 项中 2 通过、1 失败：unknown close 和写后读回变化均通过，重开
SQLite 保留 unknown、PATCH 不增加；完整 configured adapter 正向仍在 61.63 秒报
`Original Runtime graph did not reach the expected state`。这项**未通过**，未调大原 60 秒
期限、未放宽断言。三条新增实际 Engine 等待期替换此前均通过：发布 commit 确认中改
checker，N04 确认中换回归 root，关闭确认中换配置 revision；各自后续 effect 没有执行。
按用户最新“只做极小必要测试”要求停止继续性能优化和重复整图测试，交根接 Main 后统一验收。

保留日志：`.cache/f19-native-config-engine.log`、`f19-native-config-engine-isolated.log`、
`f19-native-config-profile.log`、`f19-native-config-callers.log`、`f19-native-config-engine-final.log`、
`f19-native-config-engine-no-load.log`、`f19-config-adapter-final-tests.log`、
`f19-config-default-f15-compat.log`、`f19-config-architecture.log`、
`f19-native-config-final-guards.log`、`f19-native-config-proof-final.log`。临时性能观测文件不提交。
当前真实部分为本地文件系统、Git、Node、OwnedWorkflowEngine、原 F15、Policy/ToolGateway
和 SQLite；GitHub/Git 网络、模型、safeStorage、同意/在场、临时 reviewer 和 native isolation
facts 在测试中明确 Fixture。没有真实账号写入、真实签名、F19 PSEC 或 AgentArts 验收；
这些与 Main 实际接线全部完成前不能据此合并 #531。
