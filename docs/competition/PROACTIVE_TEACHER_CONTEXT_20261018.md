# 主动教师多轮输入绑定（2026-10-18）

原 Runtime 的普通 Competition 任务继续使用不可变的 `competition-context:v1`。主动责任每次 `proactive.teacher_decision` 的问题、项目上下文会变化；此前第二轮复用了普通任务槽，因输入摘要不同被拒绝。

本次仅在 Runtime 内为原 ToolGateway 已批准且实际 started 的教师运行建立受信 run lease。槽由原 runId 的摘要派生；模型、公开请求 DTO 和普通任务均不能选择该槽。原授权、原 operation/输入、执行记录、配置、deadline、取消、私有副本和最终出机守卫每次重验。AgentArts 复制 request 并组合 AbortSignal 时，仅唯一匹配同一有效 lease 的完整编译输入、revision、deadline、textOnly/无工具/无 continuation 条件；同时检查原 signal 和副本 signal，歧义拒绝。

检查点仅保存原摘要和版本元数据，不保存正文或私有上下文。教师 attempt 已存在但进程 lease 丢失时，继续走原 Gateway 的 unknown 读回，不重新发送。确认过的同 run 复用原 Gateway receipt；改参不能借槽重签。取消、私有副本撤回、hold 和关闭按实际 task 撤回全部 run lease；普通任务的不可变语义保持不变。

定向验证使用 Node 24.15.0，独立工作树基线 `2e45faa5885ed5370eaa654aa0802f79f7c69450`：

- Runtime workspace TypeScript build 通过。
- `node --test apps/runtime/test/proactive-teacher-context.test.mjs apps/runtime/test/proactive-decision-tools.test.mjs`：9/9；其中新组合测试 5/5，覆盖原生产主动教师两轮、真实 Runtime checkpoint、AgentArts 风格 request 副本及 final guard、配置/Policy 撤回、取消、SQLite reopen unknown 不重发、私有副本擦除。
- `node --test --test-name-pattern='compiled context stores|credential await' apps/runtime/test/competition-context-binding.test.mjs`：6/6（含子用例），检查普通不可变上下文和凭据等待窗口。

上述为本地真实 Runtime/SQLite 和显式 Synthetic coordination/HTTP/策略夹具。未调用真实云、未运行 Laya，也不代表设备或全部 MOD 验收。独立 node_modules 由锁文件安装；同一发布基线的依赖编译产物复用后，目标 Runtime 单独构建。
