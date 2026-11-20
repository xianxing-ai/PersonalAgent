# F28 原模型候选链（2026-11-01）

目标 `huawei_ict_agentarts`。配置模型候选主链与可选 N12 原只读工具探索已接线；真实模型、云平台及 UI 验收仍分别继续，不能据本地 Fixture 标记整项完成。

## 实际接点

`apps/desktop/electron/f28-model-workflow-ports.js` 导出 `createDesktopF28WorkflowWorkerPorts({getApplication,modelApiHost,authorizeExport,confirmModelExport})`，返回 `tools`、`configuredWorkflowWorkerPorts`、`unavailable`。使用原模型设置的 `snapshot/getModelGateway/getGuardedModelGateway`，不依赖原 Harness 从未提供的 `nativeRoles` 字段。旧 F28 单节点接口保留兼容。

worker `workflow.f28.model_candidates@1.0.0` 默认使用原已配置 defaultId；可传 `{models:{research,analysis,coder}}` 选择原设置里的三个模型 ID，始终绑定原 configurationRef/endpoint/model/deployment。设置不成为出机许可。Main 注入同 OwnedWorkflow image 和原出口确认。

`confirmModelExport` 收到 `{taskId,kind:'f28_model_request',nodeId,payload,policyBinding,deadline,signal,assertCurrent}`；payload 为准确 destination 和原 messages/tools/输出预算。Main 原授权卡仅在本机显示并绑定它，等待前后和最终网络发送前必须调用同步 `assertCurrent`。不能以 AgentArts 元数据出口卡替代所选辅助模型的原内容许可。

F28_N01 消费原目标摘要/配置，N02 固定候选选择，N03 读取声明，N06/N07/N08 通过同 ModelGateway 各执行一次有界文字请求（coder 只读原 research 回执），N10 读取原执行证据，N05 返回 review_required，N11 汇总 candidate_only。N02 条件有真实受信 guard。模板仅将三个原云 executor 显式映射为受信 ModelGateway host，不能用云模型自报代替调用；图总节点数不变，host 目录增加三项。

配置中的原生推理字段、单次步骤预算和能力真实验证分开。三个阶段均 `tools:[]`，不冒充原生 tool calling；结果始终保留 `nativeCapabilityVerification=unverified`、`sourcesSupported=unverified`、`tests=not_run`。原正文与候选正文留在原任务 checkpoint，图 initial/receipt/completion 只有摘要、身份和计数，不向 AgentArts 重新公开完整材料。

可选请求 `toolExecution:{tools:[{name,version}],maxSteps:2|4|6|8}` 选择原已发布只读工具（1–4 项，排除 workflow/subagent/developer 递归入口）。N12 经既有业务 child 桥调用原 `subagent.dispatch`，原子任务继续走 Competition/Policy/ToolGateway；每次执行及审批恢复核同 graph/session/host/dispatch/child/模型任务目标/期限、原授权与只读描述符，不能共享兄弟工具或用模型声明授予权限。N10 等待 N12 的原 child 确认完成，最终只导出状态、实际工具次数和原证据 ID。未请求时仍明确 skipped。

工厂增加 `getToolsForSubtask(subtask,worker,tools)`：Main 必须在原 Desktop dispatch 的两个实例及 Runtime 的同名恢复钩调用它，传回原工具端口；不创建第二个执行器。`readLocalCandidates({taskId,conversationId,expectedRevision})` 供受信任务详情读取，Main 先用现有会话访问门禁核原 conversation；读取核当前 revision、原模型与 host receipt，并返回 clone。正文不进入图出口。

## 执行与恢复边界

每个 host 经过原 Policy/ToolGateway，核原 task/run/graph/session/参数/期限及原一次性授权。原模型发送前保存一次 attempt，结果绑定原模型版本与 request digest；拒绝、取消、配置替换或来源变化不能继续发送。缺失结果的 attempted 操作保持未知且不重发。每次真实 provider fetch 前仍执行原模型配置宿主的撤销检查及本图同步 guard，无第二个调度器或工具执行器。

真实审批恢复用例发现 Runtime 原 `confirmedSubagentWait` 只认 Competition loop：host dispatch 的 child 已完成但 host 留待批。现在同时精确读取原 host intent/confirmed record/原 children，复用原 host 恢复入口聚合缓存；不再次执行 dispatch。原自动 Policy dispatch 无审批对象时只允许此已确认读回路径，未开始操作仍须原批准。host unknown 保留，不自动恢复或重放。

## 最小证据

- 新树执行依赖构建；新增 Runtime 初始类型检查暴露一个 unknown 参数类型问题，已修正。最终 `npm run build --workspace=@personal-agent/runtime` 通过，不把初次完整 build 记作全绿。
- `node --test apps/desktop/test/f28-model-workflow.test.mjs`：1/1 通过（1480.2762ms）。真实 Engine、Runtime、Policy、SQLite、模型配置宿主、ModelGateway/OpenAI-compatible Provider；HTTP、安全存储、候选选择和人类响应为明确 Fixture。验证三次准确请求各经独立内容确认、保存配置零请求、原 host 顺序、原确认回执绑定、原正文不进入图出口及未测状态。
- 首次沙箱 TEMP 原子保存失败（模型配置原 rename 被拒）；未修改保存校验，改普通用户外部独立 TEMP 后原用例通过。日志在 `.cache/test-f28*.log`。
- N12 扩展同一真实 Engine 用例最终 1/1 通过（2040.4829ms），三次原模型调用、原只读 child 经实际审批恢复只执行一次、兄弟工具不暴露、N12 先于 N10、同会话本机正文读回且跨会话拒绝。前序待批恢复失败及夹具误用无 revision 的子任务摘要保留在 `.cache/test-f28-*`；未调大原 60 秒期限。
- `npm run build --workspace=@personal-agent/runtime` 最终通过。原 Linux CI 队列用例改为实际 host frontier 下的明确 Fake selector，保持串行、独立候选身份/数量/端点和零打包断言；定向 1/1 通过（56.1211ms）。不把 Fixture selector 说成真实模型调用。
- `git diff --check` 通过。未重复全套/矩阵；Main/UI、真实账号模型请求和平台部署仍须继续，当前不宣称 F28 done。
