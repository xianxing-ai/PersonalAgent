# 原生执行沙箱：方案、兼容与验收边界

本工作包服务现有 Competition 固定命令/隔离修复执行链。Runtime/Policy 仍负责授权问题、原执行记录和一次性 grant；coding-tools 公开 host-only provisional profile/request/result，由 Runtime 通过公开包消费，不反向依赖 apps，不新增 wire 或第二套执行循环。

现有 JobObject 只负责生命周期。新增原生模式复用同一受信 .NET 8 helper，使用 Windows `CreateProcessSecurityEnvironment`（PSEC）+ `PROC_THREAD_ATTRIBUTE_SECURITY_ENVIRONMENT` 在恢复挂起线程前建立文件/网络边界，JobObject 继续保证进程树清理。只探测 DLL/export 不表示 enforcement 已验；运行时必须核对 PSEC 合约支持，创建失败或不能完整表达策略时返回 unavailable，不能裸 spawn 降级。

初版提供 read-only 与 workspace-write：显式读取 roots、工具可执行 allowlist、仅 workspace-write 的写 roots，默认网络全禁。`allowlist` 在没有精确 OS enforcement 前明确 unsupported；不把 HTTP_PROXY 或 DNS 名单当成网络边界。full-access 是独立显式审批选择，仍限普通用户，backend=none/enforced=false，不冒充沙箱。

宿主冻结 sandboxRef/revision 与原 task/run/authorization/argumentsDigest/deadline，helper 只接收该次固定 executable/argv/env/cwd。受信 assertCurrent 在目标恢复前再次校验 profile 与原租约，不再消费 Policy 一次性 grant。取消、deadline 与有界输出沿原执行上下文；未确认整树停止时只能 unknown，不自动重试副作用。

路径根/工具在注册及恢复线程前校验 canonical 身份与重解析点，资源句柄贯穿执行；同根内新建 junction 不能跳出 OS 授权路径。具体 PSEC 绑定语义必须由实际子孙越界/重解析/网络负例验证，不能只用 JavaScript 前缀检查作证明。系统/运行库的必要只读访问与受管临时目录应显式记录，不能声称零环境访问。

当前开发机实际探测：普通非管理员 token，Windows 25H2 build26200.9457、.NET8.0.424、SDK10.0.26100.0。PSEC 合约 v1.0、support flags=3。真实 helper/固定 Node/自有合成 roots 已验证 read-only、workspace-write、子孙越界、junction、双栈 loopback 与生命周期，见本轮 Evidence；这不等于任意命令、根目录、平台或已集成 UI 全部可用。

生产配置拒绝卷根授予、RO/RW 交叠、将工具/可信 helper 放在 RW 根、秘密环境变量及无法 OS 表达的 network allowlist。PSEC v1.0 同根 RO 优先于 RW，不能靠合并 grant 扩权。曾实验卷根 RO 来修复 Node realpath，但原兄弟拒读断言捕获权限扩大，已完全撤回；没有保留该例外。当前固定 Node 文件入口需由可信 recipe 显式提供 `--preserve-symlinks`、`--preserve-symlinks-main`，executor 不改 argv；第三方 npm/工具兼容仍须实际受限执行，不能泛称支持。

仅显式白名单 env：PSEC 要求 SystemRoot、LOCALAPPDATA 字段；缺失返回 unavailable，不用 null env 或继承宿主作补救。read-only 是用户指定工作区只读，并非零机器状态：Windows/AppContainer 自有 profile/运行库仍有系统提供的访问，因此结果 sideEffects 保守为 possible。helper 的 apphost、DLL、deps.json 与 runtimeconfig.json 一并 hash 绑定；构建无 source cache，所有当前 C# 输入由 csproj 编译。

必须覆盖：普通用户 read-only 拒写；workspace-write 仅允许目标写；目标与孙进程越界失败；预存/运行中 junction 与根替换失败；直接 IPv4/IPv6/loopback 网络被禁；取消/超时整树停止与无法确认时 unknown；旧租约/撤回/revision 不符不恢复；full-access 不提权；不支持平台拒绝。所有源和 Evidence 提交到统一授权集成 PR，实际消费接线完成后才称交付。

一手接口依据（2026-10-21 读取）：

- https://learn.microsoft.com/en-us/windows/win32/api/processmodel/nf-processmodel-createprocesssecurityenvironment
- https://learn.microsoft.com/en-us/windows/win32/api/processmodel/nf-processmodel-queryprocesssecurityenvironmentsupport
- https://raw.githubusercontent.com/microsoft/mxc/main/external/windows-sdk/ProcessSecurityEnvironment.fbs
- https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer

仅参考 Microsoft 的原生合约，自有 harness/helper 不依赖 Codex 或 MXC SDK；没有全局账户、防火墙、系统配置修改或管理员安装。
