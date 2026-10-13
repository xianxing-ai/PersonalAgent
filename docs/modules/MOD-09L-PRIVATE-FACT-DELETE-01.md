# MOD-09L：独立私人记忆逐条删除

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；需求：PA-020、PA-024。
- 负责人：`goo122`；Desktop 消费面非作者评审：`zemeng`。
- 基线：MOD-09K / 集成 PR #209；状态：`in_progress`。

## 范围与验收

管理后台可分页列出 `desktop-private` 当前事实，不依赖原 Vault 仍在本机。
删除仅从管理窗口主框架发起，受信主进程读取当前事实，在原生对话框展示摘要、
来源和删除范围。取消、旧 revision 均不写入。确认后复用 Memory 的
`eraseUnboundFact`：删除全部事实版本、创建/修订回执和受影响查询快照，
保留其他事实；成功截断 WAL 后重新读取当前与历史，只有两者均空才返回成功。
旧快照和精确版本读取不得恢复已删除内容。删除不改变 Vault 原文件，也不
向 AgentArts 发送内容；原来源仍在时，删除标记也阻止同一事实被悄悄重新导入。
主进程不开放新的 wire capability。

合成测试覆盖拒绝确认、旧版本、旧快照、无关事实和超过 20 条的分页；
Electron 窗口测试覆盖原生取消/确认与非管理窗口 IPC 拒绝。

## 尚未完成

真实 Vault 写入仍关闭。本应用当前未创建 `private-memory.sqlite` 的独立备份，
但尚未建立未来应用管理备份的登记与删除机制；MOD-09M 补独立库
checkpoint 提交后失败的合成跨重启恢复，仍不会报告用户级删除完成。Runtime 公共事实的跨库、
其他图库和自由文本来源问题不由本片解决。私人库不能替代整个 MOD-09 验收。
