# 核心模型工具接线增量（2026-10-18）

目标 profile：`huawei_ict_agentarts`。源码基线为现有 PR #406 的
`a37cd414280ec76c82f662e58610b1cbc49d215d`，不重复实现其 `user-work` 委派与持久子会话。
本包不修改 Renderer、主进程组合文件或公共 wire Schema，不新增任务库、模型入口、迁移或能力冻结。

## 功能与实际入口

| 功能 | 公开 id / 已实现位置 | 基线主模型 / Live 情况 | 本包接线与边界 |
| --- | --- | --- | --- |
| Goal 创建、修改、查询 | `goals.create/revise/list/get`；`goal-cloud-host.js`，`packages/goals` | 已有 schema、Gateway 执行和续答投影；固定会话白名单遗漏动态新对话及 #406 的真实执行子任务 | 宿主注入 `isConversationAllowed(conversationId, taskId)`，每次目录、执行与出机重新验证；公布既有 Goal sensitivity/state 枚举；保留本地历史 sourceRef 参数兼容 |
| Goal 修复 | 原 `local-repair` 工具、`proactive-cognition-host.ts` | 已有受 reviewed source 与事实版本绑定的路径 | 不把 guard、事实证明或 sourceRef 变成模型可签发参数；本包不重复修复链 |
| 主动责任、无人值守、归来 | 原 `proactive-workflow-host.js`、Runtime `proactive-workflow-application.ts` | 基线只有管理 IPC；内部 `proactive.retrieve_context/update_item/schedule_wake/notify` 只能消费原 proposal，不能冒充用户控制工具 | 新增 `proactive.workflow.list/start/read/control` 工具；原话任务与 commandId 由 ToolContext 派生；start/control 经过原 Policy 一次授权；返回有界状态和归来计数 |
| 主影选择、比较与发布读回 | 原 `workflow-shadow-policy/release.ts`、`createRuntimeOwnedWorkflowTools` | 可信发布配置缺失时未注册到模型目录 | 维持 unavailable，不凭注册、离线比较或候选名称造生产能力 |
| 委派、子报告、主控升级 | 原 `subagent.dispatch`、`subagent-host.ts`，#406 `user-task-delegation.ts` | 基线已生产注册和返回进度/续答；#406 根仅派发原绑定 `user-work` 子任务，子任务持有实际工具目录 | 不改父子执行循环，不解除根工具隔离，不新增 controller 权限；本包 Goal 消费测试使用真实 #406 生产子派发 |

## 根组合消费

`createDesktopGoalCloudHost` 的 `isConversationAllowed` 第二参数为实际执行 `taskId`。
Root 应使用 Runtime 原有持久父子/追加会话 reader 解析 UI 所属，再检查原 UI 对话登记；不能按
`desktop-subtask:` / `desktop-subagent-conversation:` 前缀放行，也不能把执行身份替换成历史 origin。

`createDesktopProactiveConversationTools({getApplication,getHost,isConversationAllowed,resolveUserConversation})`
返回 `tools`、`competitionToolAvailability`、`competitionToolExports`，接原组合数组。
`getHost` 指向 `createDesktopProactiveWorkflowApplication`，后者也注入同一个可信
`resolveUserConversation(taskId)`。解析器返回历史结构身份，不继承私人记忆/Skill 许可，
也不因源父任务结束而改变已经持久绑定的 UI 所属。实际执行取消、期限、版本和 Policy 仍由原守卫验证。

`start` 和 `control` 不加入 `automaticTools`。模型不能指定 sourceTaskId、commandId、签名、
能力绑定、镜像配置或 frontier proposal。新增工具只在原主动宿主已有可信配置时发布；
无配置保持不可用。Root/Live 看到可委派能力摘要，实际操作由 #406 子任务原目录和 Gateway 执行。

跨轮控制使用可选可信 `RuntimeProactiveWorkflowHostOptions.resolveUserConversation` 比较双方
UI 归属，原 `sourceTaskId`、quoteRef 和任务事件引用保持真实。未提供该端口时保留原严格
conversationId 相等语义。新控制的工具期限收窄到原责任期限，不延长原任务。

`readSummary` 只投影任务状态、控制版本、mode、项目数、waiting_device / waiting_reconciliation
数量和归来摘要计数；不向模型返回 checkpoint、来源正文、提案、签名或密钥。
列表最多扫描十页，每页一百个任务，返回最多二十条会话；`truncated` 表示有界结果。
已恢复的会话可直接读摘要；未恢复且原期限已过的会话不会自动网络续跑。

## 本地验证与限制

本包新定向测试使用 Node `24.15.0`、npm `11.12.1`。初次纯 Node helper 检查和依赖构建
曾使用环境 Node `24.19.0` / npm `11.9.0`；最终 Runtime 增量构建和下列定向测试使用固定工具链。

```sh
npm run build --workspace=@personal-agent/runtime
node --test apps/desktop/test/goal-cloud-conversation.test.mjs apps/desktop/test/proactive-conversation-tools.test.mjs apps/desktop/test/proactive-conversation-runtime.test.mjs apps/runtime/test/proactive-conversation-source.test.mjs
git diff --check
```

测试为明确的 **Synthetic / local mirror**：公开鹈鹕 Goal 数据、真实 Runtime/SQLite/Policy/
ToolGateway/子任务派发和 HMAC 签名本地 HTTP 镜像；AgentArts 主模型响应为显式测试替身。
验证动态会话与真实 `user-work` 子目录、Goal 创建/修订/读回/模型续答、两次主动控制审批、
有界无密钥结果、真实来源身份、异会话/取消/过期拒绝，以及无映射端口的兼容行为。

没有调用真实云、真实模型、真实账号或麦克风，没有启动 Laya，没有运行全仓测试。
本包不证明云端版本部署、原生 function calling、物理语音、真实连接器持续责任、
关机后的 cloud_persistent 执行、日常影子收益或完整真实模型主控升级已验收。
实际 Desktop `main.js` 组合与根总体验证由本轮 Root 随统一接线包完成；本地模块测试通过不等于该组合已发布。
