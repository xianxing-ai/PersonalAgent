# Desktop 显式会话管理 API（MOD-12，契约修订 1）

状态：**已公布（host 侧）**；运行时任务状态仍归 Runtime 所有，本 API 只管理 Desktop 元数据（会话列表、活跃会话、草稿）。
实现：`apps/desktop/electron/session-management-api.js`（纯 JS、无 Electron 依赖，可跨平台测试）；宿主接线：`apps/desktop/electron/main.js`（`session.*` 前缀路由，受信对话窗口边界与 `conversation.*` 相同）。
测试：`apps/desktop/test/session-management-api.test.mjs`（真实 `Conversations` 存储，含持久化重开、并发冲突、任务守卫）。

## 调用方式

- 渲染层/受信对话窗口：`window.desktop.invoke('session.<op>', payload)` → 主进程 `desktop:action` → `handleSessionManagementApi`。
- 发送方边界：仅 panel / workspace 两个受信对话窗口；其它来源一律拒绝（`SESSION_SURFACE_INVALID`）。
- 失败形态：错误以 `SessionApiError` 抛出，经既有 `desktop:action` 包装为 `{ok:false,error,errorCode}`；`code` 即下表错误码。

## 操作目录（修订 1）

| 操作 | 允许字段 | 语义 | 返回 |
| --- | --- | --- | --- |
| `session.list` | 无 | 列出当前 surface 的会话元数据（不含草稿正文，`draft` 字段单列当前活跃会话草稿） | `{activeId,sessions,draft,apiRevision}` |
| `session.active` | 无 | 当前活跃会话摘要 | `{surface,conversationId,title,draft}` |
| `session.create` | `title?` | 新建并切换；panel 不允许 | `{...快照,createdId,apiRevision}` |
| `session.activate` | `conversationId`,`expectedConversationId?` | 切换活跃会话；归档会话须先 restore；乐观并发 | `{...快照,apiRevision}` |
| `session.rename` | `conversationId`,`title`,`expectedConversationId?` | 重命名 | `{surface,conversationId,title,archived}` |
| `session.archive` | `conversationId`,`expectedConversationId?` | 归档；受理中/非终态任务时拒绝；活跃会话自动让位 | `{...快照,apiRevision}` |
| `session.restore` | `conversationId` | 取消归档 | `{...快照,apiRevision}` |
| `session.readDraft` | `conversationId` | 读草稿 | `{conversationId,text}` |
| `session.writeDraft` | `conversationId`,`text` | 写草稿（不触发 publish，键入频率调用方自行观察快照） | `{conversationId,saved:true}` |
| `session.delete` | `conversationId` | **显式不可用**：永久删除无存储迁移，只能归档 | 抛 `SESSION_DELETE_UNAVAILABLE` |

- `apiRevision` 恒为 `1`（`SESSION_MANAGEMENT_API_REVISION`）。
- panel（小工作区）保持单主对话策略：`session.create/activate/archive/restore` 返回 `SESSION_SURFACE_LIMITED`；list/active/rename/readDraft/writeDraft 可用。

## 错误码

`SESSION_SURFACE_INVALID`、`SESSION_SURFACE_LIMITED`、`SESSION_STORE_UNAVAILABLE`、`SESSION_OPERATION_UNSUPPORTED`、`SESSION_ARGUMENT_INVALID`、`SESSION_NOT_FOUND`、`SESSION_ARCHIVED`、`SESSION_REVISION_CONFLICT`、`SESSION_TASK_SUBMITTING`、`SESSION_TASK_ACTIVE`、`SESSION_REJECTED`（存储层拒绝，保留原消息）、`SESSION_DELETE_UNAVAILABLE`。

## 边界与非目标

- 不改 Desktop Renderer / 设置页 UI；渲染层既有 `conversation.*` 动作保持原样，`session.*` 是显式公布的机器可用入口。
- 不写 Runtime 任务状态；归档守卫只读取任务状态（与 `conversation-actions.js` 同一判定）。
- 每会话模型/思考偏好仍走既有 `thinking.update` / `conversation.model`（含目录修订校验），不在本目录内重复公布。
- 显式不可用项：`session.delete`（永久删除）；真机/真实 AgentArts 端到端验收仍待（见 docs/modules/MOD-12-EXPLICIT-SESSION-API-20261107.md）。
