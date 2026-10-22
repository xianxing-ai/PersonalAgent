# Windows 原生执行沙箱：实际 OS 边界与调用方接线

本包服务 `huawei_ict_agentarts` Competition 既有固定命令/隔离修复链。分支 `codex/windows-native-sandbox`，基线 `e7d4e0c6f0830f7078a49438ea7d31fe39293394`。实现与证据由 native owner 交付给统一授权集成 owner 正常 merge，并经其完整 PR 交付；此记录不是独立批准、已合并或整个权限/UI 功能完成声明。

## 实现与可信调用

自有 .NET8 helper 新增 PSEC1.0 FlatBuffer/Win32 binding：受限目标用 `PROC_THREAD_ATTRIBUTE_SECURITY_ENVIRONMENT` 创建为挂起 AppContainer，核对普通用户/容器 token，先加入 kill-on-close JobObject，再通过独立控制通道等待 GO。目标只继承明确的输出与 NUL 输入句柄，不能伪造控制帧；stdout/stderr 由 helper 作为有界 base64 data 帧转发。取消、期限及输出溢出终止 JobObject 并读回 ActiveProcesses；不明确停止只能 unknown。

`createWindowsNativeSandboxExecutor()` 校验 canonical roots、原目录/可执行身份与完整 helper bundle hash。挂起 ready 后再次调用 `assertCurrent(binding)` 并核对原身份，原 task/run/authorization/argumentsDigest/profile revision/deadline 未变才恢复。目录 LIST_DIRECTORY 句柄拒绝删除共享，覆盖 root 与祖先；未知平台/缺能力/策略无法表达均 unavailable，无裸 spawn 降级。未请求受限策略的 full-access 仍是普通用户，backend=none/enforced=false。

生产 `command.ts` 已通过 `WorkspaceCommandOptions.trustedSandbox` 消费 executor，固定旧 recipe exe/argv/env/cwd，复核原 ToolContext 绑定，以 host-only `recordResult` 保存可信执行事实；工具 outputSchema/1.0.0 仍四字段。`isolated-repair.ts` 现有 `createCommandTool` 注入端口自然复用，无新任务库/调度器/Policy grant 消费。统一授权 owner 负责把 Runtime profile、Main recipe factory 和原执行 record 注入该端口；缺该配置的旧显式工具仍是原非隔离能力，不能把它当新沙箱。

## 实际验证

Windows25H2 build26200.9457，普通非管理员 token；Node24.15.0/npm11.12.1/TS5.9.3/.NET SDK8.0.424。真正 PSEC support 返回 v1.0/flags3。原生编译离线无 NuGet 源，0 warning/error。真实 focused test 为 **7 pass / 0 fail / 1 非 Windows 反向用例不适用 skip**。

- 自有 inside/outside 兄弟夹具：read-only 区内读允许、写拒；workspace-write 区内写允许、区外读写拒。
- 固定合成程序再生成子、孙两代：均继承文件限制和 IPv4/IPv6 原始 loopback socket deny。普通 full-access 对照成功连接同两个本机 listener 共6次，受限运行无新增连接。
- 预存 junction、运行中新 junction 均不能向 outside 写入；root alias 在启动前拒绝。
- 目标恢复前尝试替换 root 被真实共享锁拒绝；撤销租约不恢复线程、不产生 marker。
- 取消/timeout 确认整树停止；输出超限返回 unknown 且仍有界。
- 卷根、RO/RW 交叠、RW helper、秘密 env、不能表达的 network allowlist 均拒绝启动。

同一工作树独立安装36个锁定包（ignore-scripts），按 contracts→models→agents→github→policy→tool-gateway→coding-tools 顺序构建并通过 coding-tools typecheck。命令 adapter 新增核心单例 **1/1 pass**，覆盖绑定、固定 argv、可信 receipt、unavailable/unknown 无回退和缺 digest 拒绝。没有借其他树 dist 冒充本树构建，没有全仓测试、Electron/模型/云账号或网络外部服务运行。

复现（先用仓库约束 Node/npm、当前树依赖和预装 .NET8；helper 应安装到明确受信、模型不可写的外置目录）：

```powershell
node packages/coding-tools/native/build-helper.mjs --target-dir <trusted-external-directory>
# 上一步输出 apphost/DLL/deps/runtimeconfig pins 以及所有 C# 输入 hash；不缓存旧源码构建。
$env:PA_TEST_JOB_HOST_EXE='<trusted-external-directory>/WindowsJobProcessHost.exe'
$env:PA_TEST_NATIVE_SANDBOX_REQUIRED='1'
# 由当前普通用户运行，测试 TEMP/TMP 使用任务专属的仓库外目录。
node --test packages/coding-tools/test/windows-native-sandbox.test.mjs
node --test --test-name-pattern='trusted native adapter' packages/coding-tools/test/workspace-command.test.mjs
```

每次正式可用性需读完整 attestation 并调用 `verifyWindowsNativeSandbox`，绑定宿主配置代次。该合成 probe 验证的是本次 helper/Node/roots/backend；helper、root、recipe 或 profile 变化不能沿用旧绿。公共 receipt 只含 safe metadata/hash，不含原日志、私人路径、秘密配置或 raw fixture 文件。

## 发现并保留的失败边界

外层 Codex AppContainer 会阻止宿主基线，初探 HRESULT0x800706D9 不等于普通用户平台不支持；改在获准的普通用户工具上下文验证，未提权。缺 LOCALAPPDATA 的显式 env 导致 error203，补最小固定字段而非继承宿主。RO/RW 交叠实测 RO 优先，生产明确拒绝。

为修 Node 默认 realpath 曾实验卷根 RO，原 outside-read 断言立即失败；已撤回且生产拒绝卷根。当前 PSEC1.0 不支持 enumerate grant，可信 Node 文件 recipe 显式使用 `--preserve-symlinks --preserve-symlinks-main`，不会由 executor 暗改 argv，也不保证任意 npm/第三方脚本兼容。flags 只是加载兼容方式，隔离证据是上述真实文件/网络负例。

初版 READ_ATTRIBUTES 目录句柄不能阻止 rename，恢复前身份 fence 已拒执行；改 LIST_DIRECTORY 共享锁后同一负例通过。测试初轮两个连带失败未隐去；最终7/0/1来自修正后的普通用户回归。npm.cmd 曾转发全局12.x、只选 workspace 曾遗漏根 compiler、外层 TEMP realpath 曾拒绝，均分别修正 setup，未改 lock/全局配置或放宽产品断言。

read-only 仅表示受权 workspace 只读，不是零系统副作用；AppContainer 自有 profile 与 Windows/Node 运行库访问仍存在，结果 sideEffects 保守为 possible。network allowlist 未实现就 unavailable；未验证其他平台/任意 roots/所有命令/集成 Main-Policy-UI/华为云或真实模型。最后 OS 回归后仅补 pin 快照、safe 诊断和 probe setup fail-closed，当前树构建/类型/command 单例已通过；整合 PR 仍需实际新 host probe 和 UI/Runtime 验收。

原始可复现数据与失败分阶段见同名 `.receipt.json`。Microsoft 原生合约依据见 `packages/coding-tools/native/SANDBOX_DESIGN_20261021.md`，自有实现不依赖 MXC/Codex SDK，无管理员安装/全局 ACL/防火墙或账户修改。
