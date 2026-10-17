# 历史镜像实现计划与交接（已被当前 Competition 边界取代）

日期：2026-10-14 · profile：huawei_ict_agentarts · 历史计划，非当前实施授权 · [当前主架构](DESIGN.md) · [28工作流模板](WORKFLOWS.md) · [分工](../../MODULE_ASSIGNMENTS.md) · [接口状态](../../interfaces/CURRENT_INTERFACE_CATALOG.md)。

本节保留2026-10-14的历史实施计划。后续架构修订明确 Competition 的 Agent/Workflow 构建、编排、评估与部署由 AgentArts 承担；本地 Runtime 经 CloudAgentPort 消费已部署工作流，并保留 TaskRuntime、Policy、ToolGateway 与可信 Evidence。Local Profile 仅保留既有能力，不用于比赛或故障回退。下述 IMAGE-CORE 与自有镜像编排安排均为历史记录，不代表当前目标、实现或授权。本 PR 负责文档；实际代码/构建/部署分开记录。

## 1. 迁移目标与兼容

28功能模板、依赖串行推进、模型分派、记忆/上下文取舍、恢复和按需影子都由自有ARM64镜像承载。Laya服务/权重留在本机，复用现有LayaInferencePort、typed_choice与batch-server.py；资格不足升级原受信teacher。国内执行模型经AgentArts调用，架构未最终定型。

Laya只对有上下文的有限合法候选做choice；当前没有任意规划/摘要/参数JSON或Score/Noul原生端点。开放式理解、计划、摘要和补丁先由执行模型/代码模板产生候选，宿主校验后交Laya选择。执行者可在受派边界内使用现有subagent-host探索工具，但不得扩责任、签权限或改主终态。

TaskRuntime/Policy/ToolGateway、ModelGateway、Knowledge/Wiki/Memory、Skill安装宿主保持单一事实与接线。云DTO先经CloudAgentPort适配，不改旧wire终态或用图数据库替代TaskRuntime。未交付公共字段记录provisional/unavailable，按Schema/生成器扩展并验证消费方。

## 2. 三个实施工作包

| 工作包 | 唯一负责人 | 拥有范围 | 复用与输出 | 验收 |
| --- | --- | --- | --- | --- |
| IMAGE-CORE-20261014 | zemeng5208 | apps/agentarts-runtime、packages/agentarts、核心cognition/goals、scripts/laya与相关手册 | 本机Laya宿主与原受信teacher、28模板串行映射、事件/候选图、局部恢复/按需影子、平台日志Trace与离线评测composition、Huawei镜像发布入口 | 本机Laya领域资格、镜像模板/依赖/取消/未知夹具、镜像digest、deployment/version、独立invocation与真实工具/Evidence读回 |
| PLATFORM-PORTS-20261014 | goo122 | models/Runtime底座、MCP、Skills、Knowledge/Memory、公共契约与根composition | Inference Target能力/思考参数、远程MCP直连、多来源知识source映射、Skill资产/脚本宿主、F27模型窗口/上下文端口 | 真实MCP发现调用、知识原文引用、配置/来源失效、已有消费者兼容；保留进行中#350模型思考/#351上下文，不重复建路由器 |
| BUSINESS-CONSUMERS-20261014 | Potatos498 | MOD20—26连接器/业务消费，MOD34/35/38开发流程 | 公布可信ToolDescriptor、业务输入/读回/幂等与未知核实、28模板具体业务节点消费、云测试用公开合成场景 | 逐连接器真实Provider/国内网络读回、写入未知不重试、业务事件去重、同资源/取消/部分成功、自己的模块独立调用记录 |

每人保留其他协作者修改，独立worktree/数据/端口；共享Schema/exports/composition改动随兼容包交付，避免同文件并行覆盖。三人各验收自己路径，独立审查/合并按协作规则轮换。完整具体handoff见[平台交接](../../modules/AGENTARTS-PLATFORM-HANDOFF-20261014.md)。

## 3. 第一阶段：本机Laya与原受信teacher闭环

1. 在本机受信宿主固定Laya版本与资产摘要，独立管理权重/配置/tokenizer；ARM64工作流镜像不包含Laya权重、Python或PyTorch。
2. 复用本机batch-server与LayaInferencePort，由原受信宿主管理单实例生命周期与鉴权；进程在线、模型加载、领域资格和可直接决定分别记录，资格不足升级原受信teacher。
3. 单个公开合成任务由代码/执行模型生成2—16合法候选，绑定目标/来源/操作revision，Laya选择后校验候选身份，复用原ToolGateway闭环，不把Laya选项当授权。
4. 测批次身份、非法类别/版本、busy、deadline、断开、迟到、启动失败及重启。现有CPU forward不可抢占，取消等待后门锁直到完成才释放；不要假造“立即停止推理”。
5. ARM64工作流镜像、独立本机Laya、实际AgentArts调用、Desktop消费和业务工具分别记录；模型加载或模板目录不能证明全部业务完成。

## 4. 第二阶段：全部模板与责任/语音/上下文

以WORKFLOWS的185详情节点为设计输入，映射现有8 Workflow/3 Controller与各模块公开能力，登记每个节点的输入/输出、前置、必需/可选、来源版本、资源、真实读回、失败/取消/未知恢复。不能只注册28个名称而宣称28功能可执行。

预先授权责任覆盖当前动作时自动执行；缺决定主动语音/文字询问。保存用户完整原意，处理否定/条件/对象/参数；当前操作的参数或revision修改使旧答复失效。沉默、回声、中途ASR、旧回答不是同意。停止播报/语音会话/任务取消分开，本地直接停止不等待云端。

读取互不依赖来源、独立判断与研究可并行，真实依赖必须等待，必需/可选分支分开汇合；失败只修局部，成功副作用保留。补偿绑定原操作/已发生效果和读回，未知先核实，不能无条件回滚。取消结果区分未开始/停止中/未知/已发生，沿用现有wire状态。

记忆知识并行来源检索→来源/版本过滤→Laya候选比较/排序→执行模型生成有引用摘要→F27组装上下文；来源/用户目标/参数/模型配置变化使缓存/摘要失效。F28主对话指定或建议实际可用厂商/模型/思考参数，与#350/#351衔接；不自造max枚举冒充支持，不编固定轮数/Token预算。

## 5. 第三阶段：平台真实能力与按需影子

Inference Target/MCP直连、AgentArts原生知识、Runtime/LTS/OTel、平台离线结果评测按各自Provider接线，不把本地现有日志/评分重做成平台独占数据。

影子由失败、配置变化、异常、调试或配置采样触发，不对每次前台任务双跑。决策影子/历史回放/隔离执行都用固定当时快照；独立输出，不写主任务/记忆/授权。缺反事实工具结果为未知，无隔离宿主为不支持。比较和评测后台进行，只按既有实际发布条件阻塞相关节点。

平台日志先确认JSON stdout进入Runtime/LTS，再异步Span出口；关联ID不是授权凭据。真实模型/知识/工具/恢复各有Span，Evidence仍来自可信执行读回。评测先复用既有平台集20d34c73-7843-4320-bd4e-d88fc9161439并核对版本；历史actualoutput为空，发布不等于评分，不覆盖参考为实际输出。

## 6. 发布与协作者测试

先完成代码/必要检查，再构建ARM64镜像、记录digest，通过实际SWR/导入部署Huawei Runtime；读回deployment/version，调用/ping与POST /invocations，验证云提案→本地实际工具/Evidence→镜像续答→TaskRuntime终态。错误保留真实结果，不绕回Local/Fake。

交付调用配置样例（无密钥）、部署版本、真实公开场景、日志/评测入口及独立运行说明。协作者使用受信本地凭据调用，不在聊天/Git交接密钥。没有真实健康/调用/工具闭环就保留待验收，不能称“已发布可用”。

## 7. 状态与检查

文档为review；IMAGE-CORE已获授权in_progress；平台/业务工作包先按拥有者接收与实际开工登记，不代写他们已完成或已接受。当前代码证据见接口目录，历史验收保留原日期与范围。

必要检查按具体改动：文档生成一致/链接/编号/git diff --check；模块跑受影响测试；公共端口/Runtime组合按根check；真实模型/平台/设备另在tests/manual记录。未经测试不报P50/P95，配置/构建/部署/真实工具/独立运行六种证据分别记录。
