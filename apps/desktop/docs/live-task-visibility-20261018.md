# Live 工作回执与跨对话子任务显示

目标 Profile：`huawei_ict_agentarts`。本工作包修复 Desktop 读取和展示已有 Runtime 记录的路径，不变更工具执行或授权。

## 问题与行为

旧版工作区按当前工作区对话过滤父任务，导致语音面板所属对话的子任务被排除。实际旧版窗口读回：面板有 5 条子任务，工作区为 0 条。

工作区现在显示主进程已加载父任务下的全部子任务，面板仍限定当前对话。界面默认仅显示紧凑子智能体标识，无子任务时不占空间。点击标识展开独立子对话详情，显示 Runtime 已保存目标、回答、模型、强度、状态与步骤，支持关闭、刷新和返回父对话。

新增本机 IPC `task.subagentConversation` 在读取前核对已加载原父任务、Runtime 父子绑定和子任务 conversationId；不通过模型回答猜测关系。仅使用公开 `readSubagentTasks` / `runtime.getTask`，不读取私有循环检查点。Runtime 没有公开的完整逐轮会话读取端口，返回 `transcriptAvailable:false`；部分循环检查点可能保存消息，这不构成完整会话可读。

`task.openConversation` 仅定位原父任务对话，不提交、重放或恢复任务。未知或已归档对话拒绝定位。历史加载范围以主进程现有任务缓存为限，并非全库搜索。

Live 增加提交中、已受理、回执已返回和结果待核实反馈。语音被打断或播放结束时，仍有工作等待则保持工作状态。上下文提供实际 `subagent.dispatch` 注册/可用性和当前对话的子任务摘要，避免语音模型凭空宣称接口关闭。提示词要求明确派发请求经过 `request_work`，但提示词不构成接口必调用或任务成功的证明。

结果中的 Evidence 仅展示数量，不展示原始引用。执行记录、模型自报与独立验证分别解释；成功记录仍可标记 `verification=unverified`。

## 验证

- 60 项受影响测试通过：`subagent-activity.test.mjs`、`subagent-conversations.test.mjs`、`live-voice-host.test.mjs`、`live-voice-controls.test.mjs`、`workspace-preference-feedback.test.mjs`。覆盖跨对话投影、父子绑定防伪、原父任务导航、未知/归档目标、详情旧回包和关闭、语音打断及播放排空期间的工作状态、并发和重复调用以及异常回执。测试使用 bundled Node 24.19.0；仓库 pinned Node 为 24.15.0，未为轻量 JS 测试另行下载安装。
- 真实 Electron 使用现有用户配置启动。修复版面板及大工作区分别读回 6 条持久化子任务，默认详情折叠；实际点击读取的目标/回答与 Runtime 原记录一致，刷新、返回父对话、关闭均通过；未捕获页面异常。数量为各次检查时读回值，不将两次检查视为同一静态数据集。
- 检查实际截图、脚本语法与 `git diff --check`。本机截图/检查报告位于被忽略的缓存目录，不进入 Git。
- 无协议 Schema、依赖、数据库迁移或执行权限变更。保留 Runtime/Policy/ToolGateway 授权链，无 Local 回退。

## 限制与恢复

没有新开启麦克风、重放计算、调用付费模型或执行云端工具闭环。本次真实窗口验证仅证明已有记录的显示和导航；不能据此认定语音模型每次都会派发，或记录中的模型结果已独立验证。

恢复可正常退出修复版，重新启动原 main 工作树并使用原用户配置。无需迁移数据库；启动前保留现有配置备份。
