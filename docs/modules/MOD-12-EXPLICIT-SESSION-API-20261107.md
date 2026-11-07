# MOD-12 显式会话管理 API（2026-11-07 交付记录）

负责人：zemeng（zemeng5208）。基线：main `0e7f3aa1`（含已合并 #576/#577）。

## 交付

- 公布显式会话管理 API（契约修订 1）：`docs/interfaces/DESKTOP_SESSION_MANAGEMENT_API.md`。
- 宿主实现：`apps/desktop/electron/session-management-api.js` — 纯 JS、依赖注入、无 Electron 依赖，操作目录/字段白名单/编码错误/显式不可用齐全。
- 宿主接线：`apps/desktop/electron/main.js` — `session.*` 动作路由到上述实现；发送方边界与 `conversation.*` 相同（仅受信 panel/workspace 窗口），切换会话后维持 Live 语音输出失效逻辑。
- 测试：`apps/desktop/test/session-management-api.test.mjs`（10 项，真实 `Conversations` 存储与 SQLite 持久化重开）。

## 覆盖的清单缺口

ROADMAP MOD-12：「显式会话管理 API 未公布」→ 已公布操作目录（list/active/create/activate/rename/archive/restore/readDraft/writeDraft + delete 显式不可用）、乐观并发（`expectedConversationId`）、任务守卫错误码。

## 怎么测的

- `node --test test/session-management-api.test.mjs`（apps/desktop 下）10/10 通过：信封结构、panel 单对话策略、并发冲突、归档守卫（受理中/非终态任务）、草稿跨重开持久化、`session.delete` 显式 `SESSION_DELETE_UNAVAILABLE`、畸形输入全编码拒绝。
- `node --check electron/main.js`、`node --check electron/session-management-api.js` 通过；`typecheck` 脚本已纳入新文件。

## 没法测的 / 显式不可用

- `session.delete`（永久删除）：无存储迁移，显式返回 `SESSION_DELETE_UNAVAILABLE`，不假装成功。
- 真实 AgentArts 对话、工具回传、语音组合的端到端验收：需真机/真实平台，仍待验收（保持 MOD-12 in_progress，不因本 PR 标 done）。
- Electron 真窗口内的 IPC 冒烟（test:smoke）：本环境无显示器/Electron 二进制，未跑；本 PR 不含渲染层改动，渲染层既有动作未变。

## 红线遵守

- 未改 Desktop Renderer / 设置页 UI（`src/app`、`src/desktop-settings`、`src/ui` 零改动）。
- 未改 Runtime/Policy、业务连接器、#531 堆叠链在途文件。
