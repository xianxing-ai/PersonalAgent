# 公共契约（MOD-02 / PA-004、PA-023）

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

包版本 0.1.0-alpha.1；wire 版本 1.0.0；负责人 goo122，消费端评审 zemeng。按接口分层登记：Core Runtime Profile 1 已冻结，整包及模型/工具/连接器/语音等其余形状仍为 `provisional` 或 `unavailable`。精确清单见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

该冻结子集是 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 的共享可信底座；当前新增契约优先服务比赛所需的 Coordination、CloudAgent、ToolExecution 和 Evidence 消费边界。Local Model/Agent 契约仅在产品负责人以后明确启用 Local Profile 时扩展，不阻塞比赛主路径。

schema/protocol.json 是 JSON Schema Draft-07 单一来源；src/generated.ts 与 src/schema.ts 由脚本生成。当前覆盖 17 个操作的请求与结果、9 类事件、任务快照、工具、连接器、Evidence。fixtures/requests.json 提供对应有效消息与无效/伪造授权样例，可交给 C# Host 使用相同 Schema 验证。

从根目录执行：

```sh
npm run generate --workspace=@personal-agent/contracts
npm run check
```

check 会先检测生成文件漂移，再按 storage → contracts → client → testkit 顺序构建和检查。调用 parseResponse 时必须同时提供 operation 和 requestId，以校验操作对应的结果。请求业务幂等键与 requestId 分离；UI 请求中的 authorizationRef 被拒绝。

encodeFrame 包含结尾 LF，帧总长最大 1 MiB；FrameDecoder 支持分片 UTF-8 和多帧输入，finish 拒绝残帧。解码只解析 JSON，宿主必须继续调用 parseRequest/parseResponse/parseEvent。FrameDecoder 不负责 Named Pipe 身份与会话权限检查。

当前字段严格校验；新增可选字段也要通过同版本夹具做消费端兼容验证。不能仅凭 wire 主版本相同视为所有 operation 已冻结或可用；调用前先通过握手发现能力，未公布能力按 `UNSUPPORTED_CAPABILITY` 处理。

公共端口类型见 src/ports.ts。它们是联调形状，不是权限隔离实现。StoragePort 的实际受限注入由 MOD-05 实现；连接器与工具的入参 Schema 校验不能替代账号授权。ToolContext 的 scopes/authorizationRef 只能由可信宿主注入；测试中使用固定值。

Windows Host 的内部 Pipe `0.1.0` 契约单独位于 `schema/windows-host.json`，
校验器从 `@personal-agent/contracts/windows-host` 导出；不扩展本包已冻结的公共
`protocol.json` 1.0.0。接入条件与未验证项见
[Windows Host 内部通信契约](../../docs/interfaces/WINDOWS_HOST_CONTRACT.md)。

新增依赖：Ajv 8.17.1（MIT）用于运行时校验，会增加客户端校验器代码和初始化成本；json-schema-to-typescript 15.0.4（MIT）仅开发时生成类型，不需进入产品包。替代方案是手写双份类型或编译期单独生成验证器；当前选择单一 Schema 和可测试生成流程。最终桌面打包体积和许可证声明留在分发验收中核验。

AgentArts 自有镜像的独立传输 0.1.0 从 `@personal-agent/contracts/agentarts-transport` 导出，schema 为 `schema/agentarts-transport.json`，生成类型跟随既有 `generate`/`check:generated`。它是 provisional 云编排信封，不改变本地 wire 1.0.0 冻结集合；包含 invoke/status/cancel 与 ready/accepted/result/error/status，摘要绑定单键 HTTP payload，受理不等于完成，进程缓存不提供跨重启恢复。见 ADR-0014。
