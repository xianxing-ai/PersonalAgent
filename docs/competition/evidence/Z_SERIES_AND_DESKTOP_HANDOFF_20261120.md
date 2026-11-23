# PersonalAgent 交接 · Z 系列与桌面前端

2026-11-20，北京时间。负责人 zemeng5208。开发和验收已暂停，代码保存在本地。

**Z-01 的令牌轮换已通过，F20 真机验收已通过。Z-01 剩两项：新版 11 条 AgentArts 绑定的结果及 Trace，最终云端版本与交付源码、ARM64 镜像摘要的一致性。Z-04 和 Z-05 已由用户现场验收通过。**

## Z 系列逐项状态

编号沿用 [PR 675 的工作分工原表](D:/worktree/679a/PersonalAgent/docs/competition/evidence/JOINT_ACCEPTANCE_TASK_ASSIGNMENTS_20261119.md)。表内 # 编号为[联合验收报告](D:/worktree/679a/PersonalAgent/docs/competition/evidence/JOINT_ACCEPTANCE_REPORT_20261119.md)中的条目。F20 是工作流图号。

| 代号 | 已有结果 | 当前接手点 |
| --- | --- | --- |
| Z-01 · 镜像、模型绑定与令牌 | 用户确认 WSS 令牌轮换通过。MaaS DeepSeek 1017 完成 F20 真机验收。ARM64 镜像已构建、推送并从 SWR 读回。 | 核对下节两项。 |
| Z-02 · F09 云路由 | 上次云测专用路径 `/invocations/f09` 返回 404，通用路径返回 200，本机真实订阅去重通过。Gemini 工作树已补专用路由、鉴权与 F09 隔离并完成本地检查。 | 在最终固定版本读回专用路径、F09 四节点结果和后续研究任务。入口 `apps/agentarts-runtime/src/server.mjs`。 |
| Z-03 · 平台评估与 Trace | Gemini 工作树已补评估超时配置和平台 Trace 关联。旧版平台评估得分为 0。 | 核对评测集列映射、平台分数和 `ShowOpsTrace` 返回的同一执行。入口 `packages/agentarts/src/observability/index.mjs`。 |
| Z-04 · 对话操作 Windows 记事本 | **用户现场验收通过。** 从对话交代任务，子助手调用原生能力打开记事本并输入。 | 工作树 `D:\worktree\e84d\PersonalAgent\.worktrees\z04-notepad-uia`，原生实现在 `apps/windows-host/` 和 `packages/windows-client/`。 |
| Z-05 · 悬浮球命中与窗口位置 | **用户现场验收通过。** 本轮验收对话记录包含切换到 125% 缩放及用户确认。 | 同一 Z-04 工作树，窗口实现在 `apps/desktop/electron/`，记录目录 `.cache/z05-owned-window-native/`、`.cache/z05-placement-profile/`。 |
| Z-06 · 多角色、出站与直接 MCP | 已有正式 Harness 同父多角色、工具续传、取消的成功记录。Gemini 工作树已改同参只读提案收敛、续传提示与校验诊断。 | 新版直接 MCP 的一次授权、多轮续传、最终答复待云端回执。另核对 `system_observation` 出站与普通对话子任务工具公布。见原报告 #11、#15。 |
| Z-07 · SIS、唤醒与物理麦克风 | 真机读到录放端点，30 分钟唤醒设置重启后保留。原验收中 SIS 未配置、唤醒不可用。前端本轮接入大窗听写与 Live 控件。 | 实际录音填入原对话、扬声器播报、唤醒、打断及麦克风释放尚待真机验收。见 #08、#09，代码在 `packages/voice/`、`packages/voice-wake/` 和桌面语音宿主。 |
| Z-08 · 云端持续执行与主动来源 | 目录触发、撤销已通过。原 CW-05 读回缺 `business_source_adapters`；目录子任务内容读取被 Policy 拒绝。 | 续查日历和邮件触发、目录内容读取、云宿主交接、电脑断开期间执行与回来后的对账。见 #12、#18。新右栏可查看 VPS；正式配置登记数为 0。 |
| Z-09 · 原生沙箱、补偿、自愈与插件 | 原任务只读回放、空权限插件四类越权拒绝已有回执。F20 的真实隔离编译通过。 | 剩复杂补丁后 `workspace.npm_test`、Windows 通知点击补偿与读回、只读重试与父任务重规划、插件声明内访问和越界、1017 的 Node 诊断字段。见 #05、#17、#19、#25 及 PR 649。 |
| Z-10 · 隐私断链、托盘总暂停与 28 图 | 用户已交给 Gemini。已交付本地 SQLite 图谱断链、托盘暂停同步和 28 图本地/容器验证记录。F20 另有正式桌面通过记录。 | 真实授权擦除与重启读回、托盘与在途任务现场验收、其余图逐图的生产结果见 [Gemini 交付表](./Z10_PRIVACY_TRAY_AND_IMAGE28_ACCEPTANCE_20261119.md)。 |

Gemini 镜像修复工作树在 `D:\PersonalAgent\.worktrees\zemeng-owned-image-remediation-20261119`，覆盖 S531-Z1、Z-01、02、03、06。Z-10 工作树在 `D:\PersonalAgent\.worktrees\z10-privacy-tray-image28-20261119`。Gemini 的原始汇报在 `C:\Users\24035\.codex\attachments\1504698f-2fa6-44fa-a826-e3d97140a320\已粘贴的文本.txt`。

## Z-01 剩余两项与已有凭据位置

1. **11 条绑定的结果和 Trace。** 原报告 #13 记录旧版 5 条通过、5 条失败、1 条跳过。旧版失败项为 `plan`、`controller_repair`、`review_1`、`router`、`controller_router`，跳过项为 `review`。新版的每条绑定需要对上业务输出和对应的平台 Trace。场景及依赖在 `tests/manual/agentarts/owned-binding-live.mjs`，平台读回在 `tests/manual/agentarts/support/read-platform-trace.mjs`。
2. **云版本、交付源码、ARM64 镜像三方一致。** 本地已留存推仓回执：源码 `ac9a2552e6ae75b180b23197fc2394acd1a7c5a9`，架构 `linux/arm64`，SWR 摘要 `sha256:9e235024e658d8e554cdaf3f4526eb59c890ed02db7565d69d6037a4171a6fe0`。该次构建为干净源码，镜像已从远端读回；回执字段 `runtimeDeploymentVerified=false`。固定入口配置中的 Runtime 名为 `pa-z01-model-accept-20261119`，传输为 WSS。最终固定版、Latest 指向及交付源码还要与这个摘要逐一对上。回执之后另有本地代码修改。

回执目录为下述前端工作树中的 `.cache/image28-receipts-20261120/`。其中 `release.json` 记录源码和镜像摘要，`remote-platform.log` 记录平台，`desktop-binding.json` 记录桌面绑定。镜像发布入口为 `scripts/agentarts/release-owned-image.ps1`。本节的核对可沿用现有回执。

## F20 已通过的真机记录

在正式桌面对话输入「核对 API 文档、隔离编译 TypeScript 示例，并回报结果」。主任务 `860c0551-9c70-4052-af49-c1c222e63a5e`；子任务 `25625000-b1be-4a4b-88bc-f1aae0c6e038`。子对话已给出文档复核结论、隔离 TypeScript 编译结果和退出码 **0**。原版主对话只提示去子对话查看，用户随后反馈小工作区只有执行卡。前端这轮用这份原记录核对回复显示即可。

正式桌面配置目录为 `D:\PersonalAgentDesign\.cache\z01-f20-desktop-profile`。任务、执行记录在 `runtime.sqlite`，桌面对话在 `conversations.json.sqlite`。

## 前端重构交接

> **2026-11-20 更新**：前端验收与完善已改交 Gemini，专用交接见 [FRONTEND_DESIGN_HANDOFF_FOR_GEMINI_20261120.md](./FRONTEND_DESIGN_HANDOFF_FOR_GEMINI_20261120.md)。Codex 接手其余 Z 系列，续接状态见 [Z_SERIES_CODEX_CONTINUATION_20261120.md](file:///D:/PersonalAgent/.worktrees/zemeng-owned-image-remediation-20261119/docs/competition/evidence/Z_SERIES_CODEX_CONTINUATION_20261120.md)。

**工作树** `D:\worktree\e84d\PersonalAgent\.worktrees\image28-live-acceptance`  
**分支** `codex/image28-live-acceptance`，HEAD `ac9a2552e6ae75b180b23197fc2394acd1a7c5a9`。本轮改动未提交、未推送。此树也保留了此前 F20 的授权、Runtime 和编译回执修改。以下路径均相对此工作树。

| 区域 | 本轮落地内容 | 具体位置 |
| --- | --- | --- |
| 大小主对话 | 主对话继续接单。子任务结论直接回到原消息下方。两边共用回复选择函数。小窗显示聊天正文和必要授权。 | `apps/desktop/src/features/conversation/result-text.js` 的 `mainChatReplies`；`apps/desktop/electron/main.js` 的 `compactSubagentTasks`；小窗 `apps/desktop/src/app/renderer.js` 的 `renderTaskAnswer`；大窗 `apps/desktop/src/features/workspace/view.js`。 |
| 大工作区三栏 | 左侧切换主对话、助手和子对话，查看最近消息。中间显示所选会话。右侧保留星球、动态、资料库、知识库、订阅、通知和最近活动。 | `apps/desktop/src/features/workspace/command-center.js`、`inline-subagents.js`、`context-sidebar.js`、`context-sidebar.css`；`apps/desktop/src/app/command-center.css`。 |
| 两个输入框 | 保留压缩、持续目标、选模、思考强度滑块、麦克风、Live、输入后发送。滑块沿用原模型目录、档位和设置写入。大窗听写按发起窗口和对话接收结果。 | `apps/desktop/src/features/conversation/model-thinking-picker.js`、`workspace-composer.js`；`apps/desktop/src/features/workspace/view.js`、`runtime-controls.js`；`apps/desktop/src/app/workspace-composer.css`；`apps/desktop/electron/voice-input-core.js`、`microphone-capture-host.js`、`microphone-permission.js`。 |
| VPS「电脑」 | 复用现有主机列表、启停、连接测试和云持续会话控件。只有实际心跳回执用于连接状态。当前正式配置 **0 台**。 | `apps/desktop/src/features/workspace/context-sidebar.js`，`apps/desktop/src/features/conversation/remote-runners.js`，`apps/desktop/electron/remote-runner-host.js`；IPC 为 `runner.hosts.list`、`runner.hosts.test`。 |
| 卡顿 | 已移除小窗逐次渲染时读取后台任务和远端执行器的调用。授权提交消费宿主推送，取消额外整页读取。两秒恢复轮询保留任务读回，未变化时跳过重复发布。重开窗口复用已确认的快照和相同尺寸的原生窗口形状。 | `apps/desktop/electron/snapshot-publisher.js`；`main.js` 的 `refresh`、`pumpEvents`、`projectWindowSnapshot`、`applyShape`；`apps/desktop/src/app/renderer.js`。 |
| 其他桌面页面 | 设置导航、子助手独立会话与历史列表的修改已在工作树。暂停时这部分尚待整体验收。 | `apps/desktop/src/features/admin/view.js`，`apps/desktop/src/app/solid-glass.css`，`apps/desktop/src/features/conversation/subagent-conversations.js/.css` 和 `subagent-conversation-list.js/.css`。 |

### 验证和接续位置

- Runtime TypeScript 构建通过；桌面主进程与小窗 Renderer 的语法检查通过。子代理报告左栏与授权相关检查 9 项通过。
- `apps/desktop/test/panel-event-readback-order.test.mjs` 有 3 项失败。两项在测试 VM 调用取消路径时报 `visibleConversationTask is not defined`；一项期望发布次数 2，实际 4。检查入口在该文件的 `fixture` 及事件泵测试。
- 语音与输入定向检查报告 27 项通过；`apps/desktop/test/conversation-ui.test.mjs` 的模型目录默认选择用例期望 `a`，实际 `b`。
- **新版前端尚未真机验收。** 用户发出暂停时尚未打开新版。现场接续点是从小窗读回上述 F20 结论，展开到大窗核对相同消息，切换子对话，查看滑块与右栏，再检查发送、授权和反复展开的响应。真实 VPS 心跳需要已有登记主机。
- 启动位置为工作树下的 `apps/desktop`。沿用正式配置的 PowerShell 启动方式如下。

```powershell
$paTree = 'D:\worktree\e84d\PersonalAgent\.worktrees\image28-live-acceptance'
$env:PA_USER_DATA_DIR = 'D:\PersonalAgentDesign\.cache\z01-f20-desktop-profile'
$paNode = 'D:\worktree\679a\PersonalAgent\.cache\toolchains\node-v24.15.0-win-x64'
$env:Path = "$paNode;$env:Path"
Start-Process -FilePath "$paTree\node_modules\electron\dist\electron.exe" -ArgumentList '.' -WorkingDirectory "$paTree\apps\desktop"
```

### 已有功能，待用户指定摆放位置

| 功能 | 现有实现或入口 |
| --- | --- |
| 暂停/恢复后台子助手、追加指令、改变执行方向、交接任务 | `apps/desktop/electron/async-subagent-host.js`；对应 IPC 为 `asyncSubagents.pause/resume/instruct/redirect/handoff`。 |
| 记忆候选、重复项处理、偏好撤回 | `apps/desktop/src/features/admin/memory-learning-controls.js`。 |
| 开发经验验证、启用与停用 | `apps/desktop/src/features/admin/harness-experience-controls.js`。 |
| 自动执行权限、最近决定和撤销 | `apps/desktop/src/features/admin/risk-autonomy-settings.js`。 |
| 日、周、月个人数据看板 | `apps/desktop/src/features/admin/personal-dashboard-page.js`。 |
| 工作流回放配置 | `apps/desktop/electron/main.js` 的 `workflow.traceReplay.configure`。 |

设计参考图位于 `C:\Users\24035\AppData\Local\Temp\`。三栏布局为 `codex-clipboard-2d888bec-5ff1-498e-a9cb-461112e3096f.png`；保留右栏内容为 `codex-clipboard-0de8514a-c4a6-4591-bb52-a7e2be9c91be.png`；两边输入框为 `codex-clipboard-4890ce34-e0cd-4dc2-a566-666889de1d96.png`。

本地 PR 引用在 `pa-acceptance/pulls/<编号>/head`：#531 为 `76486710`，#675 为 `cb4e1079`，#689 为 `7bfb23ae`，#690 为 `2c4b6752`。
