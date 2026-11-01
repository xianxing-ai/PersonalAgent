# F22 原执行历史回放纵向包（2026-11-01）

目标 profile：`huawei_ict_agentarts`。工作树 `.worktrees/pr531-f22`，基线 `e9447a48`。

## 范围与兼容

只开放 `workflow.f22.trace_replay`，请求仅 `{sourceTaskId}`。原 F22 图实际走 N09 → N01 → N02 → N04 → N06 → N07 → N08，跳过 N03/N05。它读取已有原操作，不重新执行原工具或原模型；图自身的候选制备和有限判断仍走原机制。输出中的 `actualToolCalls:0/actualModelCalls:0` 指历史回放函数的执行次数，不是整图判断次数。

原 `apps/agentarts-runtime/src/trace-replay.mjs` 实现移至公开 `@personal-agent/agentarts/trace-replay`，云端原路径 re-export；算法、云端签名协议和请求不变。发布构建复制该原生 ESM 及声明至 dist，没有增加依赖、任务库、调度器或 wire/数据库迁移。新 Runtime 工厂为 provisional 公开组合口。

源必须是原委派用户同会话的既有 host task。检查原 namespace、task/run、参数摘要、工具版本与当前 descriptor、Policy allow/已开始记录及保留的原 grant；活动执行不接受。当前 descriptor、task revision、完整结果和原输入一起冻结到原 Runtime checkpoint。取消、期限、配置 revision、源变化或原 grant 撤销使当前链拒绝；导出等待前后重新读取。历史已消费 grant 不重新消费，历史过期不签发新授权；当前数据出口另由原用户确认。

原 unknown/failed 保留原态；写入仅时间线，不 replay；`counterfactualComparison:'unknown'`、`currentResultValidity:'not_independently_verified'`、`trainingPerformed:false` 明确输出。N02/N08 有限候选只接受本 trace 分支和无晋升结论；完成验证原四个 host 与两个判断的真实 Runtime 回执。没有 decision_shadow、isolated、F23 晋升、训练或真实机会并行的成功声明。

## Main 接线

`apps/desktop/electron/f22-trace-replay-host.js`：

```js
const configuration = createDesktopF22TraceReplayConfiguration({userData});
const f22 = createDesktopF22WorkflowWorkerPorts({
  getApplication: () => runtimeApplication,
  configuration, hostUserNamespace,
  getToolDescriptor: (name, version) => runtimeApplication?.readRegisteredToolDescriptor(name, version),
  authorizeExport: request => authorizeOwnedWorkflowExport(request)
});
```

`getToolDescriptor(name, version)` 两个字符串参数，必须读原 Runtime 注册表。`authorizeExport` 接收原 `{taskId,workflowId:'F22',stage:'initial'|'receipt'|'completion',value,deadline,signal,...}`，复用原精确出口批准，不设恒真默认值。工厂返回 `{tools,configuredWorkflowWorkerPorts,unavailable}`，4 个 host（N09/N01/N04/N06）、1 个 worker；原 `decision.choose_candidate@1.0.0` 由既有组合提供。worker 注入同一个 owned image，判断卡继续用现有 configured-workflow decision source。

配置 `snapshot()` 返回 `{enabled,revision}`；文件缺失时 `false/1`。Main 原 admin-only、原生确认之后调用 `configure({enabled,expectedRevision})`，原子保存固定 `userData/f22-trace-replay.json`，返回新 revision；退出调用 `close()`。配置只开关本 trace 功能，不能授权执行或出机。不依赖 coding workspace。

生产 admission 在工厂内部读取上述持久设置及 `Runtime.isTaskActive()`：只允许当前原用户根任务、当前 graph 和有精确双向原 HostBridge 绑定的 F22 child；其他实际活动任务优先，回放拒绝启动/推进。等待审批后仍重新检查，不缓存资源或授权结论。

Main imports、设置 UI/IPC、公开注册表只读方法由根工作包整合；本提交不改 Main，不宣称已完成 UI 或云验收。

## 最小验证

- `npm run build` 通过；完成门禁增加原 N02/N08 回执检查后，Runtime 单 workspace 构建通过。
- 新增唯一行为用例 `apps/desktop/test/f22-trace-replay.test.mjs`：真实 Desktop 配置文件、OwnedWorkflowEngine、Runtime、Policy、HostBridge、SQLite；原未知写入仍只有 1 次，原执行记录逐字段不变；实际四个 host 与 N08 判断经过原图，最终为 `trace_replay`/unknown，零原工具/模型重执行。最终 1/1 通过，0 跳过。
- 云端原路径的既有 `writes are timeline-only` 用例 1/1 通过，验证 re-export 兼容；没有重跑整套测试。`git diff --check` 通过。
- 首次沙箱 token 在测试临时目录原子 rename 报 `EPERM`，尚未进入 Runtime。原断言在明确外部 TEMP、普通 token 下通过；未放宽配置原子写断言。日志保留 `.cache/test-f22.log`、`.cache/test-f22-normal.log`、`.cache/test-f22-final.log`、`.cache/test-f22-cloud-compat.log`。

原服务写入、候选/选择器、用户批准及出机响应是明确 Fixture。没有真实账号写入、真实模型或 AgentArts 部署/API/评测验收，不把本地 replay 当 F22 全模式或 #531 完成。
