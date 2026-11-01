# F23 实际消费者接线方案

Competition Profile；PR #531。既有 F23 guarded CAS 账本保留为版本和 operation 的唯一权威，不新增配置库。

本轮将 F03 候选生成的模型选择接为具体消费者：参数仅使用已有公共 `ExecutionModelSelection`（catalogRevision、modelId、可选 reasoningEffort）。F03 提交时固定配置 revision / version / parametersDigest，并把 executionModel 放进原图顶层 input。现有 AgentArts `prepareOwnedWorkflowCandidates` 已从这里解析选择，实际 `ModelGateway` 经原 execution-model registry 解析提供者。配置晋升只影响后续图；已受理图保留历史版本，模型目录/部署失效仍拒绝。

这项行为是本地 Competition 决策选择，不是云端部署或启动参数热更新，也不改已有对话显式模型偏好。未初始化时沿原 F03 模型入口运行；不得伪造 F23 已应用版本。初始化需独立受信确认，晋升/回滚继续要求原 F23 Policy、版本化 acceptance、真实可比结果及原 operation 读回。

严格账本消费者读口已交付。Desktop 初始化入口已接原 host-only ToolGateway 工具和管理页：只接纳当前目录下已保存的主模型，单独原 Policy 许可后一次初始化；已有基线拒绝重新初始化，不能以设置按钮替代晋升。原初始化任务/状态可读，unknown 不自动重试。

必要检查：Runtime 构建通过；实际 SQLite CAS 晋升后新图读新版、已受理图保留原版、伪造选择和失效目录拒绝一例通过；Desktop 真实 Runtime/Policy/ToolGateway/SQLite 初始化与防覆盖一例通过（目录与人工批准为 Fixture，不含云请求）。F03 消费装配、版本化 acceptance、评测生产者和 F23 全图接线仍在推进；不据此声称真实平台评估或 F23 已完成。
