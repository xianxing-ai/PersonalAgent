# PersonalAgent 真机与 AgentArts 联合验收报告

截至 2026 年 11 月 19 日，北京时间。原清单共 27 项，其中 25 项有实测结论，第 6、7 项按安排暂停。末尾补列后续合并 PR 的实测结果。[清单状态索引](JOINT_CHECKLIST_STATUS_20261112.md) · [分批原始回执](JOINT_LIVE_PREPARATION_20261111.md)

## 报告写法

- 每项先给结论，再写发生的动作和实际读回。用「端点返回 HTTP 404」「桌面记录 `RESULT_UNKNOWN`」这样的句子定位停止处。保留错误码、数字、版本和必要的任务 ID。[Microsoft 写作指南](https://learn.microsoft.com/style-guide/top-10-tips-style-voice) · [Google 技术写作指南](https://developers.google.com/tech-writing/one/clear-sentences)
- 原因写到证据能支持的层级。已确认的原因写组件和因果。源码只能缩小排查范围时标明「代码线索」。现有日志定位不到具体失败点时，写清下次需要哪一条记录。[Google SRE 复盘指南](https://sre.google/sre-book/postmortem-culture/)
- 缺口写具体的复验条件。写出应出现的结果、谁能读回和如何认定完成。读回目标端、本机状态和云日志时，使用同一任务、请求或版本关联。[Google 技术写作课程摘要](https://developers.google.com/tech-writing/one/summary)

## 环境与版本

- **Windows** 使用 Windows 11 build 26200 的普通用户会话和 Node.js 24.15.0。收尾构建、启动的最新主线为 `f33ef3837e46f593ee6b5f9190a4092abde8dab7`，包含 #642。更早的实测保留原提交。所有标为「本轮」的条目以各自回执中的实际提交为准。
- **AgentArts** 使用华为云西南-贵阳一现有运行时，经 HTTPS 或 WSS 调用。访问入口 `Latest` 指向 `v4`。实测使用的最新已发布 SWR 镜像是 `f26-644c7416f5b0e98d`，源码为 `644c7416f5b0e98d5c90b8360cc4fd7d53224eda`，ARM64 镜像摘要为 `sha256:d33dcd8f32e586a03f4635b1406c918e6ecdc263e4b302682b1d0b2e45c70579`。本机最新提交的云端部署缺版本和镜像读回。
- **模型** 联合任务明确选用 DeepSeek-V4.1-Flash-1017。成功批次可按原应用请求 ID 关联平台 Trace。模型代理采用独立请求 ID，部分批次的 1017、HTTP 200 记录按结束时间关联。按请求费用以账单为准，平台角色日志中的 token 和本机估算分别保留。
- **测试数据** 真机操作使用隔离 Desktop 配置、公开工作区和专用测试资源。CalDAV 使用本机隔离 Radicale 服务和测试集合。原始回执路径以测试机的工作树为根。

## Windows 设备、本机执行与隐私

### 01. MOD-16 正式桌面 F9 记事本写入

**部分通过。** 正式 Desktop 从「电脑操控」发起任务 `d4bc07c4-c4cb-4409-a62b-04172ab2fe81`。宿主进入 `waiting_confirmation`，F9 从未注册变为已注册。SQLite 只保存准备检查点。点击「停止本次操作」后，原任务为 `cancelled`，F9 注销。退出后独立读回零授权、零工具执行、零模型请求。

**原因。** 当前入口要求确认新建空白单标签窗口并按 F9。现场没有执行这次实体确认。产品也没有提供等效的受信无障碍入口，因此本轮停在待确认阶段。

**复验条件。** 在受信的一次性确认后，验证同一新窗口只接收一次写入。用独立 UIA 读取文字，比较 SHA-256，核对 Policy 授权消费和 WindowsHost 隔离日志。若提供无障碍确认，确认必须绑定当前任务、文本和已识别窗口。[正式桌面回执](JOINT_LIVE_PREPARATION_20261111.md#2026-11-19-正式桌面记事本确认前门控与取消) · [独立 SQLite 回执](../../../.worktrees/real-device-main-20261118/.cache/notepad-restricted-device-3tPEBa/independent-sqlite-readback.json)

### 02. MOD-16 官方全权限记事本脚本

**未通过。** 11 月 19 日在 `03d383c5` 普通用户会话运行官方脚本。新记事本进程出现，WindowsHost 完成握手和绑定。6 次观察仍未确认唯一可写目标，最后记录 `MetadataRejected` 和 `IdentityChanged`。脚本退出 1，返回 `UNAUTHORIZED`。清理后原任务 `44b7fb48-a07e-4927-baec-fa2414e8ff74` 为 `cancelled`，目标就绪、执行、核验计数均为零。

**原因。** 新窗口通过进程启动这一步，停在目标身份或控件复核。现有记录定位不到具体被拒的约束。前一批曾出现 `ProcessUnqueryable`，属于另一运行的错误。

**复验条件。** 把新窗口身份、前台关联、选中标签、可写 UIA 控件及 ValuePattern 各自的判定记录下来。在同一正式记事本包上重跑全权限路径，只有通过目标复核后才进入写入。最终以一次执行和独立读回匹配为准。[全权限回执](../../../.worktrees/real-device-main-20261118/.cache/native-notepad-5AYNHD/receipt.json)

### 03. MOD-17 只读系统观测

**通过本机 Runtime 验收。** 正式 Runtime 经 Policy 和 ToolGateway 调用一次真实 `node:os` 聚合采样。任务 `0b9eeac8-0589-422b-a456-ee7aa87e9105` 为 `succeeded`，工具记录为 `confirmed`，许可已消费。拒绝、取消对照均无采样。重开 Runtime 后历史读回一致。

本项验收目标是本机 Runtime 采样。证据级别为 `conditional`，记录的是允许范围内的聚合观测。另一个正式 Desktop 经真实 WSS 派发的批次也完成本机采样，其结果出站停在第 11 项记录的门禁。[本机采样回执](../../../.worktrees/real-device-main-20261111/.cache/mod17-runtime-mvYyOh/receipt.json) · [主线复测](../../../.worktrees/real-device-main-20261118/.cache/mod17-runtime-jy3RNj/receipt.json)

### 04. MOD-11 悬浮球 DPI 与多显示器命中

**核心命中未通过。** 在 2560×1600 实体屏分别测 150%、125%、100% 缩放。透明角点击均到达下方测试窗口。球心点击也到达下方窗口，测点距球心分别为 1.41、0.63、0 DIP。150% 的球心拖拽在初始输入目标核对时被拒。测后恢复并读回 150%。

**原因。** 前景与坐标校验留下了实测证据，球心交互仍未命中悬浮球。当前回执定位不到具体失效的窗口命中、透明输入或跨进程输入环节。

**复验条件。** 同步记录原生窗口矩形、物理像素与 DIP 坐标、顶层命中窗口及实际收件人。先在同一屏确认球心交互，再测跨屏混合 DPI、边界抖动、拖拽捕获和崩溃恢复。第二块有不同缩放的实体屏是跨屏用例的环境条件。[DPI 原始回执](../../../.worktrees/real-device-main-20261118/.cache/real-orb-dpi-MX07uR/receipt.json)

### 05. MOD-18 Windows 原生沙箱

**原生探针与正式桌面固定命令通过。** 原生探针通过 7 项。真实 Runtime 的一次授权固定命令得到 `windows-psec`、`enforced=true`、`stopped=true`，替换参数、重放、残留授权计数为零。正式 Desktop 另用公开工作区通过可见试运行和原审批执行一次 `workspace.npm_test`，返回 `confirmed / allow`、`exitCode=0`，父子任务均成功。

**边界与复验条件。** 同批早先的组合任务在补丁应用后被内容围栏挡住，未进入 npm 执行。独立原生探针还记录了目录联接边界拒绝、撤销后禁止恢复和超时终止后代进程。复杂真实工作区和同一正式任务的完整拒绝场景仍缺联合证据。[原生固定命令回执](../../../.worktrees/real-device-main-20261111/.cache/authorization-native-integration/case-pQHfxU/receipt.json) · [正式桌面沙箱回执](../../../.worktrees/real-device-main-20261118/.cache/desktop-pelican-default-sAVWRR/sandbox-followup-receipt.json)

### 06. MOD-19 打包后 Electron SQLite

**暂停。** 按用户安排保留。本项需要 Windows 打包产物中实际运行的 Electron、SQLite 和 WAL。恢复后使用隔离用户目录完成提交、读回、正常退出与重启，再检查事务、任务状态及 WAL 行为。[暂停条目](JOINT_CHECKLIST_STATUS_20261112.md)

### 07. MOD-19 安装、覆盖升级和卸载

**暂停。** 按用户安排保留。本项需要实际 Windows 安装包及隔离安装环境。恢复后核对旧版安装、覆盖升级、程序启动和退出、配置与 SQLite 保留、卸载后的程序与用户数据状态。[暂停条目](JOINT_CHECKLIST_STATUS_20261112.md)

### 08. MOD-14 华为云 SIS 听写与播放

**实测不可用。** Windows 识别到 1 个正常录音端点和 2 个正常播放端点。正式 Desktop 两次启动均读回 SIS `unconfigured`，听写按钮禁用。麦克风未启动，未新增语音工具记录或云请求。

**原因。** 本轮隔离配置缺 SIS 的有效服务设置。桌面在该状态下将听写保持禁用。

**复验条件。** 在授权的 SIS 配置和实际音轨就绪后，验证真云 ASR、听写只填草稿、实际扬声器播放、打断和断网恢复。由设备、应用与服务请求分别读回音轨启停、草稿状态和云请求。[Windows 音频读回](../../../.worktrees/real-device-main-20261118/.cache/real-audio-readiness-IF2gwt/independent-windows-readiness.json)

### 09. MOD-15 / CW-10 唤醒与麦克风释放

**设置持久化通过，实际唤醒不可用。** Windows 有一个 `zh-CN` 识别器。正式桌面保存 30 分钟档，正常重启后设置保留，唤醒仍关闭。宿主回执为 `wake.phase=unavailable`，麦克风未授权、未启动，释放状态为 `never_started`。

**原因。** 正式装配要求 SIS 就绪才启用 PCM 与唤醒宿主。源码还显示默认「直到关闭应用」对应 8 小时，而麦克风许可上限为 120 分钟。时长差异及隐藏面板时的行为在本轮未触发。

**复验条件。** 在实际音轨启动的同一会话中测唤醒命中、误触、回声、草稿和超时。隐藏、撤销或退出后，用宿主和 Windows 音频状态确认物理释放。另核实默认时长与许可上限的处理规则。[语音与唤醒回执](../../../.worktrees/real-device-main-20261118/.cache/real-audio-readiness-IF2gwt/receipt.json)

### 10. MOD-27 隐私删除

**保存、撤回和拒绝删除通过，物理擦除未验。** 正式桌面在专用公开 Vault 中先拒绝保存，SQLite 无新增记录。随后实际授权保存与撤回。重启后 v1 为 `active` 历史版本，v2 为 `withdrawn`，最新有效事实数为零。「删除所有版本」出现原 `memory.erase` 卡，拒绝后两版及源文件保留。

**原因。** 本轮只执行删除拒绝路径，物理擦除需要原条目要求的现场授权。逻辑撤回写入新版本，旧版本按现有生命周期保留。

**复验条件。** 对独立可处置样本执行原现场授权，随后核对 `physicalErasure`、受影响图谱版本、依赖断链及擦除后的查询和重启状态。[隐私边界独立回执](../../../.worktrees/real-device-main-20261118/.cache/real-private-memory-QwBPdi/independent-privacy-boundary.json)

## AgentArts、工具续传与主动任务

### 11. MOD-04B 多 Agent 与续传

**同父双角色、工具续传和取消通过，部署与计费仍缺。** 在 `ac68fbf9` 的正式 Harness 路径，父任务 `aaf8a64a-02e4-4579-9b64-8e3767577b6a` 及协调、研究、复核三个运行任务均成功。研究任务只批准和执行一次公开文件读取。工具、工作区会话、公开读取与出站四项许可均已消费。研究和协调的续传为 `confirmed`，复核和最终答复都含同一公开标记及复核结论。

AgentArts 以原请求 ID 匹配 6 个完成的 HTTPS 请求及 6 个 Trace，平台执行角色均为 `fast`。同窗口的 6 条模型代理记录均为 1017、HTTP 200。平台角色日志共报告 57,359 token。另一批在途 WSS 请求的取消已由云端读回 `CANCELLED`，本机保留待核实状态。

**原因与复验条件。** 系统观测是另一条真实路径。本机采样成功后，结果出站回调缺 `system_observation` 分支，父子任务停在待核实。为该结果接入原授权及投影后，核对同一请求发生续传。整项还缺当前 HEAD 的部署读回及按请求费用。[Harness 独立回执](../../../.worktrees/real-device-main-20261118/.cache/joint-harness-roles-live-b8qisv/independent-readback.json) · [六条 Trace](../../../.worktrees/real-device-main-20261118/.cache/joint-harness-roles-live-b8qisv/platform-trace-readback.json)

### 12. CW-05 关机后云持续与归来对账

**正式桌面实测不可用。** AgentArts 已配置。打开「电脑操控 → 持续工作流值守」，页面显示宿主不可用。公开状态读取返回 `unavailable`、`missing=[business_source_adapters]`，会话和可用会话操作均为零。退出前后均无新增任务、工具执行、云请求或持续工作流检查点。

**原因。** 正式运行时缺业务来源适配器。Windows 主进程还未注入 `cloudPersistentHost`，缺少把检查点交接给云端常驻宿主的生产端口。原清单要求在该前置条件处结束。本轮机器持续在线。

**复验条件。** 在同一部署公开可用的来源与常驻宿主。对允许离线执行的原任务读回交接检查点，再断开测试设备，验证云开始时间晚于断开时间。重连后检查同一任务归并结果及副作用次数。[正式桌面状态回执](../../../.worktrees/real-device-main-20261118/.cache/cw05-desktop-live-status-of5WZX/receipt.json)

### 13. MOD-29 当前 HEAD 的部署与绑定

**目录和 10 个 Trace 已取证，绑定和版本验收未通过。** 云端目录读回 8 个工作流、3 个控制器、28 张图。原 11 项业务绑定为 5 通过、5 失败、1 未发送。通过的是 `fast`、`deterministic`、`world`、`plan_1`、`controller_mvp`。`plan` 和 `controller_repair` 返回 `EXTERNAL_FAILURE`，现有日志未定位具体根因。`review_1`、`router`、`controller_router` 返回候选，但业务校验得到 `EXPECTED_REPAIR_CANDIDATE`。`review` 因前置 `plan` 失败未发送。

AgentArts 独立匹配全部 10 个已发请求。平台调度为 8 完成、2 失败。业务验收另查输出是否符合场景，因此结果为 5、5、1。F20 的一次联合执行停在首图，云端报受信 Runtime 没有公布本机决策工具，SQLite 无执行或 Evidence。

**原因与复验条件。** `Latest → v4` 使用源码 `644c7416` 的已发布镜像，当前本机主线为 `f33ef383`。对齐发布源码、ARM64 摘要和活动版本后，复验失败及未发送绑定，并关联同批本机授权、工具执行、目标读回和费用。[11 项绑定回执](../../../.worktrees/real-device-main-20261118/.cache/real-agentarts-directory-3gcHd6/binding-suite.json) · [独立平台日志](../../../.worktrees/real-device-main-20261118/.cache/real-agentarts-directory-3gcHd6/platform-log-readback-20261119.json)

### 14. F09 订阅云前缀与会话授权

**专用云前缀未通过，本机真源去重通过。** `/invocations/f09` 返回 HTTP 404。通用 `/invocations` 以 HTTP 200 返回 F09、F10 模板。F09 摘要与该批主线一致。F10 的摘要及三个节点的能力名与当时主线不同。独立的公开 Atom 与 RSS 来源首轮分别交付 3、10 条，复用原游标次轮均交付 0 条。

**原因。** 专用路由在现有部署无法访问。404 的底层配置原因未定位。通用目录调用只返回模板，本机真源回执只覆盖采集和去重。

**复验条件。** 发布可用的专用 HTTPS 前缀和匹配的模板。在同一来源会话绑定 `feed-source-grant`，执行四节点并读回实际 F10 入队、独立 Trace 和费用。[专用前缀与模板](../../../.worktrees/real-device-main-20261118/.cache/real-agentarts-directory-sEMgHj/main-template-comparison.json) · [真源游标回执](../../../.worktrees/real-device-main-20261118/.cache/real-agentarts-directory-sEMgHj/native-public-feed-confirmed.json)

### 15. MOD-30 MCP、Skill 与目标系统

**本机两步 Skill 和直接 MCP 续传已执行，云 Skill 与单次读取后成功未通过。** 直接 stdio MCP 首批两次批准同一公开文件读取，两次均 `confirmed`。父子任务最终答复均包含原文件标记。第二批只批准一次，该结果已实际续传，模型又发出相同提案。第二次被拒后没有执行，父任务以 `CANCELLED` 结束。

**原因。** 首批驱动对两次提案都点击批准，超出本次一次读取的设计。云 Skill 则停在能力发布前。MCP 连接先调用 `stop()` 清空云 Skill 选择器，当前连接和本机 Skill 启用没有恢复该端口。原云任务的目录缺 `skill.workspace_reference_summary`。

**复验条件。** 修复选择器的连接生命周期，经正式目录读回 Skill，验证原生选源、绑定范围、目标读取和一次授权。对直接 MCP 另确认同一结果续传后能结束任务，文件写入次数应保持为零。[直接 MCP 成功批](../../../.worktrees/real-device-main-20261118/.cache/current-main-mcp-cloud-te52fN/independent-readback.json) · [拒绝重复提案](../../../.worktrees/real-device-main-20261118/.cache/current-main-mcp-cloud-GkhfSi/independent-readback.json) · [云 Skill 目录回执](../../../.worktrees/real-device-main-20261118/.cache/current-main-reference-cloud-qnllxY/independent-readback.json)

### 16. MOD-31 / MOD-32 三角色、平台评分、账单与回滚

**三角色已取证，平台评分未通过。** `router` 与 `controller_router` 各有独立 Trace，分别包含 `world`、`plan`、`review` Span。两个用例的业务修复候选均未达标。平台离线评估使用评测集 `PA-Harness-Role-Readback-20261119` 版本 `0.0.1`。三条实际输出和一条角色要求不匹配的对照均得 0 分，任务状态「成功」、四条已处理、资源「免费」。

**原因与边界。** 研究原输出逐字包含公开文件标记，评分理由却称缺少标记。评测集列名为 `output`，评估器使用 `actual_output`。现有界面回执没有确认两列的有效映射，评分偏差的根因未定。费用中心按运行时资源 ID 查到零条且未显示按请求关联字段，按次成本未取得。平台列出了可回退版本，本轮未执行回退和回退后的调用。

**复验条件。** 先读回评估器逐行实际收到的输出及映射，再检查能否区分正确样本与对照。原要求的方案对照还需要同输入、同模型与可追溯部署的单工作流真实结果。费用用可关联请求的账单核对。回滚在授权的受控环境核对回退前后活动版本和原用例。[评分明细](../../../.worktrees/real-device-main-20261118/.cache/joint-harness-roles-live-b8qisv/platform-evaluation-readback.json) · [AgentArts 评估任务](https://console.huaweicloud.com/agentarts/?region=cn-southwest-2#/home/evaluation/evaluation-task/detail/1b0b0503-09c7-45c6-aeb1-644c87a88d40)

### 17. PR #630 风险档、系统通知与补偿

**自动审计、待批和停用恢复已有实测，中风险补偿未验。** 平衡档读取一次公开资料并留下自动执行审计。保守档在默认「低风险自动」沙箱下仍产生原审批，随后获准。另设「每次都询问」后，真实读取保持待批，执行次数为零。停止自动执行、重启保留和恢复均有正式状态读回。

**原因。** 风险档决定是否进入审批，沙箱仍决定原审批是否自动处理。本轮使用公开读取作为对照，未触发有补偿能力的中风险变更。简报通知的系统记录归第 21 项。

**复验条件。** 使用明确可恢复的测试变更，核对 Windows 通知、点击、原补偿任务和独立目标读回。另检查无补偿动作的撤销和高风险操作先问。[风险档与简报回执](JOINT_LIVE_PREPARATION_20261111.md#2026-11-19-自动执行风险档与真实待审批简报) · [重启与恢复读回](../../../.worktrees/real-device-main-20261118/.cache/latest-main-risk-briefing-uYEn21/restart-independent-readback.json)

### 18. PR #631 目录、日历与邮件主动来源

**目录触发和撤销通过，内容分析、日历和邮件仍缺。** 首次扫描建立基线，新增公开文件后只创建一个根任务。它派生一个 1017 WSS 子任务。读取被 Policy 拒，`executionStarted=false`，子任务为 `failed/TIMEOUT`，父任务进入 `waiting_reconciliation`。撤销目录后，真实下一轮扫描没有创建新任务。关闭开关后取消下一排程。

**原因。** 本轮仅打开专用目录来源，显式停用了日历和邮件。目录任务完成了触发和派发，文件读取许可没有放行。源码审查发现，主动日历与邮件直接调用业务工具时把会话 ID 当作任务、运行和授权标识使用，和生产工具要求的原任务绑定不同。两个真实来源尚未实测这条代码路径。

**复验条件。** 为真实来源建立正确的任务、对话和连接器会话绑定。分别用专用日历事件和测试邮箱触发，核对根任务、活动记录、静默限制、高风险先问和关闭后的下一轮行为。[目录触发与撤销回执](../../../.worktrees/real-device-main-20261118/.cache/latest-main-proactive-directory-jYibFj/revoke-independent-readback.json)

## 用户可见结果、连接器与远程 MCP

### 19. PR #633 失败后重试与只读回放

**三类原任务的只读查看通过，重试与重新规划未验。** 天气失败显示不可恢复和停止时间线。目录任务原审批过期，子任务为 `failed/TIMEOUT`，唯一读取被拒且未执行，原 `request_parent_replan` 决策未派发。CalDAV 已真实写入，本机保留 `waiting_reconciliation`。查看三个副本前后，原任务、工具记录、修复检查点和云请求身份均一致。

**原因。** 这三类分别是不可恢复、审批过期和结果待核实。现场没有进入可重试读取、高风险终态失败、人工放弃或实际父任务重规划路径。

**复验条件。** 用独立测试对象分别触发可恢复的只读失败和正式高风险失败。核对原任务状态、新任务 ID、取消或放弃结果及父任务重规划事件。回放时独立核对工具与副作用计数保持原值。[三类真实失败回执](../../../.worktrees/real-device-main-20261118/.cache/real-failure-review-rgfCLT/receipt.json)

### 20. PR #634 活动时间线

**插件事件、撤销和重启保留通过，其他来源缺接线。** 正式页面记录插件停用、启用与撤销启用，能查看原因。原两条活动内容保持不变，新增补偿记录引用原启用。重启后保留停用状态和活动历史。真实目录事件已生成任务，但该批活动页、账本均为零条。

**原因。** 当前活动宿主的事件与失败回调从插件装配接入。主动目录、风险档和任务自愈缺各自的活动适配器。

**复验条件。** 分别用真实主动来源、风险执行和失败修复生成事件，核对原任务与新增活动可关联。针对有补偿的动作检查新增记录指向原事件，重启读回两者。[活动页面读回](../../../.worktrees/real-device-main-20261118/.cache/real-plugin-activity-Q32Adw/visible-card-readback.json) · [独立账本核对](../../../.worktrees/real-device-main-20261118/.cache/real-plugin-activity-Q32Adw/independent-readback.json)

### 21. #635 每日简报、Windows 通知和审批跳转

**补跑、系统入库和去重通过，审批跳转失败。** 13:58 的简报在 13:59:37 补跑一次，包含真实待审批任务和审批 ID，原工具未开始。Windows 通知库匹配到 `toast` 84928，载荷只有标题和计数。重启后简报与通知各一条。关闭每天生成后，次日排程转为 `cancelled`。

**原因。** 主面板实际点击「查看审批卡」后未定位原卡。按钮在主面板，`briefing.openDecision` 的 IPC 只接受管理后台调用。Windows 通知的系统点击是另一个环节。现场未定位可点的系统窗口，`clickedAt` 为空，横幅也未目视取证。

**复验条件。** 统一按钮与受信调用入口。以同一条真实待审批任务核对系统点击、简报打开、定位原审批卡。独立确认系统通知记录、点击时间和原卡 ID 一致。[Windows 通知读回](../../../.worktrees/real-device-main-20261118/.cache/latest-main-native-briefing-qwMdyl/windows-notification-readback.json) · [重启去重](../../../.worktrees/real-device-main-20261118/.cache/latest-main-native-briefing-qwMdyl/restart-and-disable.json)

### 22. PR #636 日月用量上限

**持久化、手动任务与超限通知通过，自主任务超限门禁未通过。** 日限设为 0.008 元，初始 6 条记录的本机估算为 0.008211 元。手动 1017 父子任务成功，新增两条 HTTPS 时长。超限通知落为 `delivered`。同一超限状态下，真实目录排程仍派发 HTTPS，新增 6,330 毫秒。重启后 9 条明细、阈值和通知一致。

**原因。** 目录排程创建在 `desktop-panel` 会话，账本记为 `origin=user`。代码按主动会话前缀或持续工作流检查点识别自主来源。实际来源标记与门禁条件错开，导致该调用未被拦截。

**复验条件。** 从可信排程事件传递来源到派发和记账。在同一超限条件对照自主任务零云调用、手动任务仍可执行。分别核对 WSS 记账、模型 token、降级和供应商账单。[真实超限任务回执](../../../.worktrees/real-device-main-20261118/.cache/real-budget-threshold-muHWEQ/receipt.json) · [重启独立读回](../../../.worktrees/real-device-main-20261118/.cache/real-budget-threshold-muHWEQ/independent-due-restart-readback-confirmed.json)

### 23. PR #637 总暂停

**提交门禁、重启保留、显式恢复及在途云取消通过。** 正式面板暂停后提交测试内容被拒，SQLite 无任务或工具记录。正常重启仍为 `paused=true`，从面板恢复后读回 `false`。真实在途 WSS 对照的同一请求在云端进入 `failed/CANCELLED`，Trace 为 `6a33a5c3-30aa-470c-b37b-5a667e590915`。本机原父子任务进入 `waiting_reconciliation` 并保留未知结果。

**缺口与复验条件。** 当前证据覆盖面板开关与在途取消。还需实际从托盘触发并核对面板同步，以及在原任务待对账时验证恢复和重复执行约束。[真实在途取消](../../../.worktrees/real-device-main-20261118/.cache/latest-main-cloud-brake-y21rn0/receipt.json) · [正式设置读回](../../../.worktrees/real-device-main-20261118/.cache/latest-main-settings-tBFIij/receipt.json)

### 24. PR #638 真实日历与邮件看板

**导航和空状态通过，周期保存未通过。** 在 PR 原 head `2712e4d0` 可打开看板。把「每周」改为「每天」返回 `stage=ipc; code=EXTERNAL_FAILURE`，重启仍为每周。主线复测也失败。SQLite 没有看板排程、汇总检查点或结果文件。

**原因。** 当前看板尝试装配时 Competition Runtime 尚未创建。日历读取会话许可固定为 `false`，邮件也缺正式会话范围。本轮未接入真实日历和邮箱，现场没有进入汇总阶段。

**复验条件。** 调整装配顺序并接通实际来源授权。用专用日历与邮箱核对周期保存、真实排程触发、独立合计与重启读回。撤销后核对下一个周期不再读取来源。[原 head SQLite](../../../.cache/joint-pr638-20261113/profile/runtime.sqlite) · [主线设置复测](../../../.worktrees/real-device-main-20261118/.cache/latest-main-settings-tBFIij/receipt.json)

### 25. PR #639 插件权限清单与运行时沙箱

**四类空权限拒绝通过，声明路径边界和授权正例未验。** 正式管理后台用已安装的 Internal Communications，分别检查网络、文件读取、连接器和密钥。四次均被拦截，日志恰四条。界面、IPC 返回与持久日志未回显测试内容或密钥值。重启后日志保持原值。

**原因。** 本轮插件未声明所请求的四类能力。所有请求在权限匹配阶段被拦，尚未进入声明路径归属与实际目标核对。

**复验条件。** 给专用插件声明最小权限，检查声明内可访问、范围外拒绝，并记录 Windows 路径边界和链接目标判定。高风险启用单独读回授权状态。[权限拒绝与重启回执](../../../.worktrees/real-device-main-20261118/.cache/real-plugin-activity-Q32Adw/independent-readback.json)

### 26. 专用 CalDAV 日历修改

**11 月 12 日基线两模式通过，后续主线两模式均未确认结果。**

- 在 `0bb22cd75` 基线，受限模式出现一张合并工具、会话与出站要求的授权卡。全权限模式无批准卡。两种模式各执行一次 `calendar.update` 并为 `confirmed`，父子任务均成功。独立 GET 核对同一 UID、标题、时段、强 ETag 改变和 `SEQUENCE +1`。[受限模式原回执](../../../.worktrees/real-device-main-20261111/.cache/desktop-calendar-update-live-Mq4wkU/receipt.json) · [全权限原回执](../../../.worktrees/real-device-main-20261111/.cache/desktop-calendar-update-live-0DkNe2/receipt.json)
- 11 月 18 日受限模式、11 月 19 日全权限模式的新集合各发生一次真实外部写入。独立 GET 均读回目标属性及 `SEQUENCE 0→1`。两次的本机工具记录均为 `RESULT_UNKNOWN`，父子任务为 `waiting_reconciliation`。已写入的原任务保留，未重放。[后续受限模式 GET](../../../.cache/joint-main-20261118/calendar-restricted-independent-get.json) · [后续全权限独立回执](../../../.worktrees/real-device-main-20261118/.cache/desktop-calendar-update-live-91aaUf/independent-readback.json)

**原因线索。** `calendar.update` 的顶层 `summary` 存固定成功文案，实际事件标题在 `item`。通用试运行校验把预期事件标题和顶层同名字段比较。这个字段差异与失败位置相符。现场的 `RESULT_UNKNOWN` 未记录具体失配字段。

**复验条件。** 把结果校验绑定到原 UID、请求摘要和实际事件字段，随后用独立 GET 证明 Runtime 能确认同一次写入。复验使用新集合或新 UID。

### 27. 远程 MCP 真实只读

**实际单次客户端读取、拒绝及撤销通过，有效审批跨正常重启受阻。** DeepWiki 4.0.2 经真实 HTTPS 完成初始化、身份和目录校验。握手阶段业务执行为零。拒绝任务 `3256e68a` 未执行。批准任务 `c38d81f6-67e7-4830-a01f-0bcb51bd7e9f` 有一条 Runtime `confirmed / allow` 执行记录，返回 1,912 字节结构化内容。公开网页独立匹配目录主题。断开、撤销密文配置及重启后，原结果与 Evidence 仍可读。

**原因。** 第 7 步要求在待批许可仍有效时正常重启。14:46:29 点击退出时，原许可仍有效至 14:48:29，Desktop 返回 `EBUSY`。进程仍运行，任务待批，执行次数为零。显式取消后能正常退出，重启默认断开，原审批读回 `denied`。另一批的旧任务在重启前已到期，读回 `TIMEOUT`。这两次分别验证了显式取消与过期。

**复验条件。** 若仍要求正常重启跨越有效审批，需定义审批持久化与新会话核验规则，并关联原审批、有效期和新会话的执行计数。远端调用次数从服务方日志或可审计 HTTPS 测试服务独立读回 `tools/call` 计数。历史 Cloudflare 路径已通过连接和目录比对，单独预检发现正式验证器无法编译其 Draft 2020-12 输出 Schema。原调用在「低风险自动」档曾开始后失败，远端是否收到业务调用未知。[十步实测记录](../../../.worktrees/real-device-main-20261118/.cache/mcp-live/deepwiki-20261119/record.md) · [有效期内退出对照](../../../.worktrees/real-device-main-20261118/.cache/real-mcp-deepwiki-stale-i4o0vN/pending-quit-receipt.json)

## 新合并增量

### PR #642 实时语音回声防护

**最新主线构建通过，真实播报排空不可执行。** `f33ef383` 在正式 Windows Desktop 启动，已配置 AgentArts。页面显示「实时语音：未配置」，向百炼转发音频的同意未选，Live 和麦克风均未启动。退出后 SQLite 中零新增云请求和工具执行。原验收驱动把快照中缺省的 `configured` 字段断言为 `false`，在取得页面状态后退出 1。独立回执重新核对了页面、音轨状态和 SQLite。

**复验条件。** 在已授权的 Live 会话启动真实播报。使用同一播放标识确认排空前持续防回声，排空后释放。另用旧播放通知验证它不会修改当前会话的状态。[真机前置读回](../../../.worktrees/real-device-main-20261118/.cache/pr642-voice-preflight-odpDpQ/independent-preflight-readback.json) · [PR #642](https://github.com/xianxing-ai/PersonalAgent/pull/642)

### PR #649 正式 Node 语法诊断

**独立 Node 诊断定位通过，正式失败卡未验。** 正式工作区保存并在重启后读回 Node 和公开测试文件，工具目录含 `workspace.node_check`。1017 WSS 子任务已分派，本轮未取得语法检查提案、实际命令回执或失败卡。独立 Node 诊断经生产解析器定位到第 3 行，原诊断没有列号。

**复验条件。** 从正式任务触发已公布的语法检查，将可信命令诊断保留到失败卡，并在同一文件通过跳转核对行号。有列号时，核对原始诊断与实际跳转一致。[派发与诊断](JOINT_LIVE_PREPARATION_20261111.md#2026-11-19-649-正式工作区语法检查的联合派发)

### PR #650 实时语音播报

**实际播报未验。** 第 8、9 项的听写和唤醒处于不可用状态。#642 的新主线复核也显示原生 Live 未配置。播报须在已授权的 Live 会话中用真实文本结果及实际扬声器确认，从队列、交接和最终播放状态取证。[语音前置回执](JOINT_LIVE_PREPARATION_20261111.md#2026-11-19-pr-642-实时语音回声保护的真机前置验收)

### PR #657、#659、#666 偏好、默认权限与天气

**偏好生命周期、默认设置和公开天气读取通过。** 全新正式配置读回「低风险自动」及 `mode=read-only`。一条公开纠正重复提交后仍为一个 ID，停用、恢复、撤回及重启均保存原身份与撤回状态。天气卡从空状态配置公开城市青岛，实际执行一次 `weather.forecast`，SQLite 为 `confirmed / allow`，卡片显示结果和来源。

**缺口。** 该批没有发起模型请求。偏好进入真实模型提示及撤回后不再注入仍缺出站读回。天气错误文本的特殊字符渲染仍缺失败样本。[正式设置与天气回执](../../../.worktrees/real-device-main-20261118/.cache/real-settings-preferences-ql07BC/receipt.json)

### PR #658 流式回答、独立助手与运行中插话

**库迁移、助手持久化和无插话续传通过，插话续传未通过。** 正式合并版 `1da22da5` 迁移 SQLite v12 到 v14，保留 6 条原任务。主对话和独立自建助手实际使用 1017 并显示答案增量。助手重启、改名和删除后，原任务历史可读。长多轮、多块流式及实际推理增量未取证。

**两条失败记录。** 直接 F17 查询的本机工具已 `confirmed`，出站回执被拒。后续 SQLite 读回显示 `source` 字段带内容围栏，与固定投影重算值不一致。另一组对同一 `capability.search` 做对照。无插话组发出两个 HTTPS 请求并成功。有插话组已消费原队列且写入 `competition-inject-2`，工具投影已进入第 2 步，下一步在本机报 `REVISION_CONFLICT`。该组只有首个请求，具体比较点待定位。

**复验条件。** 分别核对工具出站字段规范化和插话后的续传修订绑定。用同一正式助手任务证实第二次请求实际发出、Trace 匹配、答复采用插话。[合并后真机回执](../../../.worktrees/real-device-main-20261118/.cache/pending-pr658-merged-live-kFF8R6/postmerge-independent-audit.json) · [同工具插话对照](../../../.worktrees/real-device-main-20261118/.cache/pr658-assistant-discovery-ja8lka/independent-readback.json)

### PR #669 桌面宠物与任务状态

**形态、预览、持久化及执行中、完成、失败状态已验。** `f4ab1ffc` 的正式桌面读到 8 种独立形态、6 种手动动效和三个窗口的同步偏好。恢复默认及重启读回通过。应用内减少动效和 Chromium 模拟偏好都已观察到画面收敛，Windows 全局减少动效未切换。

**原因与缺口。** 真实 MCP 批次出现「待机 → 执行中 → 已完成」，拒绝对照显示「失败」。四次子任务待授权期间，悬浮球仍显示运行中的父任务为「执行中」。需在同一父子任务上核对产品怎样投影子任务审批状态，并读回正式标签与动效。[宠物绘制回执](../../../.worktrees/real-device-main-20261118/.cache/pet-669-live-kJ1pOB/receipt.json) · [真实任务状态批次](JOINT_LIVE_PREPARATION_20261111.md#2026-11-19-第-15-项直接-mcp-续传与-669-真实任务状态)

### PR #671 28 图、观测设置与真实答案

**正式目录与文本往返通过，整图执行和产品独立观测在实测配置中不可用。** 在 `ac68fbf9` 的设置和工作区，两处均按序显示 F01–F28、185 个节点、152 项适配器需求。此隔离配置的 28 图均显示不可用。F17 的受信 IPC 读回四节点、缺运行入口和适配器。目录读回前后零任务、零工具、零云请求。另一个无配置的正式对照仍显示公开设计目录和配置提示。

**原因与边界。** 目录返回当前配置的缺项和设计需求。观测设置缺受信凭据，产品独立观测保持 `unavailable`。独立助手的 1017 文本请求实际成功，平台日志匹配 Trace，重启后原答案仍可读。

**复验条件。** 逐图发布实际入口、适配器及受信授权。以同一执行 ID 读回每个节点和目标结果。产品观测另需独立读回权限、原请求绑定和调用结果。[正式目录和独立答案](../../../.worktrees/real-device-main-20261118/.cache/pr671-joint-live-0eODMC/independent-readback.json) · [无配置对照](../../../.worktrees/real-device-main-20261118/.cache/pr671-no-agentarts-FX3uVz/receipt.json)
