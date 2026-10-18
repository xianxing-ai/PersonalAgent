# AgentArts镜像与平台能力实施交接

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。

日期：2026-10-14 · profile：huawei_ict_agentarts · [完整设计](../design/workflow-architecture-20261013/DESIGN.md) · [实施顺序](../design/workflow-architecture-20261013/IMPLEMENTATION.md) · [接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。

## 1. 决定与交接边界

28功能模板及串行推进逻辑由自有ARM64镜像承载，由AgentArts高代码Runtime托管；当前实验为本机Laya multilingual有限choice，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher，架构未最终定型。现有LayaInferencePort和Python batch-server可复用，但当前只支持有限choice，不能生成任意规划/摘要/参数或冒充Jev Score/Noul。国内MaaS执行者生成候选，局部工具探索沿用既有subagent-host，Laya选择合法候选，Runtime/Policy决定真实权限和终态。

不新增用户确认、角色/来源封锁、固定资源预算或第二套任务库/工具宿主。预授权责任内自动处理；需要决定时主动语音/文字共用当前操作，修改参数/revision作废旧同意。依赖图串行推进（机会并行另验）、局部恢复、未知先读回、按需后台影子保持原设计。

这是当前正式工作包依据；GitHub委派/接收及进度由实际记录补充，不把本文件存在写成拥有者已接收、云服务已发布或完成比赛验收。

## 2. IMAGE-CORE：zemeng5208

状态：review（[开发预览 PR #356](https://github.com/zemeng5208/PersonalAgent/pull/356) 已提交；镜像及最小真实工具路径已发布，完整业务及比赛验收仍待补）。
拥有：apps/agentarts-runtime、packages/agentarts、cognition核心/goals、scripts/laya、tests/manual/agentarts及相关模块文档。MOD-19暂停。

第一交付：本机Laya单实例宿主、原受信teacher、健康/启动错误、候选Schema/revision和领域资格校验，保留原runtime端口。接着映射全部28模板的串行推进/条件汇合、责任/语音及按需影子；每个业务节点复用实际公开能力，不以模板登记代替真实执行。

平台侧负责Runtime/LTS采集验证、OTel出口composition/关联ID、离线评测任务与报告读回、SWR/镜像部署和协作者调用说明。依赖goo122公开Model/Knowledge/MCP/Skill端口、Potatos业务ToolDescriptor与读回；可用明确Fake/Unavailable验证消费，不等外部真实账号才开始代码。

验收：本机模型真实加载、领域资格、teacher升级、choice输出/非法候选/取消/busy/迟到隔离；镜像digest与deployment/version读回；公开任务一次真实调用及本地工具/Evidence/终态；28节点映射/独立依赖/部分失败/未知核实；平台日志/评分实际报告。代码、构建、部署、真实工具及独立测试分别提交。

## 3. PLATFORM-PORTS：goo122

状态：ready（已通过[Issue #353](https://github.com/zemeng5208/PersonalAgent/issues/353)正式委派，待本人接收）；#350模型思考和#351上下文进行中，沿用既有PR，不重复新建模型入口。

拥有：packages/models、mcp、skills、knowledge、memory、policy、tool-gateway及Runtime底座/公共契约/根composition中所需兼容增量；MOD33/36/37保持原分工。

接入顺序：
1. 在既有OpenAICompatibleModelProvider/ModelGateway接国内Inference Target，公布实际模型/原生思考能力、配置版本/窗口给F28/F27；Laya另用既有InferencePort，不伪装MaaS Provider。
2. 扩现有MCP host到平台与自有远程HTTPS/SSE，协商、tools/list、tools/call、取消、鉴权与目录版本映射。平台客户端直连平台MCP Gateway，工具调用仍进ToolGateway/Policy；本地stdio继续复用。GitHub/Gitee仓库先部署成endpoint/进程，URL不等工具服务。
3. KnowledgePort加AgentArts原生Provider，与本地Wiki/Obsidian、自有/第三方知识源并行检索，映射现有来源vaultId/path/line/revision或经兼容契约扩展；无真实身份不得伪造来源。云知识是检索派生资源，Wiki/Memory仍保留事实版本。
4. Skills复用版本安装/资源/脚本/worker/工具宿主，支持平台资产及自有/GitHub/Gitee/社区来源。安装SKILL.md或预览资源不等完整执行，凭据/工具授权仍由宿主注入；不另建安装注册系统。
5. 对#350/#351消费接口分别接模型能力/窗口、来源失效、摘要恢复，避免私设DTO/解析resultSummary尾缀。

验收：真实Inference能力/参数读回；平台MCP至少一个工具发现与调用、断连/非法目录/参数/未知写工具行为；原生知识真实原文身份/引用和无匹配；Skill实际工具/资源过程；旧本地stdio/Wiki消费与权限不回归。公共Schema用单一生成器并验证消费者，不因Fake成功冻结真实能力。

## 4. BUSINESS-CONSUMERS：Potatos498

状态：ready（已通过[Issue #354](https://github.com/zemeng5208/PersonalAgent/issues/354)正式委派，待本人接收）。
拥有：MOD20—26业务连接器与消费；MOD34/35/38 CI修复、测试定位、Issue流程；保留goo122 MOD33/36/37及zemeng核心cognition。

交付：为日历/邮件/订阅/通知/研究/天气和现有开发流程公布真实ToolDescriptor、Provider配置、输入输出/事件版本、执行结果读回、幂等/取消/结果未知核实；给镜像模板提供可消费端口，不将云端模型直接接入账号写入。既有可配置Provider继续保留，实际国内端点可达分别验证。

写入未知先读原执行与目标状态，原operation identity不变；只有确认未发生才重试，已发生保留，补偿绑定原effect/readback，不能盲回滚。等待用户只阻塞相关节点，无依赖业务继续。通知/日程责任范围已授权时自动处理，不新增固定首确认。

验收：公开合成场景先验证真实Provider/国内网络/引用；实际写账号依现有授权；场景涵盖同资源写入排队、事件去重、分支部分成功、修改失效、取消四种实际结果、断网未知不重放。独立调用镜像版本并保存自己的模块证据，不代验全部平台或另外两人的模块。

## 5. 平台差异与已有资产

| 面 | 已有资产 | 新增/仍未验证 |
| --- | --- | --- |
| 模型 | ModelGateway与OpenAI-compatible Provider、云角色JSON stdout | Inference Target实际端点/账号参数、完整F28消费 |
| MCP | 固定只读stdio host和ToolGateway | HTTPS/SSE/平台网关协商发现调用，自有远端写工具恢复 |
| 知识 | KnowledgePort.search、Wiki/Obsidian、memory版本与撤回 | AgentArts原生API/source映射及多源云消费 |
| 日志 | Runtime事件、Evidence、JSON stdout、ShowOpsTrace读回脚本 | Runtime/LTS采集与OTel Span出口、平台关联链 |
| 评估 | 本地case/scorer/paired-run/readback，已发布集20d34c73-7843-4320-bd4e-d88fc9161439 v0.0.1 | 历史actualoutput为空；平台实际任务/评分未做；需先读回资源/version再更新 |

原平台评测集为2026-09-30记录，当前状态可能变化；更新前读回而非盲建重复集。本地严格评分继续复用，平台报告是独立证据。线上Runtime评测支持随版本/账号变化，先稳定真实离线结果集评估。

## 6. 外部依据与发布记录

官方高代码/自定义镜像、Inference Target、MCP gateway、原生知识API、Runtime/LTS/OTel及离线评测文档均需按实际账号区域做读回；比赛公开方向见[Competition Profile](../competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)。没有组委会个案认证，不以文档或演示证明参赛完成。

发布登记需要source SHA、Laya资产版本/摘要、ARM64镜像digest、SWR位置、deployment/version、模型配置引用、健康/真实调用、平台trace/评测任务、真实工具Evidence和独立测试。共享示例不含密钥/私人正文。PR只记录已完成项，任一合資格非作者当前head有效Approve及实际检查/冲突/意见门槛不变。

### 本次开发预览发布读回（2026-10-14）

- 镜像源码：`fe886677d72a6f7a3312e054c68ef4d74a804fc4`；实际 Laya multilingual CPU 镜像已在离线 ARM64/QEMU 环境加载、预热并完成有限 choice。
- SWR：`swr.cn-southwest-2.myhuaweicloud.com/zemeng5208-personal-agent/personal-agent-owned:laya-fe886677`，客户端上传后独立读回 ARM64 manifest `sha256:8120ad11915c5de9c6daa61b492d3228872978ccfbc0f9a79acf59432f42366c`。
- AgentArts Runtime：`pa-owned-bindings-0dae0ff5-api`；实际新版本 `arm64-laya-fe886677`，访问方式 `Latest` 已指向该版本，原生运行日志已开启。保留原委托、鉴权、规格及旧版本。
- 实测目录 28 项；固定公开文件经原 Policy、生产 ToolGateway 读取一次，保留原执行记录、1 条 conditional Evidence、独立文件 SHA、签名回执及 SQLite 重开读回；没有工具重放。
- 整体为 partial：F20_N02 选择 `owned-review`，未继续下游模型执行。平台日志关联提案裁决 881 ms 和续图裁决 1477 ms；这是两个真实样本，不构成稳定 SLA 或完整业务验收。
- 完整发布/API/凭据注入/调用/回执/恢复与公共 Evidence 位于 #356 的 `docs/competition/OWNED_LAYA_RELEASE_AND_CALLS.md` 及 `docs/competition/evidence/OWNED_LAYA_20261014.json`。原验收缓存、数据库、机器路径和密钥不随 PR 公开。

本记录不宣称 #356 已合并、非作者已批准或 goo122/Potatos498 已接收任务。平台 MCP、原生知识、完整 Trace、效果评估、实际语音及各业务宿主仍按 #353/#354 独立交付；已发布目录不能替代这些能力的实际验收。
