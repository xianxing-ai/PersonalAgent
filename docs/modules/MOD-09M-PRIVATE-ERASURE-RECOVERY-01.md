# MOD-09M：独立私人库删除提交后的恢复

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；需求：PA-020、PA-024。
- 负责人：`goo122`；依赖 MOD-09L；状态：`in_progress`。

## 范围与验收

Memory 受信 SQLite 宿主复用不含正文的已完成删除标记，检查目标事实、公开来源
及用户创建/修订回执均已消失后，重试 `TRUNCATE` WAL checkpoint。旧读者阻塞时
返回 `STORAGE_UNAVAILABLE`，不能把事务提交当作最终删除成功。

Desktop 独立私人控制器在首次打开已有库时执行维护；若本次删除在提交后报错，
后续读取或写入前重试。合成测试在旧读者持有事务时注入 checkpoint 失败，
关闭并重开宿主仍拒绝读取，释放读者后恢复列表，目标事实不再出现且无关事实保留。
没有第二份保存私人正文的恢复日志，也没有新 wire capability。

## 边界

本片只恢复 `desktop-private` 使用的已提交单库删除；Runtime 公共事实的
`pending` 跨库意图、其他图库、自由文本来源和应用管理备份不由此完成。
真实 Vault 的持久写入仍禁用；用户级彻底删除和 MOD-09 完成状态仍未验收。
