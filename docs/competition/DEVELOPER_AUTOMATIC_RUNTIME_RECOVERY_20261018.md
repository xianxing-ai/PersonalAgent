# 开发流程自动工具 unknown 恢复消费（2026-10-18）

原开发流程可以通过可信 routine Policy 自动执行 `workspace.apply_text_patch`，不会创建 Approval。此前 Runtime 只在等待审批时持久化嵌套调用身份，自动补丁丢响应后虽可经原 marker/source 读回确认，恢复仍缺原参数 cursor；补齐身份后，子任务恢复端又会要求本来不存在的 Approval。

本次在原 active DEV proposal（binding 和当前 Competition pending 摘要匹配）的真实嵌套调用执行前，沿用 `application-tool-invocation:<runId>` 保存原参数、摘要、版本和 deadline，并更新原流程 cursor。原 save-once 改参拒绝保留。普通自动工具不新增参数持久化；原手工审批路径、routine grant 和 ToolGateway 不变。

子任务只在原 `competition-confirmed-replay` 的 runId/inputDigest 与 confirmed、executionStarted、Policy allow 的 Gateway record 完全对应，且原 routine decision 的工具名、版本、参数摘要一致时，继续原 worker。仍未知、不同 run/参数、没有原 routine decision 的调用不能使用此分支；不创建 Approval，不补发原补丁。其余调用继续检查原手工 Approval。

Node 24.15.0 定向验证：

- Runtime workspace build 通过。
- DEV 专员的 `automatic developer patch` 回归，使用 `PA_SYNTHETIC_DEVELOPER_RUNTIME_APPLICATION_MODULE` 指向本隔离工作树的公开 Runtime entry：1/1；原子任务走真实 Runtime/Policy/Gateway 和 marker reconcile，Synthetic 工具先修改 fixture source 再丢响应。确认 foreign receipt 拒绝、无补丁 Approval、原 grant 剩余 0、apply 仅一次，后续 verify/commit/push 仍通过各自原授权。
- 原 `subagent-task-binding` 两条手工批准/工具范围约束和 `subagent-explicit-competition-resume` 撤销 grant 定向检查：3/3。
- 追加子会话的独立执行任务没有 `subtask-parent`，恢复走 Runtime Application 的另一入口；该入口也按同一 exact confirmed replay/routine decision 守卫消费。DEV 专员新增 `automatic developer patch.*appended conversation message`：1/1；先完成原 ci_list，再通过真实 `submitSubagentConversationMessage` 新建原会话 turn，失响应补丁读回后继续成功，apply 仍一次、grant 仍 0、无补丁 Approval、外来参数拒绝、原 UI 归属保持。Runtime 单独重新构建通过。

验证为本地真实 Runtime 与显式 Synthetic GitHub、模型和 workspace 工具，不是真实仓库写入、云或 Windows 验收。新回归测试由开发流程专员交付，本增量只改 Runtime 消费及本记录。
