# F12 原通知 feed、策略与投递接线

目标 profile：`huawei_ict_agentarts`。实际工作树 `.worktrees/pr531-business`。本增量复用原 Desktop NotificationApplicationHost、Runtime NotificationHost、SQLite 原子通知状态、现有 Policy/提问卡及 configured worker；没有新任务库、授权器或调度器。

## 范围与兼容

`workflow.business.f12` 配置 `business-20261031-v1` 只接严格 `{itemId,trigger:'event'|'on_demand'}`。原 durable feed 中必须存在有效、未读条目；本机绑定完整原条目、层级策略及 legacy policy revision，模型不提供标题、正文、来源、额度、轮次或“用户已归来”证明。N02 公开当前原策略与本机轮次身份，N03 候选必须与本机策略分流一致；N04/N05 受信 guard 决定真实分支，不能由云候选跳过。

`event` 的 banner 分支在原 N04 外部写入工具通过审批后，才消费原单条 ready batch、以原 Runtime 原子 reserve/begin/complete 进行投递。正文是本机根据原 feed.source 生成的固定提示，实际内容仍由通知列表读取。额度不足保留 feed；旧轮次未核实/已尝试的条目不通过新图或新轮次再次发送。层级静默与原 legacy pause/quiet 走只读 feed 分支；静默不预约补弹旧通知。

`on_demand` 经过原读工具审批，N05 调用原 getDigest 读取该条仍有效未读变化，既不发通知也不确认已读。原声明中的 N05 `notification.deliver_when_due` 与当前 architecture 的“静默 feed/独立 read ack 与有效 return digest”冲突，已改为 `notification.current_feed_digest`，副作用同步为 read；没有更改 architecture 当前需求。模板摘要变化拒绝旧图恢复，不把旧节点重新解释为新行为。无 wire/数据库迁移或依赖变更。

Runtime 新公开 `createRuntimeF12ConfiguredReadHosts`；原 delivery factory 仅增加原持久 suppressed 结果的读回支持及可选结果复核 callback。Desktop 实际注入精确 feed/round/Policy 复核；所有 receipt 与 completion 出口在异步许可前后重新核验。未知结果不标记成功，原设备失败返回 `notificationState:'failed',delivered:false`。

Main 集成须注入原 NotificationApplicationHost 单例和真实用户/设备 availability，优先本工厂的受绑定 N02，避免旧 graph composition 的固定 productivity N02 占同名工具。工厂不提前读取尚未 bind 的 runtimeHost。原 settings 工具仍只用于受信 UI 设置命令，不以模型工具目录投影其 nullable Schema 来授予设置权。

## 验证与缺项

实际 Engine、Runtime、SQLite、原 NotificationHost、AuthorizationQuestions 和 Policy 验证已覆盖正常 banner、静默、显式查询、额度耗尽、legacy pause、未知设备结果、审批前撤回、原审批拒绝、审批期间策略改变、取消、完成出口期间已读、出口拒绝及第二图不能替换旧未知轮次。OS 适配器及其回执、候选与 selector、云传输、外层出机许可为明确 Fixture；这是本机真实生产组件组合，不能算真实 OS/华为 AgentArts/模型验收。

未完成项：真实用户归来事件生产来源、通知语音渠道、多条合并 batch 的领域内容/逐项绑定、真实 Windows banner、真实云整图及评测。缺归来事件时不把 on_return 方法存在当作来源证明；on_return/scheduled 不在本 worker 请求 Schema 中，条件能力保持 unavailable。单条 ready batch 不存在时保持 unavailable，不绕过原 digest/pause 队列。独立 read ack 仍归既有 UI 原操作，查询不代替它。

本地验证：F12 实际组合 **14/14**；含 F06/F07/F11 真实引擎及工厂回归 **40/40**；既有通知应用/SQLite/原端口组 **30/30**（其中包括本增量首轮 10 项）；AgentArts **242/242**；AgentArts/Runtime 构建、架构门禁 **3/3** 和 diff 检查通过。日志在本工作树忽略目录 `.cache/pr531-business/f12-business-regression.log`、`f12-runtime-boundaries.log`、`f12-agentarts-tests.log`、`f12-architecture.log`。根集成分支承担最终全仓 check。本记录不表示 F12 全完成或 #531 已可合并。
