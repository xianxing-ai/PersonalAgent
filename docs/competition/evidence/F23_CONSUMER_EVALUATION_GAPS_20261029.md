# F23 真实消费与评估证据边界（2026-10-29）

目标：`huawei_ict_agentarts`。本记录是源码检查，不是 AgentArts 平台、真实模型、真实评测或 F23 整图的验收。

## 已有真实存储与未接线边界

- `apps/runtime/src/application/workflow-shadow-configuration.ts` 使用同一 TaskRuntime SQLite host-state 的 guarded CAS；配置快照和 operation 同事务保存，包含 revision、参数摘要与操作绑定。CAS 返回 false 可重新读；抛错或结果未知必须按 `readOperation(operationId)` 恢复原操作。
- `packages/agentarts/src/workflow-shadow-release.ts` 的 `finish()` 目前将配置端口读回等于 `after` 作为 `promoted` 的条件。这只在所注入端口确为运行中配置消费者的权威时才代表该消费者版本；仅注入本地账本不能证明云端或决策模型已应用。
- `apps/agentarts-runtime/src/image-services.mjs` 的 `shadowPolicy` 仅来自 operator 启动配置。`shadow-controller.mjs` 构造时校验和克隆策略，随后使用固定副本；未从上述 Runtime 账本订阅或按任务读取版本，亦无应用 revision/digest 读回。它控制 F22 影子采样和比较，不能直接视为 F23 被测决策配置。
- `apps/agentarts-runtime/src/local-laya.mjs` 明确为本地宿主入口，云主入口不导入或启动；`adaptive-decision.mjs` 仍为实验选择器。实际云端决策参数契约、发布 API、受信应用读回未在本次源码中确认。

## 测试 Evidence 的真实来源

- `apps/agentarts-runtime/src/platform-services.mjs` 的 `evaluation.read` 是真实平台读取的扩展点，但必须同时注入 `evaluation.readResult`、`evaluation.validateResult` 和 `evaluation.authorize`。缺任一项时状态为 unavailable；接口配置存在也只报告 configured_not_verified。当前不能从此推断平台评估结果或通过事实。
- `apps/runtime/src/application/workflow-shadow-verifiers.ts` 的签名检查、原 Runtime 任务/操作/Evidence 对账依赖独立的 `verifyBranchObservation`；签名只证明消息完整，不能证明本地比较确实发生、度量正确或平台评分可信。
- `apps/agentarts-runtime/src/shadow-controller.mjs` 可在受信宿主已有真实回执后签名，但 F22 `receiptKeys` 没有 F23 的 `configurationId`、`version`、`parametersDigest`、`observedAt`、`expiresAt`，其严格字段检查不直接接受扩展后的 F23 release receipt。解决字段对接不能替代真实指标来源、隔离证明或验收。
- 仓库已有模拟/合成测试和 receipt 验证能力；本次没有发现绑定真实数据集、同条件两条执行、质量评分、调用数和耗时，并提供不可伪造原始读回的完整 F23 生产者。`adaptive-decision.mjs` 内 wallMs / teacherCalls 是单次决策观察，不能单独证明质量、可比性或所有验收检查通过。

## 需要实现的具体接线

1. 确定实际决策消费者及参数 Schema。将 `workflow-shadow-configuration.ts` 账本接成该消费者实际权威，或通过明确的远端 configurationPort 原子更新实际权威；消费者在每次决策固定并记录 `{configurationId, revision, version, parametersDigest}`，提供独立应用读回。跨进程/云写入若无法原子提交与对账，应保留原 operation 的 unknown 状态，不由本地 CAS 推断远端成功。
2. 在已有授权体系下提供明确的人类/受信配置消费者初始化和版本化验收配置；所用参数不可由模型自行授权。更新 `workflow-shadow-release.ts` 的读回条件或配置端口语义，使 promoted/rolled_back 必须反映对应实际消费者版本，而非账本中间状态。
3. 为 F23_N01–N03 注入受信数据集/时间切分/结果执行与读回适配，优先真实 AgentArts Evaluation。若仅有本地受控评测，应提供实际候选、版本、数据集摘要、时间隔离、原始 Runtime ToolGateway Evidence、测量方法、观测时间和检查结果；仅作为本地证据，不能冒充云评分。
4. 建立 F22 → F23 回执兼容并明确 schema 和签名字段；在 `verifyBranchObservation` 与 `verifyTestEvidence` 内独立读取原结果并核实 task/session/revision/deadline、baseline、配置版本与参数 digest、conditions、计量过程和原始执行 Evidence，不能以签名或回调恒 true 代替。
5. 覆盖实际消费者读回、配置变更期间竞争与撤销、指标不满足、来源变化、结果未知读回和重复 operation 不重做；真实云未配置时明确 unavailable。对应 goo122 长期维护范围由 Owner 授权本轮代实现，具体完成实现后应逐项更新归属与证据。

本次未修改 F23 生产代码、未运行测试，也未接入真实云服务。由于现有影子策略不是目标决策配置、无确认的决策消费者读回及评估生产者，未注入 `workflowShadowRelease`。
