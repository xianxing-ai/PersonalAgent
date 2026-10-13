# P5 同 Runtime 的持久认知状态

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 profile 为 `huawei_ict_agentarts`。`cognition-p5-composition.js` 使用 P8 的 `application.createHostStateStore('proactive-receipts')` 注入 `p5-runtime-checkpoints.js`，不创建状态 anchor 任务、第二个 Runtime、数据库、调度器或模型。同步 get/set KV 已由现有 Runtime 按宿主用户和 domain 绑定 namespace。snapshot 的 `persistence` 为 `runtime_sqlite`。没有任何 key 或 metadata 成为模型执行授权。

设备服务的 `DeviceAnomalyCheckpointPort` 与会议的 `MeetingDecisionReceiptStorePort` 原样注入。设备配置 digest、各 source 连续计数、最后样本、最后真实通知时间、pendingDelivery 和最后 receipt 保存在同一个设备 checkpoint；恢复不重置冷却，不把 unknown 当未执行，不恢复采样或云授权。相同时间戳重放不会调用 chooser。会议 records 和查询索引是一个原子 checkpoint 替换，按 namespace/source/eventId 隔离。

第一次读取先迁移现有 `device-anomaly-checkpoint.json` 和 `meeting-receipts/receipt-*.json`，原文件完全保留。已存在 SQLite checkpoint 时不再重新导入旧文件。损坏会议文件阻止迁移，不能跳过丢失去重状态；设备内容仍由现有服务校验 configDigest/状态。本消费增量没有新 Schema 或数据库迁移；底层 host KV 迁移由 P8 提供。旧版本仍可读原文件，但不会看到本次新增 SQLite 状态；回退不能被当成新的执行许可或删除 pending 记录。

缺少 host KV API 时组合直接 unavailable，不回退旧文件 writer。旧 JSON 仅作一次迁移输入。旧 v1 envelope 可缺 revision；新写递增 revision，namespace/source/eventId/inputDigest 不能被替换。旧设备文件没有 namespace，可信宿主可用 legacyDeviceNamespace 指定原归属；不同归属不导入。

组合只消费既有 Goal cognition host 的 `meetingReviewedRepairPort` 或明确注入同一 reviewedRepair 端口。旧 meetingExecutionPort/policyEvaluator 参数仅保留兼容识别，不执行。会议读取已提交 Fact 的 completed projection，不在 policy 函数 appendBatch。执行走原 AgentArts/Policy/ToolGateway；applied 必须有工具 Evidence 和准确版本读回。缺端口保 RECHECK，unknown 保原任务核实。calendar provider 写入与内部图谱修复分别验证，内部 applied 不代表真实日历已改期。邮件状态仍用唯一 InboxTriagePipeline 的原加密 StoragePort，不把私人信头写入公共 host KV。

用户提供的最终 KV 两 case 已由 P8 在新 compiled Runtime 实际 PASS，包含 0 tasks、reopen/corrupt。本轮复用该本机证据，不再测；本轮新增 revision/consumer 行为只做静态核对，新用例准备未运行。完整接口、迁移和本机验收入口见 `packages/cognition/CLOUD-MVP-COGNITION.md`。没有云端测试、构建、模型或真实账号调用。
