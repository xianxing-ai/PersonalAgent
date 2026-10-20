# 已有工具接入（2026-10-20）

状态：review（本地接线与回归；整仓默认并行检查非全绿）；profile：huawei_ict_agentarts；隔离工作树 `27bb/Personal Agent`；分支 `codex/connect-existing-tools`，基线 `fe60cce4`。用户已授权提交 PR；提交、远端分支和审查状态以 Git/PR 记录为准。本分支同时包含此前已推送的上下文完整性修复，PR 对照 main 时一并列明。

用户授权把可以接入的接口接入正式项目。此包消费已有 mail/calendar/GitHub 公开实现及原 Runtime/Policy/ToolGateway；不创建第二注册表、任务库、发送循环或配置库。

## 兼容与权限

- Desktop 消费 mail 包已有 inbox、accounts、mark_seen、save_draft、reconcile_send，以及 calendar 包已有 events。mail.inbox 保留同一注册名：原内部批任务交给原分类宿主执行其 session/UID 校验，普通对话另走完整任务与出机许可。原单事件会议事实绑定保留。
- 使用本机已有加密配置。未配置则明确不可用；原信头本地分类许可不扩大成写入或出机许可。
- 新工具不加入 automaticTools。原任务审批与完整 metadata/result 原生出机确认分别执行，绑定任务、会话、参数和当前账号配置，撤销/更换配置后拒绝旧许可。撤销按 mail/calendar 隔离，不影响另一连接器的独立许可。执行和异步凭据读取贯穿取消与 deadline，未知写入不重试，凭据不进入结果或错误正文。
- GitHub repair link 通过受信配置文件的 `github.repairLinks:true` 单独装配，缺省不启用；仍按原 scopes、审批和精确出机门禁执行。
- 无 Core wire、公开 Schema 或数据库迁移；新增两项已有内部 workspace 的 Desktop 直接依赖，复用根锁文件，无第三方新增依赖。

## 验收

工具注册、缺配置关闭、原任务审批、读取/草稿及已读写入、跨账号拒绝、参数替换、撤销、取消、原发送身份拒绝及结果出口拒绝；随后受影响模块回归、架构/类型检查与必要整仓检查。

真实邮件/日历账号及业务写入不作为自动化夹具。真实提供者或原始发送记录缺失时不能宣称真实验收通过。平台 Trace signer、F23 受信配置提供者、其余未实现图适配和 Artifact 服务单独列缺口，不用 Fake 填成可用。

## 实际结果

- 当前实例由34变为48项登记：6项邮件/日历，7项Windows控制（含request_access），1项Notepad。邮箱/日历未配置时仍不可用；登记不代表已获得账号或出机许可。
- 新连接器最终定向回归13/13；实际Runtime在批准前零写入、批准后原执行一次confirmed，明确Fake提供者不冒充真实账号。GitHub配置回归31通过/1跳过（32项）；退出资源回归17/17通过。
- 最终Desktop完整1335通过/8跳过（1343项），最后撤销隔离增量已包含在内。集成51/51通过。
- 整仓 `npm run check` 实际执行，架构/契约/生成/类型检查通过；9项退出夹具未声明新资源的失败已修复并定向通过；原Runtime并行F15三项失败保留，同一文件隔离28/28通过。未放宽断言，不记整仓全绿。
- Windows Host/PipeBridge Release构建0警告/0错误。独立Python3.14.6及Windows-MCP0.8.8安装到项目 `.cache/`；[PyPI元数据](https://pypi.org/project/windows-mcp/0.8.8/)和仓库固定wheel SHA一致：`597ef720e1902ba76510a4d2b946949f8a48f281dd210c183de5ded60ea3b873`。没有系统Python替换、计划任务或HTTP服务，不捆绑分发这些安装物，也不声称全部传递依赖已锁定。
- 真实stdio启动/版本/目录核对通过，正常dispose，耗时约27秒（含启动/关闭）；主进程启动预算相应调整到60秒。未调用Snapshot、鼠标或键盘；当前启动入口显式配置独立Python，不开启PA_WINDOWS_CONTROL_EXPORT。F9、目标绑定与逐次审批保留，真实输入/设备闭环未验收。
- 原桌面空闲时正常退出，原数据与凭据保留。固定云版本仍为 `arm64-context-1-7-1020`，没有重新发布镜像。真实任务 `60078105-7b1a-4224-8852-6e46ec285eba` succeeded，回答“哈喽～我在呢，有什么想让我帮忙的尽管说。”；48项目录与Notepad组件ready已实际读回。启动器曾丢失调试连接，已识别实际存活的本项目进程，并恢复被重复启动覆盖的生成端口记录，未误停早期独立诊断进程。

最终撤销隔离源码已重新加载至进程60288，实际48项目录与固定1.7读回通过；真实问候任务 `7e8a36f2-3064-406e-afee-750b37abe6f3` succeeded。当前桌面保持打开。独立启动入口和端口记录正常，不需沿用早期启动器丢失连接的状态。

本机证据目录 `.cache/verification-20261019/`：`connect-tools-check.log`、`connect-tools-scoped.log`、`connect-developer.log`、`connect-desktop-delivery.log`、`connect-integration-final.log`、`connect-f15-isolated.log`、`windows-control-ready.json`、`connect-desktop-verification.json`、`connect-native-desktop-startup.json`、`tool-interface-audit-20261020-after.json`。不提交日志、账号、虚拟环境、数据库或会话正文。

## 仍缺真实依赖的范围

| 范围 | 当前缺项与继续入口 |
|---|---|
| 邮件、日历 | 在原本机设置配置账号；原任务审批与出机确认独立。reconcile_send还需原Message-ID/幂等键身份，本包不伪造发送记录，未新增mail.send。CalDAV写侧仍不支持；未做真实邮箱/日历读写 |
| 工作区/F15与GitHub | 需用户选择工作区、可信可执行文件/配方和本会话许可；GitHub还需原受信配置/Token文件。repairLinks:true仅控制注册，不代替checks:write审批，不把Codex自身权限转给产品模型 |
| 知识/私人源、待办/目标 | 原宿主已接；知识/私人源尚未选择，待办/目标会话出口仍关闭。不自动扫描个人笔记或扩大许可 |
| Windows、语音 | 其他启动入口须显式配置PA_WINDOWS_CONTROL_PYTHON；当前界面出机未开启，Notepad组件ready不代表已执行输入。SIS麦克风/扬声器/唤醒仍未配置与验收 |
| 28图 | 当前实例仍缺152项host/guard。F15三项工厂因工作区未配置而未登记；F23 N04/N05缺真实configurationPort/CAS、acceptance及验证提供者；其他图缺各自适配和通用图执行入口 |
| AgentArts观测 | 有公开消费端，缺平台applicationId和专用AK/SK signer。SIS签名器仅允许固定SIS POST，不扩展目的地，不复用invoke Bearer |
| 其他公共接口 | 任意MCP/OAuth/写工具、任意Skill脚本、Artifact生命周期及公共settings/connector/voice等wire仍缺相应实现；Desktop私有IPC不冒充完整公共服务 |

没有真实提供者可消费的项保留明确缺口，不创建假CAS、假签名、假模型或假图执行回执。
