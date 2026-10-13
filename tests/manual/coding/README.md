# P6 编码工具真实本地验收

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。负责人 zemeng / P6；非作者评审 goo122。
使用新建的合成演示项目，但文件修改、PowerShell 独占写入、命令进程、SQLite、Runtime、Policy 与 ToolGateway 均为真实实现。没有 Fake 工具、伪造 authorizationRef 或云端调用。

## 执行

在当前工作树安装既有依赖、按根 build 顺序构建 Runtime 及 coding-tools 的依赖后执行：

```powershell
node tests/manual/coding/p6-runtime-acceptance.mjs (Get-Command pwsh).Source
```

要求普通 Windows 用户、PowerShell 7 和 Node 24。脚本在仓库 `.cache/p6-runtime-*` 排他创建新工作区、保护 ACL 的 recovery 目录、独立数据库和 `receipt.json`。不选择或读取真实用户项目，不清理历史验收文件。输出仅有相对回执目录、摘要和任务 ID；保留文件与数据库供复核。

脚本经公开 Runtime/Application 和 Client 端口发起已授权的演示工具任务，逐次读取实际审批 revision，再提交 `allow_once`。执行授权由真实 Runtime/Policy 生成并消费。验证读取与本地查找、补丁预览不改源文件、补丁实际应用、固定命令 stdout/exit、文件二次读回、执行 Evidence、取消不写入、旧源哈希拒绝，以及重启后已确认任务保持同一 ID/输入/执行记录而不重新写入。输入替换必须返回 `REVISION_CONFLICT`。

## 2026-09-30 实际结果

- 基线：`main@1d5718ab`；分支 `codex/p6-mvp-completion`。
- 新 Release 原生 Job helper 构建：0 警告、0 错误；`workspace-command.test.mjs` 8/8，0 跳过，包含取消/超时的真实进程树终结与根命令退出收尾。
- Runtime 与所需依赖定向构建通过；验收脚本 exit 0，回执 `.cache/p6-runtime-ga4x8u/receipt.json`。同目录的中文工作区、数据库和文件保留供 P8 复核。
- 工具链：.NET SDK 8.0.424；运行使用现有 bundled Node 24.19.0。安装使用宿主 npm 11.16.0 / Node 26.3.0，`--ignore-scripts`；仓库声明 Node 24.15.x / npm 11.12.x，本次未下载或更改全局工具，尚未在声明的精确补丁版本复验。

| 读回 | 实际结果 |
| --- | --- |
| before SHA-256 | `5ddbc6d1fc09ba29c255aa9c6044cac3ca75298aced82038f4b692dfb5f1b0f8` |
| after SHA-256 | `2c88b823f0fa58d95c63ebd862ead1bdc2c94d3e72a2feb98fcf21358244473f` |
| apply task | `8b7d83e0-2fac-4b1b-949a-fd2f02d7b26a`，`succeeded` |
| apply Evidence | `host-tool-8b7d83e0-2fac-4b1b-949a-fd2f02d7b26a`，执行 `confirmed` |
| command task | `f753bae0-9cd6-4d66-9ad8-dd44519906de`，exit 0，stdout `P6_AFTER_中文`，stderr 空 |
| stale source task | `b8264467-2d45-4a39-a042-5062f84603a0`，`waiting_reconciliation`，源文件与 recovery 未改变 |
| restart | 同一 apply task、同一持久执行记录、同一结果；未重放；参数替换拒绝 |

Runtime Evidence 的 `verification` 仍为 `conditional`。独立文件摘要、实际 stdout 和重启读回在此另行核验，不擅自提升公共 Evidence 等级。旧哈希的写工具失败被现有 Gateway 保守映射为 `RESULT_UNKNOWN`，继续等待核实；本脚本不改终态、不清除未知记录、不盲目重试。

## 原生命令收尾

Job helper 使用受信的明确 executable 启动根命令。根命令退出后先取得真实退出码、关闭此次 Job，再等待 stdout/stderr 排空，防止继承输出句柄的遗留子进程阻塞收尾；遗留进程仅限该 Job 的命令树。
旧 Release 在本机的新回归中同样通过，因此尚未复现该挂死；此增量是退出顺序的结构修正，不把未复现风险写成已确认现场故障。

## P8 交接与尚未完成项

- 工具仍由可信 composition 显式注册；没有新 Schema、wire operation、公开 DTO、迁移或依赖。复用 `createWorkspaceReadTool`、`createWorkspacePatchPreviewTool`、`createWorkspacePatchApplyTool`、`createWorkspaceCommandTool` 的公开出口；共享装配与 #219/#222 的补丁恢复由 P8 处理。
- 此回执证明真实本地工具链，尚未证明正式 Desktop 设置页/主对话消费、AgentArts 提案与云续接、Windows 选定应用 UIA 或整体 MVP。
- Windows 实机需要 P8 独占正式 Desktop/新记事本/F9 槽，分别确认窗口身份、目标过期/接管拒绝、写后读回、可信 Evidence 与桌面终态。
- 编码正式 Desktop 消费应保留现有工作区选择、精确能力公布、结果出云授权和 P8 恢复接线，不能用此 runner 代替用户入口。

## 2026-09-30 P6 读取摘要与 BOM 增量

正式 read → patch 消费缺少 `expectedSha256` 的来源。`workspace.read_text@1.0.0` 现在返回同一次读取原始字节的 `sha256`，输入路径与授权不变；输出 Schema 可选该字段以兼容历史回执，当前 provider 成功输出必带。正文首个 UTF-8 BOM 现在保留为 U+FEFF，而旧读取器会剥除；换行不归一化。严格消费者应发现当前 descriptor，旧无摘要结果不能直接生成新补丁。没有修改 contracts、根注册、迁移或依赖，接口保持 provisional。

定向验证：contracts、coding-tools、tool-gateway 的已有 TypeScript 构建；读取、wire 边界、patch-preview 17/17 测试。BOM 原拒绝断言改为验证准确保留，其他路径、敏感内容、非法 UTF-8 和输出边界拒绝不变。按本轮最少验证要求未跑全仓 check、原生重建或重复 Desktop 冒烟。

复用本 runner 的 `--cas-only` 模式：

```powershell
node tests/manual/coding/p6-runtime-acceptance.mjs <trusted-pwsh.exe> --cas-only
```

Node 24.19.0 / Windows PowerShell 7，本地真实 Runtime/Policy/ToolGateway 经公开 Client 审批执行，使用新排他工作区、独立数据库及 ACL recovery；不调用云端。Runtime 复用此前本地构建，contracts、coding-tools、tool-gateway dist 已按本次源码更新；这不是最新正式 Desktop 装配验收。

- 成功回执：`.cache/p6-runtime-s9priJ/receipt.json`；读取返回摘要直接用于预览和应用，写后原始字节与工具二次读取匹配，BOM/CRLF 均保留。
- before：`c955ba4dfc2309dd6a52a531b9eea3ffb258127f78af653da6c7694e21b85f37`；after：`421500aa5d5bc97c7cf52b1fd57fd0a63d7d259a617da6b7b4f11d9f1341a768`。
- apply task `0ff7012c-5e64-40c7-acd9-cc26c141d292` succeeded，执行 confirmed，Evidence `host-tool-0ff7012c-5e64-40c7-acd9-cc26c141d292` 的 verification 仍是 conditional；单独文件读回在本验收中匹配，未提升公共 Evidence 等级。
- 旧摘要 preview task `d4b2916a-c99f-4470-8d58-56b004ec9b93` failed / REVISION_CONFLICT；旧摘要 apply task `e34889db-f85b-47a8-9ddf-f2008c2a411a` waiting_reconciliation / RESULT_UNKNOWN，文件保持 after、recovery 空。另受影响测试验证读取后用户改变文件的冲突拒绝。
- 首次尝试 `.cache/p6-runtime-AVTKvE` 遇到陈旧 tool-gateway dist：它向 Policy 提供 argumentsDigest，但没有向 ToolContext 传入，apply 被拒并保留 waiting_reconciliation。源文件 raw SHA 仍为 before、recovery 空；保留此 DB，不重试或改变该 task。main 的 tool-gateway 源码已有正确字段，更新该既有依赖 dist 后在新的隔离 fixture 成功；未修改公共源来迎合旧产物。

P8 使用公开 `createWorkspaceReadTool`/`createWorkspacePatchPreviewTool`/`createWorkspacePatchApplyTool` 即可消费，无需自行计算文本摘要。正式主对话 read → patch、AgentArts 续接及 Windows UIA 验收仍由 P8 保留各自证据，不由本地 runner 替代。
