# F04 Wiki 与作用域记忆接线（2026-11-01）

Competition Profile，基线 `df3f6c48`；工作树 `.worktrees/pr531-f04`。已实现下列公开来源纵向路径及 N04 原投影只读恢复；F04 整体和真实 AgentArts 验收尚未完成。设计节点、现有模块和真实配置分别判断。

## 最小纵向范围

复用原七个节点、configured worker、Runtime/ToolGateway/Policy、受信模型选择、Knowledge source lease、原读写工具与 journal、既有 CompetitionFactHost/Memory Feed/FactProjectionStore。Main 与公开出口由集成树串行装配；不新增知识库、记忆库、任务库或授权机制。

首个路径固定同一已配置 public Knowledge 来源和 Memory namespace，只处理已有公开源映射及其已有 Fact 版本。输入是候选文本/类型及显式公开查询，不能让模型指定宿主目录、跨 namespace、当前版本、授权记录或事实确认状态。候选类型可以描述事实/偏好/责任/推断，但语义判断不是动作授权；写后记为原来源的 external_observation，不能冒充 user_confirmed。

| 节点 | 原消费与证据 |
| --- | --- |
| N01 | 冻结原任务候选、来源配置、公开查询和既有 Fact 标识。 |
| N05 | 原独立 knowledge.search 子任务及原 policy 的 200 字投影，固定 public Memory 当前头/版本链；引用是原来源，Fact 是摘要。 |
| N02 | 原 decision.choose_candidate 回执；只有相容、冲突、失效等有限候选，选择不产生写许可。 |
| N06 | 重新核对当前来源、原 Fact/版本关联、明确可写路径与原工具描述；缺失拒绝。 |
| N03 | 受信 host 绑定原候选到唯一原 knowledge.apply_note_patch 子任务，仍独立工具卡审批。路径和 expected SHA 来自宿主，结果仅按原写工具出口投影；raw receipt/backup/journal 留本机。 |
| N07 | 冲突候选保留在原 TaskRuntime checkpoint，绑定来源、scope、原选择和未解决项；不进入当前 Fact、不改写已有真实事实。 |
| N04 | 已确认源写入后只读核实原 afterSha，再沿既有 CAS/Feed/impact 更新当前来源观察、失效旧投影和索引；冲突分支只隔离候选并使本次候选上下文失效，不凭模型撤销当前事实。 |

初始可写范围收窄到原检索实际读回的单行、明确可写既有笔记和既有源映射；更广正文、私人 Wiki、跨作用域迁移、彻底遗忘仅在现有具体原授权/来源入口能够证明时开放，否则给出对应 unavailable，不用公开流程替代私人许可。不会为了凑齐节点把这些缺项标为完成。

## 一致性与恢复

原文写入会有意改变来源 revision，因此写前原版本、写后原已确认 afterSha 和 Fact 投影阶段必须分别核对。不能在写后继续要求旧文件 hash，也不能接受任意新文件版本。未知写入不重做：保留原 ToolGateway/Knowledge journal，沿 F24 原结果核实路径读回。已发生源写入后的投影错误保留原效果和未完成投影，不能把恢复变成第二次源写入。

隔离候选使用原 TaskRuntime 的持久 checkpoint，不被 Memory 查询当成生效事实。Fact 来源变化使用原 append/withdraw、Feed、投影与影响记录；不制造独立缓存失效总线。F04 条件分支需要受信 N03/N07 guard，N03 通过 host 包装原工具出口；只更改 F04 映射/模板摘要，不增加节点或改 Engine 调度。旧模板/部署摘要继续拒绝，历史证据保留。

## 当前实现与验证

Runtime `createF04WorkflowWorkerPorts` 返回原 7 节点的 configured worker、5 个受信 host、2 个 guard 及 `recovery`；Desktop `createDesktopF04WorkflowWorkerPorts` 消费与 F05 相同的已配置 Knowledge source 和 `{memoryNamespace,facts}`。工厂缺少原来源/同步版本检查/原工具投影/公开 Fact CAS 与消费端口时不注册。`recovery.readAvailable/reconcileOriginalReadback({taskId,deadline,signal})` 只接受该原图当前 N04，原会话/期限/父边/执行授权/参数/索引失效记录/源写回执/投影意图必须逐项一致。只有原 Fact 修订与原 durable impact 均读回才核实 N04；不执行来源写入、CAS、Feed、impact 或索引变更，不自行恢复图。Main 与 Runtime 公开消费桥由集成树接入，尚未作为本包验收。

本树依赖独立离线安装；初始根 build、修改后 AgentArts/Runtime build、AgentArts 原 Engine 22/22、F04 Runtime+Desktop 10/10 通过。F04 测试实际执行 Windows 受控文件写入/原恢复日志、SQLite Memory、原 Knowledge policy、Runtime/ToolGateway、原 Engine 和 Desktop 来源适配；模型分类、云传输、原生选择/确认与加密存储替身明确 Synthetic。正常更新保留原 Fact 引用并追加 external_observation；冲突/无效候选写入与 CAS/Feed 均为零；原长摘录裁剪后不能写完整行；异步原 policy 撤销不导出。N04 durable impact 已完成但回执丢失可跨 SQLite 重开只读核实；未完成 impact 保持 unknown；重复/并发读回零执行，意图污染、文件替换、取消/过期拒绝。此处不将同进程数据库重开冒充独立 OS 进程重启或真实云验收。

仍可推进项：N03 原 knowledge child 的 unknown 已由原 Runtime 阻止重放，但原知识 reconciliation 结果与原 writer receipt Schema 不同，尚未提供 F04 专用原 edge + 已核实 readback 消费；不得伪造旧 receipt。该部分另包补齐。私人 Wiki/私人 Memory、跨作用域迁移与彻底遗忘仍须原具体授权入口，未由 public 包覆盖；不提升 F04 或 #531 总体验收状态。

## 后续验证

实际 Engine/Runtime/Policy/ToolGateway、受控文件写入和原 journal、独立 Memory SQLite：相容更新前后版本/旧来源保留；冲突隔离零事实写入；未授权/跨作用域/版本变化/候选改参拒绝；原工具投影及异步撤销；未知写入跨重启零重放；已知写入后投影中断保留原效果；Fact Feed 与原依赖失效读回。模型/网络/原生确认的 Synthetic 部分独立标注。

真实 AgentArts 固定部署/模板/trace/评估、实体应用授权与 UI、来源账号和独立非作者审核另验；本计划和本地编译/Fixture 不能解除 #531 全接线及真实验收后合并的门槛。
