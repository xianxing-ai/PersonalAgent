# Desktop 订阅接线

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../../CONTRIBUTING.md) 和 [AGENTS](../../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 工作包：MVP-DESKTOP-FEEDS；Profile：`huawei_ict_agentarts`；实现：zemeng；评审：goo122。
- 只修改 Desktop 组合与设置。MOD-22 的采集、解析、脱敏、游标和分页保持 Potatos498 所有权，直接消费 `@personal-agent/feeds` 的公开 `register` 与 `HttpFeedProvider`，不另建采集器。

## 产品路径

设置 → 连接 → RSS / Atom 订阅：添加名称和地址，保存于 userData 的 `feeds-config.json`，使用 Electron safeStorage 加密。前端快照只显示名称与 ID；URL 输入提交后清空。

在 Runtime 启动前添加的订阅随首次云端配置一起装配；Runtime 已启动后变更列表需要重启，以保持已注册工具和任务快照一致。每次应用会话，用户明确允许读取与 AgentArts 汇总后，公开目录才提供 `feeds.subscriptions` 与 `feeds.collect`。云模型先取得订阅 ID，再经 Runtime / Policy 调用采集工具；分页复用原模块 `nextCursor`。不自动拉取、订阅外部邮件或创建第二套定时器。

关闭许可立即取消正在读取的请求，拒绝迟到结果，并阻止已有任务的结果出云。重新允许不会让旧任务重新获得权限；修改配置也会撤销旧范围。HTTP 请求仅使用用户配置的地址，模型不能提交任意 URL。提供者的验证等级保持 `conditional`。

## 验证和限制

定向宿主检查使用真实订阅解析器与显式合成 HTTP 响应，覆盖两页读取、未登记 ID 拒绝、加密存储适配、URL/凭据不出现在快照、编码游标中的受保护值拒绝、撤销和旧任务隔离。2 项通过。实际设置组件已在本机浏览器显示检查。

尚未进行真实订阅源 → AgentArts → Runtime 审批/执行 → 对话汇总的联合验收。配置持久化与合成检查不等于真实云端可用；Electron safeStorage 的真实配置需单独读回。不自动声明持续追踪、提醒、知识更新或 MOD-22 整体完成；这些后续消费必须复用 Runtime 的既有任务与调度边界。

依赖变化仅为 Desktop 声明仓库已有 feeds workspace；根锁文件由 npm 生成一行工作区依赖。公共 Schema 和数据库迁移未改变，现有接口仍为 provisional。回退代码不删除加密配置、订阅内容或用户任务。
