# COMPETITION-PORTS-01：编排端口与 Runtime 注入首片

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一语义决策默认国内MaaS，责任图/并行/后台影子按当前设计；旧Laya默认和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；关联 MOD-02/03/04B/29、PA-026。
- 负责人：goo122（本次公共端口与集成）；消费评审：zemeng。状态：review（PR #36 已合并为 `5944061`，非作者消费评审证据仍待补齐）。
- 基线：`bafb541`；工作树：`.worktrees/competition-coordination-ports`。
- 范围：消费模块 `packages/coordination` 声明 CoordinationPort / CloudAgentPort、显式 Fake；Runtime 注入 CoordinationPort，只接收文字结果。
- 不在范围：AgentArts HTTP/身份/部署、工具执行循环、世界状态、历史上下文出机、UI profile 切换、wire Schema 和数据库迁移。
- 兼容：旧 Desktop 未选择 profile 时保持已有 Local 装配；显式 Competition 不使用 Local 模型配置，不向端口传递 Runtime、授权、数据库或 checkpoint 方法。
- 验收：公开 Client 提交→注入端口→持久任务结果；重复提交只执行一次；取消/deadline；未配置、异常和非法返回失败；不接受云端自报 Evidence/终态或工具执行；全仓 check。
- 端口为 provisional，真实 AgentArts 仍 unavailable。后续由 zemeng 评审消费语义后交付云适配；工具闭环单独工作包。

## 本轮验证（2026-09-09）

- 新工作树独立安装依赖；锁文件仅增加本地 coordination workspace 及 Runtime 依赖，没有升级第三方包。
- `npm run check`：架构、生成类型检查、构建/类型检查通过；首次测试阶段暴露新超时夹具缺少 kind 字段，已修正。更早的返回类型声明编译错误也已修正。
- 修正后 `node --test apps/runtime/test/coordination.test.mjs packages/coordination/test/ports.test.mjs`：9/9 通过。
- 修正后 `npm run test --workspaces`：176 项，172 通过、4 项真实天气门控跳过、0 失败。修正只涉及测试夹具，未重复整轮构建。
- `git diff --check` 通过。无 wire/迁移变化；未调用真实/付费模型、AgentArts 或账号，未运行 Electron UI smoke。
- 后续状态：已通过 PR #36 合并；消费语义仍需 zemeng 非作者评审。不能将合并记录当作接口冻结或比赛验收。
