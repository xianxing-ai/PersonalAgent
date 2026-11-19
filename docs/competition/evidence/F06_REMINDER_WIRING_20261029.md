# F06 待办与提醒接线记录（2026-10-29）

目标为 Competition profile；本记录只说明本地合成测试，不代表整图或实际提醒投递通过。

## 本次变更

- `apps/runtime/src/application/workflow-f06-todo-graph-host.ts` 的 N03 移除对 `todo.create.execute` 的直接调用和拼接工具 scope；须由可信组合提供 `invokeTodoCreate`，使用原 Runtime/Policy/ToolGateway、稳定操作身份和回执读回。缺该口时不注册。N03/N05 检查图 proposal 和子任务 intent 时绑定实际输入，不能以空参数替代。
- `apps/runtime/test/workflow-optional-graph-hosts.test.mjs` 的合成测试检查缺可信口不注册、参数替换拒绝和不扩充 scope。`npm run build --workspace=@personal-agent/runtime` 通过；`node --test --test-name-pattern='F06 todo write|optional graph hosts' apps/runtime/test/workflow-optional-graph-hosts.test.mjs` 为 2/2。回调为测试替身，不能证明生产工具执行或 Policy 已接入。

## 2026-10-31 增量

- N03 成功写入后在父任务 checkpoint `f06:n03-todo:{sessionId}` 持久化 `{todoId,revision,operationId,sessionId}`；公开输出仍为 todoId/opKey。
- Desktop `createVerifyWorkflowReminderBinding` 已注入 `createDesktopTodoHost`，故 N04 adapter 可注册；缺同图 N03 绑定仍拒绝。
- 尚未接通：N03 生产 `invokeTodoCreate`（须经 Policy/ToolGateway）、N05 真实投递、图 worker；清单维持未勾选。
