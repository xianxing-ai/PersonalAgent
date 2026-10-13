# MOD-08C：知识检索工具的 Policy 边界

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一语义决策默认国内MaaS，责任图/并行/后台影子按当前设计；旧Laya默认和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


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
