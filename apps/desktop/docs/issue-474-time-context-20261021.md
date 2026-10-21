# #474：每轮可信时间与能力授权引导

目标 Profile：`huawei_ict_agentarts`。独立分支 `codex/fix-harness-time-context-474`，实施基线 `e7d4e0c6`。不扩 Local Profile，不调用真实模型或账号，不创建真实日历或待办。

## 缺口与接线

原 Competition 目标只编入用户目标、已许可的历史/私人内容，缺少当前设备时钟和时区。待办工具虽然注册，缺会话许可时原目录过滤器将其排除，模型无法区分“未装配”与“需要授权”。本次保留目录/执行守卫，增加安全环境元数据，而不把不可用工具放进可调用目录。

- Main `readDesktopRequestContext` 复用 `conversationToolAccess.resolveConversation`，只对原用户主对话及其合法子任务提供环境；内部或未知任务不额外获得这些数据。
- 纯 `createConversationEnvironmentContext` 每次调用重新读取宿主时钟，输出 UTC instant、IANA 设备时区、该瞬间 offset 和本地日期时间。未知 IANA 时明确标记 offset-only；不静默假定 UTC/上海，不用当前 offset 计算未来 DST。明确用户指定的时区优先于设备默认。
- `todoHost.readConversationGuidance` 只返回 registered、availability、固定 reasonCode，不枚举待办正文、不创建任务许可。缺操作许可、缺配置和宿主不可用分别说明；相对分钟提示使用原 `todo.create.remindInMinutes`，由本地工具在实际执行时解析。
- `CoordinationInputHooks.readRequestContext(scope)` 是可选、同步、host-only 的 provisional 扩展。内容通过已有获准 goal 出口作为环境数据发送，不成为 system 指令、工具目录或授权。旧调用不配置此项时保持原目标与检查逻辑。
- 环境快照在每次实际 `executeCoordination` 临时采样。稳定历史 binding/checkpoint 不保存时钟正文，避免 continuation 因时间改变产生历史漂移；本次发送 lease 精确绑定实际目标，预算对完整最终串计量。替换 hook、改变计量/配置、取消、deadline、来源撤回及原出机守卫仍可拒绝。

没有 frozen Core wire、公共 Schema、数据库、调度器、模型入口或依赖变更。上下文新增字符仍受原字符/token 预算，不能扩大预算或丢弃私人/Skill 门禁来容纳元数据。没有新增云端日志或私人 prompt 存储。

## 用户本轮修订：统一授权提问卡

授权引导已按当前要求改为在原对话请求实际公布的提问卡，本次/永久选择由用户决定，不再指引去设置重复勾选一次。卡不能替代账号、凭据或未装配的真实配置。

统一卡的后台挑战、持久许可和交互由 #475 工作包负责；其正式端口尚待交接。本包当前只消费稳定只读状态，原 `todo` availability/execute 守卫保持，不能仅靠引导文案或自报授权放行。卡真实消费接线与联合验证完成前，不将本工作包标为完整交付。

## 验证记录

使用 Node 24.15.0 与固定时钟、Synthetic 数据，不调用真实或付费模型/账号。

| 检查 | 当前结果 |
| --- | --- |
| 纯环境 helper：重新采样、上海跨日、纽约 DST、offset-only、无效时钟、授权状态与脱敏 | 3 项小回归已通过；后续新增配置分支将在最终定向验证一起运行 |
| 实际 Main callback → 原 canonical conversation resolver → 强制 Competition 子任务 → 工具 continuation → 主控汇总 | 源码用例已完成，待本树依赖/build 后运行；不可当已通过 |
| 临时上下文超预算/async拒绝、凭据等待期间 reader/计量漂移最终发送拒绝 | 源码用例已完成，待本树 dist 验证 |
| 旧 context binding/compaction/delegation/todo 回归 | 待最小受影响闭包验证槽，不跑模型/Docker |
| 统一授权卡消费及本次/永久 | 待 #475 正式端口与实际组合验证；未伪造卡回执 |
| 真实盘古/AgentArts 采用时间与引导、真实提醒/日历 | 未授权执行，`not_run`；Synthetic 发送载荷验证不提升平台或模型资格 |

本树原始日志与测试生成物放 ignored `.cache/issue-474-*`。公开 Evidence 只记录 Synthetic/固定元数据及检查结论，不包含账号、凭据、来源正文或私人 availability reason。
