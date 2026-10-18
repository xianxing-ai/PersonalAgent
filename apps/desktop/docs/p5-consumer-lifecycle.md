# P5 消费入口与真实结果边界

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 profile 为 `huawei_ict_agentarts`。组合是 `createCognitionP5Composition`，只消费主宿主提供的唯一 `localLaya.choose/classify`；start/stop 控制订阅与请求取消，不自行加载/停止权重。主写入、Runtime factory、云配置和 UI 接线由统一装配 writer 负责。

| 消费者 | 来源与绑定 | 实际选择入口 | 授权与执行 | 持久读回与生命周期 |
| --- | --- | --- | --- | --- |
| Goal/Fact | `goalHost.readTask` 的已确认 Goal 版本或 FactHost 的 completed impact；只传播对应依赖 | `createDesktopGoalCognitionHost.tick` → `createProactiveCognitionHost` → 同 loaded Laya.choose；KEEP 无影响、uncertain 为 RECHECK、合法 REVISE 才提供修复范围 | 当前会话出云投影 → 原 AgentArts Runtime 任务 → 版本化 repair candidate → `submitLocalRepair` → Policy/ToolGateway `cognition.commit_repair`；禁止静默 Local/Fake | `proactive-cognition-review-v1`、原 handoff task、local-repair-intent、confirmed tool record 和同 graph CAS 后读回；重建保留 IDs，不恢复出云许可、不重推理/重做 unknown |
| 会议改期 | 原已授权 calendar 读回，既有 FactHost completed projection；事件文本不能代替来源核实或 Fact 提交 | `ReviewedMeetingFactConsumer` → 唯一 Goal cognition host 的 `meetingReviewedRepairPort` → 原 Runtime 多候选/同 Laya.choose；仅对应 Fact superseded 依赖，uncertain 保 RECHECK | 原 AgentArts handoff → reviewedRepair → Policy/ToolGateway；旧 policyEvaluator/meetingExecutionPort 不执行；内部 applied 必须工具 Evidence 和准确图版本读回 | 同 namespace host KV 的 source/eventId/inputDigest、reviewTaskId、reviewScopeDigest、repairTaskId；恢复复用原任务不 choose，unknown 核实，calendarWriteVerified 始终独立 |
| 分页邮件 | 真实 `mail.inbox` 工具通过原 Runtime read lease；本地只处理生产 ConnectorItem 的 PRIVATE 信头，meeting label 只是候选 | 正式 `createInboxTriagePipeline.processPage` → 同 localLaya.classify，multi_state/chunk4/0.70/0.15；需实际 loaded artifact + policy fingerprint | 读取许可与出云分析许可独立；本地分类只保存 derived metadata；不从信头创建确认 Fact 或改日历，重点/uncertain 走既有 pending analysis | 原加密 StoragePort、namespace、cursor、sourceRevision、receiptId、classifier identity；完成 chunk 先存，完整页才推进cursor；同 cache 重建不用第二推理，unknown 不改作成功 |
| 真实设备异常 | Runtime 受控 `computer.system.observe` → `readCurrentSystemObservationSample` → `p5-system-observation-source.publishCompletedTask`，current provenance 包含 Evidence；只接受真实 node:os | `evaluateDeviceSample` → 每 source 独立连续3样本、90/90阈值、80恢复、gap/cooldown → 同 loaded Laya.choose 三个 advisory 候选 | 明确本次观察许可；通知 host 在 native.show 前复核 current provenance/许可/quiet/pause；只在实际 show 回执后 delivered=true。没有自动杀进程、系统调整或伪授权 | 同 Runtime namespace KV 保存最后样本/计数/真实选择/未决投递。已知旧样本不推理；unknown 由原 native host outcome核实而不重发，确定 suppressed 不锁冷却；重启不恢复观察授权 |

实际选择审计可注入 `tests/manual/cognition/p5-consumer-choice-audit.mjs` 的 `createP5ConsumerChoiceAudit(localLaya).chooser` 到会议/设备消费。它调用原 host 原样返回结果，验证 loaded identity、context/candidate digests，记录耗时和真实 choice receipt，不记录 source 内容、私有参数或凭据，不启模型、不创建授权。`verify(persistentReceipt.selection)` 要求同一次实际结果；恢复后 count 不增加才能证明未再次推理。uncertain 不转换为 selected。

`dialogueProjection` 显示真实 selectionState/reason/receiptId/confidence/calibrated=false；没有 selection 时不推断已经推理。指标回答、通知投递、图谱修复、真实日历写入和实际邮件账号读取是不同证据面。正常设备状态或源未变化时可返回 KEEP，但不能用人为升高指标触发分支并称真实异常。旧 CLI/合成用例是验证行为，不是这些实时源的真实推理验收。

公开合成输入的真实模型验收函数是 `p5-reviewed-goal.mjs` 和 `p5-small-mail-batch.mjs`；它们不能证明私人账号、真实设备异常或 UI 行为。会议/设备审计函数只做语法/import 检查，真实推理、AgentArts invocation、CAS 与真实设备通知必须由唯一模型/整体验收槽保存当次结果。

会议批次可能同时提交多个 Fact。受信 reader 始终返回完整原始 projection；`meetingReviewedRepairPort` 校验它与原 receipt 完全相同，且 completed report 与原 graphRevision 的历史图谱重新计算结果完全相同。只有 reader 已核实的 `meetingFact{id,revision}` 和 `sourceRevision` 可决定选择范围。内部单 link 是现有 Runtime factory 的选择视图，不替代完整 receipt，也不确认/写入新 feed。

`desktop-meeting-review-scope-v1` 在同 Runtime review task、Laya choose 之前保存完整原 projection、会议 Fact、sourceRevision 与 evaluatedAt；review/candidate/CAS 仅对应会议依赖链。恢复核对原 proof、原 Fact trigger、affected 与持久 scope digest，复用同 task，不扩大到同批次无关 Goal/Plan，不将旧的整批 review 转换为会议 review。factory 使用同 chooser/handoff/Runtime，没有第二个后台循环或执行入口；原 FactHost consume/process 仍由原宿主执行。

混合批次双 Fact/独立 Goal/Plan、篡改无关 link、恢复范围扩大、sourceRevision 替换和 Policy/CAS 不触及无关分支的用例已准备在 cognition 与 Desktop 现有测试文件中。此增量按整体验收槽要求只做语法和差异检查，未执行这些行为用例；最终统一验证由 P8 完成。
