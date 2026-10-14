# Huawei ICT AgentArts Competition Profile

日期：2026-10-14 · 当前唯一实施profile：huawei_ict_agentarts · 公开规则核对：2026—2027第11届华为ICT大赛中国区创新赛题2。

## 1. 比赛与最终技术路线

[官方赛题](https://e.huawei.com/cn/talent/#/ict/innovation-details?zoneCode=027425&zoneId=98269700&compId=85132021&divisionName=%E4%B8%AD%E5%9B%BD%E5%8C%BA&type=C002)要求用AgentArts完成构建、编排与部署，展示工具/知识/多Agent/评估的实际价值和可交互成果。公开规则没有要求全部业务必须在Studio拖拽图中实现；[高代码开发](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_001.html)及[自定义镜像](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_029.html)是官方支持路线。

全部28业务Workflow在自有ARM64镜像执行，AgentArts Runtime托管镜像与版本。唯一Laya typed-choice服务和权重也在镜像内；通用执行模型经现有ModelGateway使用国内MaaS。平台推理/MCP网关、知识检索、日志Trace和后台离线评估必须有真实调用依据，不能只用容器部署证明所有平台价值。

本设计符合公开技术方向；这不是组委会个案认证，也不是当前代码已完成比赛验收。实际账号/区域能力与委员会最终解释分别核对。

## 2. 云和本地闭环

文字/语音/业务事件 → 本地TaskRuntime受理和版本上下文 → CloudAgentPort → AgentArts Runtime自有镜像 → 执行模型产生计划/参数/摘要候选 → Laya在有限合法候选中选择 → 依赖图并行执行 → 工具提案 → 本地Policy/ToolGateway或已装配远程MCP host → 目标读回/Evidence → 镜像续答/复核 → TaskRuntime确认主任务终态。

预先授权责任内自动推进；缺失决定由主动语音或文字询问。用户口头同意/拒绝/修改绑定当前问题、操作和revision。平台输出、Laya选择和模型自报都不能签发本地授权。未知写入先核实；云失败不静默回退Local。

本地保存任务事实、授权、私有来源、实际工具执行及终态；镜像不保存第二套主任务库。云只能读取当前任务已允许出机的上下文，凭据不进提示或公开日志。

## 3. 平台价值及最小真实证据

| 接入项 | 真实流程 | 交付证据 |
| --- | --- | --- |
| 推理/MCP网关 | ModelGateway → 国内Inference Target；MCP host直接连接平台MCP Gateway → tools/list/call → ToolGateway回执 | 目标配置/版本、请求ID、工具目录/结果、执行读回 |
| 原生知识库 | 公开项目资料 → AgentArts知识库 → KnowledgePort Provider实际检索 → 来源映射 → Laya候选比较 → 执行模型引用 | 文档身份/版本、原文片段、引用及无匹配记录 |
| 运行观测 | 现有JSON stdout/事件/Evidence → Runtime/LTS采集；模型/检索/工具/恢复Span → 异步OTel → 平台读回 | 关联task/session/request/op/deployment版本的调用链、耗时与失败 |
| 效果评估 | 真实输出+参考+检索上下文+版本 → 既有评测集更新 → 平台离线任务 → 分数/报告读回 → 候选比较 | 实际输入/输出、任务ID、报告/版本及缺证据边界 |

四项接线的当前状态见[平台交接](../modules/AGENTARTS-PLATFORM-HANDOFF-20261014.md)。已发布评测集不代表已有实际输出或评分；ShowOpsTrace读回脚本不等于已完成Span出口。先稳定离线结果集评估，不假设所有owned Runtime在线评估配置可用。

本地Wiki/Obsidian、自有/其他云知识库、平台与自制MCP、GitHub/Gitee/社区Skills均可复用。一套KnowledgePort/ToolGateway/Skill宿主处理多来源，不新加厂商/source白名单或每次手工确认。

## 4. 交付与评分

中国区初赛创新60/应用价值40；中国区总决赛创新40/应用价值35/完整性与Demo15/答辩10；全球总决赛创新40/应用价值30/完整性15/部署影响10/答辩5。数据来自上述公开规则，本项目不能将演示动画或合成成功率当成成绩。

中国总决赛需可在线访问、可交互的真实Demo与完整设计材料，入围后按官方要求提供作品分享帖。材料说明架构、模型分派、知识资源、Skills/MCP、平台实际作用、失败恢复、评测和复现入口。架构离线查看器是设计材料，不代替真实比赛Demo。

## 5. 当前证据与待验收

文档核对基线main 3275aa91；固定公开合成文件的历史Huawei WSS→真实MaaS→本地Policy/只读工具/Evidence→续答见[2026-10-12记录](../modules/AGENTARTS-HUAWEI-LIVE-COMPATIBILITY-20261012.md)。已有8 Workflow/3 Controller代码/绑定，不能据此宣布28功能均已真实运行。

待验收：Laya ARM64权重加载、镜像内调用、28功能编排消费、国内Inference/MCP直连、原生知识来源映射、Runtime/LTS/OTel完整观测、平台评分读回、私人Wiki许可、口头确认、实际写入/命令、独立影子及P50/P95。保留接口目录原frozen/provisional/unavailable，发布状态与测试状态分开。

## 6. 发布与测试入口

沿用ARM64、8080、POST /invocations、/ping及可选/ws契约，WSS主、HTTPS备用可见。Laya只监听镜像内部loopback，不暴露未鉴权推理端口。构建阶段取得固定模型资产并验证摘要；运行不依赖联网自动下载。正式发布使用平台实际可拉取的SWR/导入路径，记录镜像digest、部署版本和独立调用读回。

协作者交付deployment/version、客户端配置说明、公开合成数据、实际调用和日志/评估入口；不交付密钥到仓库或公开材料。缺配置明确Unavailable，不静默Fake。仅在完成读回后写“可调用”；代码、镜像构建、部署及独立测试分别登记。

Golden Path先跑公开资料检索+有限候选决策+模型分派+真实工具读回，再跑会议15:00→17:00及准备14:00→16:00场景，证明影响范围、责任内自动推进、语音修改、旧确认失效、未知核实、重启不重放和按需影子。实施顺序见[IMPLEMENTATION](../design/workflow-architecture-20261013/IMPLEMENTATION.md)。
