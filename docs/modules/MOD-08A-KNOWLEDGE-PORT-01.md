# MOD-08A：只读知识端口与测试 Vault

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 关联需求：PA-008
- Profile：`huawei_ict_agentarts`
- 基线：`origin/main@993674f`
- 分支：`codex/mod-08a-knowledge-read`
- 负责人：`goo122`
- 评审者：`zemeng` 或其他已登记非作者协作者
- 状态：`done`，PR #93 经非作者评审后已合并；仅完成本片离线验收

## 交付

- `@personal-agent/knowledge` 暴露 provisional `KnowledgePort.search`。
- `@personal-agent/knowledge/testing` 提供显式、纯内存测试 Vault。
- 搜索结果包含有界文本片段和精确测试引用（Vault、相对路径、行号、内容摘要）。
- 输入路径、查询、结果数量、取消和 deadline 在 Fake 边界校验。

## 不在本片

不接真实 Obsidian、不读私人笔记、不做文件写入/删除、模型总结或 LLM Wiki，
不注册 Runtime capability，也不发送 AgentArts。当前真实知识能力仍为 unavailable；
接口本身保持 provisional。

## 验收

- 模块测试覆盖命中和未命中、引用、截断、Vault 隔离、非法路径、取消与超时。
- 根构建顺序与锁文件登记 workspace，`npm run check` 与 `git diff --check` 通过。
- 真实 Vault 权限、符号链接、索引与变更读回另列 MOD-08B，不能由 Fake 结果替代。

## 本地验证

- `npm run build --workspace=@personal-agent/knowledge`：通过。
- `npm run test --workspace=@personal-agent/knowledge`：4/4 通过。
- `npm run check`：架构 3/3、合约夹具 4/4、生成类型、全工作区构建/类型检查/测试与根集成 7/7 通过；真实服务测试未启用。
- `git diff --check`：通过。
