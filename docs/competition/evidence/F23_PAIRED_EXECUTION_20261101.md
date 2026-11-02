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

## 平台导入实测（2026-11-02）

平台下载模板要求每行 `{ "turns": [原样本] }`；直接导入样本对象会返回 `'turns' array cannot be empty`。Desktop 原输出展示已按该格式封装，原 input/output/reference 字符串不改写，单次渲染检查与原文件逐项相等检查通过。

两组真实输出已分别导入并提交 `0.0.1`：main 数据集 `5a7648ec-3a73-4dc3-869d-a03343c3dde5`，item IDs `6ae815f85253c8cdaff8c412`、`6ae815f85253c8cdaff8c413`；shadow 数据集 `4c7b9486-7f27-4cc1-ac80-c6cacf788fcf`，item IDs `6ae81667a6ad840f734fab02`、`6ae81667a6ad840f734fab03`。原输出空白差异保留。

平台代码判定显示“即将上新”，因此建立模型判定评估器 `8f00d83e-2adc-4076-bc6b-cdca7c259f0f` / `0.0.1`，只按有效 JSON 对象和参考对象语义等价给出 0/1 分；两组使用相同版本。评估任务 main `d9a31add-6a08-4ffa-8410-ba39d4d6e23e`、shadow `7fe04f66-9549-4fe2-89ef-2371bb0ade96`。main 首次执行在平台失败（2 条失败，0 token），尚无可接受的真实评分；不可把报表占位零分当作评价结果。控制面 AK/SK 在现有 Desktop userData 与当前进程环境均未配置，程序化结果读回仍未验收。

两组平台任务最终均为 2 条失败、0 token。main 详情的明确错误为 `ERR_PROVIDER_AUTH`、HTTP 401、`ModelArts.81003 / Invalid authorization header`；评分器模型选择只有 `deepseek-v4-flash`。未重新执行、未人工改分；平台鉴权修复前不能产出有效评分。平台结果行 ID 与评测集草稿行 ID 不同（main 结果行是 `6ae815f85253c8cdaff8c410`、`6ae815f85253c8cdaff8c411`）；绑定时须从完成任务原结果读取，不得复制草稿 ID。当前界面只展示评分器使用的 output/reference，完整 API `item_data` 仍待凭据可用后核对。

结果绑定复用已有 canonical digest，忽略 JSON 对象键的序列化顺序，保留所有实际值与数组顺序；单条读回测试覆盖字段重排通过、输出替换拒绝，通过 1/1。没有再次运行云模型或平台评估任务。

纠正最初的凭据定位：`personal-agent-platform-deepseek` / `personal-agent-platform-deepseek-key` 是运行时模型代理的出站配置，不能据评分器 401 推定该凭据失效。当前 runtime 使用此代理的 `deepseek-v4.1-flash` 已有真实调用成功记录；评分器仅支持预置 `deepseek-v4-flash`，按[官方评估器文档](https://support.huaweicloud.com/ops-agentarts/agentarts_14_0035.html)使用独立的[预置模型鉴权配置](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0185.html)。已打开“授权管理 → 模型 → 鉴权管理”，界面存在已保存的遮蔽 API Key；尚未更改。下一步应修复该入口的 MaaS 鉴权，保留运行时代理凭据，不在 Evidence 保存密钥。
