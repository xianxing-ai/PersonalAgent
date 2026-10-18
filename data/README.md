# 本地运行数据

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

该目录只用于开发环境中的数据库、缓存、检查点和临时运行状态。除本说明外，目录内容默认被 Git 忽略。

该规则同时约束当前 [Huawei ICT AgentArts Competition Profile](../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)：个人世界状态、授权、原始 Evidence、凭据和本地执行记录默认留在受信 Runtime；只向 AgentArts 发送完成当前步骤所需的最小脱敏数据或受控引用。Local Profile 仅为可选留存，不形成另一套数据目录或存储事实来源。

- 不保存源码、测试夹具或文档。
- 不提交 SQLite 数据库、WAL、密钥、Cookie、账号标识或私人内容。
- 自动化测试优先使用系统临时目录，并在测试结束后释放资源。
- 可复现的无敏感测试夹具应放在 `tests/fixtures/` 或所属模块的 `test/fixtures/`。
