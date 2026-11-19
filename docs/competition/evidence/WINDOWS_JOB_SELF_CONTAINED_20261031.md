# Windows 原生组件自包含发布工作包

目标 profile：`huawei_ict_agentarts`；状态 `in_progress`。独立工作树 `.worktrees/pr531-native-helper`，基线 `46ca9165`。不进行全局运行库安装，不改系统保护、PSEC、原授权或产品净化环境。

## 修改前的方案与兼容边界

- Desktop 已有正式 `publish-native-desktop.mjs`，固定 win-x64 / .NET 8.0.30，包含许可、完整 inventory 和 manifest。先沿原发布门禁生成，再复制完整包到独立外部临时验收目录，核对所有文件及原 initialize/EOF 身份；只证明产物可在干净环境初始化，不代表实际键鼠操作、Job helper 或 Notepad 成功。
- `WindowsJobProcessHost` 默认 framework-dependent（FDD）发布及现有调用保持兼容。新增显式自包含发布选项，继续要求受信宿主指定仓库外目录、已安装 .NET 8 SDK、本机架构及当前 C# 源码，不自动安装 SDK。
- 自包含包使用仓库已明确固定的 .NET 8.0.30 与原许可来源，不声称是最新版。完整 manifest 包含 apphost、托管程序集、运行库、配置、许可及源码摘要；不能把 Desktop 的 component 身份复用成 Job helper 身份。
- `readWindowsNativeHelperAttestation` 与每次 `execute` 前都验证完整自包含文件集合、SHA 和原清单。额外/缺失/替换运行库、重解析路径和更改清单均拒绝；不能只沿用 FDD 的三个伴随文件 pins。
- 保留原 PSEC、普通用户、外部可信非工作区可写目录、原握手、取消/期限及干净环境，不新增授权层。真实 Job 验收使用原 `verifyWindowsNativeSandbox` 的受控合成文件/回环 listener；Desktop、Job 与 Notepad 分开记录。

## 实现与失败修复

- 公开 `buildNativeHelper({targetDir,selfContained:true})` 只接受新的空外部目录，固定 runtime 8.0.30，保留默认 FDD 行为。返回完整 `helperFilesSha256`、`manifestSha256`，不是仅三个 FDD pins；源码在发布前后摘要一致才接收产物。
- 初次包在 `env:{}` 可运行 `--sandbox-support`（PSEC v1.1 / flags 15），但原始 Unicode JSON 在 request 阶段失败。诊断中仅对非 ASCII 字符转义可抵达 ready，证明默认控制台编码不符合原 UTF-8 协议；此诊断没有 GO，也不算真实执行验收。最终修复为 `Program.Main` 明确严格 UTF-8 输入及无 BOM UTF-8 输出，生产请求没有 ASCII 转义旁路。
- 修复后 baseline / readOnly / workspaceWrite 真执行通过，但原探针从调用起固定 300 ms 取消，在完整运行库校验与冷启动结束前触发，整体仍正确 unavailable。现仅将原探针改为等待自身孙进程写出独立 ready 文件再取消，保留 15 s 原执行期限、`executionStarted` 与 `stopped` 成功条件，并传播上游取消。
- 真实超时用例采用其原 request 默认 5 s 期限，避免在自包含冷启动前到期；额外断言 `executionStarted:true`，仍要求真实 timeout 与进程树停止。没有提高产品执行期限或放宽授权。

## 本机验证（2026-11-01）

全部使用普通 Windows 用户（`administratorToken:false`）、独立合成文件和回环 listener；未操作桌面 UI、未做全局安装、未使用私人文件。

| 范围 | 结果与证据 |
| --- | --- |
| Desktop 原正式发布 | 固定 8.0.30 / win-x64，完整 472 文件 inventory 复制后逐项 SHA/大小一致；干净环境 initialize/EOF 身份成功。manifest `3168293dae3c99a56f54e129994e02c4815c70d302daa705ca2726c16bfeb876`。只证明初始化，不证明键鼠/Job/Notepad。 |
| Job 正式自包含产物 | 191 个 companion pins（含运行库、许可、manifest/checksum），manifest `60bb48be82f30aa54646921790b77d4adcd8d5e0f299823041963191777b6a14`，apphost SHA `2be82f75176a7ea6a11236d837317501415d38caeee4329c32e2460a219b4ca7`。 |
| 实际 TypeScript 构建 | 根 `npm run build` 与修改后 coding-tools workspace build exit 0。 |
| 定向测试 | `node --test packages/coding-tools/test/native-helper-bundle.test.mjs packages/coding-tools/test/host-architecture.test.mjs packages/coding-tools/test/windows-native-sandbox.test.mjs`，设置显式可信 `PA_TEST_JOB_HOST_EXE` 及 `PA_TEST_NATIVE_SANDBOX_REQUIRED=1`：32 项，31 通过，1 非 Windows 分支跳过，0 失败。 |
| 真实 PSEC | 原 `verifyWindowsNativeSandbox` 的 `available:true`、networkDeny、descendants、reparse 断言通过；中文目录/参数/结果写读回、非法 UTF-8 执行前拒绝、禁止环境秘密/模糊权限、运行中 junction 外写拒绝、根与父目录替换拒绝、原 lease 撤销不执行、超时停止、输出溢出 unknown、junction 根拒绝全部通过。 |
| 清单负例 | 显式 Synthetic bytes，仅测试 FDD 兼容与完整 inventory 替换/额外/缺失/版本/manifest 拒绝、授权 await 前后变化拒绝；没有将 Fake helper 执行称为真实 PSEC。 |

本机正式 Job 包：`C:\Users\李广威\AppData\Local\Temp\pa-pr531-native-check-20261031\pa-pr531-job-bundle-YO9eXd\WindowsJobProcessHost.exe`。Desktop 包单列：同一临时根下 `pa-pr531-desktop-bundle-rwIBu4\desktop`。

独立树忽略缓存保留 `.cache/job-self-contained-publish-utf8.log`、`.cache/test-job-real-utf8.log`、`.cache/build-native-utf8.log`、`.cache/desktop-self-contained-evidence.json` 与旧失败诊断。`job-self-contained-os-evidence.json` 保留修复取消探针之前的失败结果；最终通过以显式原测试日志为准，不覆盖历史失败。产物和日志未提交 Git。

## 交接与未完成范围

- 本工作包代码、真实 Job 探针和定向测试已交付；整仓 `npm run check` 由集成分支统一执行，此处不声称全仓通过。
- Desktop Main 既有开发调用默认仍是 FDD。根接线负责人将首次发布指向新的空外部 SC 目录，随后只复核不可变包；不得覆盖旧非空缓存或只传三个 pins。安装包的 Job 资源仍须独立登记，不复用 Desktop component 身份。
- Windows Host / PipeBridge / Notepad 是独立 FDD 产物，尚未在本包证明自包含交付或真实 Notepad 写后读回；桌面 UI 由根串行验收。当前工作不等于 #531 全部设备链完成。
