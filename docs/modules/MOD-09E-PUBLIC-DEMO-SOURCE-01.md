# MOD-09E：公开演示资料到持久事实的离线来源首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`
- 负责人：`goo122`；状态：`done`（仅本片离线验收；PR #118 已获批准并于 2026-09-25 合并）
- 基线：`main@4efa7f6`；依赖已合并的 MOD-08E、MOD-09C/09D

## 最小边界

仅在显式集成测试中绑定仓库自编公开 Vault 的临时副本，读取固定检索命中并按
精确 revision 再读来源行。测试宿主为这条虚构资料显式给定事实 ID、
观察时间和有效期；这些时间**不是**由 Markdown 自动推断。来源引用保留
Vault ID、相对路径、行号和文件哈希，不保存本机绝对路径。

测试宿主把这条 `public` 事实写入专用 SQLite Memory，再通过现有
`FactChangeFeedPort → createMemoryProjectionApplication` 完成确认后投影；
再在临时副本上修改公开文字：旧引用因哈希变化被拒绝，新摘录以 `corrects`
指向旧 FactRef，投影保留同一 Goal node ID 并增加版本。重启后检查两个精确
FactRef、Goal 节点和待影响记录。仓库原演示文件不被改写。

## 不宣称

- 没有默认注册 Runtime capability、自动扫描/采集、来源游标、通用解析器或账号接入。
- 同一事实重复直接调用现有 `append` 会被拒绝，且不新增 feed 事件；
  这不是自动导入的幂等成功语义。真实采集必须另行绑定来源 revision 与重试游标。
- 没有读取私人 Vault/日历，也没有向 AgentArts、模型或网络发送资料。
- 这不是 MOD-09 的真实个人事实来源验收，更不是修正/删除和保留策略。
- 若要接真实来源，需另行确定账号授权、来源修订到 FactRef 的幂等映射、
  并发重试、用户修正/撤回、删除与备份处理；不能直接用测试宿主替代。

## 验收

- 离线集成测试应覆盖来源 revision 读回及失效、重复写入拒绝、事实修正、
  SQLite feed/Goal 精确投影和重启保留。
- `npm run check`、`git diff --check` 通过；真实服务测试保持未执行。

## 已执行验证

- `node --test --test-isolation=none tests/integration/public-demo-memory-source.test.mjs`：1/1 通过。
- `npm run check`：通过架构、契约、生成类型、全部 workspace 构建/类型/测试及根集成 12/12。
- `git diff --check`：通过。以上均为本机离线结果，非真实个人数据或云端验收。
