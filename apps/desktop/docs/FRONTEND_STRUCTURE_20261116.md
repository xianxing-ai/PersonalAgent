# Desktop 前端结构与设计功能对照

核对日期：2026-11-16；Profile：`huawei_ict_agentarts`；基线：main `1ec11db4`。本页是源码入口和工作范围地图，不是全部功能已接通或验收通过的声明。接口成熟度仍以 [当前接口目录](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) 为准；在途 PR 可能改变以下结构。

## 设计依据

- 历史起点为已合入的 [六套设计提案 #378](https://github.com/xianxing-ai/PersonalAgent/pull/378)。提案本身不证明当时已选定一套最终风格。
- 当前已有实现采用项目原生 HTML/CSS/JavaScript 的 Solid Glass 材质和深浅主题，具体交付与参考来源见 [Solid Glass 记录](SOLID_GLASS_SETTINGS_20261027.md)。该记录说明设计参考了开源 Solid Glass，但未引入其 React/Tailwind 或组件依赖；这里不把参考当作生产依赖。
- 当前截图与代码体现既有方案，不据此替 Owner 推断六套提案中哪一套为最终定稿。新视觉方向或改变既有悬浮球形态、动画、拖拽约定仍需具体需求。

## 代码和功能映射

| 功能 | 主要入口 | 本页可确认的范围 |
| --- | --- | --- |
| 窗口与装配 | `src/app/renderer.js`、`src/ui/desktop-shell.js`、`src/ui/window-controls.js`、`electron/main.js`、`electron/preload.cjs` | Renderer 按窗口模式装配；可信主进程与 Preload 提供受控窗口/IPC 入口。源码存在不代表所有窗口/设备场景已验收。 |
| 悬浮球与小面板 | `src/features/orb/orb.js`、`src/app/renderer.js`、`src/features/conversation/` | 球体、面板对话、任务状态、流式回答块（可折叠思考与工具步骤，增量刷新保持展开与焦点）、助手名册、试运行核验、权限总览、外部内容围栏与成本路由；实际拖拽、多屏、取消及设备行为需逐项验证。 |
| 工作区及连接卡 | `src/features/workspace/view.js`、`src/features/workspace/command-center.js`、`src/features/workspace/connectors.js`、`src/features/workspace/runtime-controls.js` | 工作区视图、状态投影与入口；接入流式回答块、持久助手名册与独立助手会话、目标管理弹窗（`goal.*`）、失败自愈卡片（`task.repair`）、失败定位（`task.locate`）、执行过程转录读回（`task.transcript`）、总暂停切换（`operator.brake`）、每日简报与主动观察/持续工作流控制；连接卡中的配置、就绪和实际读取/同步分别表达。 |
| 输入、多会话、模型选择 | `src/features/conversation/workspace-composer.js`、`session-controls.js`、`model-thinking-picker.js`、`assistant-roster-ui.js`、`subagent-conversations.js` | 对话输入（含中文输入法 `isComposing` 与 `keyCode === 229` 防 Enter 误提交保护）、排队/插话/停止并改发模式、会话/草稿与模型控制。不能仅由代码推断实体输入法、多窗口和所有真实模型已验证。 |
| 设置、权限、审批、Evidence | `src/features/admin/view.js`、`activity-timeline.js`、`risk-autonomy-settings.js`、`approval-status.js`、`evidence-view.js`、`src/features/workspace/workspace-approvals.js`、`src/features/conversation/approval-card.js` | 设置和授权展示消费宿主状态（含活动时间线 `activity.undo`、风险分级自主档 `riskAutonomy.*`、用量上限 `usageBudget.*`、数据看板 `personalDashboard.period`）；任务、审批和证据事实仍以可信 Runtime 路径为准。 |
| 语音与本地工作区配置 | `src/app/live-voice-controls.js`、`workspace-controls.js`、`electron/workspace-config-host.js` | 前端调用已有宿主；语音设备、工作区能力和授权仍各有独立验证边界。 |
| 样式和桌面偏好 | `src/app/style.css`、`surfaces.css`、`interaction.css`、`solid-glass.css`、`src/ui/`、`src/desktop-settings/` | 当前主题、控件与本机偏好入口；主题和窗口支持受环境影响。 |

Renderer 通过 Preload/IPC 与宿主通信；它不直接持有系统凭据，不直接操作数据库、Shell 或 Provider。缺少公开受信口的能力应明确显示不可用，不能由 UI 或 Fake 结果冒充真实接通。

## 已知接线和验证缺口

- F20：基线未发现 `coding.f20.configure`。在途 [#531](https://github.com/xianxing-ai/PersonalAgent/pull/531) 有配置和相关宿主候选，但依赖固定 recipe、工作区绑定、受信 frontier 等；该 PR 仍为 Draft，不能只搬界面或依据配置宣称 F20 可执行。worker 信任闭环未具备前保持未注入。
- F06–F09、F11/F12 业务消费、F02/F14 原生能力、F15 真人审核及 F23 等以 [协作接线缺口](../../../docs/competition/evidence/IMAGE28_COLLABORATOR_OPEN_WORK_20261031.md) 和当前公开端口的实际状态逐项核对；历史清单不等于当前所有能力仍缺失，也不等于它们已验收。
- 2026-11-16 前端小修复与 Fake 桌面 smoke 结果见 [#666](https://github.com/xianxing-ai/PersonalAgent/pull/666)；真实账号、AgentArts、物理语音设备和真实中文输入法另记证据。
- [#658](https://github.com/xianxing-ai/PersonalAgent/pull/658) 正修改部分对话 Renderer；工作包涉及同一文件时先协调并以最终合入版本重新核对。

## 后续维护

变更组件归属、调用链或风格时更新对应模块文档；变更能力成熟度前核对当前接口目录和实际调用方证据。验证记录应区分产品代码、合成测试、真实服务/设备、PR 合并和整体 MOD 状态。
