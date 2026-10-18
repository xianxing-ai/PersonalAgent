# MOD-09L：独立私人记忆逐条删除

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

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
