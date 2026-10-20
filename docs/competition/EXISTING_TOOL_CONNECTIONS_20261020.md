# 已有工具接入（2026-10-20）

## 同账号任务取消隔离修复（2026-10-20）

- 普通无冲突合并 main `93e00889`，保留原 PR 双方历史。provider 每次执行独占，完成及中断均幂等释放；单任务取消不关闭同账号另一任务连接。family 撤销仍中止全部该 family 在途操作。
- 异步凭据返回后按 combined signal 复核取消、宿主撤销和超时，阻止迟建 provider。原授权、账号、配置修订、出机确认、凭据过滤及 unknown 不重试语义保留。
- Pinned Node 24.15.0/npm 11.12.1：完整 `connector-conversation-tools.test.mjs` **19/19**，包括双任务取消隔离、family 撤销、延迟凭据取消/超时/撤销零创建、超时零重试及原 Runtime 审批执行；Desktop `typecheck` 通过。新增测试初次语法错误已修正后完整重跑；未进行全仓或真实账号/设备验收。
- 复用本机 `pr442-maintenance-20261020@db272758` 已构建依赖：比较 Runtime 与 packages（含 connectors）的 `src`、`package.json`、`tsconfig.json` 与本次合并头无差异；未使用 #451 Runtime 产物、安装依赖或重建大闭包。
- 后续复核修复本轮引入的清理等待问题：执行 finally 只发起幂等 cleanup，不等待异步 dispose；family invalidate/close 原有等待语义不变。完整定向文件重跑 **22/22**，Desktop typecheck 与 diff check 通过。新增挂起 dispose 的取消/超时用例设 1 秒返回界限、3 秒测试 timeout，并在 finally/after 释放 cleanup，断言仅一次 dispose、一次原写入且无重试；这不是对真实网络或账号延迟的验收。

状态：review（整仓首轮环境失败，重建helper后受影响工作区及桌面烟测通过；当前head CI与批准单独核对）；profile：huawei_ict_agentarts；隔离工作树 `27bb/Personal Agent`；分支 `codex/connect-existing-tools`，基线 `fe60cce4`。用户已授权提交 PR；提交、远端分支和审查状态以 Git/PR 记录为准。本分支同时包含此前已推送的上下文完整性修复，PR 对照 main 时一并列明。

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

## 接线初验结果

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

## 主线同步后的复验（2026-10-20）

- 普通合并 main `85e686fc`，保留 `owned-1.7` 上下文规则及主线有依据的直接回答要求。协作者同期推送 `d64d945c`，其生产树与本地一致，另有两条提示词回归断言；通过普通合并保留双方历史，未强推。
- `npm run check` 实际执行540秒：架构、契约、生成、构建及类型检查通过；Desktop **1378通过/9跳过**，Runtime **877/877通过**。此前三项F15失败在本轮没有复现，不据此声称并行不稳定根因已修复。
- 首轮命令退出1，唯一失败工作区为Coding Tools三项原生身份查询及Knowledge一项恢复测试。验证入口仍引用旧缓存helper，实报 `--exe <target> is required` / 身份未确认；旧二进制不支持当前源码的查询协议。失败日志保留，不改断言或跳过用例。
- 用当前源码和本机已有.NET8重建受信helper，先核实真实进程身份查询，再完整复跑：Coding Tools **274/274**，Knowledge **57通过/1既有跳过**；AgentArts含协作者新增断言 **212/212**；集成 **51/51**。
- 本轮没有将上述“首轮失败＋受影响复验”表述成单次 `npm run check` 返回0。新提交的远端必需CI及非作者批准另以PR当前head为准，旧头绿色不替代新头。
- 文字、工作区及Runtime Application三项桌面烟测均退出0，使用独立测试数据目录和显式合成配置；日志为本机 `pr442-current-*-smoke.log`，不冒充真实模型/业务账号验收。
- 原用户桌面、数据、凭据和固定云镜像未因本轮自动化复验被重新发布或替换。新的host安装物与所有日志保留在忽略目录/受信临时目录，不提交二进制或个人绝对路径。
- 本机日志：`pr442-sync-check.log`、`native-helper-build.log`、`pr442-current-coding.log`、`pr442-current-knowledge.log`、`pr442-current-agentarts.log`、`pr442-current-integration.log`。

## 日历写工具共同对话入口增量（2026-10-20）

本源分支正常吸收 #439 最终 `9080f52c8fd8706d7f882efbb91d9e0bb2a98f78` 的连接器依赖后，在原 `connector-conversation-tools.js` 增加精确的
`calendar.create/update/cancel` allowlist 和真实 `CalendarEventWrites` 嵌套代理。文字与 Live
继续使用 Main 已有的同一个工具集合、availability、prepareExport 和精确出口策略；没有第二注册入口。
每次执行的原 provider 生命周期、配置身份、会话、原授权引用及 `calendar:write` 校验不变。
原 Policy/Gateway 执行审批与 metadata/result 云出机确认分开，不能以本地读取许可代签写入。
create 不声明幂等或恢复；已开始写入的取消/超时/配置撤销仍须沿原任务核实，不自动重发。

新增测试使用显式 Fake CalDAV 传输与实际 Runtime/Policy/Gateway/SQLite，覆盖模型目录可见、
三个写操作批准前零网络、allow_once 后一次写、独立出机确认，以及只读 scope 拒绝、取消和配置撤销不重发。
原邮件/日历读取及 provider 生命周期回归保留。Node 24.15.0 于 2026-10-20 15:30–15:31 UTC：
Calendar 当前源码 tsc build/noEmit、两个 JS 的 node --check 通过，完整 connector-conversation-tools 单文件
33/33 通过（原22项保留，新增三个实际 Runtime 正例、三个 UNKNOWN 禁止续接/重复 proposal 子例及 scope/取消/撤销）。
复用已构建树 db272758 的30个依赖 dist；逐包 src/package.json 比对完全一致，Runtime 没有重编，未 install。
首次运行29过/4失败（含父聚合）仅因新增 fixture 把原 confirmed-only handoff 的 UNAUTHORIZED 错写成 RESULT_UNKNOWN；
核对原 Runtime 源码后修正精确错误码，仍必须拒绝续接，未修改生产 gate 或删除原断言。原失败日志保留。
最终日志 `.cache/pr442-calendar-write/consumer-final.log` SHA256 `d16df5760a8c61a300eaada984391332643e2a18d90d001cd4a000f9fc85cfee`。
不宣称真实账号、平台验收或依赖 PR 已合并。#439 独立审查及本 PR 当前技术 CI/非作者批准仍各自保留。
