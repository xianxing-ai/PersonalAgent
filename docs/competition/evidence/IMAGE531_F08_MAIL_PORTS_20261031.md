# #531 F08 真实语义邮件端口增量（2026-10-31）

目标 profile：`huawei_ict_agentarts`。工作树 `.worktrees/pr531-business`。本增量依赖首批业务端口 `fd9ad9e0`、原图绑定 `9a4f5414`、独立业务子任务桥 `3832fe30`（本分支桥副本 `ec146b96`）。没有修改 Main、通用 worker/bridge 或 F16/F17/F20。

## 已实现

- 公开 `mail.send` 与 `mail.archive` 注册、严格输入 Schema、独立 `mail:send`/`mail:archive` scope。只读 `mail.reconcile_send` 保留。新写工具不声明自动恢复或跨重启重发安全，幂等键绑定实际 child `runId`。
- SMTP 发送贯穿 deadline/cancellation；操作开始后的取消或异常保留原 Message-ID 和 unknown，进程内相同键重读原 Promise。跨重启不重放由 Runtime 原 child 记录负责。
- QQ 归档使用原生 IMAP MOVE，先检查 Archive 文件夹、MOVE/UIDPLUS 能力、原 UIDVALIDITY 和 Message-ID。写后必须确认源不存在、目标 UID 映射、目标 UIDVALIDITY 与 Message-ID。禁止库在缺 MOVE 时使用 COPY+EXPUNGE 回退；缺映射/读回或中断只返回 unknown。
- F08_N03 与 N07 通过独立 child Policy bridge 调用真实归档/发送；N07 记录原 task/run/messageId/idempotencyKey 并返回供 N11 使用的原身份。N12 只接受原 N11 已授权的 `mail.reconcile_send` 结果；未知保持 `RESULT_UNKNOWN`，不发送第二封邮件。
- Desktop F08 端口校验原 inbox item 的 account/folder/UID/UIDVALIDITY/Message-ID，并将发送、核实绑定到同一原始计划及持久 child。模型结果、已读或草稿均不构成发送/归档证据。

固定 bridge 映射为 `f08.mail.archive` → F08_N03 / workflow.host.f08_n03 / mail.archive，以及 `f08.mail.send` → F08_N07 / workflow.host.f08_n07 / mail.send。可信图输入包含 `archive` 或 `send` 原参数；归档要求显式 account，不能在核实阶段漂移到另一个默认账号。

## 本机验证

- Mail 与 Runtime 构建通过。
- Mail 全模块及实际 Runtime 业务链：63 项，61 通过、2 个既有真实账号门控跳过。
- 图/领域守卫与消费方：20/20。
- `npm run check:architecture` 通过（包括3项门禁测试）。
- 实际 Runtime/SQLite/Policy/ToolGateway + Desktop 端口 + 公开邮件工具的4项测试证明：外层图许可不代替发送/归档的 child 审批；拒绝 child 不到达 SMTP；unknown 保留原 child 不重发；归档只认可 MOVE 双向读回。SMTP/IMAP 服务和图输入是显式离线夹具，不是外部服务验收。
- 归档夹具覆盖旧 UID 世代、换输入、缺 MOVE 能力、缺 UIDPLUS 映射、错误目标 Message-ID、取消，以及 unknown 后不再 MOVE。SMTP 夹具覆盖取消前零调用、开始后 unknown 和同键不重发。

原始日志在本工作树 `.cache/pr531-business/f08-*.log`。首批 `fd9ad9e0` 的全量 check 6436 项零失败独立记录在 [首批证据](IMAGE531_BUSINESS_PORTS_20261031.md)，不能挪用为此后 F08 增量的整仓或最新集成验收。

## 尚未完成

- Main 共享 connector 工具白名单需由集成工作包加入 `mail.send`/`mail.archive`，继续原账号范围、精确参数提问卡与出机确认。当前模块注册本身不代表生产消费者已经开放。
- 每图 configured worker 的输入/前沿/完成条件和真实 pinned image 仍在接线工作包内；F08_N10/N13 继续要求原授权/原效果链，不用默认恒真回调。
- 未使用任何真实邮箱账号，没有真实邮件发送、归档或华为整图验收。没有账号或服务端能力时明确 unavailable，不能据此将 F08 或 #531 标为 done/可合并。
