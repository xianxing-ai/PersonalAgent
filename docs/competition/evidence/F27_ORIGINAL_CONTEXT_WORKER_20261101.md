# F27 原上下文编译器消费接线（2026-11-01）

目标为 `huawei_ict_agentarts`。本包把现有 Runtime 上下文编译、来源映射及 ModelGateway 压缩回执接入唯一配置 worker；不创建第二个模型入口，不改变原指令、授权或工具 Evidence。

## 生产入口与兼容

Desktop `createDesktopF27WorkflowWorkerPorts({getApplication,models,readDeploymentBinding,authorizeExport})` 返回 `{tools,configuredWorkflowWorkerPorts,unavailable}`。`models` 为原 `snapshot()/resolveExecutionModel()` 对象，`readDeploymentBinding` 为原部署绑定读取函数，`authorizeExport` 使用统一原出口卡。Main 将 worker 注入原 OwnedWorkflow image，并注册返回的四个 host。缺少端口时不注册，不从配置推断能力。

Runtime 新增只读 `readF27ContextBinding({taskId,deadline,signal})` 和 `createF27ContextWorkflowPorts` 公开导出。无数据库迁移；新增两个任务 checkpoint 仅存原编译元数据及摘要。原 F27_N01 单宿主公开接口保持兼容。

`workflow.f27.prepare_context@1.0.0` 使用 `{}` 请求。实际选择路径为 N01 原模型目录 → N05 原编译来源 → N02 原候选决策 → N04 映射/guard → N07 保存映射版本。N03 与 N06 显式跳过：本路径消费当前调用方已经完成的编译/可选压缩，不额外生成第二份摘要，也不执行新的知识扩展。结果 `sourceCoverage=original_compiled_context` 不表示任意未选知识或记忆已加载。

当前源、私有绑定、任务/会话/期限、模型目录/选择、部署、预算声明及原压缩回执均需与原 Runtime checkpoint 一致。每次效果、出口前后和完成读回复核，原 Policy 与精确工具参数检查保留。原正文只在原编译器读取，图输入/回执只带模型声明、来源摘要、计数和选择范围；模型能力为 `capabilityVerification=unverified`，目录声明为 `conditional`。无 tokenizer 时预算保持 `unmeasured`。

## 最小验证

- 新树 `npm run build` 通过；最终受影响 `npm run build --workspace=@personal-agent/runtime` 通过。
- `node --test apps/desktop/test/f27-context-workflow.test.mjs`：1/1 通过（818.9003ms）。真实 OwnedWorkflowEngine、Runtime 编译器/来源映射、Policy、HostBridge 和 SQLite；模型目录、候选/选择器、来源覆盖与审批响应为明确 Fixture。
- 同一用例验证实际固定节点顺序、原任务 checkpoint、源内容变化拒绝、未测能力保留 `unverified`、所有图输入/出口均不含原私有正文。
- 初次夹具缺 final synchronous send guard、随后历史任务缺 `verifying` 状态，均由原 Runtime 拒绝；只修夹具，未放宽产品断言。日志保留于本工作树 `.cache`。
- `git diff --check` 通过。遵照最小测试要求未重复全仓检查，统一集成检查由根任务执行。

## 未验证范围

本包不声明 AgentArts 已发布/整图云验收、真实模型上下文窗口/原生工具能力已测、压缩输出语义已人工验收，亦不声明额外检索分支已执行。Main/UI 与平台实际调用由集成任务继续；原压缩器/原最终 send guard 仍是实际模型调用的执行与撤销边界。
