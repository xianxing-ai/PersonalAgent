# F28 原模型候选链（2026-11-01）

目标 `huawei_ict_agentarts`。本增量完成配置模型候选主链，仍不是 F28 全部分支或真实服务验收完成；N12 原工具探索接线作为后续独立增量继续。

## 实际接点

`apps/desktop/electron/f28-model-workflow-ports.js` 导出 `createDesktopF28WorkflowWorkerPorts({getApplication,modelApiHost,authorizeExport,confirmModelExport})`，返回 `tools`、`configuredWorkflowWorkerPorts`、`unavailable`。使用原模型设置的 `snapshot/getModelGateway/getGuardedModelGateway`，不依赖原 Harness 从未提供的 `nativeRoles` 字段。旧 F28 单节点接口保留兼容。

worker `workflow.f28.model_candidates@1.0.0` 默认使用原已配置 defaultId；可传 `{models:{research,analysis,coder}}` 选择原设置里的三个模型 ID，始终绑定原 configurationRef/endpoint/model/deployment。设置不成为出机许可。Main 注入同 OwnedWorkflow image 和原出口确认。

`confirmModelExport` 收到 `{taskId,kind:'f28_model_request',nodeId,payload,policyBinding,deadline,signal,assertCurrent}`；payload 为准确 destination 和原 messages/tools/输出预算。Main 原授权卡仅在本机显示并绑定它，等待前后和最终网络发送前必须调用同步 `assertCurrent`。不能以 AgentArts 元数据出口卡替代所选辅助模型的原内容许可。

F28_N01 消费原目标摘要/配置，N02 固定候选选择，N03 读取声明，N06/N07/N08 通过同 ModelGateway 各执行一次有界文字请求（coder 只读原 research 回执），N10 读取原执行证据，N05 返回 review_required，N11 汇总 candidate_only。N02 条件有真实受信 guard。模板仅将三个原云 executor 显式映射为受信 ModelGateway host，不能用云模型自报代替调用；图总节点数不变，host 目录增加三项。

配置中的原生推理字段、单次步骤预算和能力真实验证分开。三个阶段均 `tools:[]`，不冒充原生 tool calling；结果始终保留 `nativeCapabilityVerification=unverified`、`sourcesSupported=unverified`、`tests=not_run`。原正文与候选正文留在原任务 checkpoint，图 initial/receipt/completion 只有摘要、身份和计数，不向 AgentArts 重新公开完整材料。本包没有新增 Renderer 读取候选正文入口。

## 执行与恢复边界

每个 host 经过原 Policy/ToolGateway，核原 task/run/graph/session/参数/期限及原一次性授权。原模型发送前保存一次 attempt，结果绑定原模型版本与 request digest；拒绝、取消、配置替换或来源变化不能继续发送。缺失结果的 attempted 操作保持未知且不重发。每次真实 provider fetch 前仍执行原模型配置宿主的撤销检查及本图同步 guard，无第二个调度器或工具执行器。

## 最小证据

- 新树执行依赖构建；新增 Runtime 初始类型检查暴露一个 unknown 参数类型问题，已修正。最终 `npm run build --workspace=@personal-agent/runtime` 通过，不把初次完整 build 记作全绿。
- `node --test apps/desktop/test/f28-model-workflow.test.mjs`：1/1 通过（1480.2762ms）。真实 Engine、Runtime、Policy、SQLite、模型配置宿主、ModelGateway/OpenAI-compatible Provider；HTTP、安全存储、候选选择和人类响应为明确 Fixture。验证三次准确请求各经独立内容确认、保存配置零请求、原 host 顺序、原确认回执绑定、原正文不进入图出口及未测状态。
- 首次沙箱 TEMP 原子保存失败（模型配置原 rename 被拒）；未修改保存校验，改普通用户外部独立 TEMP 后原用例通过。日志在 `.cache/test-f28*.log`。
- `git diff --check` 通过。未重复全套/矩阵；Main/UI、真实账号模型请求、平台部署和可选 N12 仍须继续，当前不宣称 F28 done。
