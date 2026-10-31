# 镜像 28 图 Host / Guard 逐项清单（2026-10-28）

目标 profile：`huawei_ict_agentarts`。此清单按 `getOwnedWorkflowAdapterRequirements()` 的当前源码规则，从受审模板投影；每个 host 节点一项，每个带条件节点一项 guard。单节点可能同时有两项；capability 是 adapter 要求，不等同已注册工具。

复选框仅在该项完成真实接线、必要测试并有对应 Evidence 后勾选；初始均未勾选，不把历史静态声明或 Synthetic 误记为真实验收。每图的 configured / tested / evidence / still-blocked 独立记录于矩阵和证据。

来源：`packages/agentarts/src/owned-workflow-data.ts`、`owned-workflow-templates.ts`、`workflow-adapters.ts`。生成时按公开函数的源码规则静态投影；构建 AgentArts 后调用 `getOwnedWorkflowAdapterRequirements()`，核对总数 152、111 host、41 guard，所有工具名称均出现在本清单中。这是目录核对，不是生产接线验收。

F20 无 host / guard 要求（0 / 0）；这不代表可信输入、调用入口及本地完成验证已就绪。

## F01 主对话与责任理解

- [ ] `workflow.host.f01_n02` — 独立依赖（默认串行）召回有效责任、上下文与能力；节点能力：`memory.query`, `responsibility.snapshot`, `model.capabilities`
- [ ] `workflow.host.f01_n04` — 宿主检查引用、适用范围与现有授权；节点能力：`policy.scope_check`
- [ ] `workflow.host.f01_n05` — F28适配执行模型与实际支持参数；节点能力：`model.native_config_check`
- [ ] `workflow.host.f01_n06` — TaskRuntime建立责任关联任务图；节点能力：`runtime.commit_task_graph`
- [ ] `workflow.guard.f01_n07` — 缺信息：在既有数据范围扩充检索；节点能力：`knowledge.search`
- [ ] `workflow.host.f01_n08` — 真正歧义：主动语音或文字补问；节点能力：`voice.ask_question`
- [ ] `workflow.guard.f01_n08` — 真正歧义：主动语音或文字补问；节点能力：`voice.ask_question`
- [ ] `workflow.host.f01_n09` — 明确已授权责任直接激活并留来源；节点能力：`runtime.commit_responsibility`
- [ ] `workflow.guard.f01_n09` — 明确已授权责任直接激活并留来源；节点能力：`runtime.commit_responsibility`

## F02 语音交互与确认

- [ ] `workflow.host.f02_n01` — 可信操作摘要：对象、参数、问题ID与revision；节点能力：`policy.pending_question`
- [ ] `workflow.guard.f02_n01` — 可信操作摘要：对象、参数、问题ID与revision；节点能力：`policy.pending_question`
- [ ] `workflow.host.f02_n02` — 主动询问：本地播报与文字同步；节点能力：`voice.speak_question`
- [ ] `workflow.host.f02_n03` — 可信语音会话的最终转写；中途与回声不作确认；节点能力：`voice.final_transcript`
- [ ] `workflow.host.f02_n05` — 检查当前问题、revision、参数指纹与一次消费；节点能力：`policy.confirmation_check`
- [ ] `workflow.guard.f02_n05` — 检查当前问题、revision、参数指纹与一次消费；节点能力：`policy.confirmation_check`
- [ ] `workflow.host.f02_n06` — 明确同意：交回既有Policy，执行后核实；节点能力：`policy.resume_original_operation`
- [ ] `workflow.host.f02_n07` — 修改或条件：旧确认失效，再核对已有授权；节点能力：`runtime.invalidate_question`
- [ ] `workflow.host.f02_n08` — 拒绝：本地停止当前动作，独立分支继续；节点能力：`runtime.reject_operation`
- [ ] `workflow.host.f02_n09` — 本地直接停止入口：不等待ASR或云模型；节点能力：`runtime.local_stop_observation`
- [ ] `workflow.guard.f02_n09` — 本地直接停止入口：不等待ASR或云模型；节点能力：`runtime.local_stop_observation`
- [ ] `workflow.host.f02_n10` — ASR / 云端不可用：显示本地操作入口；节点能力：`voice.local_fallback`
- [ ] `workflow.host.f02_n11` — 核实操作结果并反馈；节点能力：`runtime.read_original_effect`

## F03 世界状态、目标与局部重规划

- [ ] `workflow.host.f03_n05` — 独立依赖（默认串行）宽松召回时间、地点、人物、资源；节点能力：`memory.query`
- [ ] `workflow.host.f03_n03` — 保留有效成果；仅使过时计划节点失效；节点能力：`runtime.invalidate_affected_subgraph`
- [ ] `workflow.host.f03_n06` — 宿主绑定原操作、效果与变更因果链；节点能力：`runtime.original_effect_binding`
- [ ] `workflow.host.f03_n07` — 未知原写入：先读回核实；节点能力：`runtime.reconcile_original_effect`
- [ ] `workflow.guard.f03_n07` — 未知原写入：先读回核实；节点能力：`runtime.reconcile_original_effect`
- [ ] `workflow.host.f03_n08` — 现有Policy核对实际补偿授权；节点能力：`policy.compensation_check`
- [ ] `workflow.guard.f03_n08` — 现有Policy核对实际补偿授权；节点能力：`policy.compensation_check`
- [ ] `workflow.host.f03_n09` — 覆盖授权：执行补偿并读回；节点能力：`runtime.submit_bound_compensation`
- [ ] `workflow.guard.f03_n09` — 覆盖授权：执行补偿并读回；节点能力：`runtime.submit_bound_compensation`
- [ ] `workflow.host.f03_n10` — 缺决定：保留补偿草稿并语音补问；节点能力：`voice.ask_question`
- [ ] `workflow.guard.f03_n10` — 缺决定：保留补偿草稿并语音补问；节点能力：`voice.ask_question`
- [ ] `workflow.host.f03_n04` — F24按新依赖调度；独立分支继续；节点能力：`runtime.schedule_graph`

## F04 Wiki 与作用域记忆管理

- [ ] `workflow.host.f04_n05` — 独立依赖（默认串行）检索已有版本与有效授权引用；节点能力：`memory.query`
- [ ] `workflow.host.f04_n06` — 宿主核对来源与公开写入能力；节点能力：`knowledge.source_and_write_check`
- [ ] `workflow.guard.f04_n03` — 相容：写新版本并保留旧版来源；节点能力：`knowledge.apply_note_patch`
- [ ] `workflow.host.f04_n07` — 冲突：隔离候选，按需澄清；节点能力：`memory.quarantine_candidate`
- [ ] `workflow.guard.f04_n07` — 冲突：隔离候选，按需澄清；节点能力：`memory.quarantine_candidate`
- [ ] `workflow.host.f04_n04` — 通知受影响索引与上下文失效；节点能力：`memory.invalidate_projection`

## F05 记忆搜索与来源回答

- [ ] `workflow.host.f05_n02` — 范围/版本初筛后独立依赖（默认串行）多路召回；节点能力：`knowledge.search`, `memory.query`
- [ ] `workflow.guard.f05_n06` — 按需扩充已授权数据范围的检索；节点能力：`knowledge.search`
- [ ] `workflow.guard.f05_n04` — 执行模型生成带来源候选回答；节点能力：无
- [ ] `workflow.host.f05_n05` — 候选判断检查支持关系；代码核对引用版本；节点能力：`knowledge.citation_revision_check`
- [ ] `workflow.host.f05_n07` — 发布有据回答并记录引用影响；节点能力：`runtime.publish_sourced_answer`

## F06 待办、提醒与跟进

- [ ] `workflow.host.f06_n03` — 写入待办系统 (带幂等键)；节点能力：`todo.registered_write`
- [ ] `workflow.host.f06_n04` — 按实际时钟与当前提醒版本检查到期；节点能力：`reminder.current_clock_and_revision`
- [ ] `workflow.host.f06_n05` — 播发提醒通知；节点能力：`notification.deliver`

## F07 日历安排与冲突处理

- [ ] `workflow.host.f07_n04` — 写入前日历版本新鲜度校验；节点能力：`calendar.freshness_check`
- [ ] `workflow.host.f07_n05` — 创建本地预留日程；节点能力：`calendar.registered_write`

## F08 邮件分类、草稿与发送

- [ ] `workflow.host.f08_n03` — 分支A：现有Policy核验后归档并读回；节点能力：`mail.registered_archive`
- [ ] `workflow.host.f08_n10` — 宿主核对具体参数、revision与现有授权；节点能力：`policy.operation_scope_check`
- [ ] `workflow.host.f08_n06` — 仅缺决定：调用F02主动语音/文字补问；节点能力：`voice.ask_question`
- [ ] `workflow.guard.f08_n06` — 仅缺决定：调用F02主动语音/文字补问；节点能力：`voice.ask_question`
- [ ] `workflow.host.f08_n07` — 授权通过：稳定操作ID发送；节点能力：`mail.registered_send`
- [ ] `workflow.guard.f08_n07` — 授权通过：稳定操作ID发送；节点能力：`mail.registered_send`
- [ ] `workflow.host.f08_n12` — 结果未知：后台核实，禁止盲目重发；节点能力：`runtime.wait_reconciliation`
- [ ] `workflow.guard.f08_n12` — 结果未知：后台核实，禁止盲目重发；节点能力：`runtime.wait_reconciliation`
- [ ] `workflow.host.f08_n13` — 输入变化：转F03保留原效果并局部修订；节点能力：`runtime.versioned_replan`
- [ ] `workflow.guard.f08_n13` — 输入变化：转F03保留原效果并局部修订；节点能力：`runtime.versioned_replan`

## F09 订阅、信号发现与筛选

- [ ] `workflow.host.f09_n02` — 确定性哈希去重与格式校验；节点能力：`feeds.validate_and_deduplicate`
- [ ] `workflow.host.f09_n04` — 转入 F10 深度研究队列；节点能力：`runtime.enqueue_research`

## F10 深度研究与证据汇总

- [ ] `workflow.host.f10_n05` — 独立红蓝对抗审查 (寻找未支持主张与反例)；节点能力：`knowledge.check_supported_claims`

## F11 天气、出行及计划影响

- [ ] `workflow.host.f11_n04` — 仅真正缺决定时主动语音补问；节点能力：`voice.ask_question`
- [ ] `workflow.guard.f11_n04` — 仅真正缺决定时主动语音补问；节点能力：`voice.ask_question`
- [ ] `workflow.host.f11_n05` — 更新日程属性并作废旧出行闹铃；节点能力：`calendar.update_and_invalidate_reminder`
- [ ] `workflow.guard.f11_n05` — 更新日程属性并作废旧出行闹铃；节点能力：`calendar.update_and_invalidate_reminder`

## F12 通知、安静时段与主动服务

- [ ] `workflow.host.f12_n02` — 读取global→connector→responsibility当前策略；节点能力：`policy.quiet_hours`
- [ ] `workflow.host.f12_n04` — 原子reserve同round→最新策略复检→实际渠道receipt；节点能力：`notification.deliver`
- [ ] `workflow.guard.f12_n04` — 原子reserve同round→最新策略复检→实际渠道receipt；节点能力：`notification.deliver`
- [ ] `workflow.host.f12_n05` — 静默feed/独立read ack与有效return digest；节点能力：`notification.deliver_when_due`
- [ ] `workflow.guard.f12_n05` — 静默feed/独立read ack与有效return digest；节点能力：`notification.deliver_when_due`

## F13 系统检查与故障诊断

- [ ] `workflow.host.f13_n02` — 独立依赖（默认串行）运行确定性探针诊断；节点能力：`system.registered_probe`
- [ ] `workflow.host.f13_n04` — 核实执行宿主与未知效果后恢复资源；节点能力：`runtime.confirmed_recovery`

## F14 浏览器与桌面操作

- [ ] `workflow.host.f14_n01` — 加载浏览器页面并解析可操作 DOM；节点能力：`desktop.current_observation`
- [ ] `workflow.host.f14_n02` — 申请桌面/浏览器输入互斥锁；节点能力：`runtime.desktop_input_lock`
- [ ] `workflow.host.f14_n03` — 串行键盘填充字段；节点能力：`desktop.registered_input`
- [ ] `workflow.host.f14_n05` — 缺少决定时主动语音/文字确认；节点能力：`voice.ask_question`
- [ ] `workflow.guard.f14_n05` — 缺少决定时主动语音/文字确认；节点能力：`voice.ask_question`
- [ ] `workflow.host.f14_n06` — 点击提交并释放输入锁；节点能力：`desktop.registered_submit`
- [ ] `workflow.guard.f14_n06` — 点击提交并释放输入锁；节点能力：`desktop.registered_submit`

## F15 代码修改、补丁与命令执行

- [ ] `workflow.host.f15_n04` — 独立红线审查 (防越界与隐蔽变更)；节点能力：`workspace.patch_scope_check`
- [ ] `workflow.host.f15_n05` — 在支持的测试工作区应用补丁并运行必要检查；节点能力：`runtime.patch_and_required_checks`
- [ ] `workflow.host.f15_n06` — 交付补丁及检查凭证，按既有发布条件处理；节点能力：`runtime.deliver_patch_evidence`

## F16 CI 检查与修复

- [ ] `workflow.host.f16_n01` — 绑定提交版本与失败日志；节点能力：`github.bound_ci_failure`
- [ ] `workflow.host.f16_n04` — 审查修复是否保留真实验收意图；节点能力：`workspace.test_intent_check`

## F17 测试失败定位

- [ ] `workflow.host.f17_n04` — 交付根因证据清单与针对性修复；节点能力：`runtime.deliver_failure_report`

## F18 PR 审查、批准条件与合并

- [ ] `workflow.host.f18_n01` — 固定 PR 当前提交 SHA 与 Diff；节点能力：`github.bound_pr_diff`
- [ ] `workflow.host.f18_n04` — 确定性门禁检查 (真人批准、CI、冲突)；节点能力：`github.current_head_merge_gate`
- [ ] `workflow.host.f18_n05` — 执行受控合并并更新主干版本；节点能力：`github.registered_merge`

## F19 Issue 分诊与关联修复

- [ ] `workflow.host.f19_n01` — 接收新用户报告并检索已有 Issue 库；节点能力：`github.issue_snapshot`
- [ ] `workflow.host.f19_n03` — 创建关联修复子任务 (进入 F15)；节点能力：`runtime.enqueue_issue_repair`
- [ ] `workflow.host.f19_n04` — PR 合并后独立回归复验；节点能力：`github.merged_repair_readback`
- [ ] `workflow.host.f19_n05` — 核实解决后安全关闭 Issue；节点能力：`github.registered_close_issue`

## F21 MCP、Skills 和连接器接入

- [ ] `workflow.host.f21_n01` — 读取工具能力声明与权限清单；节点能力：`mcp_skill.source_manifest`
- [ ] `workflow.host.f21_n02` — 注册协议与能力元数据；节点能力：`mcp_skill.install_registry`
- [ ] `workflow.host.f21_n03` — 核对通信握手与健康状态；节点能力：`mcp_skill.protocol_health`
- [ ] `workflow.host.f21_n04` — 在支持的隔离环境验证具体能力；节点能力：`mcp_skill.isolated_probe`
- [ ] `workflow.host.f21_n05` — 候选判断匹配工具候选；宿主按现有授权启用；节点能力：`mcp_skill.enable_authorized`

## F22 工作流调试与影子实验

- [ ] `workflow.host.f22_n09` — 高级开关/风险价值/可信机会资源；主任务优先；节点能力：`shadow.trigger_snapshot`
- [ ] `workflow.host.f22_n01` — 冻结同基线snapshot/asOf/sourceVersions与原验收；节点能力：`shadow.versioned_snapshot`
- [ ] `workflow.host.f22_n03` — decision_shadow仅比较选择，不实际执行工具；节点能力：`shadow.decision_snapshot`
- [ ] `workflow.guard.f22_n03` — decision_shadow仅比较选择，不实际执行工具；节点能力：`shadow.decision_snapshot`
- [ ] `workflow.host.f22_n04` — trace_replay只读历史；write仅timeline不重放；节点能力：`shadow.historical_trace`
- [ ] `workflow.guard.f22_n04` — trace_replay只读历史；write仅timeline不重放；节点能力：`shadow.historical_trace`
- [ ] `workflow.host.f22_n05` — isolated同基线/namespace/权限执行并独立验证；节点能力：`shadow.isolated_capabilities`
- [ ] `workflow.guard.f22_n05` — isolated同基线/namespace/权限执行并独立验证；节点能力：`shadow.isolated_capabilities`
- [ ] `workflow.host.f22_n06` — 核对replay可比性，缺反事实/failed/unknown保留原态；节点能力：`shadow.counterfactual_evidence`
- [ ] `workflow.guard.f22_n06` — 核对replay可比性，缺反事实/failed/unknown保留原态；节点能力：`shadow.counterfactual_evidence`
- [ ] `workflow.guard.f22_n07` — 按已选模式汇合可比结果；显式比较才等双方；节点能力：无

## F23 决策配置、评估与版本晋升

- [ ] `workflow.host.f23_n01` — 可信验收配置/同task-session-revision-deadline比较；节点能力：`evaluation.dataset_snapshot`
- [ ] `workflow.host.f23_n02` — 验签与verifyComparable完整上下文；不是授权；节点能力：`evaluation.temporal_leakage_check`
- [ ] `workflow.host.f23_n03` — 原Policy/ToolGateway授权configuration port；节点能力：`evaluation.actual_result_dataset`
- [ ] `workflow.host.f23_n04` — revision CAS晋升并保留原operation；节点能力：`configuration.promote_with_rollback`
- [ ] `workflow.host.f23_n05` — 真实回读；必要回滚仍核原版本与授权；节点能力：`configuration.operation_readback`

## F24 调度、并发、取消与恢复

- [ ] `workflow.host.f24_n01` — 持久化任务图、revision与完成条件；节点能力：`runtime.persist_graph`
- [ ] `workflow.host.f24_n03` — 执行前核对Policy、版本与操作身份；节点能力：`policy.operation_scope_check`
- [ ] `workflow.host.f24_n04` — 经ModelGateway/ToolGateway执行并存检查点；节点能力：`runtime.execute_published_operation`
- [ ] `workflow.host.f24_n05` — 证据就绪：汇合已选择的必需分支；节点能力：`runtime.selected_branch_evidence`
- [ ] `workflow.host.f24_n06` — 本地取消/停止：先更新控制revision；节点能力：`runtime.local_stop_observation`
- [ ] `workflow.guard.f24_n06` — 本地取消/停止：先更新控制revision；节点能力：`runtime.local_stop_observation`
- [ ] `workflow.host.f24_n07` — 未开始：阻止当前操作并保留此前效果；节点能力：`runtime.stop_not_started`
- [ ] `workflow.guard.f24_n07` — 未开始：阻止当前操作并保留此前效果；节点能力：`runtime.stop_not_started`
- [ ] `workflow.host.f24_n08` — 已提交/在途：显示正在停止；节点能力：`runtime.stop_in_flight`
- [ ] `workflow.guard.f24_n08` — 已提交/在途：显示正在停止；节点能力：`runtime.stop_in_flight`
- [ ] `workflow.host.f24_n09` — 结果未知：等待对账与外部读回；节点能力：`runtime.reconcile_original_effect`
- [ ] `workflow.guard.f24_n09` — 结果未知：等待对账与外部读回；节点能力：`runtime.reconcile_original_effect`
- [ ] `workflow.host.f24_n10` — 已确认发生：保留结果，按需转补偿；节点能力：`runtime.keep_confirmed_effect`
- [ ] `workflow.guard.f24_n10` — 已确认发生：保留结果，按需转补偿；节点能力：`runtime.keep_confirmed_effect`
- [ ] `workflow.host.f24_n11` — 恢复：读检查点及原操作结果再调度；节点能力：`runtime.recover_checkpoint`
- [ ] `workflow.guard.f24_n11` — 恢复：读检查点及原操作结果再调度；节点能力：`runtime.recover_checkpoint`
- [ ] `workflow.host.f24_n12` — 状态徽章与必要主动通知；节点能力：`runtime.publish_actual_status`

## F25 配置、账户、凭据和数据范围

- [ ] `workflow.host.f25_n03` — 宿主依据实际授权组装出站上下文；节点能力：`policy.outbound_context_check`
- [ ] `workflow.host.f25_n04` — 保存安全配置引用 (三态独立验证)；节点能力：`configuration.save_credential_reference`

## F26 镜像、部署与比赛验收

- [ ] `workflow.host.f26_n02` — [阶段1/4] 构建镜像并检查产物；节点能力：`deployment.build_arm64_image`
- [ ] `workflow.host.f26_n03` — [阶段2/4] 部署上线并就绪探针；节点能力：`deployment.runtime_readback`
- [ ] `workflow.host.f26_n04` — [阶段3/4] 真实语义闭环评测：云端提案->本地Policy->工具->证据；节点能力：`deployment.real_tool_evidence`
- [ ] `workflow.host.f26_n05` — 记录验收覆盖与剩余问题；按既有发布条件上线；节点能力：`deployment.publish_verified_coverage`

## F27 上下文预算、压缩与恢复

- [ ] `workflow.host.f27_n01` — 读取模型实际容量、配置与版本；节点能力：`model.capabilities`
- [ ] `workflow.host.f27_n05` — 独立依赖（默认串行）召回当前责任、事实与必要工具证据；节点能力：`memory.query`
- [ ] `workflow.guard.f27_n03` — 长日志按需由执行模型摘要；节点能力：无
- [ ] `workflow.guard.f27_n06` — 需要原证据时恢复引用或扩充检索；节点能力：`knowledge.search`
- [ ] `workflow.host.f27_n04` — 宿主组装关键指令/授权/版本映射；节点能力：`model.context_source_map_check`
- [ ] `workflow.guard.f27_n04` — 宿主组装关键指令/授权/版本映射；节点能力：`model.context_source_map_check`
- [ ] `workflow.host.f27_n07` — 变化使旧映射失效并反馈F28；节点能力：`runtime.invalidate_context_mapping`

## F28 多厂商模型、思考深度与主对话分配

- [ ] `workflow.guard.f28_n02` — 合格Laya/未合格配置执行模型选择模型分工与上下文；节点能力：无
- [ ] `workflow.host.f28_n03` — 区分原生思考、步骤预算与验证强度；节点能力：`model.native_config_check`
- [ ] `workflow.guard.f28_n03` — 区分原生思考、步骤预算与验证强度；节点能力：`model.native_config_check`
- [ ] `workflow.host.f28_n10` — 独立检查来源、补丁与行为测试；节点能力：`workspace.source_and_test_check`
- [ ] `workflow.host.f28_n11` — Runtime 完成条件通过后汇总；节点能力：`runtime.completion_check`
- [ ] `workflow.host.f28_n12` — 执行者在派定范围内自主选工具与探索；节点能力：`executor.scoped_tool_loop`
- [ ] `workflow.guard.f28_n12` — 执行者在派定范围内自主选工具与探索；节点能力：`executor.scoped_tool_loop`

