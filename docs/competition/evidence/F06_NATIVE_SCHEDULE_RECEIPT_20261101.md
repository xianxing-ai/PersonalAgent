# F06 未来提醒的真实 Windows 回执

2026-11-01 05:58:25 UTC，在 #531 集成树使用原 `f06-runtime-scenario.mjs`，只把设备接缝替换成生产 `createDesktopNotificationPort` 默认 Electron notifier。目标 profile 是 `huawei_ict_agentarts`。真实 Runtime、Engine、SQLite、ToolGateway、Policy、Todo 和原提醒调度器执行；云端、候选生成/选择、出机同意和审批响应仍是显式 Fixture，提醒正文为公开合成 `Original reminder`。

- 根 task `d21bed74-2e42-46b4-bfde-623231ae2cf1`，原 F06 子 task `b6ca5326-f8b6-466c-af01-684f55e23c20`。图完成时未来提醒已经落盘，尚未到期，设备发送次数为 0；子任务 `succeeded` 不代表已投递。
- 原 schedule `todo-reminder:6c0f54bd-f8cc-488b-9d8d-e7c132dc07d1:2026-11-01T05:58:25.166Z` 先为 `pending`。关闭并重开原 Runtime/宿主后，真实等待到原到期时间，复用原调度器投递，schedule 变为 `fired`，执行 task 为 `88f4a948-dfbd-4d59-b1fc-1f83834d2655`。
- Windows `Notification.isSupported()` 为 true。原 `show` 回执时间 `05:58:25.246Z`，设备及原 round 的 banner attempt 为 `delivered`。Todo revision 从 1 变为 2，reminder 为 `delivered`。
- 再次关闭、重开 Runtime/宿主并 tick，原 schedule/task、Todo revision 和设备回执保持不变；发送总数仍为 1，`userRead:false`。没有主动标记已读、补发或改动测试时钟。

原始记录 `.cache/pr531-f06-native-graph/receipt.json`，SHA-256 `844107d7c8eca22f7daa95761fb67d6b1760dbc92bd8d2a76091265d4fcf6c43`。SQLite、通知记录和隔离 Electron userData 保留在忽略目录，未提交 Git。GUI 可执行文件的 shell 返回码未用作通过依据；以上结果来自完成后的真实持久记录和原调用计数。

这里只验证 F06 未来提醒分支与真实 Windows 通道；不是 AgentArts 云整图、真实用户点击/听感、进程重启、操作系统重启或关机后云持续运行证据。原图仍明确 `verification=unverified`，不得据此合并 #531 或认定所有真实验收完成。
