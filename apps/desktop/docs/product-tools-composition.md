# MOD-11 Product tools composition

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

负责人 zemeng；目标 `huawei_ict_agentarts`。此文件记录独立装配模块，主入口接线和非作者评审由集成负责人执行。接口仍 provisional。

`createProductToolsComposition` 仅消费包公开入口，不执行工具、不签发 scope、不创建第二个 Runtime。返回的 `tools`、`competitionToolAvailability`、`competitionToolExports` 分别并入同一个 RuntimeApplication 对应构造参数；应用关闭后调用 `close()`。包的 `register(host)` 通过临时收集器转为 Runtime 的工具数组，包 disposer 在关闭或装配失败时释放。

## main 注入

- `modules`：公开 package namespace，`coding` 对应 `@personal-agent/coding-tools`，`windows` 对应 `@personal-agent/windows-client`，`weather/research/feeds/mail/calendar` 分别对应同名 `@personal-agent/*` 包。不得从私有 src/dist 深层路径导入。
- `connectors[name]`：`{enabled:true, options:{provider,...包公开选项}, available(context)}`。主进程在已授权的配置下构造 `OpenMeteoProvider`、`OpenAlexProvider`、`HttpFeedProvider` 或凭据绑定 `QQMailProvider`。不读环境变量，不默认创建网络提供者；mock provider 被拒绝。`available` 必须检查实际宿主配置/账号许可，读取状态不得代替外部验证。calendar 当前只有 Fake，故仍不可启用生产。
- `workspace`：`{approved:true,options:{rootPath,...公开选项},available(context),read?:boolean,writeApproved?:boolean,apply?:{recoveryRootPath,powerShellPath,recoveryAccessVerified:true},commandApproved?:boolean,command?:{recipes,...}}`。写入和命令分别要求显式宿主批准，运行时仍经 Policy。恢复目录、可执行文件必须符合对应包安全校验；主进程实际核验恢复目录 ACL 后才可设置 recoveryAccessVerified，factory 本身不验证 ACL。批准标记仅可信 main 设置，不接受 Renderer 或云参数。
- `systemObservation:true` 开启聚合状态工具。Windows 任意执行不因此启用。
- `exports`：逐工具注入现有 `CompetitionToolExport`，必须有准确 name/version、policy version、同步 accepts 和最小化 project。默认空数组；不能用整个原始结果的透传策略代替出机许可。关闭后回调拒绝导出。

现有 synthetic `competitionCatalog.tool` 已占用 `workspace.read_text`。保留它时设置 `workspace.read:false`；切换到用户工作区必须同时替换对应 export/availability，不可注册同名不同根工具。

Desktop package 当前未声明 weather/research/feeds/mail/calendar/windows-client 依赖；由主代理在根装配授权范围内补充 workspace 依赖并维护锁文件。本模块不修改配置。

## 本树与可集成增量（2026-09-27 核对本地 Git）

- 当前树基线 `86f74b7` 已有 read/list/preview；现有可立即装配的业务公开工具为 weather.forecast、research.search、feeds.collect/subscriptions、mail.inbox/accounts。QQ 凭据由主进程注入。mail 的公开 register 不含 send，不能把 provider.send 私接为工具。
- `origin/main` 的 `f77b6f6`（PR #143）提供受限命令公开入口 `createWorkspaceCommandTool`；仅五个 coding-tools/模块文档文件，当前树尚未包含，可由主代理最小整合。
- 主代理 fetch 后确认 `origin/main@9c40a08` 已经通过 `5816785`（PR #147）包含完整 patch 写入链 `f28fc1d,c59534e,b70e495,79186dc,6c1070d`：stage、exclusive-lock apply、one-use authorization、helper-exit recovery。后续授权阶段已选择性整合到本树，保留 command exports，并修复 marker 创建失败后的 helper 退出等待；尚未提交。
- Windows Desktop 分支 `3f2edaf` 的 `windows-state-host.js` 与 `windows-notepad-host.js` 已实现专用宿主消费，但依赖 Runtime prepare/bridge/attempt-store/native-host 堆叠。其 Notepad 工具名 `computer.notepad.replace_text` 绑定观察目标、当前用户在场和审批任务；不能作为无目标的通用云执行工具。新 main 已合入 #182 Host prepare，Desktop 堆叠仍需主代理按完整依赖评审与定向集成。

## 验证与限制

定向测试：`node --test apps/desktop/test/product-tools-composition.test.mjs`。包含真实 weather 公开 register/真实 provider 构造（不发网络请求），以及显式测试 doubles 验证审批配置、动态可用性、mock 拒绝、关闭和失败释放。无云调用、设备读取、命令执行或私人数据访问；通过不代表真实业务闭环验收。mail/calendar 现有 register 未贯穿取消信号，持续账号 I/O 的取消属于提供者后续工作；不可宣称该路径已经验证停止。
