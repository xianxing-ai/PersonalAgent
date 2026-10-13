# @personal-agent/mail

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

MOD-21 · 邮件连接器——QQ 邮箱提供商工作包（PA-014，P1）。负责人 `Potatos498`，评审者 `goo122`。

## 2026-09-30 云端业务增量（待本地统一验收）

本轮完成源码和离线用例，未运行新增测试或真实邮箱调用，状态为 provisional。
精确接线、统一验收入口和越界交接见 [cloud-business-handoff.md](docs/cloud-business-handoff.md)。
历史实测不证明本次修改通过真实验收；当前云端没有配置真实邮箱账号。

- 新增 mail.mark_seen（mail:write）、mail.save_draft（mail:draft，条件注册）和
  mail.reconcile_send（mail:read，条件注册），返回已有公共 ConnectorAction。
- 草稿使用 IMAP Drafts APPEND、内存 MIME 和 Message-ID 读回，不调用 SMTP；unknown 不自动重写，
  recoverySupport=false，跨重启输入绑定和未知动作阻断由 Runtime 持久记录负责。
- QQ SMTP 在发送前生成稳定 Message-ID，未知结果也保留为 externalId。reconcileSend 只读 Sent，
  先核对原幂等键与原记录或稳定 Message-ID 的绑定，再核对精确 Message-ID；任意 A 邮件＋B 键
  返回 INVALID_ARGUMENT，缺绑定能力返回 UNSUPPORTED_CAPABILITY。没找到仍 unknown，不据此盲重发。
- mark_seen/save_draft 的可选 MailOperationContext 从工具贯穿 Service/Registry/QQ，携带真实
  signal/deadline；所有写前异步准备步骤返回后与 STORE/APPEND 前检查 CANCELLED/TIMEOUT。
  已开始的写入继续读回：APPEND 未知保持 unknown 且同键不重写；STORE 未核实返回
  RESULT_UNKNOWN（不可重试），成功读回不因稍后取消而伪称未执行。
- fetchInbox 按 UID 排序、校验进度和 epoch、由页补齐 UIDVALIDITY；工具取消信号传到读取端口。
  IMAP 有 30 秒连接/问候/空闲限制，取消在返回前拦截；不承诺在途命令立即取消。
- 完整 dedupeKey 以源码为准：accountRef:uidValidity:folder:uid:messageId，而不是下面旧简写。

## 职责

- **多账号绑定**：`MailAccountRegistry` 支持同一实例绑定多个邮箱（bind/unbind/按 `accountRef` 分发；重复 bind 同 ref 为换绑）；凭据的持久化与加密存储归宿主（桌面端 safeStorage 模式，参照既有 Pangu API Key 设置），本包只在运行时持有已构造的提供商实例。
- 邮件增量同步：游标 `uidValidity:lastUid`，只返回 UID 更大的新邮件；`uidValidity` 变化（文件夹重建）→ `CURSOR_EXPIRED`，需从头同步（与 feeds 同规则）。
- 条目规范化（`ConnectorItem`）：`occurredAt` 取邮件 Date 头的 UTC 瞬间（缺失回退抓取时刻并在 `contentRef` 标注）；**`sensitivity: 'private'`（邮件内容敏感，条目只含发件人/收件人/主题/已读状态，不含正文）**；`dedupeKey = folder:uid:messageId`。
- 动作：`mark_seen`（幂等，本地化确认）；`send`（外部写，见下）。

## 非职责

- 分类、摘要、草稿内容生成由 P5/模型消费层完成；连接器供信头投影、已读动作和草稿保存，不做分类决策。
- 其他邮箱提供商（IMAP 通用化、Gmail/Outlook）：后续按提供商拆分工作包。
- 授权码的获取与存储：用户在 QQ 邮箱设置生成授权码，装配层经环境变量注入（`PA_QQ_MAIL_USER` / `PA_QQ_MAIL_AUTH_CODE`），不进仓库、不进前端快照。

## 发送语义（PA-014：发送需对应授权；超时先核对结果）

- `send` 是外部写，`scope` 由宿主授权链控制（ADR-0003）。
- **超时不等于失败**：SMTP 超时/连接中断映射为 `state: 'unknown'`——邮件可能已发出。证据链标注 `unconfirmed`，消费方必须先到已发送文件夹核对结果，**不得直接重发**。
- **幂等键防重发**：同一 `idempotencyKey` 的重放返回先前结果（含 unknown），不会产生第二次发送；换输入复用同一键 → `INVALID_ARGUMENT`。

## 公共入口

`src/index.ts` 导出 `register`、`MailConnector`、`MailService`、`FakeMailProvider`、`QQMailProvider`、`messageFromImap`/`messageToItem`、游标编解码与全部类型。

### 工具

| 工具 | 版本 | Scope | 副作用 | 幂等 | 恢复 |
| --- | --- | --- | --- | --- | --- |
| `mail.inbox` | 0.1.0-alpha.1 | `mail:read` | read | ✓ | ✓ |
| `mail.accounts` | 0.1.0-alpha.1 | `mail:read` | read | ✓ | ✓ |

`register(host, {provider, accountRef?, registry?, now?})`：`provider` 必填（缺失抛 `INVALID_ARGUMENT`，Fake 仅测试用），作为默认账号绑定（`accountRef` 缺省 `local`）；可传入宿主维护的 `registry` 实现多账号。入参 `account`（绑定多个账号时指定，可用 `mail.accounts` 查询；只绑一个或存在显式默认时可省略——默认账号被解绑且剩多个账号时省略会报 `INVALID_ARGUMENT` 并列出可选项）、`cursor`（按账号隔离）、`limit` 1..100（默认 20）、`folder`（默认 INBOX）。

### 连接器（ConnectorPort）

manifest：`id=mail`、`accountTypes=['qq']`、`capabilities=['fetchChanges','search','getItem','performAction']`、`authentication='password'`（QQ 授权码）、`syncStrategy='incremental'`、`verification`＝Fake `mock` / QQ `conditional`。未 `connect()` 前数据方法抛 `UNAUTHORIZED`；不支持的动作抛 `UNSUPPORTED_CAPABILITY`。

## QQ 真实提供商（imapflow + nodemailer）

- **读侧 IMAP**：`imap.qq.com:993`（SSL），LOGIN 用完整邮箱地址＋授权码；`UID SEARCH uid:N:*` 增量、`FETCH ENVELOPE+FLAGS` 取元数据、`UID STORE +FLAGS.SILENT (\Seen)` 标已读。
- **写侧 SMTP**：`smtp.qq.com:465`（SSL），`AUTH LOGIN`；`socketTimeout` 取发送超时参数。
- 新增外部依赖 `imapflow@1.7.8`（MIT）与 `nodemailer@10.0.0`（MIT-0）：真实账号集成需要协议正确的客户端，自写 TLS 协议栈未经真实验证风险更高；`fast-xml-parser` 已有获批先例。归 `goo122` 评审确认。
- 网络错误映射：认证失败 → `UNAUTHORIZED`（不可重试）；超时 → `TIMEOUT`（可重试）；连接类故障 → `EXTERNAL_FAILURE`（可重试）。

## 重启与恢复

- **发送记录由 Runtime（宿主）持久化**：本包不落盘。宿主按 `actionId`（`mail-send:<幂等键>`）与 `evidenceRefs` 保存动作证据；`state: 'unknown'` 进入**核实状态**——到已发送文件夹核对结果后再决定重发（换新幂等键）或放弃，不自动重发。
- 进程内的幂等表（并发单飞 + 输入绑定）随实例存活；跨重启的正确性由「宿主持久化的 actionId」+「同键同输入重放安全」共同保证。
- 读侧游标由宿主持久化；重启后从上次游标继续增量，uidValidity 变化按 `CURSOR_EXPIRED` 从头同步。

## 取消、超时与重试

读侧由宿主 `ToolContext.signal`/deadline 门禁；markSeen/saveDraft 增加可选第三参数
`MailOperationContext`（signal、deadline、受信 now），旧的无 context 调用保持兼容。注册工具使用
真实 ToolContext，并沿现有注册表转发。写前拒绝取消或过期；已开始的外部写按读回/unknown
处理，不因取消改报未执行。此检查不承诺中断在途 IMAP 命令。写侧超时语义见上（unknown，不盲重试）。

## 测试

`node --test test/*.test.mjs`（14 项，12 离线 + 2 门控 live）：游标编解码与畸形拒绝；增量分页三页取尽＋同游标零重复＋跨页去重；条目语义（Date 头/缺失回退/`private`）；uidValidity 轮换 → `CURSOR_EXPIRED`；mark_seen 幂等且生效；发送确认与同键重放不重发；**超时 → unknown → 同键核对仍 unknown 不盲重发**（PA-014 核心）；输入校验；搜索与单条；连接器全链路；`messageFromImap` 边界；工具 schema/scope。

真实读回（门控，需授权码）：

```sh
PA_MAIL_LIVE=1 PA_QQ_MAIL_USER=<QQ邮箱地址> PA_QQ_MAIL_AUTH_CODE=<授权码> node --test packages/connectors/mail/test/
# 真实发送（会发一封测试邮件，独立开关防误发）：
PA_MAIL_LIVE=1 PA_MAIL_LIVE_SEND=1 PA_QQ_MAIL_USER=… PA_QQ_MAIL_AUTH_CODE=… PA_QQ_MAIL_TO=<收件地址> node --test packages/connectors/mail/test/
```

**真实读回证据（2026-09-13）**：用户 QQ 邮箱开启 IMAP/SMTP 并提供授权码后执行上述命令，`22/22` 全过（0 失败 0 跳过）——只读读回（真实 IMAP 列文件夹＋拉 5 封、uidValidity 捕获）与真实 SMTP 发送（自发自收一封验证邮件，SMTP 返回 messageId，`state: 'confirmed'`）均成功。imapflow/nodemailer 与 QQ 服务器的协议对接得到生产端点验证；`verification` 维持 `conditional`（网络依赖型提供商的诚实标注，不因一次读回翻转）。

**复跑证据（2026-09-30，新授权码）**：用户重新生成授权码后（凭据仅入本地 `.pa-secrets`，不进仓库/聊天记录归档），`PA_MAIL_LIVE=1` 只读读回复跑 **23 项 22 过 0 失败 1 跳过**——跳过项为真实发送（`PA_MAIL_LIVE_SEND` 独立门控，未开启）。即：真实 IMAP 列文件夹＋拉信＋uidValidity 捕获在新凭据下通过；SMTP 发送链路未用新码复验（旧证据为 2026-09-13，发送语义 unknown→先核对不盲重发不受影响）。

## 已知限制

- `QQMailProvider` 真实网络路径已于 **2026-09-13** 完成门控验证（22/22 含 SMTP 发送），**2026-09-30 用户新授权码复跑只读读回通过**（23 项 22 过 1 跳＝未开启的真实发送，见上方证据段）——当前凭据有效、条件性可用；SMTP 发送未用新码复验，需要时经 `PA_MAIL_LIVE_SEND=1` 独立开启并明确收件地址。协议映射逻辑（envelope→条目、游标、错误映射）离线固定。
- QQ 邮箱 IMAP 有连接频率限制，连接为惰性单例（复用直至不可用）；无 IDLE 推送（增量靠游标轮询，调度建议由宿主给出）。
- 搜索为客户端过滤（拉全量窗口后按主题/发件人匹配），未用 IMAP SEARCH；大邮箱应改服务端搜索。
- 文件夹列表的 `uidValidity` 仅在 `fetchPage` 打开邮箱时可得，`listFolders` 返回 0 占位。
