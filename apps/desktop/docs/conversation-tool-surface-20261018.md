# Competition 对话功能入口（2026-10-18）

主组合使用 `createConversationToolSurface({profile:'huawei_ict_agentarts',tools,competitionToolAvailability})`。返回原完整 availability 数组的投影，保留全部 readiness callback、版本和 public enum 配置。RegisteredTools、export、Policy 和 graph 内部 ToolPort 均不删除。Local 不消费此 helper。

可信 metadata `CompetitionToolAvailability.modelExposure?:'internal'` 不进入 wire 或模型输入。构造器只接受 undefined/internal；`describe()` 和首次 `prepare()` 不发布 internal 项；已保存选择在发送和提案校验时也重新拒绝 internal 项。模型不能通过主动提出内部工具名获得审批或执行。原图仍能通过原 ToolPort、原任务精确 Policy grant 调用同一工具。

精确内部名为 `coding.repair.start/list/read/snapshot/preview/patch/verify/check/publish/reconcile`、`workspace.coding_snapshot`、`workflow.host.f15_n04`、`workflow.host.f15_n05`、`workflow.host.f15_n06`。这些是现有 F15 graph 服务节点，对话入口为 `coding.repair.workflow`（由 Runtime 构造时装配）。缺少 graph 的可信配置时入口如实 unavailable，不宣称内部节点已独立公开。

仅当已注册 canonical `workspace.run_allowed_command` 时，另标记 `workspace.git_diff_check`、`workspace.node_check`、`workspace.npm_build`、`workspace.npm_test` 四个重复固定命令别名。缺少 canonical command 时保留原别名可发现。匹配采用精确名字，未来新工具不会因前缀继承隐藏策略。

Local/Synthetic 容量 fixture 使用真实 public factory 的 descriptors、最大 ready 的可信测试 callback，以及实际 `Runtime.prepareCompetitionToolCatalog()`。Windows 只注入无设备 backend 以取得真实 schema；patch apply 仅以 Synthetic 平台 seam 构造，未执行 PowerShell。原完整组合 77 项/动态 26296 字节，超过64项/24576字节协议；按上述入口投影后，加可选 GitHub Check link/get 与真实 Skill 公共 Schema，该 Synthetic 最大 ready 组合动态62项/22940字节。静态公开61项/28532字符（现有 Skill 静态摘要缺口另计；加其公开 Schema 仍低于32K）。fixture 配置为一个仓库、一个公开知识查询/笔记路径；字节数不是任意长度公开 enum 配置的无限上界。未放大协议上限、未调用 provider、未运行云镜像或真实 Windows 设备。

容量证据位于 `.cache/wiring-20261018/devtools/combined-optional-surface-capacity.json` 与同名日志，fixture 脚本为 `measure-combined.mjs`。定向源码测试还证明内部原子节点的原 ToolPort 可调用、模型同名提案被拒绝且不创建审批。
