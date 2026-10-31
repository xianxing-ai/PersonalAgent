# F03 计划与原效果接线方案（2026-10-31）

Competition Profile，基线 `d5e67c8a` 加 F24 原知识写入恢复。以下是本轮实现方案，不是已完成验收。

## 最小纵向次序

1. 原计划：复用当前 Goal cognition 的原 review/candidate、`selectProjectedRepairScope`、`submitLocalRepair`、`cognition.commit_repair`、原 SQLite CoordinationStore。先把当前 Desktop 内部的原计划回执核验提为 Runtime 只读公共端口，并让原实际调用方消费；它必须验证原 review、candidate、ToolGateway 执行、完整 CAS 后快照及当前节点版本。随后 F03 N03/N04 消费同一原回执，不增加第二套计划执行循环。
2. 原执行：复用 business bridge 已有 graph → host → business task/run/descriptor/inputDigest 持久链。增加受信原 Goal/Plan 调用方提供的原 `NodeRef`、原图 revision 与来源 Fact refs 的绑定；模型不能填写。没有映射的历史任务保持 unavailable，不追填。
3. 原因果：只以实际 `FactProjectionReceipt.links` 和 `CompletedFactImpact.report.causes` 连接原计划依赖与当前变更，随后以原执行映射连接具体效果。KnowledgeWriteProjection 当前只有 source/path/operation，不能把完成标志当 Fact revision 证明；需要真实 revalidate 结果给出精确旧/新版本读回。
4. 首个实际效果只选已有真实 journal/readback/finalize 的 `knowledge.apply_note_patch`。未知先复用 F24 原 run 读回，不写入、不复活期限。补偿是独立新操作及参数摘要；原正向许可不自动成为补偿许可。

## 授权及兼容边界

- 不放宽 `readWorkflowBusinessToolSource` 的 confirmed 语义。需要历史 unknown 身份时单独提供只读执行证明，返回明确状态，不生成 confirmed receipt。
- `Policy.authorize` 会消费一次性许可，N08 不能用它试探。现 `prepareHostToolTask` 尚未冻结参数/建立审批；`finalizeHostToolTask` 会 dispatch，不能充当纯检查。优先调查/复用原 deferred 路径；如果缺失，沿现 Runtime/ToolGateway 增加最小审批分离端口，不新建授权层。
- 计划 CAS 更新不等于外部回滚；缺原因果或 effect reader 时不提交补偿。没有实际调度/效果证据的 F03 整图不能注册为已完成能力。
- 新增内部绑定保持旧记录可读；原记录缺字段时只返回 unavailable，不能清库、迁移补造或重放历史操作。公共导出与 Main 最终组合由集成树串行完成。

## 验收目标

原计划全快照读回、历史输入替换/版本漂移拒绝；原图/会话/node/run/参数替换拒绝；同对象新动作与补偿不混淆；原 unknown 零重写；取消/期限/配置变更停止；已有事实和实际效果保留；原 SQLite 重开和重复请求不重复执行。真实文件、云模型、AgentArts、业务账号和独立审核分别记录。

## 已交付增量 A：原计划只读回执

`RuntimeApplication.readF03PlanRepairReceipt({taskId,sourceTaskId,reviewTaskId,graphNamespace})` 复用原 local repair intent、原 Goal review/candidate、原 `local-repair-<taskId>` ToolGateway run 与完整 CAS 后快照。缺少或被替换的原证明返回 unavailable；只读接口不执行、续跑、签发或消费许可。返回不可变原节点版本与 `graphUpdateVerified`：目标被后续版本替换时保留已发生的历史效果，但当前核实标志为 false；无关节点更新不影响原目标核实。Desktop Goal 实际调用方已改为消费该端口，移除其重复的私有回执核验。

本地验证：Runtime build 通过；`reviewed-local-repair`、Desktop `goal-cognition-host` 和 `goal-cognition-empty-projection` 共 69/69 通过。使用实际 Runtime/SQLite/Policy/ToolGateway/CAS 与显式 Synthetic 模型，覆盖审批前无回执、原数据库重开、来源/候选/intent/结果/命名空间替换、无关及目标后续版本、重复读取零执行，并回归原桌面 Goal 消费链。此增量不证明 F03 原因果、外部补偿、整图或 AgentArts 真实验收完成。
