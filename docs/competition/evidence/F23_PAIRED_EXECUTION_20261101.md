# F23 同条件结果生产接线

目标为 Competition Profile，配置消费者仍是现有 F03 模型选择及其 Runtime SQLite CAS 账本。

在现有受信 `/invocations` 服务分派中增加 provisional `evaluationVersion: 1`、`operation: paired_model_outputs`。只接受目录内两个固定 ExecutionModelSelection 和公开样本；复用同一 ModelGateway，不携带工具、参考答案或本地权限。原 task/request/session/deadline 及输入摘要贯穿结果，记录每次实际调用的耗时、部署元数据及文本输出。没有未知重试。时间切分只证明所给数据 manifest 的时间边界，不证明模型训练语料无泄漏。

Desktop 先经原 ToolGateway/Policy 固定样本和版本化 acceptance，再产生两分支输出。后续 AgentArts Evaluation 必须与这些原输出逐项对应；评估器耗时不代替模型耗时。F23 N01–N03 读取原样本、时间边界和真实平台分数，N04/N05 复用已有 guarded CAS、operation 与消费者读回。未配置完整数据或平台凭据时 unavailable，不填默认分数或通过状态。

兼容性：现有工作流、模型目录与其他服务协议保持不变；旧镜像不识别本服务时明确不可用，需要部署新镜像。无数据库迁移、无新依赖。真实执行的范围与剩余验收见下文。

已接 Desktop Main、管理页、两个 host-only 原工具和 F23 configured worker。管理页先提交实验 JSON，再使用返回的原 taskId 绑定两个平台任务。评估只接受完整 1–100 条、固定数据集/评估器版本、原 `item_data` 和实际输出一致的结果；不接受人工修改后的评分。平台格式需以当前真实 API 验收继续核对，不能由 Fixture 推断。

实验配置形状：`{candidate: ExecutionModelSelection, candidateVersion, splitAt, expiresAt, metricRules, cases:[{id,input,reference,availableAt,expectedAt}]}`。样本最多 10 条，reference 不进入模型输入，`availableAt <= splitAt < expectedAt`；阈值必须显式提供，不预置质量标准。结果绑定形状：`{experimentId, main:{taskId,datasetId,datasetVersion,evaluatorId,evaluatorVersion,itemIds}, shadow:{同字段}}`，itemIds 按导出原样本顺序。模型对比只证明该公开样本集合，不能替代全部 F03 业务验收或模型训练数据审计。

本轮最小检查：Runtime 构建、实际 Runtime/Policy/SQLite/F23 五节点晋升到真实消费者一例、评分读回与原输出错配拒绝一例、双模型同输入且参考答案不发送一例、F23 既有设置入口一例通过。模型、平台响应及批准为显式 Fixture；没有真实云评分或产品验收通过声明。

## 真实配对输出与时钟修复（2026-11-01 UTC）

- 云代码提交 `ad35445519aea9ea073c5ae3fb15b54cc130cb00`；SWR 上传标签 `pr531-ad354455`，仓库 manifest `sha256:a7ef99f0ae475e40ad77c0fb7f32d3f6eb5f1d37cb9ba42369a26633ad94d6b0`。注册表 manifest 独立读回的 config digest 与本地导出镜像一致。
- AgentArts runtime `9a65747e-05f0-475c-a2dc-f24dd3ed87ae`，固定版本及访问方式 `pr531-ad354455-v2`；原 Desktop 受信配置、安全存储、Runtime/Policy/SQLite 和生产 F23 工具共同执行，没有 Fake 模型或本地评分。
- 首次 task `0a396524-3bf2-47fa-ac57-c1f9026bb1b3` 留在 `waiting_reconciliation / RESULT_UNKNOWN`，未重试。独立公开诊断的云开始时间比客户端早 8ms，暴露跨机器绝对时间比较问题；首次任务未留存原响应，因此不将诊断推定为首次失败的完整证明。
- 修复将有效期检查绑定到宿主记录的请求起止时间；云时间只检查可解析及先后关系。原回执先保存在 `f23:received`，通过检查后才写 `f23:outputs`。针对云时钟落后宿主的原 Runtime/Policy/SQLite/F23 图回归一例通过。
- 新公开样本实验 task `097e5252-d61e-4110-81c1-729e88f55335` 成功，两条输入各产生 main/shadow 输出，共四次真实 `deepseek-v4.1-flash` 调用。样本为 `19 + 23` 与 `Visit Xian on Tuesday` 的 JSON 输出；仅证明这些公开样本及固定版本。
- 本地原始记录保存在被忽略的 `.cache/f23-real-clockfix/`（`prepared.json`、`main.jsonl`、`shadow.jsonl`、原 SQLite）；首次未知任务保留在独立 `.cache/f23-real/`，未覆盖。凭据不属于公开 Evidence。

尚未完成：AgentArts 平台评估分数与原输出逐项绑定、真实 F23 五节点 CAS 晋升及消费者读回。真实配对输出成功不等于 F23 或 PR #531 全部验收通过。
