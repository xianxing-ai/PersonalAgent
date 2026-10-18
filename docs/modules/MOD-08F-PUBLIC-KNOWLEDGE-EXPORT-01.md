# MOD-08F：公开演示知识的受限出机离线集成

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-15）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。每个 PR 需 goo122、zemeng5208、Potatos498 中任意一位非作者对当前提交的有效批准，并满足必要检查、冲突及未解决意见门槛；三人跨 PR 均衡承担评审与合并，禁止强制合并或管理员绕过。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`
- 负责人：`goo122`；非作者评审：`zemeng` 或其他已登记协作者
- 状态：`review`；离线集成测试完成，待非作者评审；真实云验收另行执行
- 基线：`main@63703ae`；复用已合并的 `knowledge.search` 与 Competition 受信出机端口

## 本片边界

可信测试宿主显式注入仓库自编的公开演示 Vault、`knowledge.search` 和
`competitionToolExports`。出机许可只匹配固定的提案 ID、工具版本、公开查询和
`limit=1`；投影仅保留选定公开来源的相对路径、行号、版本和固定摘录。
默认没有出机许可。云端提案、本地工具结果和引用均不能自行扩大许可。

集成测试验证：标记为 `unverified` 的提案先进入本地审批；批准前不读 Vault，
批准后仅检索一次并把裁剪结果送入 Fake continuation。另以注入的离线 HTTP
响应验证 AgentArts JSON 提案适配器的两次 invocation：第二次请求仅含已确认的
公开来源引用和摘录。改为私人查询时，在审批、检索和出机前以
`UNAUTHORIZED` 拒绝。此处的一次性本地审批与
受信宿主配置是两个不同门禁，不能用其一代替另一项。

## 验证与后续门槛

- `node --test --test-isolation=none tests/integration/knowledge-search-competition.test.mjs`：6/6 通过。
- `npm run check`：通过架构、契约、生成类型、全部 workspace 构建/类型/测试和根集成 14/14。
- 测试使用公开资料、临时 SQLite、Fake Coordination/HTTP 响应；不调用真实 AgentArts、
  不读取私人 Vault，也不证明云端工具闭环。
- 生产装配尚未注册知识工具或出机许可；需与 Desktop/AgentArts 负责人评审可信
  composition、用户选库和独立云端发送同意后才能扩展到真实私人资料。
- 真实公开资料链路仍需经用户授权运行：核对部署/版本，观察真实提案、审批、
  本地执行、出机裁剪、第二次云调用和最终回答/trace；失败不得静默回退 Local。
- 本片不创建新 wire capability、数据库迁移或默认开启的知识访问。
