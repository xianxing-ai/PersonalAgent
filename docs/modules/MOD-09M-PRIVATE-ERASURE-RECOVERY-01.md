# MOD-09M：独立私人库删除提交后的恢复

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

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
