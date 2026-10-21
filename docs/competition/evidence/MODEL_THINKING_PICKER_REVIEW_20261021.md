# 模型与思考选择器：固定基线追线（2026-10-21）

本记录基于 `ac28a58e0e8045a859d2f1b4d20b0db9f4afcfc2` 的源码只读追线。旧 `f6c0dcc0` 工作树中的选择器仍由移交方更新，本树尚未复制该稿、修改模型入口或运行产品验收；下文不是最终新实现通过声明。

- Desktop `agentarts-model-settings.js` 的 `readCatalog` 消费当前受信 deployment 的 published 请求结果；catalog revision 与 gateway/runtime/deployment 绑定。仅完整目录中的可用文本项可供选择，`unverified` 仍不能表示真实模型验证通过。
- `readExecutionModel('primary')` 使用配置中的 defaultModelId/reasoningEffort；`readExecutionModel('subagent')` 使用 defaultSubmodelId/submodelReasoningEffort。`conversation.model` 显式 executionModel/manual modelId 只覆盖该对话的主执行选择，空 modelId 恢复配置默认。
- 现有 `thinking.update` 只保存 depth/fast，Runtime 将它们转成 task-thinking 与步骤预算，不会将执行深度冒充模型原生 reasoningEffort。因此旧稿默认滑块只更新 depth，不能证明默认主/子模型原生强度联动。
- Runtime 根任务在原 `execution-model` checkpoint 保存选择；user-work 委派明确继承该选择。其他未明确指定模型的子任务经 `readDefaultExecutionModel('subagent')` 取默认子模型。该 host-only callback 在本基线仅接收 role，没有 task/conversation；不能从 Main 当前 active conversation 读取临时偏好，进而影响另一个并行任务。
- AgentArts registry 只接受当前 revision、公开 modelId 与该项公布的 reasoningEfforts；省略 reasoningEffort 意味着供应商默认，不得由提示词或 caller 填充旧强度。真正 Provider 仍由既有 ModelGateway/registry 选择，不新增路由器。
- 授权集成固定 `55235143` 的 `readAuthorizationQuestionDestination` 绑定原 execution-model/task-model-preference/subtask-model-binding 与 coordination 配置。新选择器必须最终传播到实际原执行绑定，不能只改变展示或以当前 UI 状态替代已开始任务的目的地。

最终交接后重点核对：默认组合与 manual 的真实语义、主/子各自的 published 强度映射与省略默认、队列部分保存/失败后提交隔离、会话与目录变化、原模型 checkpoint/恢复身份、授权出机目的地，以及 actual Electron 初始化到控件的消费。移交方旧 44 项与 renderer-result 仅为历史合成桥证据，不代替本树最终实现与 Runtime/IPC 验收。

## 最终源码接手

独立工作树 `.worktrees/model-thinking-picker`、分支 `codex/model-thinking-picker` 已正常同步 main `a1063e2637db73f42fd9e8b1ba93d554c787320b`。只提取移交树的 12 个已跟踪 picker 相关文件补丁及 5 个新增文件；没有复制 Gemini 提示词、旧 Runtime 授权修正或整份旧 Main。目标为 Competition Profile。

新增 shared 默认选择函数及 Main 三处小接线让默认模式在执行时按原 conversationId 解析，最低两档使用已配置子模型，其余使用已配置主模型。只取实际发布的原生枚举，无法公布强度时省略该字段。手动模式保留显式选择，默认模式不固定模型 ID、不改全局模型配置。Conversations 的可选字段和首次启用备份、私有 IPC 兼容边界已登记接口目录。

静态追线：Main 的 readConversationPreference 使用 Runtime 传入的 conversationId；Runtime 受理时将解析结果写入原 execution-model，再将该模型/强度显式写入原 user-work 委派。执行子任务核对与父任务的原模型 checkpoint 相等，主对话汇总仍读原选择。因此之后切换活动会话或更改默认配置不会重绑已受理任务；目录变化仍由原 guard 拒绝。其他没有显式模型的专业子任务继续原默认子模型语义，本包未新增跨会话的全局临时偏好。

当前仅完成源码差异/语法与静态追线；本树依赖、定向测试与实际 Electron 验证尚待唯一重资源槽。移交方最终旧树 74 项与 actual product result 为历史证据，不在这里记成本树通过；其修复旧 Runtime dist 的两个授权类型 hunk 未混入本包。Browser 插件技能未提供，渲染验收将复用项目已有 Playwright/Electron 脚本；不会调用真实模型、麦克风或账号。
