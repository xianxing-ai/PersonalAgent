# zemeng 自有能力与主对话接线矩阵（2026-10-18）

目标 profile 为 `huawei_ict_agentarts`。依据为 [最新模块分工](../MODULE_ASSIGNMENTS.md)
顶部 2026-10-17/18 交接、[CW 接线包](COLLABORATOR_WIRING_PACKAGE.md)、
[当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md) 与实际源码。
固定起点为 main `4168bd197abca4782ba8dfc2401cacfff7a5c3b5`，本轮复用现有 #406
`a37cd414280ec76c82f662e58610b1cbc49d215d` 的真实 `user-work` 委派和持久子会话。
本表是接线事实，不把所有 MOD、云业务、设备或模型质量标为通过。

Renderer、页面组织和页面消费归 `2511375597-lab`；Runtime/模型/Policy/知识记忆底座归
goo122；业务连接器和六项 DEV-WORKFLOWS 继续按原分工。下表只记录 zemeng 提供的核心、
桌面、语音、Windows 与编码消费边界，不接管他人模块。

## 状态与调用约定

- **已实现并有调用消费**：具有实际提供者、原执行入口和有界结果回传；仍可能需要配置或当前许可。
- **已接未真验收**：本轮 Local/Synthetic 路径成立，真实云/模型/账号/物理设备仍未验证。
- **配置缺失 unavailable**：目录或宿主必须明确拒绝；不是待办占位成功，不静默 Fake/Local fallback。
- **未接剩余**：指出现有实现缺少的调用方/端口；主进程已组合与各专项已验证分别记录，Synthetic 不代替真实环境验收。

主文字界面与 Live 使用同一 Runtime。#406 根任务只派发其原绑定 `subagent.dispatch`；
实际业务 schema 与工具执行进入原 `user-work` 子任务。Live 的原生工具为 `request_work`、
`read_context` 和本轮 `wait_for_task`；业务操作经 `request_work` 回到相同子任务链。
文字能力摘要与 Live 分页参数目录使用同一 Runtime 公开能力元数据；分页保持完整 schema，不截断参数。
能力说明/注册 schema 不等于该次任务已授权、可执行或已执行。

`readToolConversation(actualTaskId)` 使用原持久父子/追加消息绑定解析 UI 所属；随后核对原 UI
会话登记。它只读结构身份，不替换执行 taskId，不继承历史私人记忆/Skill 许可。
每次执行仍受原 deadline、取消、版本、当前授权及 ToolGateway 约束。

## 核心、AgentArts 与持续责任

| 包 / 具体能力 | 已实现位置 / 公开 id | 文字与 Live 可见、执行、回传 | 当前状态与必须条件 | 真正剩余 |
| --- | --- | --- | --- | --- |
| CW-01 Local Laya 候选、可信回执实验 | `packages/agentarts/src/workflow-decision-tool.ts` 的 `decision.choose_candidate`；`owned-workflow-host-bridge.ts`；镜像 `local-laya.mjs` / `laya-selector.mjs` | 属于既有 Local/历史实验及图内候选端口；不因有 descriptor 就成为当前 Competition 的可用判断器 | Local 扩展暂停；本轮未启动 Laya，也不以其作为 Competition 验收前提 | 不是当前 Competition 必须补接项目；150ms、真实收益、资格和质量均不能由历史短输入或 Fake 证明 |
| CW-02 主文字模型、CloudAgent 与镜像 | `packages/coordination/src/agentarts*.ts`；Runtime `application/agentarts.ts`、`coordination.ts`；镜像 `server.mjs/main.mjs/model-proxy.mjs`；原 HTTPS/WSS 与 `/inference/v1` | 是原主/子任务模型调用通路，不是让模型配置凭据或发布部署的工具；工具提案→本地 Policy→Evidence→continuation 已有实现 | 配置 gateway/runtime/原部署版本、授权提供者后可调用；本轮只本地镜像/显式模型替身，真实云不可用 | 当前精确远端版本业务读回、平台 trace/评估、原生 knowledge/MCP、全域多 Agent 质量缺专项真实证据 |
| CW-02 主动镜像固定版本 | Runtime `proactive-image-adapter.ts`；Owner #404 单文件补丁 | #404 将 WSS `?endpoint` 与受信 deploymentVersion 映射到同版 HTTP invocations；部署 guard 不来自模型参数 | **primary 已组合、未真实云验收**：Owner 原修复与 main 原 transportConfig 的版本、guard、受控 fetch 已接入 | 已补旧 main/#406 丢版本的接线；配置字符串/HTTP 200 仍不证明命中远端版本。Owner 补丁专项 6/6 只证明本地语义 |
| CW-02 请求 trace / 运行日志 | `packages/agentarts/observability`；Runtime `agentarts-observation.ts` | 现有受信 reader/application 端口，未公布为主模型业务工具；不是部署或任务成功依据 | 缺 AK/SK 签名 observation authorization、实际请求/agentRun 身份时 unavailable/unknown | 独立 CLI/可信调用方与真实平台读回另验；不得猜 trace、agentRun、成本或部署命中版本 |
| MOD-27 Goal 创建、修订、读取 | `packages/goals`；Desktop `goal-cloud-host.js`；`goals.create/revise/list/get` | 本轮修复动态 UI 会话、真实 `user-work` 子任务归属；schema→Gateway→SQLite→续答已验证。Live 经 request_work 消费相同工具 | 目标出云会话许可、原 UI 归属、原图/Goal revision 与 Policy；restricted/不安全内容不得投影 | 真实模型自然语言质量/多来源 Goal 流程未由合成例验收；不得用模型提供 sourceRef 替代宿主来源 |
| MOD-27 Goal 结果分页 | 同 `goal-cloud-host.js` 的 list/read 投影 | list 按完整 JSON 的 7500 UTF8 字节预算缩页，nextAfterId 指最后实际项；不截 ID 或跳过记录 | 中文长 Goal 精确分页合成验证通过；单项超页预算明确提示在本地检查 | 单个不可投影目标仍不能出云；本地完整数据保留，不能把拒绝说成目标不存在 |
| MOD-28 Goal 分析、已审修复提交 | `goal-cognition-host.js`、`proactive-cognition-host.ts`、`local-repair.ts`；内部 `cognition.commit_repair`；管理 IPC `proactive.cognition.apply` / `cognition.proposals.*` | 已有管理/受信 reviewed source 路径；不是向模型公开 guard、intentDigest、源证明的接口 | 当前 Desktop Goal cognition 仍要求本机 Laya chooser/ready；本轮保持 Competition unavailable，不启动或新扩展 Local | 缺无 Laya 前提的 Competition 合格判断/受信 reviewed source 消费；不借“接线”另写已暂停的最小修复算法 |
| CW-03 责任生命周期 | `proactive-conversation-tools.js` → `proactive-workflow-host.js` → Runtime `proactive-workflow-application.ts/session.ts`；`proactive.workflow.start/list/read/control` | 本轮新增可执行 schema、原 ToolContext 派生 sourceTaskId/commandId、原一次授权与有界 continuation；只返回已受理/真实当前状态 | 可信签名镜像、decision contract、原配置与未过期责任；缺配置不发布可执行能力。primary main 三数组与原历史结构会话映射已串接；本地专项通过，统一主进程组合证据见 Root 最终记录 | start 成功不等于任何业务动作完成；真实来源/动作组合仍见下两行 |
| CW-03 四入口与公开上下文 | Runtime `ingestUserInstruction` / `eventSink.persist` / `ingestSubtaskFeedback` / `ingestWake`；Desktop `proactive-context-ports.js` | 原用户指令已由 start 消费；Runtime 已有子回执消费；公开 Memory/Goal/精确 Knowledge lease 可读取。内部 `proactive.retrieve_context` 只执行原签名 proposal | 私人/未获许可 Knowledge 不注入；源撤回/版本变化拒绝当前引用；业务账号和来源端口仍归原 owner | **primary 已组合、Local/Synthetic 已验**：新 `proactive-confirmed-source-router.js` 只消费原 native-interest 精确 tracking task 的 confirmed 公开 receipt；新 pump 将原 Scheduler fired 回原 host。后台无 scope collect 不自动投递，缺授权明确 unavailable |
| CW-03 teacher 与业务动作 | Runtime `proactive-decision-tools.ts` 的 `proactive.teacher_decision`；原 `proactive.update_item/schedule_wake/notify` | teacher 经原 CoordinationPort；内部工具由签名 frontier 指定原 proposalId，不公开成模型自签控制参数 | 当前 Competition main 仅公布 teacher binding，不先依赖 Laya；动作仍按真实可用 host binding 决定 | Desktop 尚无全套 continue/research/delegate/local_plan/request_user/shadow 动作消费；不能把候选动作名当 capability。真实业务来源/通知服务由原 owner 提供公开端口 |
| CW-05 暂停、继续、取消、离开、归来 | `proactive.workflow.control`；action 为 `pause/resume/cancel/enter_unattended/return` | 原控制 revision、真实 sourceTask 及 quoteRef 保留；跨轮以可信 UI 归属比较，写操作未加入 automaticTools；read 返回 done/changed/pending/blocked 计数 | 原任务不重开、不延长期限；设备离线与未知写回执分别等待，归来不补弹旧通知 | 已接未真验收：真实用户离开/回来、重启后长期责任、原未知写与通知渠道分别验收 |
| CW-05 Scheduler 与常驻 | 原 TaskRuntime `createSchedule/getSchedule/dispatchDueSchedules/recoverMissedSchedules` 与 host `ingestWake` | `proactive-runtime-pump.js` 已接 main 原 eventPoll；原维护页恢复同责任、TTL、imageBinding 与持久 Scheduler wake，不重建 timer/任务库 | **已组合、Local/Synthetic 已验**：原 fired wake 去重、十页 bounded scan 续页、未知 worker 不逐 poll 重入；source pending 经同 poll 补取原 batch ack，SQLite reopen 后不再 collect | 无真实 `cloudPersistentHost` 不能宣称关机继续执行；等待设备是合法状态，不是完成 |
| CW-06 主/影子选择与收益 | `workflow-shadow-policy.ts`、`workflow-shadow-release.ts`；镜像 `shadow-controller.mjs/trace-replay.mjs`；`OwnedWorkflowHostBridge` | 已有选择、同基线/隔离校验、可信历史 receipt 比较；发布/读回工具是 `workflow.host.f23_n04` / `workflow.host.f23_n05` | 只有可信 shadow policy/configuration/readback/Evidence port 才能注册；main 未注入 workflowShadowRelease 时保持 unavailable | 日常非专项任务的真实 sampling/资源/质量收益、同版本反事实、CAS 发布/回滚消费未完成；不另造“影子调度器” |
| CW-07 委派、实际子任务、子会话 | `subagent-host.ts`、`user-task-delegation.ts`、`subagent-conversation.ts`；`subagent.dispatch`，Runtime 原子绑定/进度/报告 | #406 原 root 只允许原委派，实际子目录执行业务；追加消息保持原子会话，主/Live 收到实际结果。核心 Goal 消费测试使用生产派发 | 明确模型/工具配置、原父子绑定、预算、deadline、取消及 Evidence；不能用注册或 Fake 声称真实多角色质量 | 历史有限真实主子委派不代表完整真实主控升级、角色路由或全部模型组合已验证 |
| CW-07 报告与高级主控升级 | Runtime `ingestSubtaskFeedback`、`controllerReports`、`controller.consume/readReceipt` | 已产生原报告引用、task.progress 与签名 feedback event；不存在 controller consumer 时返回 pending/unavailable | Desktop facade 尚未提供真实高级主控 receipt 消费；不把记录一次 progress 当高级模型已读或接管 | 需要真实既有主控消费与可独立读回的 receipt；`continue/summary/notify_controller/request_controller` 不能由测试 helper 代做，当前真实 unavailable |

## 语音、Windows 与编码

| 包 / 具体能力 | 公开入口 / 已实现文件 | 模型可见、可调用与结果回传 | 当前条件与剩余 |
| --- | --- | --- | --- |
| CW-10 原生 Live 工作交接 | `live-voice-host.js`：`request_work/read_context/wait_for_task`；原 public transcript consumer | 本轮工作受理后及时返回等待审批/核实；wait_for_task 只读等待同一个 taskId，不再提交同一工作；read_context 可读取共用能力说明 | Live provider/本地加密配置/可信 PCM 是前提；primary 已组合统一 capability 元数据、完整 schema 分页、原会话归属与审批桥。Local/Synthetic 回归不证明真实麦克风、听说质量或时延 |
| CW-10 当前参数询问与授权 | `voice-command-host.js`、`voice-runtime-approval-bridge.js`、Root `conversation-tool-access.js` | 从原 persisted pending proposal 的参数摘要/revision/digest/expiry 形成当前问题；只有可信 captured final 可消费原 approval；模型工具调用不是批准 | 桥与 Live Synthetic 回归通过；primary 已接准备/回应/恢复与原 child 当前审批读取，最终组合证据由 Root 记录；partial/echo/过期/旧 final 不授权 |
| SIS 与唤醒 | `voice-input-core.js` / `voice-input.js`、`wake-voice-host.js`、`packages/voice` / `voice-wake` | 当前 SIS 主要听写填草稿，普通文本提交拥有 task.submit；唤醒管理 IPC 与语音 provider 配置不等于 Core `voice.start/stop` wire 已公布 | 默认设备许可/麦克风释放/回声约束保留；SIS 经 AgentArts 双工、实体唤醒/扬声器/设备恢复仍需专验 |
| MOD-16 记事本受控写入 | `notepad-host.js`、Runtime `windows-host-adapter.ts` / `windows-host-attempt-store.ts`；`computer.notepad.replace_text` | 基线是设置页 `notepad.start/cancel/reconcile`→原 host task。真正 presence 由宿主 current task、F9、短时 targetRef 与 UIA 目标读回执行，不能由模型提供 | Windows 原生 Host/PipeBridge、独立空白目标、原授权与读回是前提；该专用 adapter 按原设计由管理页/可信 host task 消费；通用文字/Live 操控已由正式 Windows-MCP 链覆盖，不再新造专用嵌套任务。内部 descriptor 不裸给模型；Linux/缺二进制 unavailable |
| MOD-17 CPU/内存/uptime | `packages/windows-client/src/index.ts` 的 `computer.system.observe`；`system-observation-conversation.js`；原 product tools composition | primary 复用原 RegisteredTool，补同任务 availability 与原 confirmed result 的精确原生出机确认；机器数据不在自动批准名单，未确认只保留本地结果 | 本轮 5/5 专项为 Synthetic 消费与实际本机 node:os 读取分账，不是 Windows/云/Live 实体验收。2026-10-13 有限 Windows 历史证据保留原版本；进程归因、磁盘 I/O、温度、网络活动仍 unavailable |
| Windows-MCP 主/Live 控制 | `windows-control-host.js` → `packages/windows-client/desktop-control.ts`；`computer.request_access`、`computer.desktop.observe/click/type/scroll/move/shortcut` | primary 已接 provider sidecar 生命周期、可执行 schema、原 Policy/结果导出；`desktop.request_presence` 共用可信 F9，`computer-control-lease.js` 防跨引擎并发控制 | Windows/可信 Python executable/provider/目标读回/当前任务在场与原批准是前提；Linux/缺 provider unavailable。Local/Synthetic 宿主消费与 lease 例不代表实体 Windows 或真实前台应用验收 |
| MOD-18 工作区读、列、补丁 | `workspace-config-host.js`、`coding-tool-host.js`；`workspace.read_text/list_entries/preview_text_patch/stage_text_patch/apply_text_patch` | 已有动态 schema、原 Gateway 执行及受限续答；实际子任务按当前工作区许可读取。源码外发还走原精确原生确认，补丁核实走原 run | 用户选择工作区、本机权限/ACL/文件身份、写入/出云许可和 Windows helper 是前提；不能任意 shell/路径。真实用户项目/当前 Desktop 联合验收未由本轮替身证明 |
| MOD-18 固定验证命令 | `workspace-command-recipes.js`、`workspace-config-host.js`；`workspace.git_diff_check/node_check/npm_build/npm_test`；包级 `workspace.run_allowed_command` | 已有固定 recipe 与受信 executable/工作区绑定；无任意 argv，未知命令结果不盲目重跑 | Node/npm/helper/工作区项目许可分别检查，缺环境 unavailable。跨全部真实项目安全/兼容未验 |
| MOD-18 隔离修复与发布 | `isolated-repair.ts`；`coding.repair.start/list/read/snapshot/preview/patch/verify/check/publish/reconcile` | 已有公开工具与工作区 host 消费；包级 STALE、精确补丁、核实未知结果由原端口维护 | 可信 isolated host、路径白名单、原 baseline/check/receipt 与精确发布批准是前提；隔离模式不等于任意目录写入许可 |
| 开发生产配置与原公开工作流消费 | `developer-deployment-config.js` / `developer-tools-host.js`；Runtime `developer-workflows.ts` 的 `developer.ci_list/ci_fix/code_review/issue_list/issue_triage` | primary 已组合受信配置、原 ModelPort/工具/child worker，未创建第二任务库；GitHub/Git/正文出机仍走原 Policy、F9/精确 payload 确认与有界 continuation | `PA_DEVELOPER_CONFIG_FILE`、原 repository/branch/remote/recipe/rules/model binding 与私密凭据文件需真实配置；缺项按 capability unavailable。连接器/规则算法仍归原 owner，真实 GitHub 写/CI 修复未因合成例而验收 |
| MOD-18 F15 镜像整图修复 | Runtime `coding-repair-application.ts` / `owned-workflow-image-adapter.ts`；`coding.repair.workflow` | primary 已接同原 worker 的 image 消费、原 HostIntent pending 读回、可信有界会话映射与审批 BFS；F15 实际使用通用 frontier driver，保留原本地验证与 CAS；均有 Synthetic 回归 | 缺可信 image/config/正文出机许可仍 unavailable；原镜像的本地 selector ready/资格回执依赖保留，本轮未启动 Laya；不解除 #406 原派发限制，不将28图目录或历史例视为全部闭环 |
| 编码未知写与取消恢复 | `workspace-patch-reconciliation.ts`、`patch-reconcile.ts`；`reconcileWorkspacePatchTask` / 原 resume | 确认已发生写入→保存原普通工具结果/Evidence→原 marker 确认→恢复原 continuation；取消也保留真实副作用 | 2026-10-13/15 已有有限真实 Windows/合成回执；不证明断电或写中崩溃原子性。旧任务缺原绑定、marker不明或 source/config 改变仍 waiting_reconciliation |

原 feeds native tracking grant 只在其既有支持的原会话/原 task 范围有效；动态 UI 或追加 child 没有原 grant 时，来源投递仍 unavailable，可信会话 resolver 不迁移业务授权。

Windows 与开发消费的主进程组合已由 Root 串行接入；本表依据 primary 源码与各冻结包记录，不代做实体设备/业务账号验收。
DEV-WORKFLOWS 的 GitHub/CI/Review/Issue provider、规则和模块测试由 goo122/Potatos498 负责；
本轮 devtools agent 只按原公开端口补宿主消费，具体完成事实由其工作包及 Root 统一回执记录。

## 本轮证据与未完成边界

Root 最新分组检查为 226/226，包含 teacher 多轮、DEV 连续调用、自动补丁两类会话恢复、CI 缺陷修复及远端并行整合补测；
精确命令、UTC、日志 SHA 与剩余归属见 [最终增量证据](evidence/conversation-wiring-20261018/SUPPLEMENT.md)。镜像 F01–F28 的查询已接入；
图目录、实际图入口与业务 adapter 就绪分别记录，不将目录可见当作全图闭环。

- 核心定向用 Node 24.15.0 / npm 11.12.1：Goal 动态 panel 真实生产 user-work 子派发、workspace 新会话；主动公开 start/pause→两次原 Policy→HMAC 签名本地 HTTP 镜像→有界续答；跨轮来源身份/foreign/取消/过期；初包 7/7。
- Goal UTF8 分页增量：整 Goal 文件 3/3；中文长目标精确多页无漏项，单项超预算明确拒绝、不截 ID。
- #404 原 Owner 部署绑定补丁只在缓存副本编译审核：6/6；同版 HTTPS/WSS、legacy/loopback、冲突/跨源/多余 query、凭据前/等待中变更拒绝。不是远端 deployment 证明；正常新增测试默认导入生产 dist。
- Voice 自身冻结包具有明确 Local/Synthetic 回归，实际结果见 [语音证据](evidence/voice-model-wiring-20261018/README.md)。其桥不签发模型批准。
- 主动维护初增量 16/16；恢复专项 11/11（后者包含原 Scheduler/source 回归、SQLite reopen 后普通 poll 补取 exact batch ack、parent 撤回、原 grant 撤销拒绝），见 [主动接线说明](PROACTIVE_RUNTIME_WIRING_20261018.md)。来源正文/native grant/teacher/action 明确为 Synthetic，未真实联网取源。
- primary 的 main 统一目录/审批/Windows/devtools/主动来源与 Scheduler 接线已有实际消费；最终主进程组合测试命令、SHA、UTC、wall、日志由 Root 记录。F15 同 worker 增量已组合，7/7 专项仍属 Synthetic，不能把单包通过合并为全 MOD 或 28 图通过。

没有调用真实云模型、真实账号或实体音频，没有启动 Laya，没有发送邮件，没有运行大规模全仓测试。
合成鹈鹕数据与显式替身只证明所列执行/授权边界；云端、实体设备、真实来源、日常影子收益、
高级主控质量和关机后持续执行各自保持原未验证状态。配置/注册/schema/目录/模型自报均不是完成证据。
