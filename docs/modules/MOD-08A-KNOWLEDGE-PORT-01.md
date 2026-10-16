# MOD-08A：只读知识端口与测试 Vault

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


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
