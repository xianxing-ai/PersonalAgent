# 模块分工与独立交付清单

## 2026-10-09 Wiki 与常驻设计分工

goo122 具体交付 MOD-08/09 的 Wiki 适配、来源版本、事实/检索投影、受控写回、双向去重和恢复，并随工作包完成必要公共契约/Runtime/Policy 接线。zemeng 负责 MOD-27/28 与 AgentArts 公开端口消费、常驻增量修复及监管产品体验；Potatos498 的业务模块所有权不改变。

独立工作包见 `design/resident-developer-agent-20261008/WIKI-MEMORY-HANDOFF.md`。新设计不等于接入实现；估算基线2026-10-08保留。合并需 goo122 与 Potatos498 本机阅读确认及审批；这不阻止各自独立开发、使用契约一致 Fake 或提交 PR。

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

版本：1.0 · 日期：2026-10-07 · 状态：只实施 Huawei ICT AgentArts Competition Profile；Local Profile 可选留存

本文件是未来工作负责人、文件所有权和交付边界的唯一登记处。[Competition Profile](competition/HUAWEI_ICT_AGENTARTS_PROFILE.md) 定义当前优先参赛路径，[PRD](PRD.md) 定义需求，[公共开发协议](DEVELOPMENT_PROTOCOL.md) 定义互通语义，[当前接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md) 决定接口是否冻结或可用，[ROADMAP](ROADMAP.md) 维护执行状态。

## 0. 三人独立交付分工（2026-10-07 最新修订）

用户明确要求三个人都能独立工作，不因另一人的 PR 审批、集成排队或尚未提供的 Fake 而停工。**zemeng（GitHub：zemeng5208，即用户）继续负责项目核心、AgentArts 与技术方向**。本修订替代同日早先“Potatos 全部执行权转给 zemeng”的临时安排；三人各自拥有完整交付责任。

| 负责人 | 独立主线 | 模块归属 | 可独立交付的结果 |
| --- | --- | --- | --- |
| **zemeng / zemeng5208** | **核心认知、AgentArts、桌面与受控执行** | MOD-04B、10～19、27～32；MOD-19 仍暂停 | CloudAgent/Competition 编排、Agent/Workflow/多 Agent、Goal/Fact/Decision/Plan、Laya/主动认知、Desktop/语音/Windows/编码工具、比赛评估与 Demo；含本主线所需消费接线 |
| **goo122** | **基础运行时、协议与知识记忆** | MOD-01～03、04A、05～09、33、36、37；MOD-37 按原范围待开工 | TaskRuntime、ModelGateway/Provider、Policy/ToolGateway、存储/凭据、MCP/Skills、知识/Obsidian/记忆/学习、协议与工程底座、GitHub 连接器、代码预审与 API 文档维护；含本主线所需宿主和管理接线 |
| **Potatos498** | **业务能力与业务侧用户流程** | MOD-20～26、34、35、38；未选社交平台仍不自动开工 | 待办/日历/邮件/订阅/通知/研究/天气/已选社交连接器、CI 修复、测试失败定位、Issue 分类与修复 PR；含业务设置页、业务工具注册、业务结果展示与真实来源验收 |

zemeng 掌握核心产品架构、认知语义和 AgentArts 云端方向；另外两人可在其既定目标内直接完成普通实现与交付，无需先等 zemeng 分派下一步或批准 PR。历史作者、评审、证据和已集成成果保留原归属。

### 0.1 DEV-WORKFLOWS 归属

按用户最新减负要求，六项由 goo122 与 Potatos498 各承担三项，zemeng 不再承担本组日常实现、返修或集中验收，继续负责核心认知、AgentArts 与桌面执行主线。两人的交付包含必要接线、自审和实际验收，不能把集成或验收默认交回 zemeng。

| 模块 | 功能 | 负责人 | 独立交付边界 |
| --- | --- | --- | --- |
| MOD-33 | GitHub 连接器底座 | goo122 | 公开 GitHub 端口、Provider、Fake 和消费接入 |
| MOD-34 | CI 失败修复 | Potatos498 | 模型归因、受控补丁/Git、Runtime 修复流程及验证 |
| MOD-35 | 测试失败定位 | Potatos498 | 解析器、定位报告、公开 exports、CLI/测试和 MOD-34 接入适配 |
| MOD-36 | Code Review 预审 | goo122 | 模型预审、意见锚定和受控发表流程 |
| MOD-37 | API 文档维护 | goo122 | 协议/exports 与文档一致性；当前仍为待开工规划 |
| MOD-38 | Issue 分类与修复 PR | Potatos498 | 分类、受控标签写回和修复流程接入 |

主要维护文件：goo122 负责 `packages/connectors/github/`、`packages/cognition/src/dev-workflows/code-review*` 及 MOD-37 文档维护工作包；Potatos498 负责 `packages/coding-tools/src/dev-workflows/ci-fix*`、`git-tools*`、`packages/coding-tools/src/test-locate/` 和 `packages/cognition/src/dev-workflows/issue-triage*` 及对应测试。上述 cognition/dev-workflows 文件是模块归属的明确例外，核心 cognition/AgentArts 仍归 zemeng；共享 exports、`apps/runtime/src/dev-workflows-runtime.ts` 及 Desktop 接线由实际变更人随工作包完成，保持兼容并自行验证。

DEV-WORKFLOWS 保留已授权的 Local Profile 增量范围。每个模块由自己的负责人验证和交付，不再要求 Potatos 集中验收其余两人的成果。

## 1. 独立推进、评审与集成

1. **自己完成闭环**：每人负责本模块的公开端口、实现、必要消费接线、关键验证、文档和交付。开发、验证、创建交付 PR 不需要先取得另一位协作者的批准。
2. **两人确认与自动检查**：2026-10-09 起，goo122 与 Potatos498 两人必须在自己的电脑打开当前完整设计/阅读页/全部 SVG，提交绑定 PR head 与内容摘要的本人阅读声明和审批，满足必要检查后才可按授权正常合并。禁止强制合并、管理员绕过、直接推 main 或用自审代替他人确认。开发与验证仍可独立进行；流程见 [阅读门槛](reviews/DESIGN_READING_GATE.md)。
3. **接口先行，替身可自行提供**：优先使用 main 的公开 exports、Schema 和固定版本契约。上游尚不可用时，使用或自行补齐契约一致的 Fake/Unavailable 与消费测试，独立开发和验证；缺真实服务只阻止相应真实验收结论，不阻止模块实现。
4. **必要接线随模块交付**：三人均可在自己的分支完成所需根配置、依赖锁、公开 Schema、迁移、Runtime/桌面注册和组合接线。公共区域由 goo122 长期维护，但不是其独占审批或集成槽；核心认知与 AgentArts 的长期责任仍归 zemeng。
5. **共享文件用 Git 集成**：每人可自行使用隔离分支/工作树；不在同一物理 checkout 并发编辑。合并前基于最新 main 核对冲突和兼容，保留其他人的有效改动，不靠覆盖、强推或硬重置解决冲突。不再排队等待某位唯一集成人。
6. **兼容性替代人员等待**：公共变更随 PR 记录消费者、版本/迁移及回退影响，并交付针对受影响消费方的契约测试。新增可选字段优先；破坏性变更必须提供版本化兼容/迁移方案。实现者可一并补必要接线；需求或账号授权确实不明确时才找用户确认。
7. **状态与权限分开**：本规则调整开发协作流程；产品运行时 Policy/审批、真实账号写入、云发布和付费调用继续按对应授权。完成仍须满足约定验收和实际集成，不能用自审或 CI 冒充真实服务读回。

接口冻结按实际契约、生产实现、Fake/失败夹具、消费验证、自审和 CI 证据判断；不再要求另一位指定人员签字。证据不足时保持 provisional/unavailable，其他人仍可用固定契约独立开发。

项目状态唯一来源为 [ROADMAP](ROADMAP.md)，逐接口状态见 [接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)。本轮重置文档分工，未改 GitHub 权限；文档提交与推送状态以 Git 为准，早期接手与清理事实见 [接手记录](PROJECT_TAKEOVER_20261007.md)。

## 2. 三条主线的独立验证入口

| 主线 | 上游未就绪时 | 本人负责的验证 | 不需等待的事项 |
| --- | --- | --- | --- |
| zemeng 核心与 AgentArts | Fake CloudAgent/Memory/Tool/Runtime；固定契约与合成事实 | 编排、审批消费、认知与端口回归；有授权后做云端/桌面/设备真实读回 | goo122 的真实数据库与模型配置、Potatos 的真实账号、对方 PR 批准 |
| goo122 基础运行时、知识记忆与开发底座 | FakeCoordination、固定来源与测试 Vault、显式模型/工具替身 | 状态、持久化、迁移、取消/恢复、权限及公开消费契约；GitHub Provider、代码预审与文档一致性 | AgentArts 控制台和部署、真实 Desktop、zemeng 的审批 |
| Potatos 业务能力与开发修复链 | FakeClock/Storage/ToolHost、固定 Provider 响应和测试日志 | 业务读写/去重/时区/失败语义、定位器、CI 修复、Issue 分类与修复 PR、业务注册与展示；有授权后做真实来源读回 | 核心 Agent 完成、云端账号、goo122 的专属集成 PR |

人员归属是长期维护责任，不是跨目录修复的阻断权。已有实现优先复用；必要的小范围跨模块接线由提出需求的人随工作包完成，保持公开依赖方向和单一契约来源。

## 3. goo122：底座、模型、工具、知识与记忆

| ID | 模块 / 需求 | 主要维护目录 | 依赖 | 独立交付与验收 |
| --- | --- | --- | --- | --- |
| MOD-01 | 工程与存储底座 / PA-004 | 根配置、packages/storage、scripts/dev、.github/workflows | 无 | 可启动工程；有序迁移保留数据；根构建和 CI 可复现 |
| MOD-02 | 公共协议与联调 SDK / PA-004、PA-023 | packages/contracts、packages/client、packages/testkit | MOD-01 | Schema、生成类型、Client、Fake 和兼容记录一致；逐接口登记冻结状态 |
| MOD-03 | 任务与事件核心 / PA-004、PA-009 | apps/runtime 的任务、事件、调度核心和公共 Host 边界 | MOD-01、02 | 持久任务、恢复、取消、幂等和未知结果；通过 FakeCoordination 可独立运行 |
| MOD-04A | 可选 Local Profile 的 ModelGateway 与模型供应商适配 / PA-003、PA-012 | packages/models | MOD-02、03 | 保留 ModelGateway、能力探测、Fake/Unavailable/Provider；当前只做 Competition Profile 明确需要的兼容工作 |
| MOD-05 | 权限、工具与连接器宿主 / PA-023 | packages/policy、packages/tool-gateway、packages/connector-host | MOD-02、03 | 越权拒绝、一次性授权事务消费、结果未知待核实、受限凭据注入 |
| MOD-06 | 本地 MCP 适配 / PA-005 | packages/mcp | MOD-02、05 | 工具发现、调用、断连；Fake 和至少一个真实本地 MCP 分开验收 |
| MOD-07 | 本地 Skills 加载与运行 / PA-006 | packages/skills | MOD-02、05 | Skill 版本、启停、受控工具调用和执行记录；不能自行授权 |
| MOD-08 | 知识库、Obsidian 与 LLM Wiki / PA-008 | packages/knowledge、plugins/obsidian | MOD-01、02、05 | KnowledgePort、来源引用、冲突写入和测试 Vault；真实 Vault 单独验收 |
| MOD-09 | 时序个人记忆与流程学习 / PA-020、PA-024 | packages/memory、packages/learning | MOD-01、02、07、08 | MemoryQueryPort、FactChangeFeed、修正/撤回/删除、来源和版本；不修改 Goal/Task |

goo122 必须让上述模块在没有真实 Desktop、AgentArts 或 zemeng 私人环境时，通过 FakeCoordinationPort 和固定夹具运行。

## 4. zemeng：核心认知、桌面执行与 AgentArts

| ID | 模块 / 需求 | 主要维护目录 | 依赖 | 独立交付与验收 |
| --- | --- | --- | --- | --- |
| MOD-04B | Competition Coordination 与可选 Local Agent / PA-003、PA-012 | packages/coordination、packages/agents | MOD-02、03、05；Local 才依赖 04A | Competition 路径只消费 CloudAgent/Memory/Tool 端口；既有 Local Agent 代码保留为可选 baseline |
| MOD-10 | 模型与 AgentArts 能力研究 / PA-022、PA-026 | docs/research/model-training、docs/research/agentarts | 供应商能力与数据条件 | 给出来源、实验、成本和条件结论；不把提示或记忆称为参数训练 |
| MOD-11 | 桌面外壳与桥接 | apps/desktop/electron、apps/desktop/src/app | MOD-02 | 窗口、托盘、受控 IPC；Renderer 无系统权限 |
| MOD-12 | 悬浮球与展开面板 / PA-001 | apps/desktop/src/features/orb、apps/desktop/src/features/conversation | MOD-02、11 | ORB、单面板、多屏、取消与状态映射；真实桌面合成验收 |
| MOD-13 | 管理后台与授权界面 / PA-002、PA-023 | apps/desktop/src/features/admin、apps/desktop/src/ui | MOD-02、11 | 能力、任务、审批、配置界面；未公布能力明确显示不可用 |
| MOD-14 | 语音会话 / PA-007 | packages/voice、apps/desktop/src/features/voice | MOD-02、04B、11 | ASR/TTS、播放、停止播报；与 task.cancel 保持分离 |
| MOD-15 | 唤醒词与连续语音 / PA-021 | packages/voice-wake | MOD-14 | 授权音频流、默认关闭、撤销停止、误触和回声实机测试 |
| MOD-16 | Windows 执行与凭据适配 / PA-016 | apps/windows-host、packages/windows-client | MOD-02、05 | Named Pipe、目标确认、输入串行、用户接管、后置验证、安全存储 |
| MOD-17 | 电脑状态读取 / PA-011（不集成 TraceGuard） | packages/windows-client（与 MOD-16 同一提供者，不另建 TraceGuard 包） | MOD-02、05、16 | 普通用户权限、必要真实观测与不可观测声明；PA-018 治理/恢复按 2026-09-17 用户修订排除 |
| MOD-18 | 编程执行工具 / PA-017 | packages/coding-tools | MOD-02、05 | 授权工作区、patch/command、保留用户改动、输出 Artifact 和验证状态 |
| MOD-19 | 打包与安装验收 | packaging、scripts/release | 已验收模块、MOD-01 | 独立安装、启动、升级、卸载和数据保留；发布授权另行处理 |
| MOD-27 | 目标、事实与决策图谱 / PA-024 | packages/goals | MOD-02、03、09、04B | 版本化 Goal/Fact/Decision/Plan 依赖图、来源、冲突和回退；不直接读记忆数据库 |
| MOD-28 | 持续认知与最小计划修复 / PA-025 | packages/cognition | MOD-03、04B、09、27 | 事实变化影响分析；输出 KEEP/RECHECK/REVISE 和最小差异，不直接改 TaskRuntime |
| MOD-29 | AgentArts 云端基础、身份、MaaS 与部署 / PA-026 | packages/agentarts/src/foundation 与云资源说明 | MOD-02、03、05、16 | 第一优先；CloudAgentPort、项目/Agent/deployment 引用、Fake 和真实 API 读回；凭据不进入云提示或仓库 |
| MOD-30 | AgentArts Agent/Workflow、知识、MCP/Skill 与工具提案 / PA-026、PA-027 | packages/agentarts/src/workflows | MOD-05、29；本地 MCP/Skills 为可选依赖 | 第一优先；云流程产生受限提案，一条部署 API 经本地 Policy/ToolGateway 和目标系统读回验收 |
| MOD-31 | AgentArts 多 Agent 与效果评估 / PA-012、PA-027 | packages/agentarts/src/multi-agent、packages/agentarts/src/evaluation | MOD-28～30 | 角色必要性、路由、交接、预算、固定评估集、失败降级和完整 trace；不能提升本地权限 |
| MOD-32 | AgentArts 发布、API、观测与 Competition 验收 / PA-027 | packages/agentarts/src/observability、tests/manual/agentarts | MOD-03、05、19、29～31 | 第一优先；版本、部署、API 实调、profile、日志、成本、回滚、Demo 和本地执行读回证据 |

zemeng 必须优先交付 MOD-29/30/32 的 Competition Golden Path，并让模块在没有 goo122 的真实数据库或未合并实现时使用 Fake Memory/Tool/Runtime 独立开发。AgentArts 成功不能直接把本地任务标为完成；Local Agent 新能力当前不作为必交项。

2026-10-08 自有镜像工作包目录登记：zemeng 负责 `packages/agentarts/src/{index,input,prompts}.ts`、
`apps/agentarts-runtime/`、相应模块/根集成测试和迁移文档，依赖既有 contracts/models/coordination 公开 exports。
为同一包修改根构建/锁文件及 Coordination 期限/续接接线，并提供消费验证；不覆盖 goo122 的协议/本地授权所有权。
实际隔离工作树、接口影响与验收缺口见 [迁移工作包](modules/AGENTARTS-OWNED-IMAGE-MIGRATION.md)。

2026-10-09同包WSS增量：zemeng在此隔离分支负责云HTTP/WS宿主及必要的Coordination、Runtime Application、Desktop消费接线；独立传输0.1.0契约由本包提供生成类型、兼容说明和消费验证，长期contracts/Runtime维护责任仍归goo122。Wiki接入仍由goo122负责，业务连接器仍由Potatos498独立交付。本次子智能体分工只用于开发，不进入产品授权或执行链；未合并/未真实云验收不能提高MOD整体状态。

## 5. Potatos498：业务连接器与当前工作顺序

| ID | 模块 / 需求 | 主要维护目录 | 依赖 | 独立交付与验收 |
| --- | --- | --- | --- | --- |
| MOD-20 | 待办与日历 / PA-009、PA-013 | packages/productivity、packages/connectors/calendar | MOD-02、03、05 | Fake 时钟/日历；时区、修改读回；不另建调度器 |
| MOD-21 | 邮件连接器 / PA-014 | packages/connectors/mail | MOD-02、05 | 分页、重复事件、草稿和写入核实；真实账号单独验收 |
| MOD-22 | 订阅采集 / PA-015 | packages/connectors/feeds | MOD-02、05 | 固定 feed 增量、去重和来源；通知交 MOD-23 |
| MOD-23 | 通知汇总策略 / PA-015 | packages/notifications | MOD-02、03 | 安静时段、聚合和暂停；只用 Runtime 调度 |
| MOD-24 | 搜索与资料获取 / PA-010 | packages/connectors/research | MOD-02、05 | 固定响应、来源/时间、失败与过期区分 |
| MOD-25 | 天气 / PA-010 | packages/connectors/weather | MOD-02、05 | 地点不静默猜测；缓存状态和真实提供商证据分开 |
| MOD-26 | 微信与社交扩展 / PA-019 | packages/connectors/social/platform | MOD-02、05；交互模式另依赖 MOD-16 | 每个平台单独子任务；账号类型、能力和不支持项明确 |

MOD-20～26 当前由 Potatos498 独立负责，业务接线和验证随模块交付；下列历史能力证据保持原日期与原作者。AgentArts 只消费经 MOD-05 实际公布的能力。业务模块源码、历史单包 live 读回、生产 Runtime 注册和用户旅程真实验收是不同证据层；`register`、Fake/CI 或设计 PR 均不能替代首版验收。以下是 2026-09-24 的缺口盘点，具体证据见各包 README、模块记录、PR #4/#8/#22/#23/#27/#28/#47/#81 与当前接口目录：

| 能力 | 已有证据 | 第一版仍需读回的结果 |
| --- | --- | --- |
| 待办与提醒（PA-009，P0） | `@personal-agent/productivity` 已有 CRUD、时区与 ReminderTrigger 的离线验证；PR #22 已合并 | 真实持久化的创建/修改/取消读回，Runtime 到点及休眠恢复、去重和 Desktop 通知闭环 |
| 日历（PA-013，P1） | `calendar.events`、事件时区与邀请动作仅 Fake；PR #22 已合并 | 先确定一个账号/提供商，经用户授权做真实同步读回、时区与所声明动作的结果核实 |
| 邮件（PA-014，P1） | QQ IMAP/SMTP 提供商与多账号入口已合并；包 README 记录 2026-09-13 的一次真实读回/自发自收 | 宿主可信凭据接入后，至少一个邮箱的应用内同步、分类、摘要、草稿读回；发送仅在对应授权后验证，结果未知先查已发送记录 |
| 订阅（PA-015，P1） | RSS/Atom 增量与去重已合并；包 README 记录两个公开源的真实两轮取数及 304 | 宿主配置的真实源经持久游标轮询，更新去重并进入通知汇总；真实更新时点与界面读回 |
| 通知（PA-015，P1） | 安静时段、暂停、聚合、去重为离线策略证据；PR #27/#81 已合并 | 真实源进入宿主调度，安静结束/暂停恢复自动裁定，Desktop 展示与确认读回 |
| 研究（PA-010，P0） | `research.search` 的 OpenAlex 单次 5 条真实读回与失败/过期离线语义；PR #47 已合并 | Competition 应用内请求、来源/时间/过期展示与失败读回；是否需要非学术来源由具体首版场景确认 |
| 天气（PA-010，P0） | `weather.forecast` 已在 Runtime 显式装配；Open-Meteo/可选 GeoNames 有历史真实读回，PR #4/#12/#23 已合并 | 当前环境下地点确认、观测/覆盖时间和缓存状态的应用内读回，以及 AgentArts/Policy 工具链证据 |
| 微信与社交（PA-019，P2） | PRD 列为扩展；当前无已选平台的模块提供者或真实验收 | 先由产品负责人确认首版具体平台、账号类型与合法能力；每个被纳入的平台再按动作单独验收，不承诺全部平台读写 |

#88 设计 PR 已合并，仅收敛工具清单与边界，不代表五包已经接入。后续按当前缺口逐项交付，一个能力一个小 PR，不把五包同时塞进根装配：PA-009 待办存取与提醒触发、PA-015 订阅采集与通知裁定分别形成可审查的业务工作包；PA-013 日历在选定一个真实提供商后单列，PA-014 邮件复用已有 QQ 提供商，只补连接器侧实际缺口；PA-010 研究/天气优先复用已实现提供者，不重复造同类工具。现有实现已足够的部分直接进入跨模块验收，不为凑 PR 另写源码。每包固定公开端口、已声明 scope、无配置时 `UNSUPPORTED_CAPABILITY`、对应失败/取消/读回证据；有副作用的操作另按动作授权。公共 Runtime/Policy、SecretStore、StoragePort 的长期维护归 goo122，核心分类/认知语义归 zemeng；Potatos 可随业务 PR 完成必要的 capability 注册、宿主接线、业务设置与展示，使用公开端口和消费测试保证兼容，无需等待独立集成 PR。

Windows 安装包与安装流程继续暂停。PA-019 及其他 PRD P2 项是否进入首版，先核实具体约定；未选择平台或账号时不得以空实现、Fake 或未经授权的真实账号写入冒充完成。

## 6. 跨主线接口与状态

| 方向 | 公开边界 | 独立开发方式 |
| --- | --- | --- |
| Runtime → 核心认知 | CoordinationPort / 已公布 application 入口 | goo122 使用 FakeCoordination；zemeng 使用 Fake Runtime |
| Competition → AgentArts | CloudAgentPort | zemeng 自行维护适配器、云配置与 Fake，消费方使用公开响应 |
| Agent → 模型 | ModelPort / ModelGateway | goo122 提供模型底座；其余人使用固定契约和显式替身 |
| 核心认知 → 记忆 | MemoryQueryPort、FactChangeFeed | 来源与版本契约一致；双方可分别验证提供者/消费者 |
| Agent/业务 → 工具 | ToolExecutionPort / ToolGateway | 本地授权与执行归 Runtime；各模块可自行提供测试宿主 |
| Goal/业务 → 存储与证据 | 公开 Storage、CoordinationStore、Evidence/Artifact 端口 | 使用模块独立数据及固定夹具，生产接入随工作包完成 |

接口是否 frozen、provisional 或 unavailable 以 [当前接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md) 和实际公开 exports 为准；本表不复制过时状态，不私设第二套 wire DTO。接口成熟度只约束消费和声明方式，不成为等人审批的理由。

## 7. 工作包与完成标准

每个模块必须交付：目标 profile、公开入口、消费的接口版本、README、Fake/夹具、代表性验证、接入说明、已知限制和真实验证条件。当前新增工作默认以 Competition Profile 验收；只有接口冻结不等于模块完成，只有 Fake 通过也不等于真实服务可用。

模块负责人从最新 main 或明确固定的依赖提交建立分支，独立完成必要集成与自审。合并必须满足两人本机阅读确认、审批和对应检查；实际集成且达到工作包验收后才能更新 done。整体 MOD 和真实服务完成度仍按原验收范围判断。
