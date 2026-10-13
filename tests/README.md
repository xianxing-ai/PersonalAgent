# 跨模块测试

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

模块单元测试放在各自 workspace 的 `test/`。这里只保存必须跨模块验证的测试：

- `architecture/`：目录、依赖方向、公共导出和循环依赖检查。
- `contracts/`：尚未冻结接口的合成验收夹具自洽性检查；不得把夹具格式当作 wire Schema。
- `integration/`：多个核心模块组合后的 Fake 集成测试。
- `e2e/`：从应用入口开始的完整链路。
- `manual/`：需要真实账号、网络或付费模型的显式验收。
- `fixtures/`：不包含密钥、账号或私人数据的共享夹具。

跨模块接口测试必须固定接口目录中的冻结基线，并分别覆盖 capability 已公布、未公布、版本不兼容和 `UNSUPPORTED_CAPABILITY`。Fake 通过只证明接口形状与状态分支；盘古、AgentArts、真实账号、语音和 Windows 操作仍需在 `manual/` 中保留独立验收与读回证据。

当前新增测试只服务 [Huawei ICT AgentArts Competition Profile](../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)。至少覆盖 AgentArts 项目/Agent/deployment 读回、API/trace、工具提案→本地授权→执行→目标系统读回、评估指标，以及 AgentArts 失败时不静默回退 Local。Local 现有测试可以保留，但不新增测试义务，也不能计入比赛完成度。

不得把真实 Provider 测试加入默认 CI。目录在出现第一项真实测试时创建，不保留空占位目录。

## 离线集成测试入口

`npm run check` 在构建、类型检查和 workspace 测试成功后执行 `npm run test:integration`，
覆盖 `tests/integration/*.test.mjs`，包括受限工作区读取的 Competition 审批消费链。
任一集成测试失败会使 check 失败；不包含 `manual/`，不启用真实账号或设备验收。
单独运行时先执行 `npm run build`，再执行 `npm run test:integration`。

`architecture/integration-test-entrypoint.test.mjs` 只防止检查入口再次漏接，
不代替集成测试本身，也不证明真实 AgentArts、设备或外部 Evidence 验收通过。
