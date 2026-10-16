# 本地运行数据

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../docs/design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../docs/design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../docs/design/workflow-architecture-20261013/index.html) · [接口状态](../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

该目录只用于开发环境中的数据库、缓存、检查点和临时运行状态。除本说明外，目录内容默认被 Git 忽略。

该规则同时约束当前 [Huawei ICT AgentArts Competition Profile](../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)：个人世界状态、授权、原始 Evidence、凭据和本地执行记录默认留在受信 Runtime；只向 AgentArts 发送完成当前步骤所需的最小脱敏数据或受控引用。Local Profile 仅为可选留存，不形成另一套数据目录或存储事实来源。

- 不保存源码、测试夹具或文档。
- 不提交 SQLite 数据库、WAL、密钥、Cookie、账号标识或私人内容。
- 自动化测试优先使用系统临时目录，并在测试结束后释放资源。
- 可复现的无敏感测试夹具应放在 `tests/fixtures/` 或所属模块的 `test/fixtures/`。
