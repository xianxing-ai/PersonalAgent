# F12 显式多项通知批次增量

目标 profile：`huawei_ict_agentarts`。本增量补齐既有通知队列的显式多项分支，不增加队列、调度器或授权层。

## 方案与兼容

原请求 `{itemId,trigger}` 保持兼容，新增互斥的 `{itemIds,trigger}`；多项 ID 必须显式、唯一，不能由模型或待投递队列悄悄追加。N02/N05 读取与 N04 投递参数携带相同选择。旧单项结果不变，新多项结果回传全部原 ID。配置版本为 `business-20261101-f12-v2`，Schema 摘要随之改变，原在途图不得借新配置恢复。

准备阶段只读绑定每个原 active/unread feed 条目、同一 scope 及原策略。只有原 N04 写入审批通过后才消费现有 drain；仅当可用 ready batch 的完整并集精确等于已绑定 ID 集时，原 CAS 预占一个 round 并投递一条本机数量摘要。批次不完整、含额外条目或条目/策略变化均拒绝，保留队列事实。每项都核对原来源、期限、已读/撤回状态与原设备持久回执；未知结果不重发。

## 验证状态

Runtime 构建通过。实际 F06/F07/F08/F11/F12 图引擎、工厂及 F12 原端口回归 **63/63**；原 notification application、NotificationService 与 optional Runtime hosts **45/45**；架构门禁 **3/3**、diff 检查通过。F12 新增覆盖显式选择的互斥/唯一性、一个合并 batch、两个 ready batches 共用一个 round、多项只读摘要、额外未批准项/跨 scope/参数替换拒绝、第二项撤回、取消、策略变化、第二项在最终许可期间已读，以及 unknown 跨第二个图不重发。全仓 check 由根统一集成执行，本增量未另跑。

日志位于本工作树 `.cache/pr531-business/f12-batch-build.log`、`f12-batch-final.log`、`f12-batch-ports.log`、`f12-batch-architecture.log`；首轮未抽取设备入口前的 28/28 也保留在 `f12-batch-runtime.log`。真实用户归来事件、语音渠道、正式 F12 的 OS/云整图与评测仍独立跟踪；不把 Fake 设备通道当真实 Windows 设备或华为云证据。

## 真实设备接续入口

原实际图 fixture 抽取为 `apps/desktop/test/fixtures/f12-runtime-scenario.mjs` 的 `scenario(t,options)`。`t.after(fn)` 收集清理函数，`options.multi:true` 选择两条公开合成通知；注入 `options.createChannel({getApplication,userData})` 返回现有真实 Electron 设备通道即可，不另造 Runtime、审批、队列或投递路径。返回值含原 application、notification host、sent 参数、原任务状态与隔离 SQLite 位置；调用方须在读取原 round/evidence 后执行收集的清理函数。

没有注入时仅使用测试 Fake；明确传入却缺少原 `sendAdvisoryNotification/readDeliveryOutcome` 方法时拒绝，不回落为 Fake。注入实际设备仍只改变设备证据：候选、selector、云传输与外层出机许可依旧为 Fixture，原问题卡由夹具逐卡回应，不能表述为真实模型/云整图或真实用户手动批准。Main 无新增回调，重建 Runtime 后原工厂即可公开新 Schema；真实设备运行由根集成串行执行，当前增量未额外弹出通知。
