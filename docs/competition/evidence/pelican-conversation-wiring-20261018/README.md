# Pelican 对话工具闭环：Local/Synthetic 定向证据

日期：2026-10-18。目标 profile：`huawei_ict_agentarts`。实际环境：Linux，Node `24.15.0`，
npm `11.12.1`。执行者：受委派的 `windows_adapter_1018`。基线：`a37cd414`，独立工作树
`.worktrees/windows-model-wiring-20261018`；构建验证依赖已冻结的 DEV 工具与共享 presence 补丁，
这些依赖不包含在本证据的两文件补丁中。

本次只证明公开 Client、原 Runtime 父子任务/工具目录、Policy/ToolGateway、审批恢复和 Evidence 的
**Local/Synthetic 调用闭环**。模型由明确的 `FakeCoordinationPort` 脚本代替，提案使用 `unverified`
以经过实际目录与结果出口校验，不用 `mock` 提案绕过出口。没有真实模型、Laya、AgentArts、云调用、
Windows 桌面、音频或外部账号操作，也没有生产 Linux patch fallback。

## 输入与真实调用方

- 测试：[conversation-pelican-wiring.test.mjs](../../../../apps/desktop/test/conversation-pelican-wiring.test.mjs)。
- 公开源 fixture：[pelican-animation-bug.svg](../../../../tests/manual/agentarts/fixtures/pelican-animation-bug.svg)。
- 原 fixture SHA-256：`2cb6272bb47cb86f93e74ba0033409644d4890eb060a7a90ffd28af0447d80d8`。
- 本次源 SVG 始终只读；测试只创建、修改并最终删除独立临时工作区内的副本。
- `createRuntimeApplication({delegateUserTasks:true})` 强制生成原 `user-work` 子任务；父对话不直接
  读写工作区。子任务继续使用原 Competition worker，没有新的任务库或执行循环。

## 实际链路与断言

| 节点 | 调用与读回 | 结果 |
| --- | --- | --- |
| 对话提交 | 公开 `Client.task.submit`，保留原 UI conversationId | 原父任务受理，不当作完成 |
| 必需子任务 | 原 `subagent.dispatch` / `user-work`；读取真实 `availableTools` 与持久目录 | 单一真实子任务；四个有完整参数形状的工具，未给 child 递归 dispatch |
| 文件读取 | 公开 `createWorkspaceReadTool()` → `workspace.read_text` | 真实读取临时 SVG，内容与公开 fixture 一致 |
| 修改预览 | 公开 `createWorkspacePatchPreviewTool()` → `workspace.preview_text_patch` | 三个精确替换、before/after SHA、完整 previewText；保持除 begin 时序外的全部字节 |
| 临时写入 | **仅测试文件中定义**的 `workspace.synthetic_cas_apply` | 明确 `verification=synthetic-fixture-cas`；核对原 SHA/新 SHA/geometry，再写入临时副本并读回；不冒充原生 Windows apply |
| 固定命令 | 公开 `createWorkspaceCommandTool()` → `workspace.run_allowed_command` | 实际启动当前固定 Node executable 和宿主固定脚本；模型只能选择公开 recipeId，不能提交 Shell 或执行代码 |
| 命令验证 | Node 独立读取写后 SVG | 正好三个 animateTransform，begin 全为 `0s`；去除 begin 差异后 SHA 与原文件一致，geometry 保持；exitCode=0 |
| 原任务回执 | 原 Runtime 的执行记录、`readEvidence(childId)` 与父 evidenceRefs | 四条 child 执行均 Policy allow、started、confirmed；四个原 Evidence ID 被父结果关联 |
| 父结果 | 父脚本只在确认真实 child 终态及命令读回后汇总 | parent/child 都 succeeded，父只有一次末尾模型脚本调用；不凭文字声称成功 |

所有子工具均保留原 task/run、scopeRef、参数 digest 和 Evidence。执行包装器在调用公开 provider
前核对原 Runtime 已记录的 Policy allow/started 执行，并通过 `matchesToolExecutionInput` 比对原参数。
只有根 `subagent.dispatch` 在测试自动工具名单中；读、预览、临时写入与 Node recipe 都逐次等待原审批。

独立 Synthetic 审批 harness 通过公开 `authorization.respond` 消费当前原 `approvalId/revision`，
脚本模型只提出工具请求，不签授权。临时 CAS 审批的错误 revision 被真实 Runtime 拒绝，
审批仍 pending、文件仍为原内容、CAS 调用数仍为零；随后使用正确原 ID/revision 才执行一次。

`createConversationToolAccess` 从同一父 UI 对话读回原 child 待审批项，包含原任务映射；
另一个 UI 对话无法读到它。这里没有模拟 Live 音频或宣称 UI 窗口已经实际交互验收。

## 命令与结果

依赖构建：独立工作树执行 `npm ci --ignore-scripts` 后，运行 `npm run build`，成功；不运行全仓测试。
实际定向命令：

```sh
node --test apps/desktop/test/conversation-pelican-wiring.test.mjs
git diff --check
```

结果：**1/1 通过，0 失败，0 跳过**；本次最终测试约 2.86 秒。包含五次 child 模型脚本调用和
一次父汇总调用，四个独立原审批、四个工具执行、一次实际 Node 子进程与一次 Synthetic 临时 CAS 写入。
源 SVG 的 geometry、路径、颜色和其他字节均未改动。

原始本地日志保存在被忽略的
`.cache/wiring-20261018/pelican-conversation-test.log`；依赖构建日志为
`.cache/wiring-20261018/pelican-dependency-build.log`。没有把临时 SQLite、临时 SVG 或依赖加入提交。

这份证据不完成真实模型/Windows/Live 验收，不扩大冻结 capability 或替代原生 patch 的独立验证。
本工作包没有 commit、push、PR、Approve、merge 或外部发送；根集成人负责将两文件补丁合入原工作包。
