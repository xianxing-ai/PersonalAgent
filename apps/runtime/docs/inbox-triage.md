# 本地邮件分类派生流水线

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

MOD-11/认知消费者，zemeng，Competition Profile。消费 Potato 已有 `mail.inbox` 返回的 ConnectorItem；不修改 mail provider，不读取账号或凭据。分类保持 `private`、`headersOnly:true`，不创建 Fact，也不更改邮件标签、已读状态、移动、发送或删除邮件。

生产装配通过 `@personal-agent/runtime/application` 的 `createInboxTriagePipeline({storage,namespace,triage,labels,meetingLabels,authorizeRead})`：

- storage 使用现有 StoragePort，宿主必须保证单 key 替换持久且原子，每个 namespace 只有一个流水线 owner。不要给每次页面请求新建并发 owner；StoragePort 本身无 CAS，不能证明跨进程互斥。
- namespace 绑定当前用户；triage 为 cognition 公开 `new LayaTriageService(localInference, options)`，必须使用本地 transport；宿主控制服务来源。流水线不创建 transport，不访问网络。
- labels 是用户/宿主定义的类别说明，meetingLabels 是其中应标记待核实会议候选的类别。标签定义变化使用独立缓存命名空间，重新分类。
- authorizeRead({accountRef,folder,deadline,signal}) 同步检查当前已授权的本地处理 lease；目录或邮箱配置存在不代表授权。
- `processPage({accountRef,folder,cursor?,nextCursor,hasMore,items,deadline,signal})` 输入来自既有已授权邮件读取。items 不超过 inbox 现有单页100上限。`cursor(accountRef,folder)` 返回持久检查点，`snapshot()` 返回派生分组、needsReview、高影响/会议候选计数及无信头正文的metadata。

messageId 由账号、文件夹、externalId、dedupeKey计算，包含已有provider的UIDVALIDITY语义；sourceRevision由dedupeKey、信头摘要和源时间计算，排除fetchedAt及缺失Date时的抓取时刻回退。完全相同版本跨重启复用；新内容版本重新分类。原始contentRef不持久化到派生状态，不解析其拼接格式为单独subject，也不从标题提取“已确认会议时间”。

每4封一组交给已有Laya分类服务。完成组先持久保存metadata，服务的unavailable/invalid_response/cancelled/deadline结果不记完成；所有邮件均有本版本成功结果后才在同一个状态写入中推进页游标。中途异常保留已持久组和旧游标；重试只分类未完成版本。uncertain属于已得到但弃权的结果，保留needsReview。高影响只产生候选，不授权主Agent外发或执行；会议类别一律needsReview。

游标按账号/文件夹隔离；UIDVALIDITY变更仍由mail提供者返回CURSOR_EXPIRED，宿主需显式启动新导入范围（新namespace），此模块不静默清除旧检查点。元数据保留历史分类版本以支持重放；当前没有自动保留期/清理功能。真实持久宿主、真实Laya和真实邮箱尚待接线；专项测试仅使用合成私有信头及显式Fake classifier/storage。

必要检查：Node 24 运行 `node --test apps/runtime/test/inbox-triage.test.mjs`。测试覆盖局部失败不推进、重启恢复、同版本去重、新版本重分类、无原始信头持久化、public降敏拒绝与撤销授权。
