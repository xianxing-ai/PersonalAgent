# MOD-09A：世界状态查询与变化流契约准备

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；关联 PA-020、PA-024、MOD-09/27/28。
- 负责人：`goo122`；消费语义确认：`zemeng`；状态：`review`。
- 分支：`codex/mod-09a-world-state-contract`；交付基线：PR #40/#42/#44 合并后的 `main@3eb9156`。

## 1. 目标与边界

本片只确定问题、场景和验收数据，不冻结 TypeScript 方法签名。它为未来
`MemoryQueryPort` 和 `FactChangeFeed` 提供消费需求，避免在核心认知负责人暂时
无法评审时，由存储提供方单方面决定消费者接口。

Memory 提供事实快照与变化，不直接修改 Goal、Decision、Plan 或 Task。Coordination
只输出 KEEP/RECHECK/REVISE；Runtime 继续拥有调度、审批、工具、Evidence 和任务终态。

本片不新增 package、公共 exports、contracts Schema、数据库迁移或 capability；不接
Obsidian、向量检索、AgentArts 或真实私人数据。

## 2. 事实语义要求

未来事实记录必须表达以下语义，但字段名和传输形状尚未冻结：

| 语义 | 最低要求 |
| --- | --- |
| 身份与版本 | 稳定 fact ID、单调 revision，能引用被修正的精确版本 |
| 来源 | 可追溯 sourceRef；来源不构成真实性、权限或用户确认 |
| 时间 | observedAt、validFrom、validUntil 使用明确 UTC；有效期采用半开区间 |
| 状态 | active/withdrawn；修正和撤回均追加历史，不能覆盖旧版本 |
| 内容 | 规范化内容或受控 contentRef；不解析 resultSummary 形成协议 |
| 敏感范围 | public/private/restricted；可信宿主绑定命名空间和允许范围 |
| 确认 | 区分外部观察、模型推断和用户确认；模型不能自升为已确认事实 |

优先复用 `@personal-agent/goals` 已有 ID、revision、来源、有效期、sensitivity 和
state 语义。Memory 不创建第二套 Goal/Decision/Plan，也不能直接写 CoordinationStore。
额外的观察时间、确认状态或内容引用应在消费确认后通过独立类型组合。

## 3. MemoryQueryPort 消费要求

未来查询端口至少支持：

1. 在宿主已绑定的命名空间和敏感范围内读取当前有效事实。
2. 按固定 revision 或 snapshot watermark 重放一致结果。
3. 按来源和稳定 fact ID 定位修正、撤回及历史。
4. 限制结果数量和内容大小；取消、deadline 或故障不能返回部分“成功”。
5. 返回隔离副本，消费者修改结果不能污染后续读取。

| 情况 | 必须表现 |
| --- | --- |
| 成功但无匹配 | 空结果及其 snapshot watermark |
| 命名空间不存在 | NOT_FOUND，不伪装为空 |
| 条件、版本或范围非法 | INVALID_ARGUMENT |
| 无对应敏感范围 | FORBIDDEN 或等价拒绝，不能泄露是否存在 |
| 存储损坏或不可用 | STORAGE_UNAVAILABLE 或公共外部失败 |
| deadline/取消 | TIMEOUT/CANCELLED，不推进消费位置 |

## 4. FactChangeFeed 消费要求

- 至少表达 created、corrected、withdrawn，携带稳定事件 ID、事实精确版本、
  单调 sequence 和可恢复 cursor。
- 首次读取固定水位；续页不能跨水位偷读新事件。
- 重启后从已确认 cursor 继续；重复事件可安全去重。
- cursor 过期、sequence 缺口、乱序和修正链缺失必须显式失败或 reconciliation。
- cursor 只在消费者确认持久处理后推进；读取成功不等于影响分析已提交。
- deadline 和取消贯穿等待；结束订阅后不能继续投递。

本片不决定 push、poll、AsyncIterable 或分页签名，也不把 Runtime task event cursor
冒充事实变化流。

## 5. 信任、隐私与删除

- namespace 由可信宿主绑定；消费者方法不接受任意 namespace 字符串。
- namespace 只是隔离标签，不是身份验证；宿主还要绑定用户、敏感范围和出机许可。
- 网页、邮件、连接器、模型、AgentArts 和工具输出均不能扩大权限。
- 发往 AgentArts 的事实必须经过当前任务授权与最小化筛选；端口可用不代表允许出机。
- 错误、日志、cursor、dedupeKey 和公开 Evidence 不包含私人正文或可逆摘要。
- withdrawn 保留历史，不等于物理删除。真实私人数据进入前必须确定主库、索引、缓存、
  WAL/备份的删除与保留策略。
- 本片只使用合成会议数据；Fake 和夹具不能写入生产数据库。

## 6. 合成验收场景

夹具见 [meeting-change.json](../../tests/fixtures/world-state/meeting-change.json)。其格式只
服务契约讨论和未来测试，不是 wire DTO、数据库 Schema 或冻结接口。

1. 会议 v1 为 15:00，目标、决策和计划固定依赖该版本。
2. 会议 v2 修正为 17:00，相关依赖 RECHECK，无关计划 KEEP。
3. 只重绑定目标后，仍依赖旧目标的决策和计划继续 RECHECK。
4. 完整显式重绑定后，相关节点恢复 KEEP。
5. 会议 v3 withdrawn，历史版本继续可回放。
6. 重复 corrected 事件按事件 ID 去重。
7. sequence 从 1 跳到 3 必须失败，不能静默推进。
8. restricted 事实在 public/private 范围不可见；更换 namespace 不能越权。

查询 probes 还覆盖空结果与固定水位、历史 revision、命名空间不存在、非法参数、
存储不可用、deadline 和取消；失败不能携带部分成功。变化流 probes 覆盖固定水位分页、
并发新事件隔离、确认后重启续读、处理失败不推进 cursor、cursor 过期 reconciliation，
以及取消订阅后零投递。这些字段只服务夹具自检，不冻结未来端口形状。

## 7. 等待消费方确认的问题

`zemeng` 恢复后需要确认：cognition 需要批量快照、点查或两者；固定水位所需字段；
cursor 确认时机；缺口、修正链缺失和图谱冲突的恢复流程；AgentArts 可接收内容引用、
脱敏摘要还是授权正文；哪些错误映射到 contracts。

| 决策 | 推荐选项 | 原因与影响 |
| --- | --- | --- |
| 查询方式 | 批量快照与按稳定 fact ID 点查都保留 | 批量用于影响分析，点查用于按精确版本解释；不包含自由向量检索 |
| snapshot watermark | 端口暴露不透明 token | 避免消费者依赖 SQLite revision 或变化流 sequence；Fake 可使用确定字符串 |
| cursor 确认 | 消费者持久完成影响分析后显式确认 | 读取成功或内存处理成功都不足以保证重启后不会漏事件 |
| 缺口或过期 | 返回 reconciliation required | 不静默跳过、不自动从头执行；由可信宿主安排固定水位重建 |
| 历史读取 | 支持按 fact ID 加精确 revision 的有界读取 | 用于解释修正链；默认查询仍只返回当前有效版本 |
| AgentArts 出机 | 默认只提供引用或脱敏摘要，正文需当前任务单独授权 | 端口可读不等于云端可见，禁止把 namespace 当作出机授权 |
| 公共错误 | 先保留模块错误，公开 operation 接线时再映射 contracts | 避免为尚未发布的 capability 提前扩展公共 Schema |

评审者可以逐项接受或提出替代方案；任何替代方案都必须说明重启恢复、隐私和兼容性
影响。该表是提案而非已冻结接口。

确认前不得新增公共接口、迁移或 capability。

## 8. 完成标准

- 与 PRD、ARCHITECTURE、MODULE_ASSIGNMENTS、接口目录和 MOD-27/28 交接一致。
- 合成 JSON 可解析，稳定 ID、revision、sequence 和预期结果自洽。
- 链接和 `git diff --check` 通过。
- MemoryQueryPort、FactChangeFeed 继续为 unavailable。
- 非作者评审只批准需求与夹具，不代表接口或真实能力完成。

下一步是消费语义确认，再开发最小公开端口、Fake、SQLite 重启/游标测试及 cognition
消费集成。

## 9. 本轮验证

- `meeting-change.json` 可解析；5 条事实、会议 revision 1/2/3、3 个唯一事件、
  9 个查询 probes、7 个变化流 probes、重复事件、固定水位分页、sequence 缺口和敏感
  范围预期自洽。
- `npm run test:contract-fixtures` 验证版本引用、查询错误分支、cursor 确认、去重和图谱
  KEEP/RECHECK 集合；该测试不代表公共接口已实现或冻结。
- 文档链接与 `git diff --check` 通过。
- `npm run check`：通过，包含架构门禁、契约夹具 4/4、生成类型检查、类型检查和全部
  workspace 测试。
- 变更包含文档、合成夹具、自检测试与根检查脚本接线；没有 apps/packages、Schema、迁移或依赖改动。
- 未运行真实服务、模型、AgentArts、账号或 Electron；接口仍 unavailable。
- 本增量提交非作者评审；合并状态以 GitHub PR 为准。第 7 节消费语义仍待 `zemeng`
  确认，夹具自检通过不代表 Memory 查询、变化流或持久化实现已经通过验收。
