# Strict native ARM64 的 unknown OS machine 前置修复（2026-10-22）

Profile：`huawei_ict_agentarts`；独立工作树 `.worktrees/psec-real-completion`，
分支 `codex/psec-real-completion`。只改 `host-architecture.mjs`、对应直接测试和本记录。
没有改 WSS/Main、runner label、执行权限、沙箱或原 PSEC 正例。

## 已知失败与判定

主控提供最新 Hosted run `39730146256` / job `119663113163` 的脱敏诊断：
`reason=Unsupported Windows architecture`、`unsupportedArchitecture=other`、
`nodeArchitecture=arm64`、`osMachine=unknown`。它停在 prepare preflight，尚未运行两项
真实 PSEC 正例；前置失败或未执行不能算 native 验收通过。

现有判定把 `os.machine()` 一律交给固定 x64/ARM64 枚举；Node 24.15 ARM64 这里返回
`unknown` 时，即便宿主可能为真实 ARM64，也不能通过。不能直接接受 unknown，不能用
用户可改的 PROCESSOR_ARCHITECTURE/PROCESSOR_ARCHITEW6432 环境变量替代证据。

## 最小只读辅助

仅当 `osArchitecture === 'unknown'`（精确匹配）时调用固定原生探测。已知值、已知冲突、
不支持的机器类型和非 Windows 不调用辅助，不会被第二来源覆盖。

使用固定系统 Windows PowerShell 组件路径，`-NoProfile -NonInteractive`、
`shell:false`、隐藏窗口、10 秒期限、8 KiB 输出上限和固定内联源码。路径不取 PATH 或
用户的 SystemRoot；子进程只带固定 Windows 根和临时目录，不继承处理器架构、
PowerShell profile 或任意 .NET 启动 hook 环境。非标准非 `C:\Windows` 安装在这个
unknown-only 分支会拒绝，不能改用用户提供的可执行文件。

固定 C# P/Invoke 从 System32 的 Kernel32 调用 `OpenProcess(0x1000, false, currentNodePid)`
和 `IsWow64Process2`，结束后释放句柄；只查询当前 Node PID，不执行 PSEC 或目标命令。
`0x1000` 是 PROCESS_QUERY_LIMITED_INFORMATION，只读查询权限。
回执必须包含恰好五个固定字段、版本/API 标识、精确 Node PID 和整数机器值。
要求 processMachine=0（非 WOW64），nativeMachine 仅 x64=0x8664 或 ARM64=0xaa64，
再与 `process.arch` 和原 expectedArchitecture 一致；任何失败、异常输出、错 PID、
仿真或不一致都拒绝。安全诊断仅输出固定原因/查询名/退出码，不导出原错误或 stdout/stderr。

采用此 API 而非单独 GetNativeSystemInfo，是因为微软明确说明后者在 ARM 上的 x86/x64
仿真环境可能报告仿真信息；官方要求用 IsWow64Process2 区分。依据：
[GetNativeSystemInfo](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getnativesysteminfo)、
[IsWow64Process2](https://learn.microsoft.com/en-us/windows/win32/api/wow64apiset/nf-wow64apiset-iswow64process2)。
后者官方契约支持查询指定进程，并分别返回 WOW64 类型与系统原生 machine。

现有所有 preflight 都调用同一 host-architecture 模块，因此不需要修改 workflow：
setup prepare、helper build、smoke 和普通 token 正例入口均复用该辅助。
实际 .NET host 架构、已安装 .NET 8 SDK/runtime、publish RID、helper/launcher PE，
以及降权后 RuntimeInformation 的 ProcessArchitecture/OSArchitecture/Framework 全部
保留原检查；辅助只补 Node 的 unknown 信息，不替代任何后续门槛。

## 轻量验证与边界

```text
node --check packages/coding-tools/native/host-architecture.mjs
passed

node --test packages/coding-tools/test/host-architecture.test.mjs scripts/ci/runner-probe.test.mjs
12 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo

git diff --check
passed
```

夹具覆盖：unknown+原生 ARM64/x64 成功；错 PID/API/版本/额外字段/伪造字符串/非零退出/
失败/中断仍拒绝；processMachine 非零或 Node/native 不匹配拒绝；已知 OS 不查询辅助；
辅助成功后 .NET host 不匹配及缺 .NET 8 仍拒绝；原 PE/RID/降权运行时失败用例保留。
这些是明确 Fake 原生回执，不能证明 Hosted ARM64 支持 PSEC。

另外只执行一次本机真实 x64 只读 API 查询（pinned Node 24.15，主动指定测试输入
osArchitecture='unknown'，未执行 PSEC）：成功返回 architecture=x64、win-x64、
api=IsWow64Process2、processMachine=0、nativeMachine=34404（0x8664）。这证明当前 Windows
固定探测源码与 API 调用可运行，不代表 ARM64 或 Hosted 两正例已运行。

未安装依赖、未构建 helper、未运行 PSEC/模型/Electron/Laya/邮箱，未重启或关闭应用，
未复制 DLL、降级沙箱、接受 emulation、绕过 Framework64/token 检查或改 skip。
根将审查、推送并 dispatch strict ARM。只有后续新 run 在真实普通 token 下完成原 smoke、
compatibility 和两个 REQUIRED 正例且 0 skip，才可记录 Hosted native 验收通过。
