# MOD-08A：只读知识端口与测试 Vault

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

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
