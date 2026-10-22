# 当前源码的真实 PSEC 强制验收

目标为 `huawei_ict_agentarts` 的既有固定命令和授权执行边界。隔离工作树分支 `codex/psec-real-completion`，基线 `cb120aca`；只选择云端提交 `7e552b1982ded5783b4f2104e3bbdf423834476f` 的严格入口，正常 cherry-pick 为 `a138b1c6a`。实际 Windows 验收源码为 `dbc0bdea47a3f1a155a65d685dd29b58614dc7e4`，没有用旧 pre-PSEC helper。

## 实际结果

2026-10-22 04:44:51–04:45:00 UTC，在 Windows 11 25H2 / 26200.9457、Node 24.15.0、npm 11.12.1、预装 .NET SDK 8.0.424 下，当前源码新 helper 与新 standard-token launcher 编译成功。launcher 原 smoke 验证 stdio、原退出码、环境/cwd、Job 关闭及 launcher 被终止后的子孙回收；完整 compatibility 原 token/selected token 各 console variant 均退出 0。没有修改现有应用、账户、系统 DLL、全局 ACL 或防火墙。

通过该 launcher 的固定 `--run-psec-acceptance` 入口串行运行，两个正例都强制 `PA_TEST_NATIVE_SANDBOX_REQUIRED=1`：

| 正例 | pass | fail | skip | 依据 |
| --- | ---: | ---: | ---: | --- |
| `packages/coding-tools/test/windows-native-sandbox.test.mjs` 的真实根场景及六个子项 | 7 | 0 | 0 | 受限读写、区外/junction 拒绝、代次与恢复前路径锁、撤销、超时/输出溢出和整树停止 |
| `apps/desktop/test/authorization-native-execution.integration.test.mjs` 的真实原问题场景 | 1 | 0 | 0 | 原 Runtime/Policy/ToolGateway/问题卡/生产 native host；批准前零业务执行，批准后一次 marker 读回，重复/参数替换拒绝，配置不可用无降级 |

两项 cancelled/TODO 也均为 0，严格入口退出 0，总计 8.828 秒。原授权回执的 `backend=windows-psec`、`enforced=true`、`executionStarted=true`、`stopped=true`；一次 grant 剩余次数为 0。用户卡决定和文件内容为 Synthetic，执行器、Windows 边界、Runtime/Policy 和实际文件写读均为真实实现，未使用 Fake executor。模型与账号调用均为 0。

另行反向验证 REQUIRED 模式缺少 helper：指定一个不存在的自有测试路径后，focused 根场景实际退出 1、fail 1、skip 0；不再将缺少 helper 算作可跳过。严格 TAP 判定回归与原路由回归共 3/3，0 fail/skip。当前树依赖按锁安装，依赖闭包按原根 build 顺序构建；没有借用别树 dist。安装使用 ignore-scripts，未启动 Electron/声音/模型服务。

## DLL 与宿主诊断

新增固定 `--sandbox-diagnostics` 只从 System32 加载 `processmodel.dll`、检查四个固定 exports，并输出 OS/架构、DLL版本、原 token 布尔值和安全数值错误。它不创建 PSEC 环境、不启动业务进程、不输出账户/SID/私人路径/环境块/异常正文，也不会设置 available/enforced。既有 `--sandbox-support` 单独验证合约；最终可用性仍取决于两项真实正例。

本次实际诊断为 `elevated=false`、`administrator=false`、`appContainer=false`；DLL `10.0.26100.9444` 成功加载，四个 exports 全存在；合约探针为 v1.0 / flags 3，仍准确标记 `enforced=false`。launcher 在恢复前另核对 medium integrity、原用户/会话、UIAccess、主 token 以及禁用管理员组，未使用提权执行代替受限正例。

旧 Hosted 诊断 `native-create-environment:-2146233052` 是 `DllNotFoundException / 0x80131524`，发生于首个 PSEC API 的加载阶段；该旧日志不能区分主 DLL 缺失与其依赖加载失败。新诊断可区分 DLL 不存在、存在但加载失败、缺 export，并保留即时 Win32 code。这是诊断能力补齐，不声称更换宿主或安装 DLL 已修复 Hosted。Microsoft 的 System32 限定加载路径与自有 binding 一致，未发现有证据支持改 API/放宽策略。[Microsoft 实现](https://github.com/microsoft/mxc/blob/main/src/mxc-sdk/src/backends/process_container/common/secenv.rs)

Hosted 新入口的实际 run/attempt 仍为 `not_run`；本机通过不代表 Windows Server 2025 镜像具备 PSEC。应由同一源码、新 helper、普通用户 launcher 在目标 runner 运行严格入口；缺 API、未知结果或任何 skip 都必须 job failure。不得复制外来 DLL、改用 Fake/普通 spawn 或关闭沙箱来变绿。

## 安全回执与复现

[本次完整严格回执](psec-real-completion-20261022/receipt.json)、[真实原问题执行回执](psec-real-completion-20261022/authorization-0-receipt.json)、[PSEC 边界 TAP](psec-real-completion-20261022/os-boundary.log)、[整链 TAP](psec-real-completion-20261022/authorization-chain.log) 与 [分层诊断](psec-real-completion-20261022/native-diagnostics.json) 仅包含自有合成执行及安全元数据；没有 SQLite、业务正文、账户或原配置。helper apphost/DLL/deps/runtimeconfig hashes 均在回执中。

[构建来源与额外验证散列](psec-real-completion-20261022/build-provenance.json) 另保留全部当前 C# 输入 hash、依赖构建/launcher 原日志 hash，以及 REQUIRED 缺 helper 的实际失败结果；含私人绝对路径的构建原日志只留本机 ignored cache。

先按锁安装本树依赖，用预装 .NET8 构建当前 helper 到可信仓库外目录；设置本任务独立仓库外 TEMP/TMP、`RUNNER_TEMP`、固定 Node/npm PATH 与 `PA_TEST_JOB_HOST_EXE`。在原 cwd 执行：

```powershell
./scripts/ci/windows-standard-token/smoke.ps1
# 读取该 smoke 生成的 PA_CI_CHECK_LAUNCHER，再运行固定入口。
& $env:PA_CI_CHECK_LAUNCHER --run-psec-acceptance
exit $LASTEXITCODE
```

普通本地 shell 需从 smoke 的 `GITHUB_ENV` 文件读取 launcher 路径；脚本仅在实际 smoke 和 compatibility 成功后公布它。严格入口保留两项实际 TAP、诊断和此轮新生成的两个允许名称的 Synthetic JSON，不上传 cache 树。

本轮未验真实 Electron 点击、AgentArts/模型/云账号、任意 npm/git recipe 或 Hosted PSEC。公共 wire、Schema、数据库迁移与冻结级别不变。必要原生验证已满足，不以此宣称整个 Competition 或所有功能完成。
