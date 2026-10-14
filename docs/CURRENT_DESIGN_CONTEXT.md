# 当前设计与实施状态

日期：2026-10-14 · profile：huawei_ict_agentarts · 代码基线：main 3275aa91。

## 当前唯一主架构入口

[完整主架构](design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](design/workflow-architecture-20261013/index.html) · [39模块](MODULE_ASSIGNMENTS.md) · [重构接线](design/workflow-architecture-20261013/IMPLEMENTATION.md)。

| 事项 | 已定设计 | 当前实现边界 |
| --- | --- | --- |
| 决策 | 唯一Laya语义决策服务和typed-choice权重位于自有ARM64镜像 | 现有Laya端口和Python batch-server可复用；镜像内生产接线、真实加载及28功能消费待验收 |
| 编排 | 事件驱动责任图、稳定模板、真实依赖并行 | Runtime/图/云角色代码可复用，完整28功能图宿主待接线 |
| 模型分派 | 主对话可选择厂商、模型和原生思考；执行者提交候选 | subagentModels与ReasoningEffort已有；Competition参数映射另验收 |
| 语音 | 主动询问、口头同意/拒绝/修改、问题与操作绑定 | Voice/Live代码已有；完整确认与设备场景未验收 |
| 记忆 | Wiki来源+Memory事实，唯一模型参与排序/取舍 | #320组合已合入；生产身份/真实私人出机及完整失效传播仍缺 |
| 影子 | 决策比较、轨迹回放、隔离执行，默认后台 | 轨迹/测试可复用；独立影子宿主待实现 |
| 执行 | 本地Runtime/Policy/ToolGateway/Evidence | 沿用现有端口，不新增授权或第二个任务库 |
| 传输 | WSS主、可见HTTPS备用，未知结果先核实 | 固定读取场景已有真实记录；云回执非持久恢复 |
| 资源/延迟 | Laya权重在云端镜像，本机不加载；MaaS执行模型、独立判断合批/并行/缓存减少阻塞 | 没有28功能端到端P50/P95；普通语义任务有秒级等待风险 |
| 协作 | 一位合资格非作者有效Approve及检查门槛 | #347已合并；文档重写为新工作包，不自动授权合并 |

设计不增加模型封锁、角色白名单、审批门槛或固定金额/Token/步骤预算；实现依既有授权、用户配置和平台限制。当前接口事实见[接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)，旧百分比不作为本次重构完成率。

## AgentArts最小真实接入

全部28业务Workflow的分支、分派、恢复与影子仍在自有镜像；平台高代码Runtime托管该镜像。平台通过四个真实能力参与，不另建业务编排或复制本地状态库：

| 能力 | 复用与增量 | 完成依据 |
| --- | --- | --- |
| 推理与MCP网关 | 现有ModelGateway/OpenAI-compatible Provider接国内Inference Target；现有MCP host加远程HTTPS/SSE与协商/发现，直连平台MCP网关，仍经既有ToolGateway/Policy | 目标/版本读回、真实模型请求、tools/list与tools/call及目标读回；平台网关不是本地Runtime入站WSS网关 |
| 原生知识库 | 现有KnowledgePort增加AgentArts Provider，与本地Wiki/Obsidian、自有及第三方知识源并存；平台片段映射现有来源引用，由Laya比较/排序，执行模型组织引用回答 | 实际检索片段、文档身份/版本/位置及回答引用；未完成source映射前不虚造vaultId/path/revision |
| 日志与Trace | 复用镜像JSON stdout、Runtime事件与Evidence、现有ShowOpsTrace读回；先验证Runtime/LTS采集，再加模型/知识/工具/恢复Span及异步OTel出口 | 平台可查看关联task/session/request/operation/version的调用链与失败；Trace不是成功证据，不另建日志库 |
| 后台离线评估 | 复用已有真实结果/参考/检索片段、配对评测和已发布平台评测集；填实际输出、提交平台任务并读回评分，再与配置版本比较 | 平台任务ID、输入与实际输出、评分报告与版本；评测集发布或本地分数不算平台评测完成 |

知识、MCP与Skills均保留平台、本地、自有、GitHub/Gitee及社区来源。仓库URL是代码/资产来源，MCP需部署为真实endpoint或本地进程；Skill需经现有安装/版本/宿主接线。当前本地SKILL.md转发不等于脚本与资源完整执行。无第二套工具注册或Skill宿主，不强制本地工具绕平台。

当前四项为待接线/待真实验收。平台原生在线评估适用范围随版本与账号而变，先交付明确的离线结果集评测，不假设自有Runtime所有在线配置都可用。详见[三方实施交接](modules/AGENTARTS-PLATFORM-HANDOFF-20261014.md)。
