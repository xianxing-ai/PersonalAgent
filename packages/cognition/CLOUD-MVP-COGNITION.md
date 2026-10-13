# Cloud MVP cognition 接回说明

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile: `huawei_ict_agentarts`。工作包：`codex/cloud-mvp-cognition`。依赖源为 P8 `d2a23bea182a0a61104f601a6769d6ac16d7db5b`，PR target 为 `codex/zemeng/p8-mvp-final-integration`，由根统一合 main；不把 P8 shared 源码作为本 PR 新增实现。

复用 `f4456f8a` 的 referenced deadline/cleanup（不重测）、`a1229770`→`e11ac12d` 的 host KV 消费、`45da2725` 的 exact meeting impact/crash confidence 修复、`ef7852ee` 的真实 selection dialogue/audit、`18d25ea7`＋`36b66639` 的公开 8-header/真实模型注入验收。新逻辑没有新数据库、anchor task、调度器或模型进程；Windows/native 设备通知 host 与 receiptstore `ab08ded` 未修改。

## 实现和端口

`ReviewedMeetingFactConsumer` 替换生产组合中的 prospective Fact/CAS 写入。先从既有 FactHost completed projection 读当前会议 Fact，核来源、revision、摘要、有效期，再仅传播该 Fact 的 superseded 依赖；无关 RECHECK 不成为会议修复范围。无影响返回 KEEP；有影响消费现有 Runtime review/Laya 多候选，uncertain 保持 RECHECK；合法 REVISE 使用 `prepareReviewedRepair`，执行交给现有 AgentArts→reviewedRepair→Policy/ToolGateway。

`createDesktopGoalCognitionHost.meetingReviewedRepairPort(readCommittedProjection)` 将同一 cognition/chooser/AgentArts handoff/修复 owner 给 P5，没有第二循环。它核对 completed projection 和原 Runtime intent，原 reviewTaskId 恢复不再 choose。`applyDecision(reviewTaskId, {deadline, signal})` 保留当前会话许可并将调用方期限传给原提交路径。新消费的 applied 必须有工具 Evidence、准确更新节点版本及同图谱读回；pending/unknown 保 waiting_reconciliation，不盲目重写。旧 receipt 未标明安全重试的保持原状态。

`createCommittedMeetingProjectionReader({namespace,store,facts,readSourceRevision})` 提供来源适配实现。`readSourceRevision` 必须读既有已授权来源回执，返回 `{source,sourceRevision,meetingFact:{id,revision}}`；不能直接照抄 Renderer/event 的字段来代替受控读回。Fact 尚未通过既有 Memory/Coordination 投影提交时，P5 保 RECHECK，不自行补写 Fact。

`createInboxPageConsumer({pipeline,now})` 只给既有 `createInboxTriagePipeline` 加页背压、pause/resume/deadline；无第二缓存或 cursor。直接页和流消费都使用该 pipeline 的原子断点与 current classifier fingerprint。完成页先存 cursor 后再请求下一页，取消/未完成分类不确认该页；uncertain 的原 receipt 留在既有 review/outbox。`measureTriageClassifier` 仅测实际 public classify await 的调用数、submittedCount、inferredCount、classifyWallMs；缓存命中不会进 classify，未运行不能填写成绩。

P5 composition 公开接线参数：

| 参数 | 根应注入的现有来源 |
| --- | --- |
| `application` | P8 当前 RuntimeApplication；`createHostStateStore('proactive-receipts')` 已落源码 |
| `goalCognitionHost` | 已创建且配置本会话许可的唯一 Desktop Goal cognition host |
| `facts`＋`readMeetingSourceRevision` | 原 FactHost 和已授权 calendar/Memory source-revision readback；或直接注入 `readCommittedMeetingProjection` |
| `inboxPipeline` | 当前已授权账号的原 InboxTriagePipeline owner，优先复用 |
| `mailStorage`＋`mailReadAuthorization`＋`getClassifierFingerprint` | 仅当根装配唯一 pipeline 时注入现有加密 StoragePort、当前读取 lease、当前 loaded artifact＋policy digest |
| `layaHost` | 当前唯一已加载本地 host 的 public `.choose/.classify`；P5 start/stop 不起停模型 |
| `notificationPort` | P8 native notification consumer；本工作包不接管它 |

`triageInboxPage({accountRef,folder,cursor?,nextCursor,hasMore,items,deadline,signal})` 消费真实 ConnectorItem。旧 `triageMails(items, options)` 保留名字，但 options 必须是同一 scoped page envelope；不再消费无账号/无授权的任意 text 数组。`triagePagedMails({accountRef,folder,fetchPage,maxPages?,pageSize?,deadline,signal,onPageCompleted?})` 的 fetchPage 接受 `{accountRef,folder,cursor?,limit,deadline,signal}` 并返回 `{items,nextCursor,hasMore}`，cursor 为原 source 的字符串（例如 `1:4`），不造新 uid 游标协议。

根的 shared `main.js` 装配、账号来源回执→Fact 投影以及原 mail host 的 pipeline 暴露仍由根接线，不能把这些注入缺失当 Fake 可用。现 composition 缺 host KV 直接 unavailable；缺 reviewed source 不写图，缺邮箱 lease/identity/storage 不启动私信处理。原 policyEvaluator/meetingExecutionPort 不再走生产 CAS。

## 迁移与本机统一验收

直接复用 `p5-runtime-checkpoints.js` 的同步 get/set，无 extra task，底层沿 P8 migration 10。原 JSON 保留一次导入；旧 v1 envelope 支持缺 revision，首次新写开始递增。会议 namespace/source/eventId/inputDigest 不允许替换；损坏旧文件阻止迁移。设备 pending/cooldown/configDigest 不重置。不同旧设备 namespace 禁止导入其无 namespace 文件。旧 mail 文件保留，不把缺 loaded fingerprint 的结果冒作当前 inbox cache。原加密 Inbox 状态继续由原 StoragePort 保存；public host KV 不新存私人信头正文。

用户提供的 P8 最终 KV 两 case 已在新编译 Runtime **PASS、0 tasks、reopen/corrupt**；这是复用的本机证据，本轮云端没有再跑，新增 revision/consumer 调整尚待本机统一执行。

本机已有依赖/dist 更新后，仅运行本次相关测试：

```sh
node --test packages/cognition/test/reviewed-meeting.test.mjs packages/cognition/test/inbox-page-consumer.test.mjs apps/desktop/test/p5-cloud-port-composition.test.mjs
```

原 composition 测试中的 policy-direct-CAS/旧文件 checkpoint 测试属于被替换的 API，需由本机统一验收按 scoped page/host KV/reviewedRepair 路径检验；不能保留旧 production 写法让历史断言假绿。本 PR 新增端口用例覆盖原权限/取消/恢复需求，不执行旧 direct writer。

真实模型只在 P8 重槽注入原 `runSmallMailBatchAcceptance`（`tests/manual/cognition/p5-small-mail-batch.mjs`）。它实际调用正式 pipeline：page1 4条真实 classify→页边界 cancel 不推进 page2→同 storage reopen、原4 receipts 完全相同且零 classify→page2 剩4。`createPipeline=createInboxTriagePipeline`，`layaHost`、model fingerprint、加密 storage/reopen 和 pauseRead/resumeRead 全部用现有宿主，不下载/启动模型或创造授权。选择审计用 `createP5ConsumerChoiceAudit(localLaya).chooser` 在创建唯一 Goal cognition/设备 service 时注入，保留 exact uncertain/result 不改阈值。

本轮云端只做源码/接口、JS/TS syntax 和完整 diff 静态核对。没有 unit/integration/smoke/build/npmcheck、真实模型、supplier、截图、性能或账号试调。本地最终待验：新 consumer 真实 choose/classify、AgentArts deployment/API/trace、受控 repair Evidence 和 graph reopen、Windows 通知 native outcome、真实账号当前 read/export 许可。没有新增 API key/设备/训练需求；不降低既有 2GB Laya gate，不宣传千封已测。
