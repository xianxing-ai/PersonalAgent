# 早到系统通知点击的独立已读证据

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/large-control-20261026`，分支：`codex/large-control-repair-20261026`。本包从已合终态覆盖修复起步：`desktop-notification-port.js` 的起点 SHA256 为 `d229b56a859c09426930cc2de54fbbfedd53bfd599e392b4300350d99b251c59`，原 `xhigh-notification-boundary.test.mjs` 与 `NOTIFICATION_BOUNDARY_AUDIT_20261026.md` 均保持不变。Root 的已合集成与其他模块不在本包修改范围。

## 行为

- Electron 的 `click` 回调若早于 `show`，通知端口先把 `clickedAt` 写入原 `desktop-notifications.json`，再发布带原 `roundId` 的私有读回。端口的 `deliveryState` 仍是 `unknown`、`userRead` 仍是 false，且没有 `show` evidenceRef；只有实际 `show` 或受信核实可以改变投递状态。`failed` 保持终态，迟到回调和释放实例仍不能覆盖它。
- 应用宿主在原通知轮次已存在、端口 id 与 `roundId` 精确对应时，把原 feed 项标记已读，使用固定 operationId 去重。它不调用 `completeDelivery` 来处理单独的点击，不创建新轮次、不退还或扩大额度，也不重发 unknown。已确认的 show/failed 仍走原完成路径。
- 原 Runtime 的轮次和 feed 留在 SQLite；通知端口原意图 JSON 增加可选 `roundId`，与 `clickedAt` 同处持久记录。重开时只读取这两个最小字段，核对原轮次及通道 ID 后补原 feed 已读。历史记录缺 `roundId` 时不猜映射；显式持有原轮次的既有核实路径仍可读取原 click。无需公共 wire/Schema、数据库迁移或新依赖。

## 验证与界限

聚焦合成用例先在仅有终态修复的基线上得到 3/3 失败：私有 outcome 无点击字段、运行中 feed 不读、SQLite/端口重开后无原轮次映射，日志在 `.cache/sol-notification-click-evidence-20261026/before-tests.log`。修复后运行新的五项及原端口/应用宿主/终态边界共 27/27 通过，日志在同目录 `after-tests.log`。新用例覆盖 early click 不冒充 show、原轮次 unknown 不重发、重开读回、错误 roundId 不跨轮次已读、点击后失败仍为 failed。使用真实本地 SQLite/Runtime/NotificationHost 与显式 Fake notifier；没有真实 OS 通知、GUI、模型或云服务调用。

Electron 44 的 Windows `Notification.handleActivation` 可在对象不在内存或应用冷启动时处理通知点击；本包**没有**接入它，也没有把逻辑 id 写入原生通知的 Tag/activation 参数。冷启动点击需要另一个有原生身份绑定和真实 Windows 通知中心验收的工作包，不能把当前 Fake 回调结果当作该能力已通过。旧记录缺映射以及实际 Electron 事件次序也仍按未知处理。代码和回执的最新哈希由本包 manifest 登记。

## 已确认投递后的点击恢复增量

- `show` 已确认之后的原生 `click` 现在把同一时间同时写入 `clickedAt` 与 `acknowledgedAt`，持久化后才发布原 outcome；投递结果仍是 `delivered`，不重发。此前仅有 `acknowledgedAt`，若应用宿主错过回调或原 Runtime 的已读写入失败，重开扫描会漏掉点击。
- 对已绑定原 `roundId` 且状态为 `acknowledged` 的旧记录，重开扫描可用既有 `acknowledgedAt` 作为兼容读回时间。原应用宿主继续核对内部通知 ID、原轮次和 banner attempt，再用同一个固定 operationId 对原 feed 已读；没有修改公共接口或 Runtime 投递终态。
- 新增三个真实本地 Runtime/SQLite + Fake notifier 用例，先在原点击包基线上得到“回调丢失”与“已读写入失败”两项失败，兼容旧记录单项也先失败。最小增量后，这三个用例及原端口、应用宿主、通知终态边界测试合计 30/30 通过。原点击包的 manifest-computed-v3.json 与日志不覆盖；本增量的前后回执和哈希另存于 `.cache/sol-notification-delivered-click-recovery-20261026/`。仍未发送真实 OS 通知或验收 Windows 冷激活。
