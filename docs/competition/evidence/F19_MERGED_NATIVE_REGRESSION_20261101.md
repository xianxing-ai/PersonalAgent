# F19 原 PR 合并后独立回归接线

Competition Profile，`.worktrees/pr531-f19`；接续 `1cfa0e50` 原发布链。
本段完成 N04，N05 关闭尚未接入，完整 worker 仍 `available=false`。不据此标记 F19 或 #531 完成。

## 行为与兼容边界

N04 声明 `requiresPresence:true`，使用原 Policy 审批卡保持等待。卡明确要求原 PR 已独立
审核并合并、独立目录已预配 merged SHA 后才批准；按钮不证明这些事实。批准后调用原
`github.merged_pr_readback`，绑定 N03 的实际 PR number/head 与原 F15 发布证据，再由原桥
分别调用 `workspace.f19_regression_head`、`workspace.f19_regression_command`。这两个固定
别名只包装现有 Git/command 实现，不增加执行器、任务库、授权层或循环。

独立 checkout 须与开发工作区互不包含；使用预配置分支、普通 `.git` 目录和原分支 loose ref。
不支持 packed-only ref、worktree `.git` 文件或目录链接，缺项明确拒绝。产品不 fetch/checkout，
不修改开发目录。原 HEAD 必须等于 API 的 merged SHA、工作区完全干净；修复文件实际字节
与原 F15 发布哈希相同。换行转换造成字节变化也拒绝，配置者须预配一致 checkout。

独立 checker 在两个工作区外，路径、文件身份、SHA-256 和固定 Node/argv 在受信配置中绑定；
模型不能提供命令。执行前和结果导出后再次核验 checker、root、原分支 SHA 与修复文件。
这些是前后读回检查，不声称可原子阻止外部程序在执行期间修改再还原文件。

`native-execution-host` 仅增加 F19 专用 `readF19Binding` 和持久原绑定：精确 child task/run、
argumentsDigest、graph/session/host、PR/merged SHA、root、recipe、helper pins、原 sandbox Policy
和实际执行事实。F19 只接受 `read-only`、`windows-psec`、network deny、无 writeRoots；命令必须
真实 started/stopped、outcome exited、exit 0，回执哈希必须对应原绑定。stdout 或 `verified:true`
不能替代这些事实。F20 原 checkpoint 与恢复语义保持。

## 根接线接口

`createDesktopF19IssueRepairPorts` 新增可选 `regression`：

- `configurationRef`、同步 `assertCurrent`：原受信配置身份及撤销复核。
- `rootPath`、`sourceBranch`：已预配独立 checkout；不由工具输入传入。
- `nodeExecutable`、`checkerPath`、`checkerSha256`：固定独立 bug 回归，argv 固定为 `[checkerPath, rootPath]`。
- `native`：原 `createDesktopNativeExecutionHost` 实例；不接受普通进程替代隔离。

工厂仍返回 `{tools, configuredWorkflowWorkerPorts, ...}`，增加
`prepareRegressionQuestion(scope, question)` / `confirmRegressionPresence(scope)`，复用原
publication 的受信在场回调。Main 应在原卡准备/确认链消费；N04 不加入自动读取批准列表。
业务命令别名已加入 native host 的准备列表；用户原 sandbox policy 必须为只读，其他模式拒绝。
没有独立目录、checker、原包、真人签名/在场或账号时继续 unavailable。Main 由根负责接入。

## 验证

- Runtime 构建通过；架构 3/3。
- 实际 OwnedWorkflowEngine → configured worker → 原审批 → 业务 child → 原 F15 → 原 Git 发布 →
  N04 的 8 项通过：成功、未合并、错误 checkout SHA、checker 替换、独立回归失败、unknown、
  拒批、等待期间取消。批准前零 merge GET；成功只执行一次回归；unknown 重开 SQLite 仍为
  `waiting_reconciliation`，没有重放。日志 `.cache/f19-regression-matrix.log`。
- F20/native readiness/可选图 host 兼容 23/23，日志 `.cache/f19-native-f20-compatibility.log`。
- `git diff --check` 通过。根集成树统一运行最终完整 check。

真实本地 Git、Node checker、文件系统、Policy/Runtime/SQLite；Git 网络、GitHub HTTP、模型、
用户同意/在场、临时 reviewer 签名和 native isolation facts 是明确 Fixture。Fake native executor
确实执行固定 Node，但其 `enforced` 字段仅测试受信消费边界，绝不是实际 PSEC 证明。本段没有
真实账号 merge/close、真实用户独立签名或实际 F19 原生隔离验收。

首轮成功路径因合成 clone 的默认 CRLF 转换未通过精确字节门禁；夹具改为在 clone 时明确
`core.autocrlf=false`，未放宽产品哈希检查。原失败日志保留。
