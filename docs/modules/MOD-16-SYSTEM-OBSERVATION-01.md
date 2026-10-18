# MOD-16-SYSTEM-OBSERVATION-01：只读系统聚合观测

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-16/17、PA-011。
- 负责人：zemeng；非作者评审者：goo122；状态：review。
- 基线：`72cc76b`；分支：`codex/zemeng/system-observation`。
- 本包新增 workspace 构建与 lock 登记，无外部依赖、数据库迁移或 wire Schema 变更。
- 现有本地完整检查受邮件依赖未安装影响，本包采用定向验证与干净 CI；不宣称本地全仓通过。

## 范围

本工作包把用户原先要求的 TraceGuard 集成缩减为 PersonalAgent 所需的最小电脑数据获取能力。
它不集成、复制或发布 TraceGuard，也不实现 MOD-16 的 Windows 操作、Named Pipe、凭据适配，
或 MOD-17 的治理与恢复。

交付物是 `@personal-agent/windows-client` 的单个 `RegisteredTool` 工厂。默认 probe 只读取：

- 两次 CPU tick 采样得到的整体利用率和逻辑处理器数量；请求间隔字段不冒充实测耗时；
- 内存总量、可用量及由两者计算的使用量；
- 系统 uptime、采集时间和采样窗口。

不读取 hostname、用户名、进程/命令行、文件/路径、网络地址或凭据。进程归因、磁盘 I/O、
温度和网络活动保持 `unavailable`，调用方不得据此捏造性能因果。

## 信任与执行边界

- 工具是 `sideEffect=read`，只申请 `computer:system:read`。
- 输入和输出使用 `additionalProperties=false` 的精确 Schema。
- probe 由受信宿主注入；默认实现使用 Node `os`，不启动 Shell 或申请更高权限。
- 注入 probe 的结果标记 `source=injected`，只有默认适配器标记 `source=node:os`。
- sampling 同时受 `ToolContext.signal` 和 deadline 约束；取消/超时清理计时器且不重试。
- probe 异常统一为脱敏 `EXTERNAL_FAILURE`，不会回显系统或测试错误正文。

## 验收与状态

定向合成测试应覆盖确定性聚合、严格 Schema、不可用项、取消、deadline、单次 probe 采样及
错误脱敏；类型检查和模块构建独立通过。可选本机 smoke 只报告断言通过/失败，不输出观测值。

这是 provider slice，不是整个 MOD-16 或 PA-011 完成。当前 Competition Coordination 仍只接受
有界文本并拒绝 Local tools；AgentArts 工具提案、Runtime 装配和 Desktop 展示均不在本包范围。

2026-09-17 在独立工作树完成的最少验证：本树 contracts 构建、windows-client 类型检查与构建
通过；`node --test --test-isolation=none packages/windows-client/test/system-observation.test.mjs`
共 7 项通过。Policy/ToolGateway 合成集成测试 1 项通过，证明缺授权和撤销均在读取 probe 前
拒绝、授权后仅执行一次采样。另执行一次默认 `node:os` probe 的本机 smoke，只输出 `PASS`，
未输出或落盘任何观测值。上述结果证明 provider 的本地读取和边界，不证明 Competition/Desktop
已接通。

2026-10-06 续接修复（#212 `6017855959`）：原实现只比较聚合 tick，某核心或计数类别回退可被其他增长掩盖，错误返回有效利用率。现保存各核五类计数的独立数值快照，同数量两次采样间逐核逐项拒绝负差值，再按原算法聚合；允许某核心静止、其他核心增长，保持整体差值必须为正。注入 probe 复用数组或对象也不会改写已捕获的第一份快照。没有新增 CPU 身份字段，不能据此证明同数量处理器重排未发生。

Node 24.15.0 下保留旧实现两场景失败（跨核掩盖、同核类别掩盖），修后模块 build、typecheck 和 12/12 测试通过；仅使用明确的注入 probe，不冒充原 Windows 实机观测。公开 Schema、scope、来源标记、取消、deadline 和脱敏错误语义保持。新提交的 CI、正式非作者 review 及实际集成在对应 PR 记录，整个 MOD16/17 真实验收仍按原负责人继续。
