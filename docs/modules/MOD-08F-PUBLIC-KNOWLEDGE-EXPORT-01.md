# MOD-08F：公开演示知识的受限出机离线集成

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


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
