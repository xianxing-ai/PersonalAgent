# Desktop 订阅接线

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

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
