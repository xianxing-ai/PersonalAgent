# 前端与前端接线责任分区（2026-10-17 起；2026-10-31 修订）

目标 Profile：`huawei_ict_agentarts`。长期归属以 [MODULE_ASSIGNMENTS](../../MODULE_ASSIGNMENTS.md) 文首 **2026-10-31 Owner 修订** 为准。

## 现行负责人：`2511375597-lab`

Owner 明确：**全部前端与前端接线**、以及 **MOD-10 参赛研究**，均由 `2511375597-lab` 负责。

### 前端

- 信息架构、视觉与交互、组件状态、样式/token、布局、键盘与动效。
- `apps/desktop/src/**`：Renderer 装配、页面控件、`features/`、`ui/`、`desktop-settings/` 等。
- 大工作区、主对话/多对话、模型与思考深度、设置/授权/审批、任务及子任务、连接器/知识/Evidence/语音等 **UI 表面**。

### 前端接线

- Desktop 组合：`apps/desktop/electron/main.js` 中 `conversationTools` / availability / exports、图 host 条件注入、`workspace-controls.js`、设置相关 IPC（如 `coding.review.*`、`coding.f20.configure`）。
- 经安全 Preload/Client/IPC 消费真实任务、会话、审批与配置；缺能力展示 unavailable。
- Renderer 不持密钥，不直连数据库/Shell/Provider；终态与授权由原受信链路决定。
- 相关 Desktop/UI smoke 与 Evidence（标明 composition/UI 级，不冒充云或账号完成）。

### MOD-10 参赛研究

- 目录：`docs/research/agentarts`、`docs/research/model-training`（PA-022 / PA-026）。
- 交付来源、实验、成本与条件结论；不把提示/记忆称为参数训练；不代替 AgentArts 平台联跑验收（联跑仍归 zemeng）。

## 不归 lab（仍归原负责人）

| 负责人 | 保留 |
| --- | --- |
| zemeng5208 | AgentArts 云与编排、语音/Windows **原生能力**、编码工具后端、Competition 平台联跑 |
| goo122 | Runtime/Policy/ToolGateway、协议、知识记忆后端口 |
| Potatos498 | 业务连接器 **后端口**与真实账号读回 |

lab 只接公开口，不伪造后端；不把 UI 可点写成整图 done。

## 历史

[PR #378](https://github.com/zemeng5208/PersonalAgent/pull/378) 曾交付设计提案；[Issue #379](https://github.com/zemeng5208/PersonalAgent/issues/379) 为早期指派记录。2026-10-31 起责任分区以上表为准，覆盖「仅设计/仅 Renderer」的窄解释。
