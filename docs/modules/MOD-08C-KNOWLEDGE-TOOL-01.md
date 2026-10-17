# MOD-08C：知识检索工具的 Policy 边界

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-15）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。每个 PR 需 goo122、zemeng5208、Potatos498 中任意一位非作者对当前提交的有效批准，并满足必要检查、冲突及未解决意见门槛；三人跨 PR 均衡承担评审与合并，禁止强制合并或管理员绕过。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 关联需求：PA-008
- Profile：`huawei_ict_agentarts`
- 依赖：PR #94 的 MOD-08B，基线 `codex/mod-08b-vault-read@110fcb5`
- 分支：`codex/mod-08c-knowledge-tool`
- 负责人：`goo122`
- 评审者：`zemeng` 或其他已登记非作者协作者
- 状态：`done`，PR #95 经非作者评审后已合并；仅完成本片离线验收

## 交付

- `@personal-agent/knowledge/tool` 提供显式注册的 `knowledge.search`。
- 工具只接收 `query`、`limit`，不接收 Vault 根、文件路径、凭据或账号。
- 复用现有 `ToolGateway`/Policy 的 `knowledge:read` 授权，绑定任务、工具名、
  参数摘要和期限；撤销或变更参数后不执行提供者。
- 工具注册返回 disposer；没有被可信宿主注入时保持 `UNSUPPORTED_CAPABILITY`。
- 合成临时 Vault 集成测试覆盖拒绝、授权、参数替换、撤销和注销。

## 非目标

不新增授权体系或公共 wire 操作，不在 Desktop/Runtime 自动发现或注册真实 Vault。
不读取真实私人笔记，不向 AgentArts 发送内容，不验收真实账号、Obsidian 插件、
持久索引、写入或 LLM Wiki。工具对象的直接调用不等于授权；生产能力仍
`unavailable`，不静默回退 Fake。

## 验收

- `@personal-agent/knowledge` 构建与类型检查通过。
- `npm run check` 完整通过：根集成 8/8；真实服务测试未启用。
- 合成 Vault 的 Policy/ToolGateway 测试通过，拒绝前提供者调用次数为零。
- `git diff --check` 通过；真实 Vault 和云端数据出机需单独授权验收。
