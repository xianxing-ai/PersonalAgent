# F11 原会话信息补全入口（2026-11-01）

Profile：`huawei_ict_agentarts`。本次只完成原任务的信息补全消费面，不代表 F11 整图或真实语音验收完成。

- Main 在 pinned AgentArts 配置下创建原 `createF11LocationQuestionHost`，将同一实例交给业务 worker 与当前会话 snapshot。问题来自原 Runtime/host 关系的公开读回，Renderer 不能创建问题。
- Panel/Workspace 的受信 IPC 使用当前窗口的原会话标识，提交原 question/task/source/revision 和独立消息 ID。Admin 或其他窗口不能代答。地点回答不创建新任务，不授予后续日历/提醒操作权限。
- 输入卡保留进行中的输入和焦点；传输回执不明时冻结原回答，显式重试复用同一消息及参数。已确认回答不会被延迟 snapshot 重新打开。方案 accept/decline 展示和请求形状已实现，等待原 N04 决定 host 与 Main 注入集成。
- F04 recovery 已注入 Runtime options，原任务核实按钮消费 F04/F24 公开恢复结果；未取得核实回执仍保持待核实，不重发原写入。

验证：独立 UI 工作树运行 `node --test apps/desktop/test/f11-conversation-questions.test.mjs apps/desktop/test/task-progress.test.mjs apps/desktop/test/authorization-question-card.test.mjs apps/desktop/test/reconcile-task-action.test.mjs`，32/32 通过、无跳过。首次输入保留测试发现 progress snapshot 会替换正在输入的节点，已修正渲染签名并通过原断言。覆盖当前会话、过期/非法字段、明确拒绝方案、传输未知的同消息重试及延迟 snapshot。

边界：DOM fixture 与 Main 实际处理代码测试属于本地合成验证；未据此声称真实用户回答、声学、日历账号、云固定部署整图、目视或独立真人审核通过。最终集成构建和 Desktop smoke 待本轮其余提交合入后执行。
