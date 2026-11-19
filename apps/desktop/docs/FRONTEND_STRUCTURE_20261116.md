# Desktop 前端结构与设计功能对照

核对日期：2026-11-19；Profile：`huawei_ict_agentarts`；基线：main `ac68fbf9`（已含 #658 流式助手、#669 桌面宠物、#671 Issue #379 前端全功能接线）。本页是源码入口、工程结构、组件复用与验证边界清单，不是全部云端或设备验收已通过的声明。接口成熟度仍以 [当前接口目录](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) 为准。

## 设计依据与开源复用清单

- **设计起点**：已合入的 [六套设计提案 #378](https://github.com/xianxing-ai/PersonalAgent/pull/378)（历史起点，不据此替 Owner 推断某套提案为最终唯一视觉定稿）；保留既有悬浮球形态、动画与拖拽约定。
- **生产引入 vs. 设计参考（严格区分）**：

| 类别 | 组件 / 来源 | 版本 | 实际引入范围与适配点 |
| --- | --- | --- | --- |
| 生产依赖 | `electron` | `44.2.0` | Desktop 主进程窗口壳、安全 Preload/IPC 与本地安全存储宿主（`apps/desktop/package.json` 锁定，国内镜像可本地构建）。 |
| 生产依赖 | `@jackwener/opencli` | `1.8.6` | 受信主进程受控浏览器观测与外部 CLI 适配层；不向 Renderer 暴露。 |
| 生产依赖 | `playwright` | `1.63.0` | 自动化 Electron 窗口/工作区/布局烟测驱动与浏览器宿主能力。 |
| 构建工具 | `electron-builder` | `24.13.3` | Windows NSIS 打包脚手架校验（`check:packaging-scaffold`）。 |
| 设计参考（非生产依赖） | Solid Glass 材质参考 | — | 参考材质分层与深浅主题视觉语言，以原生 HTML/CSS/JS 独立实现于 `solid-glass.css`、`surfaces.css`、`tokens.css`（详见 [Solid Glass 记录](SOLID_GLASS_SETTINGS_20261027.md)），**未引入** React、Tailwind 或第三方 UI 组件库。 |

## 运行与开发验证方式

- **本地启动**：拉取或切换分支后须先在仓库根执行 `npm run build` 更新所有 workspace 的 `dist/`，再执行 `npm run start:desktop`（或 `npm run dev:fake --workspace=@personal-agent/desktop` 启动显式离线 Fake 模式）。
- **核心前端检查命令**：
  - 类型/语法检查：`npm run typecheck --workspace=@personal-agent/desktop`、`npm run check:desktop-local --workspace=@personal-agent/desktop`
  - 单元测试：`npm run test --workspace=@personal-agent/desktop`（或定向 `node --test apps/desktop/test/<file>.test.mjs`）
  - 桌面烟测（显式 Fake/本地合成）：`test:text-smoke`、`test:smoke`、`test:workspace-smoke`、`test:frontend-layout`、`test:runtime-application-smoke`

## 代码和功能映射

| 功能 | 主要入口 | 本页可确认的范围 |
| --- | --- | --- |
| 窗口与装配 | `src/app/renderer.js`、`src/ui/desktop-shell.js`、`src/ui/window-controls.js`、`electron/main.js`、`electron/preload.cjs` | Renderer 按窗口模式装配；可信主进程与 Preload 提供受控窗口/IPC 入口。源码存在不代表所有窗口/设备场景已验收。 |
| 悬浮球与小面板 | `src/features/orb/orb.js`、`src/app/renderer.js`、`src/features/conversation/`、`src/ui/preferences.js` | 球体（8 种形态与 6 态动态联动，均响应降低动效偏好）、面板对话、任务状态、流式回答块（可折叠思考与工具步骤，增量刷新保持展开与焦点）、助手名册、试运行核验、权限总览、外部内容围栏与成本路由；实际拖拽、多屏、取消及设备行为需逐项验证。 |
| 工作区及连接卡 | `src/features/workspace/view.js`、`src/features/workspace/command-center.js`、`src/features/workspace/connectors.js`、`src/features/workspace/runtime-controls.js` | 工作区视图、状态投影与入口；接入流式回答块、持久助手名册与独立助手会话、目标管理弹窗（`goal.*`）、失败自愈卡片（`task.repair`）、失败定位（`task.locate`）、执行过程转录读回（`task.transcript`）、总暂停切换（`operator.brake`）、每日简报与主动观察/持续工作流控制、28 图工作流目录（`workflow.image.catalog`）以及知识关注与认知提议快捷入口（含防重入与提议应用刷新）；连接卡真实呈现天气、本地待办与 CalDAV 日历配置、邮件、知识库、订阅与键盘可达通知入口。 |
| 输入、多会话、模型选择 | `src/features/conversation/workspace-composer.js`、`session-controls.js`、`model-thinking-picker.js`、`assistant-roster-ui.js`、`subagent-conversations.js` | 对话输入（含中文输入法 `isComposing` 与 `keyCode === 229` 防 Enter 误提交保护）、排队/插话/停止并改发模式、会话/草稿防后台刷新覆盖与模型控制。不能仅由代码推断实体输入法、多窗口和所有真实模型已验证。 |
| 设置、权限、审批、Evidence | `src/features/admin/view.js`、`src/features/admin/setting-search.js`、`src/app/agentarts-controls.js`、`activity-timeline.js`、`risk-autonomy-settings.js`、`approval-status.js`、`evidence-view.js`、`src/features/workspace/workspace-approvals.js`、`src/features/conversation/approval-card.js` | 设置和授权展示消费宿主状态（含 AgentArts 主连接与平台观测 AK/SK 凭据配置 `agentarts.observation.*`、28 图工作流注册与不可用探测 `workflow.image.catalog` 及其 DOM/折叠保持与防重入、全页面专属导航图标与搜索别名、桌面宠物形态预览、活动时间线 `activity.undo`、风险分级自主档 `riskAutonomy.*`、用量上限 `usageBudget.*`、数据看板 `personalDashboard.period`）；任务、审批和证据事实仍以可信 Runtime 路径为准。 |
| 语音与本地工作区配置 | `src/app/live-voice-controls.js`、`workspace-controls.js`、`electron/workspace-config-host.js` | 前端调用已有宿主；语音设备、工作区能力和授权仍各有独立验证边界。 |
| 样式和桌面偏好 | `src/app/style.css`、`surfaces.css`、`interaction.css`、`solid-glass.css`、`src/ui/`、`src/desktop-settings/` | 当前主题、控件与本机偏好入口；主题和窗口支持受环境影响。 |

Renderer 通过 Preload/IPC 与宿主通信；它不直接持有系统凭据，不直接操作数据库、Shell 或 Provider。缺少公开受信口的能力应明确显示不可用，不能由 UI 或 Fake 结果冒充真实接通。

## 依赖后端接口与未完成边界

- **业务后端口（对接 Potatos498）**：F06 `invokeTodoCreate`、F07/F11 日历条件写与提醒失效、F08 真归档与真 SMTP 发送、F09 真实 feeds 会话与 F12 渠道投递读回在后端口合入并完成主进程注册后，由前端补充对应授权提问卡与读回展示（PR #618 端口层已复核，尚未接线至 Desktop 生产组合）。
- **底座后端口（对接 goo122）**：F01/F03–F05/F10/F16–F17/F21/F23–F25/F27 的受信 Gateway invoke、配置消费者及 `workflowShadowRelease` 条件注入需待后端确认消费者齐备后再接入前端组合与 developer 读回。
- **原生与云端能力（对接 zemeng5208）**：F20 `coding.f20.configure` 与 `ownedWorkflowWorker` 仍在 Draft [#531](https://github.com/xianxing-ai/PersonalAgent/pull/531) 中，worker 信任闭环未具备前保持未注入；F15 真人签名目视验收、F02 物理声学防回声与真实 AgentArts 云端账号/评测仍需实机与在线账号独立取证。
- **验证分层**：已有自动化测试与 5 项 Electron 烟测均属于「UI/组合级（合成/Fake 运行时）」证据，不代替真实外部账号、AgentArts 在线部署、物理麦克风/扬声器或真实中文输入法实机验收。

## 后续维护

变更组件归属、调用链或风格时更新对应模块文档；变更能力成熟度前核对当前接口目录和实际调用方证据。验证记录应区分产品代码、合成测试、真实服务/设备、PR 合并和整体 MOD 状态。
