# F23 同条件结果生产接线

目标为 Competition Profile，配置消费者仍是现有 F03 模型选择及其 Runtime SQLite CAS 账本。

在现有受信 `/invocations` 服务分派中增加 provisional `evaluationVersion: 1`、`operation: paired_model_outputs`。只接受目录内两个固定 ExecutionModelSelection 和公开样本；复用同一 ModelGateway，不携带工具、参考答案或本地权限。原 task/request/session/deadline 及输入摘要贯穿结果，记录每次实际调用的耗时、部署元数据及文本输出。没有未知重试。时间切分只证明所给数据 manifest 的时间边界，不证明模型训练语料无泄漏。

Desktop 先经原 ToolGateway/Policy 固定样本和版本化 acceptance，再产生两分支输出。后续 AgentArts Evaluation 必须与这些原输出逐项对应；评估器耗时不代替模型耗时。F23 N01–N03 读取原样本、时间边界和真实平台分数，N04/N05 复用已有 guarded CAS、operation 与消费者读回。未配置完整数据或平台凭据时 unavailable，不填默认分数或通过状态。

兼容性：现有工作流、模型目录与其他服务协议保持不变；旧镜像不识别本服务时明确不可用，需要部署新镜像。无数据库迁移、无新依赖。本文件为实现方案，尚非真实验收记录。

已接 Desktop Main、管理页、两个 host-only 原工具和 F23 configured worker。管理页先提交实验 JSON，再使用返回的原 taskId 绑定两个平台任务。评估只接受完整 1–100 条、固定数据集/评估器版本、原 `item_data` 和实际输出一致的结果；不接受人工修改后的评分。平台格式需以当前真实 API 验收继续核对，不能由 Fixture 推断。

实验配置形状：`{candidate: ExecutionModelSelection, candidateVersion, splitAt, expiresAt, metricRules, cases:[{id,input,reference,availableAt,expectedAt}]}`。样本最多 10 条，reference 不进入模型输入，`availableAt <= splitAt < expectedAt`；阈值必须显式提供，不预置质量标准。结果绑定形状：`{experimentId, main:{taskId,datasetId,datasetVersion,evaluatorId,evaluatorVersion,itemIds}, shadow:{同字段}}`，itemIds 按导出原样本顺序。模型对比只证明该公开样本集合，不能替代全部 F03 业务验收或模型训练数据审计。

本轮最小检查：Runtime 构建、实际 Runtime/Policy/SQLite/F23 五节点晋升到真实消费者一例、评分读回与原输出错配拒绝一例、双模型同输入且参考答案不发送一例、F23 既有设置入口一例通过。模型、平台响应及批准为显式 Fixture；没有真实云评分或产品验收通过声明。
