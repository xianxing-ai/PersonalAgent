# P5 通知宿主生命周期交接

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 工作包：P5-NOTIFICATION-LIFECYCLE；profile：`huawei_ict_agentarts`；状态：review。
- 负责人：zemeng；非作者评审：goo122 或 Potatos498；main 接线：P8。
- 工作树：`.worktrees/p5-notification-lifecycle`；分支：`codex/zemeng/p5-notification-lifecycle`。
- 基线：PR #245 / `6ae2bda16235cf307b65410de62e4b3cff3a8e2a`。
- 独占文件：`electron/p5-device-notification-host.js`、其专属测试和本文。
- 不修改 P5 算法、composition、设备遥测来源、main/preload、公共协议、依赖或数据格式。

当前基线已接通 Runtime 已完成采样的可信读回 → 设备遥测订阅 → P5 多候选/Laya
→ 现有提醒回执存储 → 面板建议卡片/原生 Notification。缺口是停止订阅后，通知宿主
仍等待系统回执，迟到回调可能继续消费认知反馈。该包补生命周期，复用
`p5-device-receipts.json`，不引入 #238 的第二份投递事实库。

## 稳定输入与回执

构造输入保持 `Notification, store, readProvenance, isActive, onUpdate, onLateOutcome, timeoutMs`。
`store` 使用现有 `addNotification/recordDelivery`；`readProvenance(notification)` 只能由
可信采样来源提供。`isActive()` 由 P8 绑定订阅、认知运行状态和监控授权，不由模型控制。
通知输入保持 `id/source/timestamp/title/message/advice/candidateId`，没有新增 wire operation。

`sendAdvisoryNotification()` 等待系统 `show` 才返回 `{delivered:true}`；明确 failed 或
尚未调用 show 就失去授权返回 `{delivered:false}`。已调用 show 后的超时/停止/撤销
保留 unknown 并拒绝 Promise，供 P5 保留 `pendingDeliveryId`，绝不据此自动重弹。
同 ID 输入冲突仍由现有 store 拒绝；在途同 ID 复用等待，unknown 重启后仍需核实。

卡片保存（persisted）、等待系统回执（pending）、系统 show（delivered）是不同事实；
没有用户阅读回执（user-read），不能从系统 show 推断已阅读。`show` 与 `failed` 均解绑
对方监听器；活动会话内的迟到系统回执可以通过原有 `onLateOutcome(source,id,delivered)`
核实。停止、撤销或 dispose 会抑制已排队但尚未调用的认知核实回调。

## P8 唯一 main 挂载补丁

在现有 `stopP5DeviceTelemetry()` 中，将订阅句柄置空之后、第一次 await 之前加入：

```js
const subscription = p5DeviceTelemetrySubscription;
p5DeviceTelemetrySubscription = undefined;
p5DeviceNotificationHost?.stop();
// 继续原有 unsubscribe / p5Cognition.stop()。
```

`stop()` 同步将所有在途通知记为 unknown，拒绝等待、清除定时器、解绑原生监听器并尝试
关闭本宿主创建的通知。关闭不是未投递证明；不触碰其他窗口、应用或系统安全设置。
该方法幂等，不创建第二个启停开关；重新授权并恢复现有订阅后，`isActive()` 允许新的
通知意图，旧 unknown 仍不重发。退出继续调用现有 `dispose()`，永久禁用宿主。

P8 重新启用监控时，应在 `startP5DeviceTelemetry()` 绑定订阅之前 await 现有
`reconcileDeviceDeliveries()`；基线目前仅在装配时调用它。若 show 在停止前已保存 terminal
回执、但认知核实回调被停止拦住，恢复时只消费 store 已确认 delivered/failed 的
`pendingDeliveryId`，再读回 `readDeviceFeedback()`。unknown 不作推断、不清空也不重发。
`reconcileDeviceDeliveries` 当前位于装配局部作用域；由 P8 串行调整可见性并接线，
该包不编辑 main。

## 最小验证与限制

运行 `node --test apps/desktop/test/p5-device-notification-host.test.mjs`，覆盖异步回执、
在途去重、unknown/重启、stop/恢复、撤销、dispose、迟到 failed 和排队回调隔离；
运行宿主 `node --check` 与 `git diff --check`。
本包实测：上述专属测试 10/10 通过，语法检查和差异检查通过。
仅使用显式 Fake Notification 和隔离临时回执；无需安装依赖或启动模型/桌面。
真实 Windows 通知、真实 Laya/遥测、P8 main 挂载和整体比赛链留给统一验收，未据此
升格接口或宣布 MOD 完成。非作者批准、准确 head CI 和合并由 PR 专线协调。
