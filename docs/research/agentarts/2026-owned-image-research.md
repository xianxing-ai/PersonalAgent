# MOD-10：自有镜像能力与剩余证据研究

日期：2026-10-13（UTC+08）；Profile：`huawei_ict_agentarts`；负责人：zemeng。
本页核对已有仓库证据和官方公开说明，没有登录账号、新建服务、真实模型调用或训练。
研究范围为 PA-026 与 MOD-29～32 的能力/证据边界；[参数训练研究](../model-training/README.md)单独说明 PA-022。

## 当前研究结论

自有 ARM64 镜像在 Huawei AgentArts 托管，云端调用 MaaS 并产生工具或修复提案，本地
Runtime / Policy / ToolGateway / Evidence 掌握授权、执行和终态。这条架构已有固定公开合成文件读取的真实证据。
它支持继续完成开发者无人监管时的增量修复演示，但不能据此宣称完整自主性、全部工具和全部 MOD 已验收。

本工作树基线 `main@5b581139` 已包含 PR #317 的镜像实现；
[10 月 12 日验收记录](../../modules/AGENTARTS-HUAWEI-LIVE-COMPATIBILITY-20261012.md)
写的“未合并预览”是验收当时状态。该次部署镜像按固定源码 `194799c6` 和当时 Runtime 版本记录，
不能因为代码进入 main 或新增提交就声称云端已经更新。9 月 Studio 资源证据按日期保留，不替代 owned 镜像验收。

## 现有证据能证明什么

同日后续[逐绑定与最小修复验收](../../modules/AGENTARTS-OWNED-BINDING-LIVE-20261013.md)区分旧镜像和新部署 `arm64-7b6b4101`：02:54–02:55 UTC 最新一轮为三项通过、四项失败、四项跳过；World/Router 记录 `RATE_LIMITED`，两个修复 Controller 的合法候选未通过固定场景断言，真实最小修复尚未完成。后续 `0cbb3f1d` 本地 ARM64 build 已成功，截至 02:57 UTC 尚无新云版本验收。下表保留历史成功范围，不能以目录完整、合法候选或既有读取成功概括整条修复链。

| 表面 | 已记录证据 | 当前边界与下一份证据 |
| --- | --- | --- |
| 模型推理 | MaaS `deepseek-v4-flash`；实际提案与工具结果续答 | 不是盘古实测，不是参数训练，也不证明原生 function calling |
| 镜像交付与托管 | ARM64 构建产物、SWR 导入、控制台 Latest → `arm64-194799c6` 独立读回 | 只证明当时配置；不能把可变 Latest 当永久固定版本或逐请求执行证明 |
| WSS 主通道 | `/invocations/ws` 完成该次链路，HTTPS 应用调用 0 | 不推广为所有网关/区域均可用；长期保活、断线/平台重启恢复、HTTPS 备用整链仍待实际验收 |
| 本地工具闭环 | 审批前读取 0，审批后生产 `workspace.read_text` 执行 1 次，Evidence 1，任务 succeeded | 仅公开合成文件；审批来自可信验收程序，不能称为 Desktop 人工点击 |
| 持久读回 | 重开同一 SQLite 后读到 succeeded/confirmed/Evidence；没有网络或工具重放 | 不是系统重启测试，也不是云端跨进程恰好一次执行 |
| 绑定发现 | 精确 8 Workflow / 3 Controller 目录返回 200 | 不等于 11 个入口逐项真实执行；新建 owned 绑定也不等于恢复原云端空 Controller |
| 角色观测 | 本地增量 `b2b35caa` 的角色 request/span、UTC 时间、耗时、状态与可用 token 回执 | 应用级模型调用观测；此增量未由本页证明发布或部署，不冒充平台 TraceID |
| 版本声明 | 宿主可填写固定 `PA_AGENT_DEPLOYMENT_VERSION`，缺省 unknown | `host_configuration` 只是配置来源，仍需独立平台资源/版本读回及请求关联 |
| 平台评估与费用 | 现有文档与离线材料 | 没有本轮平台评估任务、逐请求平台 trace / usage / 账单读回，保持未验证 |

依据为上述真实记录、[镜像入口说明](../../../apps/agentarts-runtime/README.md)、
[编排实现说明](../../../packages/agentarts/README.md)及[接口目录](../../interfaces/CURRENT_INTERFACE_CATALOG.md)。
原验收程序在成功回执保存后清理失败，之后仅持久读回修正关闭；失败历史不删除，也不写成一次无异常全程验收。

## 2026-10-13 官方资料复核

先使用 agent-reach/Jina 获取已知官方页面，再从华为文档正文核对相同主题。公开内容不证明当前账号权益。

| 官方来源 | 与本项目相关的明确含义 | 不可推导的结论 |
| --- | --- | --- |
| [Runtime 调用](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_066.html) | 入站认证与会话头由平台规定；HTTP `endpoint` 指访问方式，未提供时使用 Latest；请求/响应业务结构由镜像代码定义 | 文档中的 HTTP 参数不能自行当作所有 WSS 的合同；本项目 WSS 采用已验收的精确地址 |
| [调用链信息](https://support.huaweicloud.com/ops-agentarts/agentarts_14_0012.html) | 平台 TraceID、会话、Model Span token 和元数据有各自含义 | 应用生成的 spanId、stdout、配置标签不能替代平台 trace 或请求级部署版本 |
| [评估介绍](https://support.huaweicloud.com/ops-agentarts/agentarts_14_0023.html) | 平台评测集、评估器及任务有独立流程；结果用于同场景质量对照 | 本地测试数、一次工具成功或自报评分不能代替已执行的平台评估 |
| [MaaS 对话规范](https://support.huaweicloud.com/model-call-maas/model-call-021.html) | 模型相关 thinking 和输出限制属于推理配置 | OpenAI 兼容入口不等于所有参数/模型完全等价，更不授予训练或平台观测权限 |
| [计费项](https://support.huaweicloud.com/price-agentarts/agentarts_08_0003.html) | 套餐/CU、模型调用和 LTS/APM/AOM/DEW 等适用关联服务应分别核对 | 不能把局部免费额度、token 数或成功请求数当实际账单；不填未经账号实查的金额 |

Runtime 文档另说明，会话 ID 可供关联上下文，但是否保留记忆由 Agent 代码决定。
因此长连接或重复 Session ID 不能直接证明跨重启记忆；Wiki、隐私与本地持久执行仍须各自验收。

## 可完成的研究项和账号条件项

| 交付项 | 本页状态 | 验收材料 |
| --- | --- | --- |
| 现有真实读取实验与结论边界 | 已整理，可评审 | 指向原始仓库验收记录，明确身份、模型、时点、输入范围和终态 |
| 平台能力与应用协议的差异 | 已整理，可评审 | 上表官方来源和本仓入口；不扩充冻结范围 |
| 参数训练是否为当前必要前提 | 已形成研究判断 | 先完成工程链与基线评估；训练仅在独立条件满足时讨论 |
| 成本采集口径 | 已定义，金额未知 | 按资源、调用和实际计费周期读回；区分估算与账单 |
| 当前 Runtime 身份、版本、镜像与请求关联 | 条件项 | 同时记录控制台/管理 API 独立读回与调用时点；仅宿主标签不足 |
| 平台 trace / 评估及日志查询 | 条件项 | 需要对应权限和资源状态，取得实际任务 ID、TraceID、跨度、原始结果与时间范围 |
| Wiki、业务工具、自主修复及 Desktop | 各模块继续验收 | 每条链独立取得权限、提案、实际执行、Evidence/图版本和重启读回；不因文档完成而完成模块 |

下一次真实实验应选择已声明可用的最小场景，冻结镜像/模型/提示/输入/目录版本，
独立保存失败、跳过、未知结果和实际调用次数；不重放未知写入，不用成功样本替换失败。
平台 trace 与应用回执只有在精确标识及时间/资源关系读回后才联合展示，候选匹配须明确标注。
费用记录至少区分 MaaS、Runtime、身份托管及实际启用的观测/评估资源；本研究不新开付费服务。

## 对历史研究的使用

[赛事与历史能力研究](2026-competition-entry-rules.md)保留原核对日期。
本轮未重新核对报名、提交截止时刻或代金券，不沿用 9 月“当前开放 PR”等描述作为实时状态。
本轮研究文档可以交付评审；实际参数训练、平台 trace/评估、真实全工具链和完整参赛 Demo 仍按各自证据判断。
