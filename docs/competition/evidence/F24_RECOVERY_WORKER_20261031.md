# F24 原知识写入恢复消费链（2026-10-31）

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/pr531-f03-f24`。

## 交付范围与当前状态

新增 `createF24RecoveryWorkflowPorts` 与 Desktop `createDesktopF24WorkflowWorkerPorts`，交付 `tools`、`configuredWorkflowWorkerPorts` 和 `reconcileOriginalReadback`。生产来源适配使用 Main 已有的知识源配置及 `RuntimeApplication.reconcileKnowledgeWriteTask`，继续走原 Knowledge writer journal/readback/finalize；不新增连接器、任务库、调度器、授权层或写入重试。

该包是 F24 **原知识写入恢复**的可消费纵向链，不等于 F24 所有业务工具的通用调度器。只接受同一当前原用户会话内、已开始且等待核实或已有核实结果的 `knowledge.apply_note_patch@1.0.0`。普通未提交写入、其他业务效果、跨会话历史任务、本机设置页直接创建且未绑定原用户会话的任务仍不可选。没有真实来源或读回能力时不可用，不能换成 Fake。

## 原任务与权限边界

- 对外固定能力 `workflow.recovery.knowledge@1.0.0`，请求仅 `{sourceTaskId}`。宿主通过 `readDelegatedUserTaskParent`、`readToolConversation`、原 HostBridge intent 和 ToolGateway execution 核对会话、原 task/run、工具版本、参数摘要、知识 sourceId/configRevision、原写入期限。绑定首次保存后不能更换目标。
- 当前恢复任务沿原 delegated user deadline/cancel/configuration；原写入自己的期限仅作为历史身份，不能因此再执行写入。当前父任务取消、期限变更、参数替换或知识源版本变更均拒绝。源任务本身已有取消请求仍可核实已发生的效果。
- 工具继续经原 Policy/ToolGateway。执行入口检查原 intent、当前 configured binding、已允许且正在执行的原 run 与实际参数；不能仅拿一个 taskId 直接调用工具函数。
- initial/receipt/completion 均消费 Main 统一的 exact export 卡授权。授权前后重验原配置、身份及实际结果 revision；不向模型发送笔记路径、正文、凭据或原写入参数。
- N01 确认原图持久绑定；N03/N04 复用原授权和已开始的执行记录；N05/N11 读取实际检查点。恢复路径不创建新执行。N06/N08 仅观察已有本地取消，不能由云端制造停止事件；N07 对已开始的写入保持 skipped，不能声称“从未提交”。N09 调用已有只读核实与元数据 finalize；N10 保留核实后的已发生效果；N12 只发布有原 verified Evidence 的结果。
- `unknown` 不完成。原 N09 工具同样停在 `waiting_reconciliation`。`reconcileOriginalReadback` 只核实该原 N09、原目标及其真实读回证据，再按现有 Runtime reconciliation 完成该读取回执；并发/重复请求不启动图、不写笔记、不重新执行工具。后续继续图使用已有 Runtime resume 入口，仍须原 deadline 与授权。
- 原生 UI 桥：Main 注入工厂 `recovery` 至 `RuntimeApplicationOptions.f24Recovery`；`readF24RecoveryStatus/Available` 只从当前可见原用户任务的 forced-delegation、原 `subagent.dispatch` 确认回执及精确幂等子任务定位 N09，不扫描历史。`reconcileF24WorkflowTask(taskId,expectedRevision,scope)` 以原 graph deadline 读回；新原生 scope 只能缩短等待，不能延长期限。unknown 保持原任务，confirmed 后调用原 `resumeOwnedWorkflowTask` 继续同一张图及其 exact export 卡，不伪装成纯本地终结。父取消、部署变化、原请求 revision 或委派变化均拒绝。

## F24 模板兼容性修复

审阅设计源已有 `F24_N11 → F24_N02`（可恢复）与 `F24_N11 → F24_N09`（不能确认）边，但原节点 dependencies 漏掉 N11。没有取消时，N06/N08 都 skipped，Engine 会在 guard 前把 N09 跳过，导致正常恢复从未进行读回。

只在模板编译时把这两个既有边规范化为可选执行依赖；保留普通路径、取消分支、原 Engine 与生成设计数据。N11 skipped 时 N01 仍可使 N02 就绪；N11 selected 时，N02/N09 必须先读取恢复检查点。F24 `templateDigest` 因此变化，旧云部署/签名 checkpoint 不能冒用新模板；应保留原部署处理原会话，并重新部署匹配版本供新会话使用，不能清库或重放未知写入。

## 验证与未验项

- 真实本地 Runtime、SQLite、Policy、HostBridge、OwnedWorkflowEngine 集成：applied / not_applied、unknown 保持、原 N09 延后读回、并发/重复请求零重写、SQLite Runtime 重开、跨会话拒绝、exact export 拒绝、知识源变更、父取消、原期限和参数替换。
- 实际 Engine 回归覆盖普通、无取消恢复、取消在途、unknown 恢复分支，证明恢复读回不再被 skipped 前驱误跳过，unknown 仍不完成。
- 新增受控文件实测：在独立临时知识库创建公开合成笔记，经实际 `createKnowledgeWriteTool/openControlledVaultWriter` 写入后，测试故意丢失调用回执；F24 消费真实 journal/readback/finalize，验证实际 SHA256、原备份字节及仅一次写入。它证明本机受控文件恢复消费，不代替真实用户笔记或云验收。
- 定向 18/18（含上述本机文件实测）；较宽 AgentArts、configured worker、F03/F24 历史宿主及 Knowledge reconciliation 回归 285/285；架构门禁 3/3；Runtime/AgentArts build、Desktop 工厂语法检查及 `git diff --check` 通过。
- 原生用户 parent 恢复桥与实际公开 package export 的 Desktop 工厂消费补测：84/84，包含 F24 历史宿主、真实受控文件读回、原委派/部署/revision/期限拒绝，以及既有 native/subagent termination 回归。没有把新的观察期限用作旧图续期。
- 其余模型、写入工具、知识读回及导出授权测试明确为 Synthetic；用户原会话、AgentArts 部署与统一授权卡的联合验收尚未完成。Main 公共出口与工厂装配由集成工作树串行接线；本包不宣称 #531 完成或可合并。

## Main 与对话调用方集成

Main 已将工厂 `recovery` 传给原 `createAgentArtsRuntimeApplication`，`task.reconcile.finish` 只在 Runtime 公布原 F24 资格时调用 `reconcileF24WorkflowTask`，并沿原窗口观察范围与当前任务 revision 执行。对话显示“核实原结果并继续”；未知结果保留待核实，确认后由原 Runtime 继续原图，所需云调用与出机卡仍沿原门禁。Desktop 不设置任务终态、不重发知识写入。集成树 Runtime build 及实际文件/原父任务/公开工厂/界面动作与状态边界 **36/36** 通过；不代替真实账号与云联合验收。

## F03 后续边界

现有 reviewedRepair 可对原 Goal/Plan 图做 CAS 版本修复；Goal NodeVersion 只有来源/依赖等计划字段，不包含实际外部 task/run/effect 与 change-cause 绑定。不能把相同对象的历史写入或模型候选当成 F03 N06 因果证明。F03 对真实外部效果的恢复/补偿仍需要原实际执行调用方持久化该绑定，以及对应真实 effect reader；现有 F03 N07 fail-closed 保留。
