# P1 邮件 → P5 分类 分页与身份映射契约（provisional）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 登记号：MOD-22B-MAIL-P5-PAGINATION-01（#228 日历契约的姊妹篇）；登记日：2026-09-30。
- 负责人：P1 原语 `Potatos498`（`@personal-agent/mail`）；消费 `zemeng`（P5 `packages/cognition` 邮件分类）。
- 状态：`provisional`——固定双方当前消费的名称与语义；升格 `frozen` 需两侧非作者评审。
- 依据：POTATOS-MVP-TASKS-20260930 §5（P1-B）与既有实现（`MailService.fetchInbox`、`LayaTriageMessage`）。

## 1. 职责边界

P1 提供账号页域、版本化条目、增量游标与动作端口；**分类决策、标签、断点持久化由 P5 负责**
（P5 内部分类断点语义已由 #224 固定：页内瞬态结果不推进持久游标）。P1 不做关键词分类、
不替 P5 判断高影响。

## 2. P5 分类输入映射（`LayaTriageMessage` ← 连接器字段）

| P5 字段 | P1 来源 | 语义与约束 |
| --- | --- | --- |
| `source` | `accountRef` | 账号引用。**同账号不同文件夹是不同页域**（`externalId` 自带 folder 前缀），P5 应按页域分开消费与断点 |
| `messageId` | `externalId` = `folder:uid` | 页内稳定标识。**不是** RFC `Message-ID`（它只是 `dedupeKey` 的尾段佐证），**也不是**裸 IMAP UID——三种身份不混用 |
| `sourceRevision` | `String(uidValidity)` | 邮箱 epoch 修订。参与 P5 缓存键 `makeKey(source, messageId, sourceRevision)`：epoch 轮换后旧键自然失效（重新分类），不会撞旧缓存 |
| `text` | `contentRef`（`发件人 → 收件人｜已读/未读｜主题`，无 Date 头时附「取抓取时刻」标注） | **信头投影，不含私人正文**。按消费契约截 4000 字符；`contextDigest = sha256(text)`（#224 完整性校验） |
| `highImpact` | 宿主规则可选注入 | 连接器不生成 |

完整去重身份（P1 侧）：`dedupeKey = accountRef:uidValidity:folder:uid:messageId`——
`messageId`（P5 语义）与 `sourceRevision` 成对使用才跨 epoch 安全。

## 3. 游标协议（`uidValidity:lastUid`）

- `InboxPage.nextCursor` 是字符串 `"{uidValidity}:{lastUid}"` ↔ P5 侧 `{uidValidity, lastUid}`
  （按 `:` 拆分两段非负整数）；回传 `fetchInbox(accountRef, {cursor: {uidValidity, lastUid}, limit})`。
- **增量语义**：只返回 UID 更大者（IMAP UID 序，**不是** Date 头时间序）——P5 需容忍乱序到达。
- **epoch 轮换**：`uidValidity` 变化 → 提供商抛 `CURSOR_EXPIRED`。P5 必须**从头重建同步**
  （丢弃旧断点与旧 `sourceRevision` 缓存域），不得复用旧邮箱断点。
- 服务层保证：`nextCursor` 只推进到**实际返回**的最后一条（聚合超额取回的条目留在游标之后，
  不漏邮件）；P5 只在页结果持久化后才推进自己的检查点（#224 已固定）。
- `hasMore=true` 时继续用 `nextCursor` 取下页；`limit` 1..100（默认 20）。

## 4. 动作边界

- `mark_seen`：幂等本地副作用。
- `send`：**外部副作用**。超时/未知 → `state: 'unknown'`，先到已发送文件夹核对再决定重发
  （换新幂等键）或放弃；同幂等键重放返回先前结果，不盲重发（PA-014）。
- 草稿等其他动作未在首版范围，显式 `UNSUPPORTED_CAPABILITY`。

## 5. 账号与凭据现状（如实）

- 真实链路证据：2026-09-13 用户 QQ 邮箱门控读回 22/22（IMAP 列文件夹＋拉信＋uidValidity 捕获、
  SMTP 自发自收 `confirmed`）。2026-09-30 用户新授权码下只读复跑 23 项，22 过、0 失败、1 跳过；
  IMAP 读回通过，跳过项为独立门控的 SMTP 发送，因此新授权码下 SMTP 尚未复验。
- `verification: 'conditional'`（网络依赖型）；这些有限读回证据不改变条件状态。

## 6. 非目标

P1 不提供：正文拉取/上传、IDLE 推送（增量靠游标轮询）、服务端 IMAP SEARCH（现为客户端过滤）、
分类断点存储。Runtime/ConnectorHost 装配归共享集成槽（P8）。
