# 当前设计与实施状态

日期：2026-10-13 · profile：huawei_ict_agentarts · 代码基线：main 3275aa91。

## 当前唯一主架构入口

[完整主架构](design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](design/workflow-architecture-20261013/index.html) · [39模块](MODULE_ASSIGNMENTS.md) · [重构接线](design/workflow-architecture-20261013/IMPLEMENTATION.md)。

| 事项 | 已定设计 | 当前实现边界 |
| --- | --- | --- |
| 决策 | 唯一语义决策配置，默认华为国内MaaS DeepSeek-V4.1-Flash | 新统一配置及Laya迁移未完成；存量适配保留 |
| 编排 | 事件驱动责任图、稳定模板、真实依赖并行 | Runtime/图/云角色代码可复用，完整28功能图宿主待接线 |
| 模型分派 | 主对话可选择厂商、模型和原生思考；执行者提交候选 | subagentModels与ReasoningEffort已有；Competition参数映射另验收 |
| 语音 | 主动询问、口头同意/拒绝/修改、问题与操作绑定 | Voice/Live代码已有；完整确认与设备场景未验收 |
| 记忆 | Wiki来源+Memory事实，唯一模型参与排序/取舍 | #320组合已合入；生产身份/真实私人出机及完整失效传播仍缺 |
| 影子 | 决策比较、轨迹回放、隔离执行，默认后台 | 轨迹/测试可复用；独立影子宿主待实现 |
| 执行 | 本地Runtime/Policy/ToolGateway/Evidence | 沿用现有端口，不新增授权或第二个任务库 |
| 传输 | WSS主、可见HTTPS备用，未知结果先核实 | 固定读取场景已有真实记录；云回执非持久恢复 |
| 资源/延迟 | 云API默认，不强制本地权重；合批/并行/缓存减少阻塞 | 没有28功能端到端P50/P95；普通语义任务有秒级等待风险 |
| 协作 | 一位合资格非作者有效Approve及检查门槛 | #347已合并；文档重写为新工作包，不自动授权合并 |

设计不增加模型封锁、角色白名单、审批门槛或固定金额/Token/步骤预算；实现依既有授权、用户配置和平台限制。当前接口事实见[接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)，旧百分比不作为本次重构完成率。
