# MOD-21：邮件连接器——QQ 邮箱（第一个提供商工作包）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 基本信息

- 关联需求：PA-014（P1 邮件管理——同步/分类/摘要/草稿中本包负责同步与动作）
- 当前 GitHub 负责人：`Potatos498`（2026-10-07 三人独立交付重置）
- 自审：模块负责人；可选同行评审：`goo122`，不作为交付前置
- 独占目录：`packages/connectors/mail/`（族入口）
- 历史工作包状态（原记录，不作为新 PR 审批门槛）：review（源码完成待评审；分支 `feat/mod-21-mail-qq`）

## 职责

同一实例多账号绑定（MailAccountRegistry：bind/unbind/按 accountRef 分发，游标与幂等键按账号隔离）；QQ 邮箱增量同步（IMAP，游标 uidValidity:lastUid）、邮件条目规范化（sensitivity private，不含正文）、mark_seen 与 send 动作（发送超时→unknown，先核对结果不盲重试）。

## 非职责

分类/摘要/草稿（MOD-04）、其他提供商（后续拆分）、凭据的持久化存储（桌面端 safeStorage）、通知（MOD-23）。

## 输入、输出与公共入口

- 入口：工具 `mail.inbox`（读，多账号时需 account 参数）与 `mail.accounts`（列出绑定）；ConnectorPort `fetchChanges/search/getItem/performAction`。
- 输入：账号游标/查询/动作；输出：邮件页（ConnectorItem）与动作结果（ConnectorAction，send 可能 unknown）。

## 依赖

- 前置模块：MOD-02（contracts）、MOD-05（权限宿主，接线归 goo122）。
- 允许依赖：contracts + 外部 `imapflow`/`nodemailer`（已按 fast-xml-parser 先例在 ROADMAP 登记，待 goo122 确认）。
- 禁止依赖：apps、其他内部包私有导出、凭据入库。

## 权限与数据

- Scope：`mail:read`（唯一工具）；`send`/`mark_seen` 经宿主授权链（ADR-0003）。
- 敏感数据：授权码（环境注入）；邮件条目 `sensitivity: 'private'`，不含正文。

## 验收

- Fake/离线：12 项（增量/去重/游标过期/幂等/超时语义/契约校验）。
- 真实条件：QQ 邮箱开启 IMAP/SMTP＋授权码后的 live 读回与发送（双开关门控），待执行后补记。

## 排除项与已知限制

见包 README「已知限制」（QQ 网络路径待 live、无 IDLE、客户端搜索、文件夹 uidValidity 占位）。
