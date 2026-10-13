# MOD-08F：公开演示知识的受限出机离线集成

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

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
