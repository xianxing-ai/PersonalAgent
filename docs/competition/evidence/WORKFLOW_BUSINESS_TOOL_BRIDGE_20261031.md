# 图节点业务工具子任务桥（2026-10-31）

目标 Profile：`huawei_ict_agentarts`。接口 `provisional`，本地合成验证；本记录不代表 #531 整图、真实账号或 AgentArts 验收完成。

## 受信调用口

`@personal-agent/runtime/application` 导出 `createWorkflowBusinessToolBridge({application, resolveTool, assertCurrent, now?})`。
`application` 必须是当前实际 RuntimeApplication 实例。`resolveTool(request, scope)` 是同步受信组合端口，按固定 `actionKey` 返回
`{workflowId, nodeId, hostToolName, toolName, toolVersion, arguments}`；未知动作返回 `undefined`。
业务参数必须由原图节点、原范围和已验证输入精确解析，不能让 Renderer 或模型选择目标工具、替换参数或声明 Evidence。

- `invoke({actionKey, input}, context)` 返回原确认的 `{result, taskId, runId, scopeRef, toolName, toolVersion, arguments, evidenceRefs}`。
- `read({actionKey, input}, context)` 只读原子任务状态与可用的 `confirmed` 回执；不存在时是 `unbound`，不会创建任务或重试。
- `assertCurrent(scope, context)` 必须同步检验当前原图授权与来源；不能返回 Promise。缺少当前许可、原始输入或注册描述符时拒绝。

回执只供可信本机消费。出机仍须业务工厂的 `authorizeReceipt` / `authorizeExport` 与原 HostBridge 签名投影链核验原 Evidence 和当前出口许可；桥不授予出机权限。

## 持久身份与执行边界

身份绑定原 host `taskId/runId` 和固定 `actionKey`，参数摘要不进入身份，改变参数会冲突。原业务 descriptor、输入摘要、精确参数、期限、原图 operation/session 与 namespace 写入同一 TaskRuntime checkpoint。已有 `prepareHostToolTask` / `finalizeHostToolTask` 在派发前写好原 `coding-repair:parent` / `coding-repair:host` 双向关系，因此现有会话解析可递归回原用户对话。

每个业务子任务独立经过原 Runtime、Policy、ToolGateway 和审批，不复用图节点的 grant。外层宿主等待子任务真正 confirmed，`waiting_approval` 不返回成功；拒绝、取消、超时、撤销、参数或 descriptor 替换均不产生成功回执。取消传入原 child，已开始的未知写入保留原记录。

Runtime 的现有 ToolGateway adapter 入口增加一个同步检查，覆盖 Host 与公共 `tool.invoke`；检查位于异步授权问题返回之后、实际 Gateway 派发之前。它只检验当前进程中的原父调用、持久关联、精确输入和当前许可，不签发或替代 Policy 授权。原父调用结束即释放该检查；进程重启后旧待批 child 没有原活跃 guard，批准旧卡也不能执行。

原未知结果、只有 intent 而未完成 child 关联、以及中断的 created child 都保留为待核实，不静默补派。当前没有实现让未知原 host 重新开始执行的恢复 API；必须通过原任务的可信核实路径处理，不能新建 child 或改 actionKey 重发原写入。

已 confirmed 的 host 可在原父图仍活动、期限有效、当前许可成立时提交固定的只读后验动作，例如 `f07.calendar.recheck.before_export` 和 `f07.calendar.recheck.after_export`。这些动作各自拥有独立 Policy 子任务；已完成 host 不能再提交新的写动作。同一动作再次调用只读原回执。

无新增数据库、迁移、公共 wire、模型入口或调度器。25ms 等待只观察原持久 child，不决定派发或重试。

## 本地验证

专用 `apps/runtime/test/workflow-business-tool-bridge.test.mjs` 使用实际 SQLite、Runtime、Policy、ToolGateway、HostBridge；底层业务服务与图提案明确为 Synthetic。Runtime 构建通过；专用测试 13/13 通过。

- 分开的图/业务审批；业务原卡待批时外层仍未确认；结果与原 child run、参数和 Evidence 精确一致。
- 拒绝、参数替换、伪造授权、未知 action、取消、超时、撤销和描述符变化；在途取消的迟到结果不能确认。
- 原写结果未知后关闭并重开 SQLite，不重发、不改变原执行记录。
- 实际测试进程在 child 待批时被终止，重开其 SQLite 并批准旧卡，写调用仍为 0。
- 原异步授权问题期间撤销，返回批准后也不能调用业务服务。
- 已确认 host 的两次独立只读后验各自审批，重复动作不重发；新的写动作拒绝。

红→绿证据：移除执行前检查后，重启旧待批测试出现写调用 `1 !== 0`（`.cache/test-pr531-bridge-before.log`）；只在异步审批之前检查时，审批期间撤销也出现 `1 !== 0`（`.cache/test-pr531-bridge-async-before.log`）。最终检查点移至原 ToolGateway adapter 入口，两项与全部专用回归通过（`.cache/test-pr531-bridge.log`）。

现有 HostBridge / configured worker 联合定向在新增异步问题回归前 25/25 通过（`.cache/test-pr531-bridge-focused.log`）；最终全仓检查另记，不将局部通过宣称为完整检查。
