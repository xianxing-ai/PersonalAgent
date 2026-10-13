# ADR-0009：知识结果的本地持久化与云端出机边界

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 状态：proposed；产品负责人已选择先用明确可公开的演示资料推进比赛链路，未批准私人 Vault 接入或真实付费云调用
- 日期：2026-09-24
- Profile：`huawei_ict_agentarts`；关联 MOD-08、PA-008/023
- 负责人：`goo122`；需产品负责人确认数据范围，并由 `zemeng` 评审 AgentArts 消费边界

## 背景与现状

`knowledge.search` 已能通过现有 ToolGateway/Policy 显式注册，Obsidian 插件侧只读适配器也已交付；当前仅有合成 Vault 离线测试，没有可安装插件、用户选库或真实 Vault 授权。Competition Runtime 仅允许 `mock` 工具提案继续执行；`unverified` 提案在执行前返回 `UNSUPPORTED_CAPABILITY`。

不能只考虑“是否发往 AgentArts”：Runtime 在确认工具执行后将完整 `result` 保存至 `tool-result-*` SQLite 检查点，以支持重启后的幂等重放；Competition 循环还将含 `result` 的 continuation 保存至 `competition-loop` 检查点。若直接注册私人 Vault，检索摘录会进入本地数据库及其 WAL/备份范围，即使云端发送仍被禁止。本地 `knowledge:read` 审批目前不说明这一持久化范围，也不构成出机许可。

## 提议的最低边界

1. 默认不注册私人 Vault。由可信宿主让用户显式选择 Vault 与文件夹；`/`（整个 Vault）必须是明确选择，不从路径、工具参数或云端提案推断。撤销选择后禁止新的检索；已发往云端或留在备份中的内容不能声称可撤回。
2. 本地读取、结果持久化和云端发送是不同决定。若要处理私人笔记，先确定结果在 SQLite/WAL/备份中的存储与保留方案，再接入真实 Vault；不得为过检查而直接删除 `tool-result-*`，破坏已确认执行的重放语义。
3. 云端发送默认拒绝。未来若开放，用户须知道目的地、任务、将发送的来源与内容预览、上限和有效期；许可不能从 `knowledge:read`、插件安装或“用于 Agent”推导。引用中的 Vault ID、相对路径和摘录均按可能敏感内容处理；发送前做结构化裁剪，并在可信宿主检查许可。
4. 未配置或许可过期时明确返回不可用/等待决定，不静默回退 Fake、Local Profile 或扩大范围。任务状态、Evidence 和日志只记录必要元数据，不记录未经许可的笔记正文。

## 待产品确认的选择

- 近期比赛路径已选择仓库内新写的公开演示资料；它是当前最小可交付路径，但仍需真实 AgentArts API/trace 验收，不能把 Fake 测试算成云端能力。
- 如接入私人 Vault：结果以什么方式在本地持久化并保障重启重放、WAL/备份与删除？现有明文检查点不能直接沿用；也不能简单省略结果使已确认工具在重启后重做。
- 出机范围：仅引用元数据，还是经逐次预览批准的有限摘录？默认整库、整篇正文、长期通用许可均不在本提案内。

## 影响、替代方案与复审条件

本提案不新增 DTO、数据库迁移、授权 UI 或运行时开关，现有 MOD-08E 合成数据测试保持不变。后续实现若改变公共协议、检查点或审批语义，须单独设计兼容与迁移；先检查现有数据库中的历史工具结果，不以清库作为升级手段。

未选择“直接用 `knowledge:read` 后上传摘录”，因为它混淆本地读取与外部发送；未选择“只去掉检查点”，因为会破坏幂等重放与失败恢复。产品确认上述选择、非作者评审、合成失败路径测试，以及分别授权的真实 Vault 和 AgentArts 验收之后，才可将本提案改为 accepted 并启用生产接线。
