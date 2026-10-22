# 真实日程修改：原桌面对话、AgentArts 与独立 CalDAV 读回

Competition Profile，主工作树 `D:/worktree/f809/PersonalAgent`，分支 `codex/autonomous-change-loop`。
公开派生回执见 [JSON](CALENDAR_REAL_UPDATE_20261022.receipt.json)，保留实际入口源码哈希。

使用真正的 Radicale 3.8.3，本机回环随机端口、专用公开账号及每次全新集合/UID。
原桌面隔离配置只复制已授权的加密 AgentArts 配置与 Local State；通过原设置界面配置测试日历。
不复制用户历史、不读取私人日程、不使用 Fake Provider/模型、不直接调用工具执行或签发 Policy grant。

| 实际入口 | 原授权卡 | 原父/子任务 | 独立服务读回 |
| --- | --- | --- | --- |
| 受限模式，公开日程修改 | 1 张；工具、连接器、结果出机合并；决定后 DOM 移除 | succeeded / succeeded | 精确 UID、标题、起止时间符合；强 ETag 改变、SEQUENCE +1；关闭桌面后再次 GET 不变 |
| 完全访问，同一类型操作的另一新 UID | 0 张；DOM MutationObserver 从未观察到审批卡 | succeeded / succeeded | 同上；只有一次原 confirmed calendar.update |

两例均具有真实 AgentArts 请求和结果续接身份、原 `calendar.update` 的 confirmed / allow /
executionStarted 回执，以及父任务中的原执行证据。没有 pending 或 waiting_reconciliation。

原始本机目录分别为 `.cache/desktop-calendar-update-live-NK350p/` 和
`.cache/desktop-calendar-update-live-mtyvPg/`。JSON 仅发布公开测试事件及必要执行元数据，
不发布加密配置、凭据或整个 SQLite。测试账号和集合只属于本机验收；不是用户私人日历恢复声明。

保留两次前置失败：首个真实 PUT 因 Windows 路径过长返回 500，改用短测试存储及集合路径后恢复；
下一次实际父子任务已成功，但 runner 错误要求 dispatch 必须额外审批。原 dispatch 的 Policy 本来无需
用户卡，因此改成必需一张合并 calendar.update、仅允许可选一张 dispatch，并用新集合/UID复测。
没有给生产增加审批，也没有覆盖或重放旧操作。

当前原 Runner 是 `tests/manual/connectors/desktop-calendar-update-live.cjs`。正常请求没有停留待核实，
不表示真实结果未知的写入也可以直接改成成功；未知写入仍需原执行核实。
