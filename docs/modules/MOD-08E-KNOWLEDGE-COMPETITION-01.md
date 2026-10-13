# MOD-08E：知识工具的 Competition 离线集成

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 关联需求：PA-008、PA-023
- Profile：`huawei_ict_agentarts`
- 依赖：已合并 PR #93～#97；现有 Runtime Application、ToolGateway/Policy 和 FakeCoordinationPort
- 分支：`codex/mod-08e-knowledge-runtime`
- 负责人：`goo122`
- 评审者：`zemeng` 或其他已登记非作者协作者
- 状态：`done`（仅本片离线验收）；PR #98 已经非作者批准并合并到 `main`

## 本片交付

- 使用现有 `RuntimeApplicationOptions.tools` 显式注入 `knowledge.search`，不增加第二套工具入口、公共 wire 操作或迁移。
- 在[仓库自编公开演示资料](../demo/knowledge/README.md)及临时合成 Vault 上验证 Fake Competition 提案 → 本地审批 → 一次性只读检索 → Fake continuation；引用保留 Vault ID、相对路径、行号与摘要，不传本机绝对路径。
- 审批拒绝时任务取消，检索次数为零且没有 continuation；重复审批不会重新检索。
- 本片测试未配置真实提案出机许可：`unverified` 提案被拒绝，检索次数为零、无审批和出机结果。

## 未启用与后续门槛

本片没有 Desktop/Runtime 默认注册、可安装 Obsidian 插件、用户选库或撤销流程，
没有读取真实私人 Vault，也没有向 AgentArts 发送私人内容。Fake continuation 只用于
离线验收，不能证明真实云端知识能力。后续 PR #103/#101 已提供显式 opt-in 的
AgentArts JSON 提案和受限结果出机投影，但本片没有为 `knowledge.search` 配置该边界，
也没有完成真实知识工具闭环；后续接线须由 `zemeng` 与 Runtime 共同评审。

生产接线前需先评审用户选库/范围授权与独立的云端发送同意、内容裁剪和撤销语义；
本地 `knowledge:read` 审批不能代替出机授权。信任边界方案确定后再修改 Runtime/宿主，
并分别验收真实 Vault 与 AgentArts。MOD-08 整体仍为 `in_progress`。
现有 Runtime 还会持久保存工具结果与 Competition continuation，私人摘录的本地保留方案
同样必须先确定；见[ADR-0009 提案](../adr/0009-knowledge-data-boundary.md)。

## 验证

- `node --test tests/integration/knowledge-search-competition.test.mjs`：3/3 通过，仅合成数据。
- 架构门禁 3/3、协议夹具 4/4、生成类型检查、全部 workspace 类型检查、workspace 测试和根集成测试 11/11 分别通过。
- 本地 `npm run check` 尚无稳定完整通过记录：一次在未改动的 Runtime 100 ms 截止时间测试上失败，单独重跑 Runtime 68/68 通过；另两次全仓调用超时。PR #98 的 Foundation CI 两项通过，不能反写为本地整套检查通过。
- 真实 Vault/AgentArts 未执行。
