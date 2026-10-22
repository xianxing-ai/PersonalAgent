# Hosted PSEC 必须真实正例：诊断与严格入口

2026-10-22；当前状态 `not_run`。Linux 上语法检查不是 Windows 正例；此前 Hosted 两项 SKIP 不计通过。

原回执 `native-create-environment:-2146233052` 的 HRESULT 是 `0x80131524`。Microsoft 的 [DllNotFoundException 文档](https://learn.microsoft.com/en-us/dotnet/api/system.dllnotfoundexception) 明确其为 `COR_E_DLLNOTFOUND`。精确调用链是 `SandboxLauncher.cs` 的 `create-environment` → `new PsecEnvironment` → `Probe` → System32 限定的 `processmodel.dll!IsProcessSecurityEnvironmentVersionSupported`，随后才可能进入 Query/CreateProcessSecurityEnvironment。这里不是 userenv.dll 的 CreateEnvironmentBlock。异常可表示主 DLL 或其依赖未加载，旧回执没有 DLL 清单，不能进一步断言具体缺哪一个文件。

[官方 CreateProcessSecurityEnvironment 文档](https://learn.microsoft.com/en-us/windows/win32/api/processmodel/nf-processmodel-createprocesssecurityenvironment) 的签名与当前自有 binding 一致；其 requirements 只列 processmodel.h，没有公布最低 OS 或可证明 Server 26100 支持的声明。2026-10-22 读取的 [actions/runner-images Windows2025 清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md) 是 OS 10.0.26100 Build33438 / image20261013.288.2；仓库原生真实成功证据来自 Windows11 25H2 26200.9457。这两个环境不能互相替代。

未发现有依据的生产 API 修复。保持普通用户、PSEC enforcement、Policy/Runtime/Job 和原安全断言，不复制系统 DLL、不切管理员、不创建账户、不修改已有 desktop ACL，也不改 unsupported 分类。

严格执行入口在原 current-user standard-token launcher 新增固定 `--run-psec-acceptance`，其余参数与原 token/Job 路径保持一致。前置仍是正常依赖安装、当前源码构建、native helper 构建，以及 `scripts/ci/windows-standard-token/smoke.ps1` 的真实成功。然后在同 job：

```powershell
& $env:PA_CI_CHECK_LAUNCHER --run-psec-acceptance
exit $LASTEXITCODE
```

固定脚本强制 `PA_TEST_NATIVE_SANDBOX_REQUIRED=1`，串行执行 `packages/coding-tools/test/windows-native-sandbox.test.mjs` 的真实 PSEC 根场景和 `apps/desktop/test/authorization-native-execution.integration.test.mjs` 的真实原 question/Policy/Gateway/PSEC 场景。只选择这两个真实根场景；每个必须 exit0、至少一个 pass、0 fail、0 skip；缺配置/非普通用户/不支持/未知都失败。两项日志及 receipt 写到 `$RUNNER_TEMP/psec-positive-acceptance`，含源码 SHA、helper SHA、UTC、wall、exit/signal、日志 SHA、OS 与 System32 processmodel.dll 是否存在/散列。两项都通过才整体 exit0。

复用默认分支已有 `.github/workflows/runner-probe.yml`，新增显式 `workflow_dispatch` 输入 `target=psec-strict`。原短工具链模式保持；严格模式只选一个 `windows-2025` 槽，权限仍只有 `contents: read`，不接新秘密。该模式正常安装依赖，用根既有 build 顺序构建 Runtime/coding-tools 的内部依赖闭包，构建原 native helper，通过原 smoke 后再执行固定严格入口。失败也上传两项原日志/receipt artifact；准备失败而尚无 receipt 时仍为 job failure。push 分支不能选择 strict target。此 job 不是 Foundation required 状态，也不影响合并队列。

artifact 另定点保存本次新 case 的 `receipt.json` / `unavailable-receipt.json`，外层回执绑定其散列；不上传 SQLite 或整个 cache。采集拒绝符号链接、非普通文件与超过 256 KiB 的回执。

本地已完成 Node 语法、2/2 路由测试、workflow YAML 解析与 diff 空白检查；未运行 Windows、不构建 Windows helper、不称实际通过。真实 runner 的结果须补充 run/attempt、确切 source/helper、OS 与上述 receipt。

后续本地主控基于 `dbc0bdea` 新构建 helper/launcher，补齐固定 DLL/export/token 分层诊断及 REQUIRED 缺 helper 必失败；两项原生正例已在普通用户 Windows 11 上真实通过，7/7 与 1/1 均 0 skip。该新结果见[独立本机回执](PSEC_REAL_COMPLETION_20261022.md)，不回写为 Hosted 已通过；Hosted run/attempt 仍 `not_run`。
