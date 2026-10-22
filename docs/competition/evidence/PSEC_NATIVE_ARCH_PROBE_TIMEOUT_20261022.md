# Hosted ARM64 原生架构探针超时（2026-10-22）

Profile：`huawei_ict_agentarts`。工作树 `.worktrees/pelican-real-completion`，
分支 `codex/pelican-real-completion`；实现基线 `9099ebc8`，包含 `309e5ebe`。
本工作包只改原 `host-architecture.mjs`、其直接测试和本记录。

## 这次真实失败

通过 GitHub 连接器读取原始
[job 119706116619](https://github.com/xianxing-ai/PersonalAgent/actions/runs/39743447813/job/119706116619)
日志及步骤。run 为 `39743447813`，实际 checkout 是
`6b9a9e44ac2690914c6c44d345236a030203a83c`；不是本修复的新验收。

原日志报告 Hosted `windows-11-vs2026-arm64`，image `20261013.183.4`，
Windows 11 `10.0.26200`，setup-node 下载并使用 Node `24.15.0` ARM64。
固定 preflight 所在 step 从 `2026-10-22T07:52:07.754Z` 开始，
`07:52:18.431Z` 输出以下白名单诊断：

```json
{"status":"failed","reason":"Native Windows OS architecture probe failed","query":"native-os-architecture","processError":"ETIMEDOUT","exitCode":null,"nodeArchitecture":"arm64","osMachine":"unknown"}
```

`Prepare exact strict PSEC acceptance inputs` 失败；
`Require both real ordinary-user PSEC scenarios without skips` 未执行（步骤为 skipped）。
这不是两个正例失败后的回执，也不能算 PSEC 或 native ARM64 验收通过。
原探针没有内部阶段信息，不能断言超时发生在 PowerShell 初始化、`Add-Type` 编译或
原生 API 调用的哪一步。冷启动和编译包含在 10 秒进程期限内，是可检验的可能因素，
尚未由原日志证明。

## 最小改动与保留门禁

只将 unknown-only 固定系统 PowerShell 的只读探针进程期限从 10 秒改为 60 秒，
没有新增重试、可配置绕过、备用架构提示或其他执行入口。原 dotnet 三项查询仍各 10 秒。
这给冷初始化/编译更多时间，不表示已证明 Hosted ARM64 问题消失。

固定脚本向 stderr 写三个固定阶段标记：`powershell-started`、`type-compiled`、
`query-complete`。失败诊断只采纳整行精确匹配的阶段枚举，并输出固定期限和本机单调时钟
测得的耗时；没有阶段标记时记 `no-stage-received`，不推断进程从未启动。
任意原始错误、路径、stdout/stderr 正文和其他字段均不出现在诊断中。
阶段只辅助定位，不参与架构判定或授权。

仍使用固定 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`、
`-NoProfile -NonInteractive`、`shell:false`、隐藏窗口、8 KiB 输出上限和受限子环境。
仍只通过原 `IsWow64Process2` 查询精确当前 Node PID，要求版本/API/五字段回执严格匹配，
`processMachine=0`、native machine 为 x64/ARM64，且与 Node 和原 expected architecture
一致。失败、超时、非零退出、中断、错 PID、额外字段及 emulation 均拒绝；即使超时前
stdout 已含有效回执，也不能放行。原 pinned Node、dotnet/.NET 8、RID/PE、降权后运行时
和两个真实正例门禁均未修改。

## 必要验证

使用 pinned Node `v24.15.0`：

```text
node --test packages/coding-tools/test/host-architecture.test.mjs scripts/ci/runner-probe.test.mjs
13 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo

node --check packages/coding-tools/native/host-architecture.mjs
passed

git diff --check
passed
```

新增回归确认只有该 probe 的期限变为 60 秒；每次只有一次调用；各阶段及无阶段 timeout
仍抛原固定错误；诊断不导出私人占位内容；其他查询不采纳 probe 元数据；原架构拒绝负例保留。
这些是假回执测试，不是真实 ARM64 证明。

另在本机只执行一次固定探针的真实只读 API 查询，pinned Node `24.15.0` x64，
显式令测试输入 `osArchitecture='unknown'` 进入原备用探针：

```json
{"status":"passed","nodeVersion":"v24.15.0","nodeArchitecture":"x64","result":{"architecture":"x64","runtimeIdentifier":"win-x64","osArchitectureProbe":{"architecture":"x64","api":"IsWow64Process2","processMachine":0,"nativeMachine":34404}},"elapsedMs":507,"stages":["PSEC_NATIVE_OS_ARCH_V1:powershell-started","PSEC_NATIVE_OS_ARCH_V1:type-compiled","PSEC_NATIVE_OS_ARCH_V1:query-complete"]}
```

这只证明当前本机固定脚本、阶段输出及 API 查询可运行，不证明 Hosted ARM64 冷启动耗时，
也不证明 PSEC helper/普通 token 的真实正例。
未安装依赖、未构建 helper、未启动模型/服务/Desktop、未读用户配置或数据库，未派发 CI。
后续由主控审查、集成并派发新 strict ARM job；必须在新源码下实际完成两项 REQUIRED
正例且零跳过，才能记录相应验收通过。若仍超时，应依据新固定阶段继续定位，不反复盲派。
