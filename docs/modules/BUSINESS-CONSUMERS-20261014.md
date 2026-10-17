# BUSINESS-CONSUMERS-20261014：业务工具消费接线（Potatos498）

工作包依据：[Issue #354](https://github.com/zemeng5208/PersonalAgent/issues/354) 与 [当时的平台交接（固定提交的历史来源）](https://github.com/zemeng5208/PersonalAgent/blob/a1803ce4504641b6447894d7f52c5282007d2cc3/docs/modules/AGENTARTS-PLATFORM-HANDOFF-20261014.md) §4。状态：`in_progress`（2026-10-14 已接收）。基线 main `3275aa91`，工作树 `.worktrees/business-consumers-20261014`，分支 `business-consumers/tool-descriptors-20261014`。

本文记录首个增量：现有业务工具描述符审计 + 缺口清单 + 实施顺序。设计不等于已实现；每个缺口以自身 PR 交付并验收，不把登记当可用。

## 1. 现状审计（main @ 3275aa91 静态核对）

Competition 目录（`apps/desktop/electron/main.js` 组装）中业务面工具与其 ToolDescriptor 关键字段：

| 工具 | 版本 | sideEffect | 幂等 | 恢复 | scopes |
| --- | --- | --- | --- | --- | --- |
| calendar.events | CALENDAR_CONNECTOR_VERSION | read | ✓ | ✓ | calendar:read |
| mail.accounts / mail.inbox / mail.reconcile_send | MAIL_CONNECTOR_VERSION | read | ✓ | ✓ | mail:read |
| mail.mark_seen | MAIL_CONNECTOR_VERSION | external_write | ✓ | ✓ | mail:write |
| mail.save_draft | MAIL_CONNECTOR_VERSION | external_write | ✓ | **✗** | mail:draft |
| inbox.classification.save | MAIL_CONNECTOR_VERSION | local_write | ✓ | ✓ | mail:classification |
| feeds.collect / feeds.subscriptions | FEEDS_CONNECTOR_VERSION | read | ✓ | ✓ | feeds:read |
| notifications.status | NOTIFICATIONS_* | read | ✓ | ✓ | notifications:read |
| research.search | RESEARCH_MODULE_VERSION | read | ✓ | ✓ | research:read |
| weather.forecast | WEATHER_CONNECTOR_VERSION | read | ✓ | ✓ | weather:read |
| todo.list | PRODUCTIVITY_MODULE_VERSION | read | ✓ | ✓ | todo:read |
| todo.create | PRODUCTIVITY_MODULE_VERSION | local_write | **✗** | **✗** | todo:write |
| todo.update | PRODUCTIVITY_MODULE_VERSION | local_write | ✓ | ✓ | todo:write |
| github.issue.get/list/label、github.actions.run.list（MOD-33，goo122） | — | read/write | — | — | 供 MOD-34/38 消费 |

结论：描述符结构（name/version/输入输出 schema/sideEffect/scopes/幂等/恢复/presence）**已完整覆盖**业务读面与大部分写面；`mail.save_draft` 不可恢复、`todo.create` 非幂等为有意声明，消费侧须按此语义处理（创建类调用无幂等保护，云提案重放会重复建待办）。

## 2. 缺口清单（按交付内容对应）

1. **通知域事件版本（F12）**：目录仅 `notifications.status` 读状态；安静时段/投递回执/提醒读回未作为版本化事件公布给镜像节点。对应交付 1。已交付（2026-10-17）：`notifications.events` 只读工具（eventVersion:1，快照分页使用 `snapshotRevision` + `sinceBatchId`；版本变化返回 `changed` 并从头对账；未知游标报 `compacted`。条目只引用 dedupeKey，不复制内容、不触发 drain，也不代替 acknowledge）已随 `packages/notifications` `register()` 注册；desktop `todo-host` 切换到 notificationHost 时会去除旧 fallback 的 events 绑定，notificationHost 路径暂不直接暴露 events（属下一增量）。原提交证据：notifications 53/53 绿（含 `test/events-readback.test.mjs` 7/7）、desktop todo-host 定向 13/13 绿（`test/todo-host.test.mjs` + `test/notification-application-host.test.mjs`）、`npm run build` 成功；本次快照修复将读回测试扩为 8 项并修正摘要窗口测试，当前 head 等待 CI 复验。
2. **开发工作流入口工具化（F15–F19）**：MOD-34 CI 修复、MOD-35 测试定位、MOD-38 Issue 分诊作为镜像可消费的 ToolDescriptor/入口尚未登记（目前只有其下游 github 读工具）。对应交付 1/2。
3. **国内 Provider 端点实测**：weather=Open-Meteo、research=OpenAlex 均为国际端点；交接要求按真实国内网络核验（华为云区域出网 + 本机双环境），不可达时按交付 4 显式 Unavailable，不静默换 Fake。对应交付 4。
4. **验收场景集**：同资源写入排队、事件去重、分支部分成功、修改失效、取消四态、断网未知不重放——以公开合成场景落在各连接器测试与 `tests/manual` 验收脚本。对应验收节。
5. **镜像独立调用证据**：待 zemeng 发布可调用镜像版本说明后，按交付 5 保存本模块 Evidence；此前用 Fake/Unavailable 端口开发。

## 3. 实施顺序

1. 缺口 3（端点实测）先行——结果决定 weather/research 是否需要 Provider 配置扩展；
2. 缺口 1（通知事件版本）与缺口 2（工作流入口工具化）各一个 PR，均带 Fake/Unavailable 消费验证；
3. 缺口 4 场景随上述 PR 分别交付，最后汇总 `tests/manual/business-consumers-acceptance`；
4. 缺口 5 在镜像版本可用后单独记录，不改断言、不代验他人模块。

凭据全部本地配置，不入仓。每个 PR 由任一非作者在当前 head 有效 Approve + 实际检查后按授权合并。
