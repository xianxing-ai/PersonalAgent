# 新旧 MOD 接续（2026-10-05）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

用户要求按 #277 分工接续新旧 MOD、审核待审 PR，外部受阻时推进其他独立任务；最终停止前发送结果邮件。zemeng 串行集成槽 `.worktrees/review-277`，分支 `codex/dev-workflows-continuation`；续交原 #277，初始 head `1a2affa64d991640ca890b1f6196f3617281191a`，main 基线 `330be3862eb7ba9b50709ec8ac0c6292ff7829fd`。保留原作者归属与提交。

## 本轮改动

- 组合 #280（包含 #278）的 Runtime、P5/feeds/通知修复，以及 #281 unknown 补丁观察修正：保留原 marker，不记录未知终态，覆盖重复核实、SQLite 重启和后续 applied。
- 组合 #279 MOD-35 与 #282：源码片段限于原工作区的有界常规文件；仓库外绝对/父路径/file URL/符号链接不返回片段；真实 Node TAP 的堆栈、多行错误、嵌套 subtest、带空格路径正确定位。
- MOD-33/36：发表报告总是传入新的可选 `expectedBaseSha`，GhCliProvider 在 POST 前核对 head/base。复现修复前审批期间 base 漂移仍 POST 一次；修复后零 POST，Runtime 保守等待核实。GitHub 前置读取与写入仍非原子事务。
- MOD-34 Runtime：较大的 CI 共享预算不再触发 Review 32k 单次输出上限而阻止整个宿主启动。只限制 Review 输出，保留 CI 预算；64k 配置启动及审批恢复通过。
- 两项 Desktop 门禁失败来自 Linux 夹具兼容：Windows 路径夹具显式用 win32 basename；环境断言验证各平台白名单，保留 SECRET_TOKEN/GITHUB_KEY 拒绝条件。未放宽生产权限。
- MOD-38 文档/注释纠正为已授权 Local 工作流，不计入比赛验收。无 wire operation、数据库迁移、新依赖或锁文件变化。

## 验证依据

Node 24.15.0 / npm 11.12.1；锁文件安装 `npm ci --ignore-scripts --no-audit --no-fund`。不执行 Electron 安装脚本，不代表真实 UI/native helper 验收。

初始组合 `npm run check` 完成架构、契约夹具、生成一致性、全 workspace 构建/类型及测试，仅上述两项 Desktop 夹具失败；Runtime 306/306，其余 workspace 零失败。修正后 Desktop 完整 342 通过/0 失败/6 跳过，DEV-WORKFLOWS 66/66，根 integration 17/17。最终完整门禁结果见 PR 最新回执，不能把初次失败说成通过。原始本机日志在 `/tmp/personalagent-review/`，未提交。

## 队列与真实完成条件

| 工作包 | 已推进 | 剩余 / 继续入口 |
| --- | --- | --- |
| #278/#280、P5/P7/通知回归 | 已评审、缺陷交 #281、组合消费；保留 Fact review、TrackingGrant 与 unknown 回执断言 | 非作者审核新修复与组合 head、CI 终态、main 集成 |
| MOD-35 (#279) | 已评审、边界与真实 TAP 修正交 #282，定位器 9/9；组合消费 | Potatos498/goo122 非作者评审与 main 集成 |
| MOD-33/34/36/38 (#277) | 公开端口、生产组合和离线链已有实现；本轮恢复/配置缺陷已修正 | 受信 gh 凭据、真实模型、Windows helper；完成 Actions 修复、COMMENT、标签和 Issue 回链真实读回 |
| MOD-37 | goo122 负责；当前无待审实现 PR | 审核后续交付，不代写其目录或另造接口事实源 |
| P5 MOD-27/28、P7 消费 | 当前源码已有正式来源、私有 Fact 审核、Laya 与持久恢复；旧 #273/#275 已合入 | 真实本机/模型/来源变更和 AgentArts 联动；私人出机保持原生授权，不以 Fake 判完成 |
| P6 MOD-16/18 | 保留 Windows 控制、patch/受限命令与恢复；本轮修正 MOD-18 丢 marker | Windows 普通用户设备、目标确认/接管、PowerShell/helper 实际应用和读回 |
| MOD-17 / #116 | Desktop public host/main 已有生产注册；本轮真实 Linux node:os→Runtime/Policy/ToolGateway→confirmed 读回 | Windows 生产授权、Desktop 展示、AgentArts 同请求闭环；不关闭 #116 |
| P8 / MOD-29～32 | 组合源码、必要门禁与交付证据；Competition 默认组合不变 | 受信 AgentArts 配置、真实 deployment/API/trace/评估及本机统一验收；当前会话无 Windows 设备或受信模型/云凭据注入端口 |
| MOD-19、PA-018 | 保持此前排除 | Windows 打包安装及 TraceGuard 治理不在当前包 |

MOD-17 Linux 本轮回执：task `d9be4481-cad0-426f-9259-75047815b437`，run 后缀 `:system-read`；工具 `computer.system.observe@1.0.0`，source=node:os，审批前执行数 0；审批后记录 confirmed/allow/executionStarted=true，任务 succeeded。采样 `2026-10-05T07:47:37.009Z`～`07:47:37.261Z`，251.92ms。脱敏 JSON SHA-256 `fa0564194acdebd4bfa399e1e04371665c0b90fcbab28e5402c37b13db6a5c4c`；本机 SQLite/JSON 保留在忽略的 `.cache/mod17-runtime-*`。不含原始 CPU/内存值、设备身份或凭据；Windows、Desktop UI、AgentArts 验证均为 false。

GitHub 插件评审、发布和邮件发送是开发执行证据，不计作产品 GhCliProvider/模型工作流真实外部验收。非作者评审后才合并；整体 Goal 未完成，外部验收缺项不得抹去。

## 后续 P8 可信设置与前端细节（2026-10-05）

用户要求已交成果沿现有 PR 交付、不重复建 PR，等待审核时继续自己的 MOD/前端细节，所有执行对话使用 GPT-6.1 Sol，并确认已在界面选定。先核对 `MODULE_ASSIGNMENTS` §0 和 #212：Potato P0～P4、Gemini P5、goo122 P7/MOD-37 不接管；此增量限 zemeng P8 的 AgentArts 可信设置、对应控件及回归，已在原 #277 登记。保留 #283 独立 Runtime 初始化修复，不合并或自批准 PR。

- `agentarts-config.revoke` 原先吞掉文件删除错误，导致仍有磁盘配置时返回“已清除”。现在立即禁用本进程旧凭据；删除失败明确报未确认，脱敏状态保留错误。只有删除成功或文件已不存在才返回成功；修复存储后可显式重试。未变更安全存储格式、云绑定、环境配置来源或云端权限。
- AgentArts 设置保存/撤销互斥，等待期间所有输入和按钮锁定，重复事件不会额外调用宿主，旧 snapshot 不改写待处理目的地。只有 `configured:true` / `configured:false` 对应读回才显示保存/撤销成功；异常或不匹配回执为未获确认，不自动重试，不回显宿主错误。Authorization 在提交/撤销时清空，调用结束后再次清理请求对象。
- 真实文件删除失败回归在原代码报 Missing expected exception，修复后通过；临时目录中的保留配置修复后可读回重启，再次撤销确实删除，状态不再保留失败。控件回归覆盖并发去重、待处理 snapshot、脱敏、失败重试及不匹配回执。
- Node 24.15.0 / npm 11.12.1：AgentArts 配置/控件/模型页面和 Admin Evidence/撤销定向 11/11；Desktop typecheck 通过，完整 Desktop 测试 346 通过、0 失败、6 Windows 门控跳过。新增控件和宿主文件另执行语法检查，diff 检查通过。
- Browser plugin not available，使用已安装 Playwright + 本机 Chromium 151，不新增依赖。临时 HTTP 宿主加载真实 `mountAdmin`、AgentArts 控件和既有样式，合成 invoke 不连接 Electron/云端。1280×900、480×900 验证页面身份、有内容、无错误遮罩/控制台错误；保存→失败→显式重试→成功→撤销失败→重试成功，按钮/输入禁用、凭据清空及无横向溢出均通过。截图和临时脚本保留在工作区外 `/tmp/personalagent-review/agentarts-ui-*`；不是用户 Windows/安全存储/云连通验收。

#280 最新 `d484c864` 已由 goo122 消费 #281 原修复，并新增 controlled-clock 测试；没有重新实现这份增量或改写其作者。新 head 的审核/CI 与前一 head 分开记录，旧通过不能替代新提交验证。

## MOD-33 注入 Provider 的期限与取消

等待 P8 CI 时继续本人 MOD-33，范围已沿 #277 登记。公开 GitHubService 原先仅入口检查 context，随后直接等待 Provider；对忽略 signal 的注入 Provider，取消后迟到的读取/写入结果仍可确认，或永久等待。两个新增回归在原代码均 Missing expected rejection。现在复用既有 withGitHubContext 包装 Provider：读取超时/取消明确失败；进入写 Provider 后的超时/取消保守 unknown，工具入口转 RESULT_UNKNOWN，不接受迟到 confirmed、不自动重试；入口已取消/过期仍零调用。不把信号中止当成外部操作已停止，无新接口、权限、依赖、wire 或迁移。另用受控 Date/timer 验证永久等待 Provider 到期限必结束，写保留 unknown。README 同步可选 base SHA、当前用户验证授权和包装语义；无真实 GitHub 调用。Node 24.15.0/npm 11.12.1 模块 build/typecheck 和测试 13/13 通过，完整组合检查运行中，终态回写原 PR。

包含该 Provider 修复的 tree `58228388cbc26e641cec158a2bd597c17ae4ff3f`，本机完整 `npm run check` 退出 0：31 workspace 1644 通过、0 失败、45 门控跳过；Runtime 308/308、Desktop 346 通过/6 跳过、GitHub 13/13，根 integration 17/17，架构/契约/生成与全类型检查通过。日志 `/tmp/personalagent-review/p8-mod33-full-check.log`。后续新增选择器行为另做受影响验证，不将此旧 tree 的全套结果直接算作新 tree 的结果。

## P6/P8 原生选择器的迟到结果

继续按用户邮件推进自己的 MOD/细节，沿 #277 登记 `workspace-config-host` 及原测试文件。旧 host 在原生工作区/Node/检查文件/npm 选择器等待期间即使已 close 或 revoke，仍会落盘迟到结果；较旧的选择也能覆盖新选择。原代码四类关闭和撤销回归共 6 个计数均失败于 Missing expected rejection。现在入口拒绝已关闭宿主，等待返回后重新核对 active 与原 generation；关闭、许可撤销或另一项已接受设置变更均使旧选择失效，不落盘、不重新授权、不重开选择器。正常取消和有效选择行为保留，无新 API、IPC、存储格式或目录。

Node 24.15.0：宿主语法检查通过；workspace-config-host、workspace-command-config、coding-and-windows-acceptance 定向 39/39，含四类迟到选择、关闭后零重新打开、撤销失效、较旧选择不覆盖新确认及现有绑定/导出/命令路径。选择器和安全存储为明确合成端口，持久配置使用真实临时文件，Windows/设备/系统安全存储未据此验收。新 head Foundation 与已登记非作者审核分别回写原 PR，不自批准或合并。

## P8 当前配置投影与 P6 受信 helper 接线

AgentArts 模型只读页每次从当前配置快照投影 configured/keyConfigured，撤销成功及磁盘删除失败后都不再显示启动时缓存的已配置状态；始终保持 unverified，不以配置存在证明云可用。配置持久化后的启动异常与撤销异常也在 finally 发布当前快照，错误不假报成功。新增纯投影及真实删除失败回归，不改云执行或授权。

Desktop coding host 和 workspace config 补全既有公开 patch 工厂的可选外部 helper 参数；仅主进程受信环境 PA_CODING_PATCH_HELPER_SCRIPT 注入，不接受 renderer/model 路径、不自动复制或运行脚本。helper 必须位于工作区及恢复目录之外，保持公开工厂字节一致/链接限制，并固定 canonical identity；更改后不可执行。人工安装受审查的版本一致脚本及原生许可仍必要，配置 helper 不恢复写许可。两项 Windows 回归覆盖 canonical 传递、变更失效、根外限制、实际仓库根/公开工厂和持久 workspace 重启接线；本机 Linux 明确跳过，等待精确 head Windows CI。

当前 Linux Desktop 完整测试 356 通过、0 失败、8 Windows 门控跳过，架构 3/3；浏览器真实 Admin 挂载使用合成宿主，Chromium151/Playwright 在桌面及窄屏核对撤销后状态和删除失败原因，无控制台错误。Electron 原生运行组件和 Windows 设备不在此环境，未声称原生或云验收。

发布前发现协作者已将 #283 合入 #277 分支（cb51372）；接续以该远端 head 为父提交，保留其 Runtime 初始化清理及作者历史。本代理没有批准或合并。用户邮件确认真实验收可由其他协作者承担，当前执行继续源码交付，不把缺少设备视为全部工作停止条件。

## Windows fixture 定位的受载超时

24dcd034 PR CI 的第一次 npm ci 无诊断退出已重跑；第二次在新 helper 回归进入安全断言前，夹具额外 where.exe 子进程5秒超时，stdout 已有 PowerShell 路径。相同head push全套check通过。将此测试定位改为直接扫描受信 PATH 的现存 pwsh.exe，避免无业务意义的额外子进程期限；找不到明确断言失败，仍不跳过真实 Windows 测试。生产 executable/超时不改，canonical/字节一致/根外/变更失效/重启接线与许可断言全部保留。新精确head Foundation另验，不用旧head绿替代。

## 协作者真实模型与创建回执增量的边界回归

Potato d3e110c7/a2c9ee5 从真实验收反馈补充 JSON 围栏、查询30项边界以及模型长哈希复制错误：先保留严格提案结构和已读取路径限制，采用可信源快照哈希构造待审批补丁，apply 原 before-sha/oldText 校验不变；规范化不会授权未读路径。LGW 24dcd034 补充PR创建回执head复核，不匹配保守unknown并保留已返回的PR定位。保留作者且不双写源文件。

将此前工作区外5项行为回归固化到本人 ci-fix.test.mjs：有效围栏正常通过、围栏外说明和shell字段无patch、有界30项查询和目标缺失零模型/patch、错误模型hash使用可信读取hash与成功缓存不重放、未读路径仍拒绝。原15项完整保留，公开工作流测试20/20；GitHub最新build及14/14通过。这些是显式合成模型/ToolPort契约验证，不是实际GH/模型/Windows执行验收。真实整链由Potato在受信环境接续并回写原task/run/审批/执行Evidence。

## 最新真实验收缺项的作者接续与 P6 控件（2026-10-05 11 时）

重新读取 #277 最新全部评论发现 Potato `5992872339` 明确报告：真实 Actions/GLM 链走到 patch-0-0，仍 RESULT_UNKNOWN，且 DEV-WORKFLOWS 缺核实入口。这两项不能被先前 CI 双绿或一轮结果邮件抹去。Windows 原因定位继续交持有原复现环境的 Potato，要求脱敏原 task/run、底层 error、marker/核实状态，不删除 marker 或新建任务盲重试。

本次沿原 #277 精确登记本人 dev-workflows 源码/测试和 P6 controls/host snapshot。新增 `reconcileWorkspacePatchTask(taskId,runId)` 绑定原输入、授权执行记录、根/恢复/PowerShell identity 与可信 preview；unknown/in_progress 只观察，SQLite 重启不重复 apply。not_applied 先持久失败读回、后 ack；marker 缺失不能推断成功。apply 异常仅保存固定本地诊断类别，不泄露原始错误、私有路径或凭据。

**独立核心依赖仍未完成**：原 Runtime `reconcileToolExecution(applied)` 会终结整个任务，不能用于尚需验证/commit/push/PR 的中间 patch。已在 `5993147961` / `5993224076` 向唯一核心 owner goo122 提交精确 `reconcileToolExecutionForContinuation` 接口需求，本次不改 `apps/runtime/src/index.ts`。此方法须原子确认原 run/正常 apply 缓存，但保持 waiting_reconciliation，再由现 resumeConfirmed 消费。未交付时 applied 明确 UNSUPPORTED、保留现场，不伪报已完成恢复；正向整链待该接口及实际 Windows 回归。

P6 前端三个新增回归在原代码全部失败：项目代码许可缺命令前置、宿主许可不按读回显示、待装配目录仍可授权。现在项目许可依赖命令且不自动勾选；安全 snapshot 独立报告 authorizationAvailable/writeAllowed/commandAllowed，不输出路径；宿主读回更新勾选但保留用户未提交更改；pending 可访问状态、按钮互锁及无效回执明确未确认。相关 host/controls 40/40、DEV-WORKFLOWS runtime 12/12。

Browser 插件不可用，使用已安装 Playwright/Chromium 实际挂载 Admin worktrees 页面及原样式，1280×900 与480×900，检查前置许可、待装配、读回/未保存选择、重复提交、失败重试及窄屏无横向溢出，控制台无错误；桥接为明确合成宿主，不代表原生 Electron/Windows/云已验收。临时证据保留在 `/tmp/personalagent-review/workspace-ui-*`，不提交测试截图或私有数据。整体 Goal 继续 in_progress，不将本次增量当全部完成。

进一步核对本人新 MOD 找到并修正两项独立缺陷，均沿原 PR 登记精确文件范围：

- MOD34 的 `precommit-head-${j.steps}` 在每次暂停审批后换身份，真实 TaskRuntime/Policy 的逐项审批回归复现反复新 HEAD 审批直至 Persisted step budget exhausted，从未 commit。现在持久稳定该步身份，兼容旧 pending/cached 步骤；commit 实现仍在 dispatch 时核对实时 HEAD、文件指纹与真实成功验证回执，不放宽任何写入前置。新增完整逐项审批回归走到原修复 commit/push/draftPR/回链，模型/Git/账号端口均明确 Fake；Runtime+CI工作流33/33。
- MOD38 与已修 MOD34/36 的真实模型 framing 不一致：完整 json/无语言围栏分类原本 manual_review。现在仅解包完整外围 framing，严格 schema/原文证据/敏感筛查/置信度和审批不变，外围说明/额外shell字段/虚构证据零标签与修复。两项新增回归通过，Issue工作流20/20。
- MOD36 注入 ModelPort/ToolPort 忽略signal时可永久等模型，COMMENT取消后迟到confirmed还能覆盖预留unknown。两项新回归在原实现均失败。复用同包既有 withCognitionDeadline 约束读取、模型和发表；过期/取消入口零调用，写入中断保持unknown，不盲重发。Review15/15，Review+Issue+Runtime48/48。

以上不代表真实 Windows unknown 已定位或 applied 后核心恢复完成。自己的实现/前端交付与其他人的核心接口、人工评审和原生验收分开记录；等待期间持续核对其他可独立推进项，未接管业务/P5/P7/MOD37或 Runtime 核心文件。

## 继续核对后的兼容与配置修正（2026-10-05 11:45 UTC）

用户本人项目邮件明确允许 GPT-6.1 Sol 代理在既有归属内并行；两个代理分别修改互不重叠的本人文件，父代理串行提交/发布原 #277。没有接管 Runtime 核心或另建 PR。

- MOD34 旧格式 checkpoint 的 `inflight=precommit-head-N` 也须继承为稳定身份。此前只兼容 pending/cached，原 run 已确认仍可能换身份卡在核实。新增旧格式回归验证未确认时零额外调用，确认后只重放原 HEAD 回执，单次 patch/model/commit；CI 工作流21/21。
- 恢复适配器立即克隆端口观察及 acknowledgement，避免复用对象在第二次调用时把持久 not_applied 改写为返回 applied。ack 前回读持久观察、原执行及 core 回执，观察缺失/错配不清 marker；共享对象篡改明确冲突且无成功 receipt，持久原结果与重启恢复保留。三项新增回归，Runtime 组合16/16；applied 正向恢复仍等待 goo122 核心接口。注入端口若自行在 ack 中删除 marker，适配器不能撤销外部删除，不能声称可复原。
- P6 同目录重选 Node、检查文件或 npm 后，持久设置必须与本次启动已装配的全部输入一致才可授权/执行/导出；否则明确提示重启、禁用项目脚本。真实临时配置加合成 recipe 验证三种变更、取消/相同设置、旧 task 不复活以及重启后实际使用新输入；host+command 配置41/41。
- P8 AgentArts 运行时名先检查字符串类型再匹配现有正则。修复前缺字段、undefined/null/数字/数组越过校验进入加密，旧坏记录虚报 configured。现在非法保存零加密、零临时/最终写入，坏记录读回 unconfigured/runtimeReady=false、不返回 binding/凭据且原文件不改写；配置/控件/模型投影23/23。无存储格式或云绑定语义变化。

前一精确提交 `12c0c464` 的 Windows Foundation PR `37302787065` / push `37302778590` 均完成 success，两份日志各确认31 workspace1705通过、0失败、16门控跳过，Desktop366、Runtime315、coding-tools90、GitHub14，根 integration17、架构3、契约4通过，dev/protocol/runtime demo通过。该结果只覆盖前一提交；上述后续增量以新 head 的 Foundation 和登记非作者评审为准。针对性测试不是真实 Windows 普通用户设备、Electron/安全存储或 AgentArts/GLM/账号整链验收。

原子中间补丁确认由协作者 LGW 在 e509388f 交付、86d6569f 更新文档，沿现有分支保留作者实现；本次仅消费该核心提交，不自行改写 index.ts。仍需 Potato 原 task/run 的 Windows helper 首因及真实整链读回、当前 head 的非作者审核；整体 Goal 保持 in_progress。已查重并更新已有项目邮件自动化为用户接受的每小时检查，执行中读取本人新回复，真正停止通知后当前执行留守五分钟；平台启用回执不等于未来触发或原对话自动恢复已验证。

### 现有 #288 并行续接：MOD33 结算与 MOD29 字节快照

用户明确授权多个 GPT-6.1 Sol 代理在本人已登记范围并行，不等待评审才开发；
root 串行核对与交付，继续原 codex/dev-workflows-integration / #288，不另建任务或PR，
不自行 APPROVE 或合并，不接管 MOD37、Runtime core、P1/P2/P5/P7 的在途源文件。
外部原任务/真实环境验收不阻止其他独立源工作，也不以合成测试记通过。

MOD33 公开 Provider 的旧 Promise.race 在同步取消后立即 resolved 时仍接受成功结果，
同步推进时钟越过期限也仍成功。新增回归先复现，再加入结算后原 context/中断检查；
成功或拒绝结算两条路径都优先校验中断，避免同步取消后再抛错泄漏原异常作为执行结果；
没有中断的原错误对象保持原样。读取拒绝 CANCELLED/TIMEOUT，已经进入写 Provider 保持 unknown，注册工具为 RESULT_UNKNOWN，
不重发、不推定远端停止。操作同步抛错也给两个 race 分支安装处理器，清理监听器/定时器；
长期限在平台 timer 上界重设，不在上界就提前报超时。
GitHub build 通过；作者初验使用 Node24.19.0，root 用项目固定 Node24.15.0 实跑首版19/19，
独立复核发现拒绝路径遗漏后，最终作者用 Node24.15.0 重新 build 及25/25测试通过，
二者分开记录。没有真实 GitHub 账号写入或集中验收。

MOD29 公开 AsyncIterable/reader 响应允许 transport 复用 Uint8Array，旧适配器保存原引用，
两块 SSE 的 A/B 被后续写入覆盖成 BB。现在 aggregate byte 限额检查后复制当前字节，
保留已接收快照、既有协议与响应释放路径；两种公开 transport 回归先失败再返回 AB，
成功 reader release 一次、零 cancel。Coordination build/typecheck 和112/112测试通过。
这限定注入 transport seam，未证明默认原生 fetch 复用缓冲或真实 AgentArts 云缺陷。
真实 deployment/API/trace/评估以及 Windows unknown→verify→commit→push→PR→回链、
MOD36 COMMENT、MOD38 标签仍按原持有环境 owner 接续，不能据此完成整个 MOD/Goal。

交付期间 goo122 于14:46 UTC将 #288 的前一 head634870a0 squash 合入main d1fe5537，
该main的tree9906fed9与前一分支相同，未包含本次11文件增量。
依据用户已明确要求“前置分支后继续做到可交付Draft”，本次在同一原分支消费该main祖先，
保留历史后交唯一后继Draft；只包含本次新diff，不重复已合入的10文件，也不批准/合并PR。
同source tree完整 Node24.15/npm11.12 check：31workspace1772通过、0失败、49跳过，
根integration19/19、架构3/3、契约4/4、生成/全类型检查通过。新head Windows门禁另读。

### MOD34 公开工厂有界等待与最新协作者交付

规划最后核对又确认一项独立源码缺项：直接消费公开 runCiFix/createCiFixWorkflow 的注入 ModelPort/ToolPort 时，调用前后 check 不能使永久 pending 端口在取消/期限时结束。新增回归先复现原实现取消后仍等待；不把此问题描述为生产 Runtime 缺少 ModelGateway/TaskRuntime 保护。

现以操作局部等待约束公开端口，贯穿同一 deadline、取消及 options.now，长 timer 按平台上界重设并清理监听器。模型及明确 read 中断为 CANCELLED/TIMEOUT；已进入非 read/未知 metadata 端口后中断保留原 inflight、等待 Runtime 核实，不以中止等待证明外部操作停止。迟到 confirmed/模型 usage 不落成功 checkpoint，重复恢复零重发。未扩展公共 Schema/依赖/核心文件；CI32 + Runtime16 共48/48。

协作者新 main `31ffba6f` 已合入 #285 MOD09 消费与 #286 真实验收记录，接续保留作者内容、不接管返修或批准/合并。#286 的 MOD36 “闭环”明确限于真实 GitHub/GLM 的只读预审：两次46.8s/48.0s、8项真实变更行 finding，未 publish、零写入。COMMENT 发布、MOD38 标签、MOD34 patch 后完整验证/提交/PR/回链不能据此计通过。#286 原验收脚本未共享，本 Linux 不冒充独立执行 Windows/helper/GLM；作者核实入口/诊断交付后仍需持有原环境的 Potato 接续原任务。

前一 `fec8d4cf` push `37305051263` 已完整 success，31 workspace1727通过、0失败、16跳过；PR `37305057947` 首次 npm ci 无诊断 exit1、未执行检查，相同head push安装成功后仅重试失败作业一次，第二次安装成功，终态另读。该证据不能覆盖本次公开工厂与新 main 组合。
Runtime applied recovery now uses the core reconciliation transaction to persist the confirmed result while preserving the waiting workflow. The original Windows helper root cause and real end-to-end readback remain unverified.

消费核心与新 main 后，组合 build/typecheck 通过；CI32+Runtime16 共48/48，applied 在真实 SQLite 中确认原 run/cache，跨重启继续原审批至验证/提交/推送/PR/回链，apply与commit各一次（模型、工具与账号操作仍为合成端口）。新 main 的根 integration19/19，通过实际 Admin 双尺寸重新检查工作区与 AgentArts 设置，零 console 错误。前一 fec8d4cf PR第二次亦完成 success，与push两份日志共用的精确head31workspace1727通过/0失败/16跳过；原首次安装失败保留，新组合 Foundation另验。

### 原 unknown 的预览前置诊断

继续原 Windows 首因定位的源码核对发现 trusted preview、binding/candidate 校验及 intent 保存都在诊断 catch 之外：它们失败时 Gateway 仍保守 unknown，却没有固定诊断。三项回归在原实现确认 diagnostic 缺失、原授权执行 unknown、apply0；现 catch 覆盖前置至 apply，进入 apply 前只记录固定 preview 阶段/错误码，实际 apply 原分类保持。不会据此确认 not_applied、创建 marker/intent/receipt 或自动重放，原错误文本/路径/凭据不落诊断。

Runtime build及组合20/20通过，包括前置诊断跨重启、无 intent/result/readback、核实拒绝且零port poll/零apply，以及原LGW applied续接与独立快照/持久读回回归。此改动只让持有原环境的 Potato 可辨别失败阶段，不宣称已定位真实 Windows 原因；新精确head门禁及非作者评审继续分列。

### 新用户指令后的整套 MOD 续接

用户最新直接指令及已认证项目邮件要求跳过外部阻塞，整套做到可交付后接入，
不分段等待评审。前台已回具体阻塞邮件并恢复唯一发布槽，消费邮件续接已交的
`9da9f6b`：MOD34 宿主等待取消/期限与 MOD38 持久分类预算四文件；不重复实现。
继续沿唯一 Draft #290 和原分支，不自行 APPROVE/合并，不接管 Runtime core、MOD37 或 P1/P2/P5/P7。

- MOD34 原 Actions run/jobs 第一页、日志 offset0 漏掉后页失败/后段错误。
  现在在原 maxSteps/maxLogBytes/deadline 内最多4页列表、8个失败作业、每作业8段日志；
  首步原合法参数和 checkpoint key 保持，追加页/offset 使用稳定原运行身份。
  错页/不前进/错run拒绝；字符页上限遵守 MOD33 的65536，UTF8 byte预算按完整codepoint截取，
  没有读完时明确 truncated，不把省略部分或页上限称完整日志。
  现有 GitHub UTF16 slice 的页末半emoji被剔除并停止、不推进省略字符的cursor；
  原文本其余孤立代理拒绝，实际公开Provider切页回归与独立源码probe覆盖此边界。
- MOD36 默认 Git quoted 中文/非ASCII路径原先无法预审；现严格解析 Git C-style 字节转义，
  fatal UTF8 解码并保留父级/绝对/畸形路径拒绝。临时真实 Git diff 加公开 prepare/publish 回归；
  Windows 无法创建的控制字符文件只用明确协议夹具，不冒充 Windows 文件验收。
  GitHub 既有写端口不支持的路径保留只读finding，发表返回 unsupported、零新写意图/调用；
  既存 unknown/confirmed 回执与原run/auth校验优先保持，不放宽连接器路径规则。
- MOD38 原修复审批后 labels/updatedAt 漂移会改变 MOD34 委派输入，导致原链无法恢复。
  委派前保存精确来源，恢复保持原 fingerprint/PR正文，同时重新核实正文/state/敏感内容；
  旧记录缺来源且 metadata 漂移时保守转人工，不新建修复或重发 unknown。
  修复前读取采用持久 generation/预算预留，pending审批复用同一读取身份；实际委派后才
  开始下一次新鲜读取，不重用原已confirmed缓存，也不每次恢复换ID造成审批循环。
  未获原unknown核实仍零read/零delegate。真实SQLite原缓存反例先失败，正常metadata变化
  恢复同委派输入/单次执行；关闭或正文改变只读后拒绝，不继续旧修复。
- 原 `listIssues` 没有应用调用者；新增可选 Runtime `issue_list` 请求直接复用此公开入口，
  原页走审批/SQLite 恢复、零模型/副作用。可信宿主按页读回显式选择 Issue 并用稳定幂等键提交
  既有独立 `issue_triage` task；不增加调度器、整页修复循环或改变 Competition 默认入口。
- P6 Node/npm recipe 动态 available 保留到宿主：身份/输入失效时 snapshot、Competition
  可用性与项目授权前置一致拒绝，零 factory 执行；保留读取和其它独立能力。
- P8 先验证/规范化网关再保留同实例已有凭据，等价HTTPS默认443/大小写/末尾斜线不误报换实例；
  异实例/非法endpoint/非字符串凭据仍拒绝，不改变受信 readAuthorization 精确绑定。
  控制页随新宿主 snapshot 更新状态 reason，save/revoke pending 与未确认失败提示保留优先级，
  不再永久展示第一次“未配置”；原控件/布局/玻璃保持。小型真实 Chromium DOM fixture 验证
  状态推送、pending、失败/重试和凭据清空，无console错误，仍明确使用合成宿主。

新增真实 SQLite close/reopen 组合覆盖 MOD38 分类一次、原内容 label 一次、同timestamp正文改变
零label，以及中文 Review 每次审批重启仍 model/COMMENT 各一次。工具/模型/账号明确合成；
这比单独 JSON/new-factory 验证补充了实际持久宿主证据，仍不是原 Windows/GitHub/GLM/cloud 验收。
MOD38 中文/混合标签四类夹具通过只证明契约，不是未给阈值的真实分类准确率评估。

本节1839项验证时，“修复PR链接回写原run”仅交付PR中来源run URL，GitHub Actions run本身
没有已登记评论端口。后续已在本清单“自主推进的可选源提交修复关联”交付neutral sourceSHA
CheckRun的明确opt-in底座与消费；仍不是原run页面评论，不使用commit-status或success替代。
当前默认来源引用不计原run反向回执，真实Checks权限/写入读回仍待对应原场景验证。
原 unknown/Windows现场/COMMENT/label/完整Actions修复及云deployment/API/trace仍由原owner验收，
不妨碍本轮独立源码和必要组合接线；整体Goal保持进行中。

本节整套 Node 增量最终完整 `npm run check` 已实跑通过（Node 24.15.0 / npm 11.12.1）：
31 workspace 1839 通过、0 失败、49跳过；根 integration 19/19、
architecture 3/3、contracts 4/4、生成一致性、全 workspace build/typecheck 通过。
MOD34 CI 53、MOD36 Review 21、MOD38 Issue 38、Runtime DEV-WORKFLOWS 28 的定向检查
与独立源码/SQLite复核覆盖上述新边界。原初次完整检查因发现 UTF16 页尾缺陷被主动中止，
未计通过；修复冻结17个文件后才运行这次最终检查。`f7e0c4c` 阶段 MOD16 的 C# 增量不在
npm 检查范围内，需单独 .NET HostFixture 证据，不使用该阶段 Foundation Node 绿灯代替。

旧 MOD16 的独立源码核对还发现 Host 的慢 UIA/元数据查询后缺少期限复核，可能返回已过期
`observed` 或 `ready=true`。四个 Host 文件在 #212 登记后继续实现：观察/解析用同一生产
lease helper 在查询前后复核，ready 用生产 helper 在解析后核对请求 deadline 和目标 expiry；
不续期、不授予权限、不读正文、不改变真实 UIA 默认路径。正式 Runtime adapter 原本也会
复核期限，未证明其正式路径发生越权写入。HostFixture 增加受控时间和合成元数据的生产
helper 回归，但本 Linux 无 .NET，官方 SDK metadata 经现有代理 CONNECT 403，未绕过；
只完成独立源码审查及 diff 检查，C# build/run 明确待验证。已在 #212 向原 Windows owner
goo122/Potatos498 交精确 HostFixture build/run 命令；该 fixture 不等于真实 UIA 设备验收。

继续核对发现可独立提供验证入口：现有 Desktop `node --test test/*.test.mjs` 会发现
Windows 专用测试。已在 #212 登记新 `windows-host-fixture.test.mjs`，不用修改他人负责的
根 workflow/package/lock，即可在后续 Windows Foundation 构建并执行原 HostFixture。
测试发现并固定已安装的稳定 .NET8 SDK，所有项目引用用独立临时 artifacts/CLI 目录，
运行实际 runtimeconfig 旁的 DLL 并核对原完成标记；Windows 缺 SDK、编译/fixture 失败、
超时或缺标记都会失败，不以环境原因跳过。Linux 定向运行明确1项平台跳过，语法、diff和
独立只读评审通过；Windows 实编译/运行结果须按新 head 日志另记，尚不预记成功。
临时产物仅清理该测试所有目录，不在源码生成 bin/obj；此受控验证仍不等于真实 UIA。

上述 Windows gate 已在 `6b6569a7` 的两份实际 Foundation 日志确认通过：push
`37353599315` / PR `37353609453`，均首次 success，各31 workspace1875通过、0失败、16跳过。
Desktop434，Runtime330；根integration19、architecture3、contracts4通过。
实际稳定 .NET8 构建并运行 HostFixture 的完成标记已核对，分别约25.3秒/31.0秒。
这补齐前述旧 Host 期限修正的 C# 受控编译/运行证据，未补齐真实普通用户 UIA/设备验收，
也不覆盖下述尚未交付的新源码。

### 用户要求不等待评审后的新独立实现

已认证用户邮件要求继续完成明确归属自己的工作到可交付，再由协作者在接线时审批/合并。
当前前台持续实施，不因外部验收等待而停止；唯一交付仍为原分支和 Draft #290。
精确文件登记见 #212 `6000691613`（P6）、`6000706716`（P8）、`6000802518`（MOD34）。

- P6/MOD16：慢 UIA 元数据查询后可能前台/窗口所属进程已变化，旧 lease 只再检查时间。
  在 Observe/Resolve 共用的生产 helper 中加入查询前后身份复核，各次绑定 Process handle，
  核实前台 HWND、所属 PID、开始时间、存活与受信 Notepad 身份，再核对原 expiry。
  不激活窗口、不读正文、不续期。受控夹具覆盖窗口/PID/开始时间/退出/异常/检查自身耗时，
  并经生产 CheckTargetReady 组合保留 TIMEOUT 优先级；真实 Win32/UIA 并非原子快照，
  仍有检查之间的小窗口，不能宣称已复现物理 PID 复用或消除所有竞态。
  当前增量需要新 head Windows C# 编译/fixture，不能沿用 `6b6569a7` 证据。
- P8：已保存后继续编辑时，旧提示仍显示已保存，下一次宿主状态也会覆盖未保存提示。
  现在保留 pending/未确认/错误优先级，脏编辑显示未保存并注明当前已保存配置状态。
  两个回归在旧源码失败，新控件7/7通过；真实 Chromium 在1280×900和480×900核对
  保存/继续编辑/重复状态/错误/重试/撤销，零console/page错误、无横向溢出。
  桥接明确合成宿主，不代表真实 Electron/云验收；CSS、材质及HTML布局未改。
- MOD34：原 ci_fix 需要已知 runId，规划中的失败 run 发现没有调用方。
  新公开 createCiRunDiscoveryWorkflow / CiRunListRequest / CiRunListResult 与 Runtime ci_list
  读取固定 failure 的一页，最多30项。只通过 AgentToolPort，沿原审批/预算/持久恢复，
  无模型/Git/工作区依赖；可信宿主选择后提交独立 ci_fix，下一页也显式提交。
  不自动轮询、调度子任务或新增 wire/default Competition fallback。
  列表与修复公开接口仍 provisional，必要类型/SQLite/全 check 与新 head CI 结果后续实记。
- MOD36 消费：publish=true 在后续 finding 的 unsupported/pending/unknown 时原公开结果
  覆盖 report，只剩发表状态，虽私有 checkpoint 有预审意见却无法从 readResult 展示。
  新增两个finding的三种受控 SQLite/Fake Gh 场景先全部复现丢失报告；现在保留 report、
  发表 index/总数/已confirmed索引，以及准备与此前评论Evidence。
  pending重启不重复模型或首条评论，继续原审批只发表第二条；unknown原执行仍须核实。
  Runtime组合33/33、MOD34 discovery30+既有CI53共83/83；尚非真实账号COMMENT验收。

本节12路径源码冻结后已完整执行 Node24.15/npm11.12 `npm run check`：架构3、契约4、
生成一致性、全build/typecheck通过；31workspace1876通过、1失败、50跳过。
唯一失败为此前同症状 P1 `calendar/test/cloud-business.test.mjs:88` 的超时错误码
EXTERNAL_FAILURE vs TIMEOUT，未修改该模块，已在 #212 `6001147118` 交 Potatos498 原owner。
本人coding-tools153通过/15跳过、Desktop425通过/11跳过、Runtime335通过/0跳过。
因workspace失败而未进入的根integration另外实际执行19/19通过；整套check仍exit1，
不能称全绿，不通过重跑或改他人断言隐藏失败。新head Windows Foundation另验。

每次通知保留至少五分钟回复机会，期间继续独立实现并读取新邮件。
账户额度工具未提供读取入口，不能将内部上下文预算冒充账户剩余额度。
原任务 unknown、真实 GitHub 写入及 UIA/云验收仍交原持有者；不计为通过、不接管其源文件。

### 自主推进的可选源提交修复关联

用户后续已认证邮件要求按自己的实现判断继续，协作者睡觉期间不等审批，
先把明确归属源码做到可交付后让其他人适配；停止时间为北京时间2026-10-06 08:00。
上一12路径已沿原Draft290交付 `07e8a60`，API tree `b82ceae5` 与冻结本地树一致，
没有重复PR、强推、APPROVE或merge。下一增量仍沿原分支，精确槽见 #212
`6001054237` / `6001134263`，不接管P5/P7/MOD37或Runtime核心。

本人MOD33新增可选 `registerGitHubRepairLinks`，默认原13工具不变；显式注册才增加
actions.repair.link/get。写入绑定原runId/runAttempt/sourceSHA/repairPR/head和原稳定
tool runId的SHA256，先核对当前原失败运行及open PR，再创建全新固定独有名字的
completed/neutral Check Run，details_url指修复PR；读取同一新ID核对全部固定字段才confirmed。
不修改旧CI、不用success或commit-status fallback，不称原run页面已写回。
需要Checks(write)、新工具exactargs审批及实时presence，旧PR许可不推导权限。
POST进入后响应、取消/期限、解析或读回不确定均保守unknown，不自动再POST。

MOD34可信宿主opt-in sourceRunBacklink后，在原PR/评论后追加稳定步骤，共用原预算、
审批和核实缓存。未配置时旧identity逐字节保持，成功reason准确描述PR引用原run/issue；
配置缺端口零修复副作用，issue-only无run拒绝。confirmed sourceRunLink严格核对公开
GitHubRepairReceipt完整identity、CheckID、官方名字、neutral状态及同repo URL。

Runtime githubRepairLinks=true显式装配，独立注册不dispose共享provider。
ci_link_readback由宿主显式提交known CheckID+原identity，单次只读仍需自己的审批，
结果checked/receipt不自动确认另一任务或授予写权，不查列表猜ID。
registered RESULT_UNKNOWN仍为固定错误；后续同步observer增量允许受信Runtime保留
合法partial CheckID候选。无ID或保存失败仍保持等待，预读/POST非原子窗口明确保留。

固定Node24.15/npm11.12：GitHub89（旧25+新64）、CI83+发现30共113、Runtime38通过；
新Runtime覆盖默认13/opt-in15、provider只dispose1、原knownID审批SQLite跨重启，
CI关联写独立审批/原执行hash/confirmed与unknown重启后无model/patch/commit/write重做。
独立只读复核另跑GitHub新64、CI关联30、Runtime新5通过，没有实质新问题。
这些为明确Fake/合成Gh/SQLite受控证据；真实Checks权限/外部写入、原Windows/云验收未计通过。
整套check与新head Foundation结果随后实际读取，不沿用上一head或定向测试冒充。

本节15路径冻结后完整 Node24.15/npm11.12 `npm run check` 实际 exit0：
31workspace1976通过、0失败、50跳过，GitHub89、coding-tools183、Desktop425、Runtime340；
根integration19/architecture3/contracts4、生成一致性、全build/typecheck通过。
上一轮P1日历同源码此轮44通过，此前超时错误码失败证据和owner交接仍保留，
没有修改日历或将偶现问题宣称已修复。上一交付 `07e8a60` 双Windows Foundation完整日志
各1913通过/0失败/16跳过，新P6身份代码真实.NET8编译/fixture通过；
此新关联源码待新head Foundation，不用上一Windows证据替代。

### 原未知关联的已知 ID 提示

沿现有 PR290/分支第三小增量，精确7路径登记 #212 `6001564764`，不新建任务或接管他人文件。
GitHub optional register 增加同步 observeUnknown；先校验合法 unknown，传入克隆原输入、
候选结果及原 ToolContext。异常、保存失败和误用 thenable 不等待、不改变固定 RESULT_UNKNOWN。
Runtime只保存原审批执行/journal/hash绑定的候选正整数ID和原参数，不保存provider任意URL或文本。
原 waiting_reconciliation 的 readResult 返回 unverified sourceRunLinkHint，完整 input 可明确
提交独立审批的 ci_link_readback。原执行无确认、不重POST、不自动GET或跨任务安装缓存。
缺ID、非法输出、保存失败/冲突、task/run/version/digest/journal绑定变化、取消不产生提示。

受控验收使用真实 GhCliProvider + 显式合成 transport 和 SQLite：原POST成功返回11，
首次GET失败留unknown，重启保留候选；独立新读任务审批后GET成功，累计POST1/GET2，
原任务仍 waiting_reconciliation，model/patch/commit各1。不是实际账号Checks权限验收。
GitHub完整96/96（新增observer7）已通过；Runtime与全仓检查及独立复核按实际结果续写。

第三7路径冻结源码完整 Node24.15/npm11.12 check 已实际 exit0：31workspace1990通过、
0失败、50跳过，GitHub96、coding-tools183、Desktop425、Runtime347；根integration19、
architecture3/contracts4、生成一致性、全build/typecheck均通过，冻结文件验证无变化。
原未知候选/明确读回/保存失败/实际冲突/缓存伪hint/取消标记定向7/7，非作者独立复核14/14。
独立复核发现的既存缓存hint绕过及unknown取消仍等待核实的cancelRequested展示问题已修复，
原失败断言保留、不改core状态；候选/展示不能成为授权证据。

上一交付59c366b PR Foundation37363569744/job111943509757当前success，实际完整Windows
日志2012通过/0失败/16跳过，.NET8 HostFixture真实构建运行约31.9s；push37363562899
run终态failure、job111943488439 cancelled且无steps，日志404 BlobNotFound，根因未证。
不将取消路径计绿，也不拿该上一head的成功替代第三源码新head Foundation。

goo122 Draft289 current5da274f已完成非作者只读审核，原PR评论6001841433交回证据，
无新增实质问题：隔离精确head Runtime6/6、两集成5/5，精确base错误码probe复现running遗留，
head持久failed/EXTERNAL_FAILURE/task.failed。MCP官方stdio与SQLite真实、资料/HTTP/确认Fake；
不算真人私人许可、原生交互、真实云或MOD09完成，未接管其source/APPROVE/merge。

### 本人模块说明事实校正

#212 `6001886824`登记4份本人MOD33/34/36/38说明及本清单，沿同一PR290续交：
初稿禁止构建/测试的约束明确保留为当时历史，当前source2eda73d完整check证据已关联；
MOD34运行/Job每页30最多4页、日志offset有界续读及共享UTF8预算与源码一致，
明确默认PR来源引用与opt-in中性Check关联、发现/选定独立任务与未知候选读回边界。
MOD36中文Git转义路径及报告/发表进度保留、MOD38原委派与缓存代际恢复说明同步。
模块维持review/provisional；Fake/CI不升级真实权限/设备/云验收，Local链不强制AgentArts。
仅校对source和相对链接、git diff --check；无source变更，不重复构建或测试。

上述5份说明沿原 Draft290 交付 `734e2fd`，其生产源码与前一 `2eda73d` 一致。
`2eda73d` 两次 Foundation 首次成功的完整 Windows 日志均已实际读取：
PR run37366157900/job111951731083、push37366150093/job111951705739，
各31workspace2026通过/0失败/16跳过，.NET8 HostFixture实际构建运行约25.4s/57.7s。
这覆盖该源码的受控 Windows CI；不等于真人UIA、真实账号Checks或原未知任务核实。
docs-only `734e2fd` 和下列新源码的 CI 另核对准确head，不拿该证据冒充新head门禁。

### MOD34 Git 路径与 stdout 字节保留

同一 PR290 的4路径登记 #212 `6002024053` / `6002153136`，仅 git-tools 实现、
其测试、MOD-34-GIT-TOOLS-01 与本清单。旧实现分块解码导致合法中文 root 被替换字符
破坏；真实临时 Git 仓库 `中文工作区 ` 的末尾空格也被 `.trim()` 丢失并产生 ENOENT。
合成stdout另复现非法 UTF-8 被接受。原失败证据保留，不修改断言隐藏错误。

stdout 维持原1 MiB字节上限，正常退出后一次严格UTF-8解码且保留BOM；非法编码
固定失败，push/update-ref仍保守unknown，超限仍中断并RESULT_UNKNOWN。
root只移除单个LF/CRLF输出终止符，保留合法目录空格。无公共端口/版本/授权/index-CAS
或依赖变化，没有使用真实凭据/远程账号写入，没有盲目重试。

固定Node24.15/npm11.12 coding-tools build/typecheck及完整模块测试实际exit0，
187通过/0失败/15平台门控跳过，Git19/19；真实临时Git仓库+逐字节合成stdout各按
证据性质区分。另实际Node子进程显式合成Git输出在中文UTF-8中点分块，旧实现ENOENT，
修复后公共head返回确认结果。按AGENTS模块内部改动门槛执行受影响模块检查，
未将上一完整check或上一Windows结果冒充此增量的完整检查；新head Windows另读回。

### MOD36 含空格 Git 路径头

本人4路径登记 #212 `6002238962`：code-review实现/测试、MOD36说明及本清单。
实际临时Git repo的正常 `with space.ts` diff在未quoted路径头末尾附tab分隔符，
旧公共codeReviewChangedLines抛INVALID_ARGUMENT导致准备预审失败；旧实际Git探针与
新增3场景2失败/1负例通过的日志保留。仅剥单个未quoted头末尾tab，不trim合法空格，
不放行剩余内嵌tab/时间戳/畸形quoted/NUL/父路径，不变更head/base锚定、publish限制、
缓存/审批/unknown边界或其它P5 cognition文件。

固定Node24.15/npm11.12 cognition build/typecheck及完整模块测试实际exit0，204/204，
0跳过。真实Git中间/开头/末尾空格（真实末尾空格文件Linux限用），rename/delete左右
定位、非法分隔符回归通过；注册GhCliProvider+明确合成transport使用实际Git spacediff，
报告与唯一POST payload保持精确path。独立GPT6.1Sol只读复核无实质问题、diffcheck通过。
按内部模块门槛验证，不重复整仓check；真实账号COMMENT/设备闭环和新head CI另验。

### P8 工作区等待与未确认反馈

本人P8两源文件+本清单登记 #212 `6002252542`（已校正实际src/app路径），
GPT6.1Sol代理唯一实现 workspace-controls.js/test，root串行交付。旧render的后台snapshot
会抹掉仍busy的等待提示及失败/畸形回执的未确认提示，新增两回归实际失败，执行工具回执保留。
原旧/新5项定向测试没有另存独立原始日志文件；浏览器JSON/截图与后续完整CI日志分别保存。
现仅在无pending/未确认反馈时采用宿主reason；宿主字段/许可投影仍更新，busy仍互锁，
显式成功读回后清反馈并解锁，异常内容不回显、不自动重试、后台快照不代替原操作确认。

固定Node24.15目标5/5、源码语法与Desktop typecheck通过，独立只读复核5/5和相同冻结
hash无实质问题。真实app/index+renderer+Chromium151、明确合成桥接在1280x900/480x900
验证等待+推送/字段刷新/重复按钮/明确读回/异常/畸形/显式重试/未配置读回及正常reason，
console warning/error/pageerror均无、无页面横向溢出。未改样式/其它UI/宿主授权/共享main，
原生Windows选择器/安全存储和云仍待真实环境验收，没有以此重复全Desktop/全仓测试。

同包保留MOD34 Windows夹具返修 #212 `6002331612`：`d3426af` PR Foundation
37368733314/job111960198816实际failure，完整301510chars日志已读，31workspace
2026通过/4失败/16跳过，coding194/4/4；四新增Git测试因8.3 TMP别名严格cwd比较和
Windows尾空格目录cwd失败，未到相应UTF8断言，旧正常Git测试仍通过。夹具建立后用
realpathSync.native固定与生产相同canonical根，Windows实际repo用合法中文内部空格，
Linux保留原尾空格case；不跳过中文/超限/非法编码、不放宽cwd/HEAD/调用序列断言。
生产Git源码本轮无新改动，修正后本机coding完整187/0/15、独立只读复核无实质问题。
该失败与之前成功head分别记录，当前包准确head Windows结果另读回，不能预记通过。

本人组合说明顶部“公开入口计划/静态交付待集中验收/集中整合exports后”已按实际
apps/runtime package export和上述SQLite/模块检查校正，不改公开接口或默认Competition。
状态仍review/provisional，协作者真实只读报告与账号写入/原Windows整链分别标注。
仅事实/相对链接/diff检查，无source变化、无重复build/test；不修改根配置或共享ROADMAP。

### 最终受检源码与非作者交接（2026-10-05 21:04 UTC）

以上Git、Review和P8源码/测试沿同一PR290交付 `be49b3065e811e50f6628db12306d591748eb805`；
随后两份组合说明事实校正的 `90f02d08cc03e4fc6b185cf7e930cb30d9060ad8` 源码/测试与其完全相同。
准确 `90f02d0` 两路Windows Foundation完整终态和日志均已实际读取：

| 事件 | run / attempt / job | 完整日志字符数 | 31 workspace测试 | 实际.NET8受控fixture |
| --- | --- | --- | --- | --- |
| push，首次 | 37370606148 / 1 / 111966496367 | 318219 | 2035通过、0失败、16跳过 | 48.05秒 |
| PR，唯一一次基础设施重试 | 37370612132 / 2 / 111973026542 | 319063 | 2035通过、0失败、16跳过 | 40.00秒 |

两路check、dev、demo:protocol、demo:runtime及清理步骤均success；coding198/0/4、
cognition204/0/0、Desktop439/0/1。之前四个新增Git回归全部通过，MOD36/P8新增回归通过。
这证明该冻结源码的受控Windows兼容性，不是原账号push/COMMENT、原设备UIA或云验收。

PR首轮37370612132/job111966517289仍为run failure/job cancelled，runner_id0、steps[]，
未执行测试、日志404 BlobNotFound；源码be49两路同样未分配runner即取消，根因未证。
只对当前PR无runner一路重试一次，不将取消计绿，也不删除d342/ba0先前夹具失败证据。
旧docs734 push37367178618长时间停在dev，普通cancel后终态cancelled，不计成功、不改Git refs。
额外Linux实际TMPDIR别名探针旧stdout夹具0/3、新canonical夹具3/3；此Linux探针本身
不证明Windows8.3，Windows兼容证据以以上实际runner日志为准。

#290已转ready for review，正式请求goo122与Potatos498并读回确认；没有APPROVE或merge。
goo122负责MOD33/公开接口非作者审核，Potatos498负责MOD34/36/38审核及原场景集中验证。
目前已登记本人源码增量均已交付，独立范围审计没有额外已复现源码缺口；反馈有新问题时
沿该PR返修。整体Goal仍in_progress，MOD仍review/provisional，不能由CI绿灯改成done。

真实验收续接保持原可信现场：Potatos498或原Windows任务持有者核实patch-0-0的原
task/run/intent/marker，再verify→commit→push→PR；缺intent不得回填，不新任务盲重发。
P6原设备持有者验证窗口/进程隔离、接管、取消、普通用户权限与未知恢复，P2原设备负责人
验证DPI命中。原GH/GLM账号持有者核实COMMENT/标签及Checks(write)外部回执；独立
neutral source-SHA Check不能称为原Actions run页面评论。zemeng原可信AgentArts会话
完成deployment/version/API/trace/usage/eval/角色/成本读回。原始脱敏证据未回交的不计通过。
MOD37保留goo122实现归属，MOD19打包继续暂停，不因等待而接管其它模块。

本次只是三份本人说明的证据与交接回填，源码/测试仍等于上述受检90f02d0/be49b30；
校对日志、链接和diff，不重复build/typecheck/test。文档提交自身的Actions终态另读回，
不把上述90f02d0终态宣称为不同head的结果。

## 2026-10-06 主线集成与继续执行

用户当前聊天恢复执行至北京时间2026-10-06 21:00，并明确允许多路GPT-6.1 Sol。
本人13:12邮件进一步允许新独立增量建立后续PR，覆盖此前只能沿已合并PR交付的限制；
13:31邮件要求继续寻找归属明确的工作。文件归属、不自行批准或合并、真实验收等级保持。

### 已合入成果与原现场报告

#289已于01:10 UTC合入；#290最终head `e4ef11d9437b388ea08282e0eb85cdcd6f09ae20`
由Potatos498非作者评审 `5422708048` 后于01:17 UTC合入，merge commit
`7cbff653e71ed708ca6eee23ef77aabc384a87b2`。本执行没有APPROVE或merge。
随后main为 `1e5566d67e364fd6c056210eb50fc418ebc9c55c`；本隔离工作树非破坏合入
main，保留所有作者与本地历史，没有reset/force或改写Runtime核心。

#291（Potatos498，head `d911e561b8bcf1d9a1a3d327ce6e056fed44a952`）是明确不合并的
Draft验收产物。公开失败run37400194940/job112065422685确为父提交0eb4fc8的类型错误；
父子修复只将验收锚12345改成字符串，两路37400883784/37400892725均success。
原现场报告patch、tsc与commit confirmed，随后push unknown，核实not_performed后人工
push和建PR；公开CI不能证明自动push→PR→backlink confirmed，也不能补造旧task/run
的intent/marker。脱敏审批、执行、核实回执及验收文档新旧结论冲突已沿原#291交原作者。

共享ROADMAP的MOD16/17未启动、MOD18写/命令未交、MOD35待集成及MOD34仅到patch
陈旧文字已在#212 `6009833031` 交唯一台账写入者；本清单不改共享台账或Potato验收文档，
不将旧文字当新增源码任务。MOD37仍goo122实现、本执行评审，MOD19继续暂停。

### P6/P8 权限草稿与当前生效状态

本人两文件槽#212 `6009683212`：workspace-controls.js及对应测试。实际app DOM复现
已授权写入时取消写勾选，仅形成草稿，但页面仍显示已授权且没有未生效说明。
现在立即提示选择尚未生效，保留宿主当前能力和reason；等待及未确认反馈优先，明确
成功读回后清草稿，再编辑重新提示。没有自动authorize/revoke，不改变宿主权限。

交付原分支 `519b207f616959ab079debc25c6b8a0471427b6b` / tree
`cb50647e4fda6e540ddf0ac01722864dc169beaa`，父main1e5566d；API树等于本地受检树。
用户允许后建立唯一后续#293，两位正式非作者审核请求保留，未自行批准或合并。
Node24.15新行为回归旧代码5通过/1失败、修后6/6；独立只读复核6/6，Desktop完整
428通过/0失败/11跳过，typecheck、源码语法及diff检查通过，失败原始日志保留。
Browser插件不可用，已有Playwright/Chromium151加载真实app/index与renderer、明确
合成宿主桥，1280×900及480×900验证草稿、取消cloud、背景快照、等待、畸形回执、
显式重试与再编辑，无console/page错误或横向溢出，不冒充原Electron/Windows或云验收。

准确519b207的两路Windows Foundation均首次success、零重试，完整日志实际读取：

| 事件 | run / job | 完整日志字符数 | 31 workspace测试 | 实际.NET8受控fixture |
| --- | --- | --- | --- | --- |
| push | 37416771757 / 112117009414 | 319155 | 2037通过、0失败、16跳过 | 26.09秒 |
| PR | 37417487233 / 112119218065 | 320264 | 2037通过、0失败、16跳过 | 26.72秒 |

两路check/dev/demo:protocol/demo:runtime及清理均success；Desktop440/0/1、Runtime348/0/0、
coding198/0/4、cognition204/0/0，新增草稿回归实际执行。日志、JSON、截图与冻结哈希保留
在忽略的review-evidence/20261006及临时review目录。后续不同head的CI另读回，不复用这些
结果冒充新head。整体Goal仍in_progress；非作者审核、main集成和原场景验收分开记录。

### 本人 MOD33/36 与 P8 进一步缺口修复

按13:31本人邮件继续找工作，四路GPT-6.1 Sol先复现再分别登记唯一文件槽：
#212 `6010070792`（MOD33/P8）、`6010080647` 与 `6010104749`（MOD36及本人说明）。
root唯一负责文档和串行交付，未接管MOD35、MOD37、P5/P7、业务或共享根文件。

- MOD33：实际Node子进程、明确合成GH transport的非法UTF8被旧runner静默替换，
  公共issue读取接受损坏正文，写POST回执甚至仍confirmed。完整有界stdout/stderr现
  严格UTF8解码、保留BOM与跨chunk字符；取消/期限/超限优先，错误固定且不回显raw。
  Provider已派发写入继续unknown、只一次POST、不自动重发。只runner及新增模块测试，
  README说明同步；原7项回归3通过/4失败保留，修后GitHub完整103/103、build/typecheck
  通过。独立只读7/7及额外实际子进程不完整UTF8后TIMEOUT优先探针通过。
- MOD36：真实Git rename的LEFT删除行之前锚到旧文件名，导致合法新路径意见丢弃；
  现在两侧采用当前PR文件名，LEFT仍旧行号，纯删除回退旧路径。第一方Microsoft GitHub
  扩展固定源码依据见模块说明，没有执行真实COMMENT。正式public exports旧回归2/2
  失败保留；另实际Git中文加空格quoted头后合法单tab被拒绝，现仅剥一个分隔符后继续
  原严格解析。旧错误rename与quoted单tab断言明确校正为真实格式；双tab、时间戳、
  malformed quote、非法UTF8/NUL/traversal防线保留。最终cognition207/207、build/typecheck
  通过，独立定向15/15及多rename/escaped tab/尾空格/纯删除探针通过。合成GhCliProvider
  验证当前新路径、LEFT旧行号及缓存仅一个POST，不算真实账号写入。
- P8：AgentArts输入Enter保存或按钮撤销，在busy禁用后失去原键盘焦点；settlement现
  仅当前focus仍body、面板与原控件有效可见时恢复。等待期间用户移往外部或切页即使
  返回也不抢焦点，不自动重试，不变凭据清理/授权/宿主或玻璃样式。原新回归7通过/1
  失败、修后8/8，独立相关3/3；Desktop完整429通过/0失败/11跳过及typecheck通过。
  真实app+明确合成桥Chromium151宽/窄屏各十次save/revoke成功/失败/畸形及焦点离开
  操作均通过，无console/page错误、溢出或错误遮罩。首轮临时QA脚本selector错误已
  单独保留、修正后最终浏览器命令exit0，不把脚本失败混作产品失败或最终通过。

上述只是各受影响模块门禁，未重复无关整仓检查，也不替代原设备/账号/云验收。
三份本人说明只校对事实、相对链接及diff；新组合沿既有#293发布，准确新head的
Windows检查另读回，不能借用上一519b207的双绿。原始日志和冻结哈希保持可续接。

### 2026-10-06：继续旧 MOD 与消费者细节

#293 的精确 `50f8c38` 已获 Potatos498、goo122 正式非作者批准，由 Potatos498 合入 main
`e02865c`；两路首次 Windows Foundation 均完整读日志，各 2048/0/16。此事实只关闭
该源码增量的评审与集成，不关闭原设备、账号、云端真实验收或整体 Goal。

在最新 main 继续核对后，本人沿原分支交付 #295：MOD18 注册后根路径被替换可使固定
命令在别处运行，现绑定 canonical 路径与 bigint 目录身份，在 spawn 前同步重验。
旧回归 1/5（含父用例）、修后 6/6、coding-tools 193/0/15 平台跳过，build/typecheck
与独立公开入口验证通过。目录校验不能消除至 OS 启动之间的竞态，不是 OS 沙箱。

同一轮另登记 #212 `6017855959` 两项本人增量：MOD16/17 CPU 每核每类计数回退不能被
其他增长掩盖，保存独立快照后逐项验证，windows-client 12/12 及 build/typecheck 通过；
P8 消费既有 `projectCommands`，仅展示实际构建/测试子集，缺失或非法名单不宣称具体
命令。后者保留原 `projectScriptsAvailable` 许可、按钮、提交参数及草稿条件，不将
显示名单变成新权限门禁。首次多加名单 Gate 的方案已纠正、临时证据单独保留，不交付。

实际可复现失败及明确归属是本轮实现依据；不把陈旧台账或等待真实验收当作缺源码，
也不接管 goo 的 MOD37/P7、Potato 的原设备现场。新 #294 固定 `23400525` 已完成普通
只读 review 并记录 COMMENT，未 APPROVE 或 merge。用户延长执行至 2026-10-07
北京时间 20:00，审核期间继续独立工作；新组合准确 head 的 CI 与评审在 #295 续记。

上述 P8 修正后正式定向 8/8（旧源码 7/1），Desktop 完整 431/0/11 Linux 门控跳过、
typecheck 与实际 app 的 1280/480 屏幕验证通过；生产 Host 配合显式 Fake 配方生成实际
build-only、test-only、两者快照，没有执行命令。独立只读 8/8 及七种名单 probe 验证
legacy 权限与唯一显式调用保留。CPU 另独立定向 4/4、五类回退 probe 均拒绝。

#295 首个 e8e3e30 head 的 push Foundation 37474438969/job112306058042 实际失败：
calendar `cloud-business.test.mjs:88` 的超时分类期望 TIMEOUT、实际 EXTERNAL_FAILURE。
完整原始日志已读，交 Potato 原模块负责人；本执行未改该模块，不绕过失败或声称双绿。
该首 head 与新组合的检查各自记录，旧 green 不能关闭此历史问题。

#295 的后续 `7abca084` 两路首次 Windows Foundation 完整日志分别 323334/324155 字符，
各 31 workspace 2071/0/16；coding-tools 215/4 跳过、windows-client 12、Desktop 443/1
跳过、Runtime 348，受控 .NET8 fixture 实际 41.65/27.62 秒。goo122 对准确 head 正式
批准后合入 main `d332bec5`，本执行未 APPROVE 或 merge；它不覆盖下述新接线增量。

继续按明确契约修补 MOD38 默认 Runtime 桥丢失 goal/PR 正文：入口捕获原请求字段，
MOD34 有界转发 goal 至模型并追加正文至原回链后，字段纳入 checkpoint 身份。无字段
legacy CI 身份保持；旧 Issue 未知 journal 加新上下文会拒绝且完整保留，不能自动迁移、
清除或换 run 继续写入，由原可信宿主核实恢复。权限、源码白名单、预算及审批仍原样。
旧 CI 三组与默认桥一组公开回归失败保留；修后 coding-tools 208/0/15、Runtime 目标
46/46 与最终默认桥 SQLite 审批重启 1/1，独立 CI 5/5、Runtime 1/1 及旧 unknown 零派发
probe 通过。明确 Fake 模型/工具不冒充真实账号操作。

必要组合 `npm run check` 在 Node 24.15.0 上 exit0：31 workspace 2040/0/50 Linux平台
跳过，Runtime 349、Desktop 431/11、根集成 22/22；架构、生成协议与类型检查均通过。
代码与已合入 main 的对应源树一致，文档只校对事实及 diff。新独立接线 head 的 Windows
CI、正式非作者评审与集成另记，整体及原真实验收仍未关闭。

### 2026-10-06：默认桥已集成，继续恢复与前端细节

#296 的准确 `0babfcc75d5e3f23fd0c33e187eca25b079e52ff` 已获 goo122 正式非作者批准
`5430070658`，由 goo122 于 14:48:37 UTC 合入 main `111bb90ad94808b87424a7fa02041b44f42313b6`；
本执行未 APPROVE 或 merge。两路首次 Windows Foundation 完整原始日志实际读取并归档：
push 37479487409/job112323564604，323953 字符；PR 37479964577/job112325196887，324869 字符。
各 31 workspace 2076/0/16，coding-tools 219/4 跳过、cognition 207、GH 103、
windows-client 12、Desktop 443/1 跳过、Runtime 349；实际受控 .NET8 fixture
25.84/25.18 秒，check/dev/两项 demo 与清理均成功，零重跑。

MOD33 新严格 UTF-8 实现的公开生产 Provider 另完成真实只读 3/3：实际
`GhCliProvider + SpawnGhCommandRunner(/usr/bin/gh)` 调用 repo.get、issue.get #212、
pr.get #296，Schema 与官方身份独立匹配，中文标题完整。必要凭据只在 Node 内存，
未打印或写入文件；全部 GET、外部写入零，不以 Fake 或 MCP 响应冒充 Provider。
此项不关闭原 COMMENT/labels/Checks 写入、Windows 或 AgentArts 真实验收。

等待审核期间继续发现并登记三项具体增量：MOD18 完成时未复核任务与最长执行期限
（#212 `6018788042`），P8 取消系统选择器清掉既有权限草稿（`6018824541`），
MOD38 标签审批恢复没有重新读取完整 Issue（`6018825022`）。两源码子包与 P8 四文件
分别唯一 writer，root 仅私有 main coding 分支及本人说明、串行交付；不改公共 Schema、
共享 Renderer/Admin、他人业务或 Runtime 核心。#296 已合入后的新独立增量沿原分支交付
唯一后续 PR，按用户已有新 PR 授权执行，不复制旧任务。

MOD18 固定真实 Node 子进程配合显式时钟钩子验证期限边界，取消加时钟异常的独立
发现已修正，最终定向 9/9、coding-tools build/typecheck 与包测试 217/0/15 平台跳过。
独立入口确认期限前非零退出保留、精确期限拒绝、初始/完成取消优先；副作用可能已发生，
不能安全重试。该证据不冒称原 Windows 已发生竞态或具备 OS 沙箱。

P8 四种选择器取消仅返回临时 `selectionCancelled:true`，普通快照/持久配置不加字段；
既有 main 分支转发私有 `codingSelectionCancelled:true`，Renderer 限定四 selector 与
明确布尔 true 保留已有未生效草稿。正常换选、授权/撤销、legacy 回执仍原清理；
宿主撤销或配置失效保持优先，不自动授权，不以同名工作区猜测取消。定向 53/53、
Desktop typecheck、源语法通过，完整包 434/0/11 跳过。真实 app 配合明确
合成 IPC 与生产 Host 回执在 1280/480 屏幕通过，无页面错误或溢出；另实际 main
分支提取加生产 Host 组合核对四取消、正常操作、权限与 invalidate/publish。
后者是受控私有端口验证，不是原生 Electron/Windows 选择器或 DPI 验收。

MOD38 同一 updatedAt 内正文变敏感的公开 before 已复现。新恢复检查的独立复核又
发现 pending GET 换运行身份会反复请求审批，已按原契约修复：读取等待审批需
保留原 runId 与已计预算，取消/未知或读回消费后才推进代际。未知标签先消费可信原
confirmed receipt，保留事实与 Evidence，再重读内容决定能否继续修复，不能丢掉已发生
写入或盲重发；随后转人工也保留已确认历史标签，不宣称远端当前标签。cognition
build/typecheck 与完整测试 213/213；独立恢复缓存 2/2 及原 unknown/self-label 合法恢复
probe 通过，原失败及首次 after 脚本末调用断言错误均单独保留。准确后续 head 的 CI
与非作者审核在新交付记录补齐，不将 #296 的受检结果套用于本批源码。

同轮新增 MOD18 对账配置快照（#212 `6019076651`），先在独立缓存副本复现 6 失败、
修后 reconcile 16/16，再由 root 串行应用原两文件；正式 build/typecheck 与 coding-tools
223/0/15 平台跳过，独立真实临时 marker 入口 1/1，保留原执行绑定与 marker 选择。
这只证明公共 options 复用的异步问题，不宣称当前 Runtime literal 配置受影响。

三项增量的首轮完整组合 check 确实失败，原始日志保留：Runtime 原事实重启测试在批准
标签后未继续批准新增 fresh GET 就期待终态，实际 waiting_approval。root 单一消费者
测试槽（#212 `6019190246`）补齐真实 TaskRuntime/SQLite/Policy 的显式 GET 审批及再次
重启，保留最终成功、分类模型只一次、原事实标签一次/变化零次、每次批准读取只执行
一次的强断言，增加标签审批期与恢复读取审批期同 timestamp 变更，定向 5/5。
没有降低终态要求、绕过 Policy 或回退旧缓存；必要最终完整 check 另实际执行。

MOD33 另实际只读失败 run/job 元数据可消费：公开 Provider/runner 识别历史失败
37474438969 与 job112306058042，Schema、原 e8 源 SHA 及 npm check 失败步骤匹配。
一次标准失败日志读取返回空文本，同 runner 的官方 `--log` 对照也为空，exit0/stderr0；
未绕过重定向、替换 MCP 原始日志或编造 Provider 数据。该现场日志诊断仍未通过，
尚无证据支持改变 `--log-failed` 解决；不因晚些 CI 成功关闭原 calendar 超时分类问题。

上述四项沿唯一 #297 发布 `026412c9671b3d16a9528a0162075ce89df71bd7` / tree
`dab9f3be26b7005393db78672928a3819bf19d3b`，16 个 diff 文件、API 树等于本地受检树。
最终 Node24.15 完整 check exit0，31 workspace 2066/0/50 跳过、根22/22、
架构3/3、生成协议与类型检查通过，203685 字符原始日志归档；Windows准确head另读回。

继续 P8 工作区按钮键盘焦点（#212 `6019311625`）：原按钮经 Enter 启动后禁用，成功或
失败结算均落到 BODY，不能继续原键盘位置。独立缓存先保留原码10通过/1失败，修后
12/12，再由root串行应用原控件及测试；监听器在结算清理，只有原按钮仍连接、可见、
启用且用户未外移/切页、焦点仍BODY时恢复。主动外移即使又回BODY、切页再回、
移除DOM或宿主使原按钮禁用均不抢焦点，不自动invoke、授权或重试。
actual app 1280/480各15场景通过，明确合成延迟宿主与仅本人模块route，不冒充原
Electron/Windows选择器；无页面错误、溢出或遮罩，独立目标2/2及冻结哈希匹配。
这是沿现有开放#297的后续两文件行为增量；正式 Node24.15 Desktop 完整436/0/11平台
跳过、typecheck、控件/测试语法及diff检查均通过。无公共接口或跨模块装配变化，不重复
上述026组合全检；准确新增head的Windows完整门禁另实际读回。

用户当前截止仍为 2026-10-07 北京时间 20:00；不使用旧邮件 22:00 或翌晨 08:00 截止。
整体 Goal 与原现场验收仍 in_progress，原负责人及恢复入口维持前述分工；邮件阶段
进度不代表停止，真实结束前仍需发送结果与剩余事项。

### 2026-10-06：#297 精确 Windows 门禁与 MOD34 单次输入绑定

`f0d07e342d60708ad0d50645ad35afc7e689d19a` 的 push run37487356557 / job112350752905
与 PR run37487364346 / job112350782527 均 completed/success。分别完整读回327286/
327994字符原始日志，全部34组测试汇总已核对：31workspace2104/0/16 Windows平台
跳过、根integration22/22、架构3/3，check/dev/demo:protocol/demo:runtime实际通过。
其中coding-tools234/0/4、cognition213、Desktop448/0/1、Runtime351。前一026头的
37486658564/37486665561也双绿，独立完整日志31workspace2102/0/16，保留为历史证据。
这些不是原设备现场或calendar历史错误分类已修的证明。

继续明确自有MOD34的输入绑定缺口，#212 `6019776595` 登记唯一两文件写入者。
公开 `createCiFixWorkflow` before1/1失败：普通调用方在首读等待期间改复用options的
repository，后续工具args偏离原仓库但identity仍相同。Fake成功不冒充真实账号写入，
真实Gateway可能拒绝；没有靠修改权限或重试解决。每次run捕获执行配置，复制原
sourcePaths/Issue/Git工具名/源运行关联；Model/工具端口仍原引用，实时Runtime授权、
confirmedReplayReady/时钟保持。不同task的新run可采新配置，原journal变更仍拒绝。

正式Node24.15 module build/typecheck通过、coding-tools227/0/15 Linux平台跳过；
原before脚本after1/1通过、独立公开10/10通过。覆盖GET/model/verify三处await配置
突变、原身份/参数、新任务更新、旧journal拒绝、live hook属性替换、非法backlink零
派发及legacy序列化一致。独立审阅无finding，源hash
`bed82070788f7dd8f0ee1552944dafa335ce5253437ee9a494b941c1f4da786b`。
只改本人ci-fix实现/测试、README、MOD34与本续接说明；沿既有开放#297发布。
无公共DTO、wire、迁移或Runtime装配改动，不重新运行已通过且未变的组合全检；
新增提交的Windows完整门禁另核实。非作者审核、原Windows/账号/AgentArts场景仍按
原owner接续，整体Goal继续in_progress，不等待审核才推进独立工作。

MOD34上述配置绑定已沿#297普通FF发布 `31d67ecbcb13d5f0df60c3a90dcd211c4e0dad98` /
tree `87b16dbab045c379724b59072557cdfe526518df`，当时19diff文件，API树=受检树。
push37489939901/PR37489948010启动，不能用f0双绿代替该增量终态。

继续MOD36 factory端口绑定（#212 `6019894581`），仅本人code-review实现/测试及模块
与续接说明。原公开before在first-head await期间caller换复用options使原workflow改用
另一model/tools；prepare后换tools还忽略原port已撤销的评论能力，独立before2/2失败。
factory捕获原Model/Tool端口引用，原port.list/invoke/complete仍实时，context/access/
授权/confirmedReplayReady与原checkpoint行为不变，新factory可以使用新端口。
正式原回归2失败/1通过，修后Node24.15 cognition build/typecheck和模块216/216、零
跳过，独立同probe2/2通过，原评论能力撤销unsupported、Fakewrite零次。明确全部
合成评论，不冒充实际GitHub写入；源hash
`1a8e2caf0780901106b3095b1fde6a768afc67333f45b6428e0131bbba857017`。
无公共接口或Runtime装配变化，不重复未变的组合全检；新提交Windows完整门禁另
实际核对，仍不自行批准或合并。MOD38相邻factory绑定另登记独立两文件，串行模块
构建，保持原独立写入槽，不等待本PR审核再推进。

MOD36上述端口绑定已发布 `30156074337341fe364a1683abfc4bd50ba2f94c` /
tree `03c495aaf4ae0add22e5a079f44da622ebf64ca8`，API树=受检树，当时22diff文件。

MOD38 factory同类绑定（#212 `6019995540`）沿本工作包继续：request/labels/threshold
原已捕获，只固定Model/Tools/Repair端口及已验证maxSteps/maxTokens。普通caller首GET
await后更新复用options，旧码会混用新分类端口；有效公开before1/1失败，同脚本修后
1/1通过。端口对象不deepclone，原方法与list能力继续实时，authorizationRefFor/
confirmedReplayReady/confirmedRepairReplayReady仍原options实时属性，新factory可用
新配置；不改标签审批/读取run/预算恢复逻辑、DTO/wire或Runtime装配。
正式Node24.15 cognition build/typecheck与完整219/219、零跳过，独立公开6/6通过，
源hash `efe132a54fbfbeb75290892b224f4cdcf57d672b2c9eb82a2358347109245b2a`。
准备期一个误命名before的日志已用新dist并3通过，明确不作为旧失败证据；有效旧失败
另单独归档。全部Fake标签/修复，不冒真实账号写回；独立审无finding。仅本人实现/
测试与MOD38/本续接说明，沿现有#297交付，最新提交Windows准确门禁另读回。
整体Goal、原现场恢复和非作者评审仍未完成，持续核对新PR、反馈和明确自有可推进项。

MOD38上述factory绑定已发布 `cf87b72aed5d755eccadd1681c4f09d4471a73a3` /
tree `82c8f9c2ddbb391b68cfef64d08984282c5b5e22`，当时仍22diff文件；准确新头
push37491346187/PR37491353087启动，阶段邮件1a111ed29d5ece7d已核SENT及To，非停止。

继续本人MOD34 CI discovery端口绑定（#212 `6020191190`），有效公开before1/1失败：
caller启动旧factory读取后为新factory更新同options.tools，原descriptor来自A而微任务
invoke却用B（同合法工具版本/官方run Schema）。Fake只证明原实例端口切换，不是
真实Gateway账号放行。factory捕获tools，仅3行绑定变化，原list/invoke方法、授权/
confirmedReplayReady仍live，now/maxSteps/参数/identity/checkpoint保持不变。
正式Node24.15 coding-tools build/typecheck和230/0/15 Linux平台跳过，同public脚本
after1/1通过，独立公开4/4：旧实例A/新factoryB、能力移除及原方法替换、pending/
unknown精确原run/args/steps1、实时授权与ready属性。源hash
`fa1e3fd6d8f047c7062aea6124a063ae9a1de83b51278f6c1d014358f1dfdc69`，独立匹配
且无finding。准备误名before的新dist3pass明确不计旧失败，原有效失败另保留。
仅本人发现实现/测试与MOD34/本续接说明，沿开放#297发布，不改公共协议或Runtime
装配，原完整现场依然按owner接续。最新新头Windows完整门禁另读取，不借旧头绿灯。

上述九项增量的准确 head `e109368779ba833f9d75b331766256701201338b` /
tree `73bd2f9a44418523c160a9d4158db03ba3b5e37d` 两路 Windows 首次全检成功：
push run37492638458/job112369024033、PR run37492644255/job112369046672，完整
raw328961/329841字符均读取归档。31workspace2117/0/16跳过、根22/22、架构
3/3，check/dev/两项demo均通过。#212原交付记录已更新同head及原验收owner；阶段
邮件1a1120a846b4d144已核SENT/To，非停止通知，整体仍in_progress。

继续本人MOD33真实失败日志读取（#212原记录 `6018777209`）：标准gh2.46.0原
exit0/text0的根因已由官方parser与既有非空CRC完整ZIP证明。仅有合并job文件
`0_check.txt`/`check/system.txt`，旧版逐step正则11steps零匹配后无声返回。
按正常网络取得并核官方SHA256的隔离gh2.102.0后，原公开Provider/runner在固定
Node24.15下真实actions.log.read成功：run37474438969/job112306058042/failure身份
已核，正式Schema六页、连续offset、最终nextOffset:null，348224 UTF-16字符/
356938 UTF-8字节，SHA256
`334b89ed82dc50fd73546b104ce4d760e2ca1c526ada1f6c565e4696245a253d`。
实际Calendar路径、TIMEOUT/EXTERNAL_FAILURE及测试失败标记存在，全GET、凭据
只在内存，不输出/存储日志正文或签名URL，未改系统CLI/协议/连接器实现。本人仅
补充MOD33包README、模块说明及本续接文档的可信CLI兼容前提和证据，沿#297交付。
当前兼容版本不代表最早支持版本；原Calendar错误、账号写入、Windows与原可信
Runtime闭环仍按原owner处理，不能将新读取证据升级为整体完成。截止仍为
2026-10-07北京时间20:00，继续新PR/分工/认证邮件检查与新增独立工作。

上述MOD33文档已发布准确head `4afb8e0812438c17dfead2fddb156061e652726f` /
tree `68e4e23ea01e521fd03006d0c9c4fdad4bf3db4a`，26diff文件；新头双Windows
push37499240945/job112391665236、PR37499249363/job112391696773首次均成功。
完整raw328965/329931字符均归档，34组汇总31workspace2117/0/16、root22/22、
architecture3/3，check/dev/两项demo全部success。

继续本人MOD33 runner生命周期绑定（#212 `6021583746`），唯一源码writer仅
gh.ts/github.test.mjs。普通caller复用options创建新Provider，在原credential await
期间替换runner会让旧请求换用新runner；旧dispose还会释放新依赖并遗漏原依赖。
原公开before2/2失败，独立before2/2失败且新Provider被错误dispose后明确失败。
构造捕获原runner引用，API/log/dispose三处一致使用原对象；原run/dispose方法与
readToken/仓库白名单检查保持live，不冻结凭据或授权。公开after2/2、独立同probe
after2/2及原dispose方法live断言通过。正式新增回归旧1失败/1通过，fixedNode24.15
GitHub build/typecheck、完整105/105全部通过，无跳过。源码冻结SHA256
`4f7969f6d5a8d5b85b8f412b8b011879ca0d42ccab3ee59c7db74c9538938938`，测试
`67e9ae32fa47a4cce9cdcba65ec75fea44cbf67048487e860722d04f01eceaeb`，独立匹配。
仅本人两源码及三配套文档，沿#297交付；无DTO/Runtime/根配置变化，全部before/
after生命周期复现为明确Fake READ，无真实账号write。当前新增源门禁另按准确head
读取，不借上阶段4af双绿，原真实写入/Windows/可信Runtime仍按owner验收，整体
Goal继续in_progress，截止仍Oct7北京时间20:00。

最新冻结runner实现另以官方gh2.102、Node24.15原公开Provider实际复验首日志页：
正确原run/job/failure身份，正式Schema、offset0/nextOffset65536、65536字符/
66086 UTF-8字节、UTF8 roundtrip通过，页SHA256
`e24ca1e9e7fbfc6c1054dc47f9c7b7d9af43f2408b5d94268fc39fa04a644f71`。
仅一个日志页及必要元数据GET，之前完整六页全文证据单独保留，不把首页未出现的
Calendar标记误说消失，也不重复全量读取；无凭据/正文/签名URL落盘或账号write。

上述第十项源码增量已发布准确head `6fe4a922813dcb565ac60393959ef4cf9caa13f4` /
tree `541f4871e838cffa2cfab23760d545fca4cf5947`，28diff文件；双Windows首次attempt1
push37503321460/job112405575122、PR37503328395/job112405602544均成功。完整原
日志329222/329992字符已读回归档，34组汇总、31workspace2119/0/16skip/0cancel、
root22/22、arch3/3、GitHub105/105，新增runner两回归实际执行；check/dev/两项demo
全success。阶段邮件1a1125046fc5ec31已核SENT/To，非停止通知，整体仍in_progress。

继续本人MOD34 factory原Model/Tools绑定（#212 `6022269030`）。旧公开before1/1
失败：读取pending后复用options创建新factory，旧factory恢复原run却toolsB12次/
modelB1次；独立纯Fake READ的pending/unknown旧2失败。factory构造固定两对象，
私有执行入口保原liveOptions；直接公开runCiFix两参数仍每次选端口，各run配置可
更新并按原snapshot/identity校验，原授权/confirmedReplayReady/now属性与原port方法/
能力仍实时。新factory可用新端口，不把旧unknown改为新write。公开同probeafter1/1、
独立同probeafter2/2、追加边界4/4；追加探针曾误断unsupported返回为异常，纠正后
通过且原日志保留，不计产品缺陷或oldfail。新增正式回归旧1fail/1pass，Node24.15
coding-tools build/typecheck、完整232/0/15 Linux平台skip均通过。冻结源码SHA256
`933bf44ed1937321302f01b5b8c73a83f3558727a1483092c56cd0221c4eeb8a`、测试
`a011e7ee7d3de17eeb72073fe05ae2593b83dc8faad380accfc420268a59321d`，独立匹配。
只本人两源码及三配套说明，沿现有#297交付；新提交Windows准确门禁另读回，不借
6fe双绿。真实原现场自动修复/账号写/Windows/AgentArts仍由原owner验收，整体
Goal继续in_progress，持续新PR/分工/认证邮件核对至Oct7北京时间20:00。

### 2026-10-07：跳过分类与 Windows Job helper 编译接线

Potatos498 对准确 `df99818d` 作非作者批准后，#297 合并为 `813fb727`，合并树与
已验证源码一致；11 项源码增量已完成评审和集成。goo 的 #294 随后合并，当前
main `4d15f06312745c45412c3d9caf6086fa16a99436` /
tree `87e9e8ea4d2a05aa7193d3667941b0f9a13c372f`，本人原 28 交付文件内容未变。

这两个准确合并头的首次 Windows CI 完整原日志已读取：`813fb727` run37563088156 /
job112604581622 的 31 workspace 为 2121/0/16；新 main `4d15f063` run37563282512 /
job112605184647 为 2125/0/16。两者各 34 组汇总，root22/22、架构3/3、fixtures4/4，
全部 required check/dev/demo 步骤成功。历史总跳过数保留，不能将整个 workspace 的
跳过统称为“平台跳过”；新 main 的实际 16 项如下：

| 原因 | 数量 | 证据边界 |
| --- | --- | --- |
| `WindowsJobProcessHost.exe not compiled` | 4 | 现有成功执行、abort 杀进程树、deadline、root exit/继承输出回归尚未执行 |
| 显式 opt-in 连接器 live 测试 | 11 | Calendar3、feeds1、mail2、research1、weather4；不代表真实账号/服务已验收，mail send 另有独立 opt-in |
| Desktop 显式 opt-in 渲染测试 | 1 | knowledge controls 读回/交付/绑定区分与订阅刷新，需要 `PA_KNOWLEDGE_UI_TEST=1` 及浏览器；不推断为已通过的 Windows 行为 |

沿 #212 原登记 `6022269030` 开展本人 P8 唯一共享 CI 接线，goo122 评审公共兼容：
在现有 Windows check 前核验 runner 预装 .NET8 SDK，调用已有
`packages/coding-tools/native/build-helper.mjs --target-dir`，只发布到 runner 外部
临时目录，并在解析 `helperPath`、确认文件存在后写入已有 `PA_TEST_JOB_HOST_EXE`。
不下载 SDK、不改公共接口/依赖或四项原测试断言，保留原构建失败而非静默 skip。
新准确提交的实际编译及四项回归必须另读 CI 原日志，不能借上述旧头成功计为通过。
这只覆盖生产 helper 的合成进程树，不证明原设备 UIA/用户接管、完整授权链、
Windows 安装包或 #291 原自动写闭环；连接器真实 WRITE 和 AgentArts 仍按原 owner 验收。

新增 CI 增量已沿原分支交 #298 Draft，初头 `e25c52a` / tree
`2a752c1a96f92d4da2f71a76323fb9497cc5df40`，仅上述三个文件。两路首次 Windows
helper 编译与 `PA_TEST_JOB_HOST_EXE` 注入成功，四项原测试实际执行，但整套未通过：
push run37565575276/job112612385030 为 helper3通过/1失败，abort 测试尚未主动取消，
即因准备阶段 `grandchild started` 失败；PR run37565593918/job112612445148 为
helper1通过/3失败，另有 success 原10秒 TIMEOUT、deadline 原300ms 在准备阶段拒绝。
root-exit 两路都通过。完整失败原日志保留，不把编译成功记为四项或整套验收通过。

两名 Sol 代理独立确认原测试生命周期缺口：执行 Promise 在准备后才被消费，
准备断言失败时跳过取消和收尾，fixture 会先清理，原 deadline 随后触发未处理拒绝。
尚不能由此认定冷启动或生产 Job/取消逻辑根因。沿原 #212 登记新增本人 P6 原测试
唯一写槽 `packages/coding-tools/test/workspace-command.test.mjs`，先补立即观察、
所有失败路径取消并等待收尾及有界启动诊断；保留原等待/执行期限与 PID、存活、
严格 CANCELLED、实际 ESRCH 杀树和精确输出断言。生产 native/command 不猜改，
新准确 Windows 运行继续定位；沿现有 #298 交付，不开新任务或重复 PR。
