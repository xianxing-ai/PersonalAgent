# 开发计划与进度

更新：2026-10-08 · 本轮审查基线：main@efbfbdd2 · 项目主要负责人：zemeng / zemeng5208 · 整体 MVP：in_progress；代码集成、CI 与真实服务/设备验收分别记录

本文维护工作状态，需求以 PRD 为准，当前交付顺序以[华为 ICT AgentArts Competition Profile](competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)为先。模块负责人和独占目录唯一登记在 [模块分工](MODULE_ASSIGNMENTS.md)，契约见[公共开发协议](DEVELOPMENT_PROTOCOL.md)，逐接口冻结和可用性见[当前接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)。`goo122` 负责共享底座、公共协议、Runtime、工具、知识与记忆；`zemeng` 负责 Competition Profile、AgentArts、核心认知和桌面执行；`Potatos498` 独立负责 MOD-20～26、MOD-34/35/38 及业务接线；三人各自验证和交付，不等待另一人的 PR 批准。历史作者与证据保留。Local Profile 只作为可选保留，不进入当前比赛退出条件。阶段不代表承诺日期；正式排期需根据比赛时间、团队人数和接口验证结果确定。

### 2026-10-08 最新状态与本轮集成

- 分工 PR #299/#300 已合并：zemeng 保持核心、AgentArts 和桌面执行；goo122 负责 MOD-33/36/37，Potatos498 负责 MOD-34/35/38。三人独立交付和自审，不恢复指定人员审批或集中验收门槛。
- #298 已合并 Windows Job helper CI 执行；#301 已合并失败 GitHub job 空日志拒绝；#303 已合并代码预审 diff 缓存的 Evidence 保留；#304/#305 已合并私人记忆控件刷新及控制器关闭后拒绝来源访问。审查基线 efbfbdd2 的 Foundation run 37731330132 成功。
- #302 交付核心认知恢复、Goal/Fact 绑定、Desktop 状态/语音生命周期及 AgentArts 参数与观测接线。本轮整合最新 main，保留双方进度及私人记忆修复；实际合并和检查状态以该 PR 与 Git 为准，不把原 head 的 CI 成功冒充整合后检查。
- #291 为 MOD-34 真实验收草稿；相对当前 main 只新增 `brokenAcceptanceAnchor` 验收锚点，没有待集成产品修复，继续保留为不合并的验收证据。
- 真实 Competition 同批 Golden Path、请求级部署版本/trace/usage/费用、发布回退、物理 ASR/TTS/Live/Wake、Windows F9/UIA/DPI，以及业务账号和私人记忆确认写入/重启/删除仍按各包记录分别验收。历史合成或只读回执不提升这些状态；MOD-37 和未选社交平台未因本轮合并自动开工。

### 2026-10-07 分工重置（历史登记）

用户继续负责 zemeng 核心认知、AgentArts 和桌面执行主线；goo122 负责基础运行时/知识记忆，Potatos 负责业务能力及 CI/测试/Issue 修复链。DEV-WORKFLOWS 六项由 goo122（33/36/37）与 Potatos（34/35/38）各三项，zemeng 专注核心与 AgentArts，不集中代验。取消集中验收、指定他人 PR 批准和唯一集成槽；各自按公开契约、必要检查和自审独立交付。具体目录及跨模块修改规则以 MODULE_ASSIGNMENTS 为准。本修订覆盖同日较早的临时全部接手安排；远端 main 已核对无强制审批规则，本轮未修改远端权限或保护设置。

### 2026-10-07 项目状态与接续入口（历史快照）

- 已 fetch/prune 并同步主目录和当前工作树到 `4d15f06312745c45412c3d9caf6086fa16a99436`。该 head 的 Foundation run `37563282512` 已完成且结论 success；本轮没有重跑全仓、真实模型或桌面验收。
- #294 已于该 head 进入 main；#297 已于 `813fb727` 进入 main。旧“等待集成”描述已修正。新增修改仍需对应检查与负责人自审，同行评审按需进行。
- 当前开放 #298：CI Windows Job helper 回归执行增量，head `7480feb1719aed04a7f4a59dfc24854fd45b8aa0`，未读回批准。保持 review，不因本轮接手自动合并。
- 当前开放 #291：Potatos 的 MOD-34 真实验收草稿，head `d911e561b8bcf1d9a1a3d327ce6e056fed44a952`，PR 明确标注不应合并。保留真实失败、patch/tsc/commit 与人工收尾的证据边界。
- 当前主对话接替旧统筹和开发入口。旧对话已经归档；工作树备份、目录清理与恢复入口见 [接手记录](PROJECT_TAKEOVER_20261007.md)。历史分支及证据继续可恢复。
- 下一步依次收口 各自负责工作包的自审/集成（含 #298）、恢复真实宿主配置和未公开原始证据，再按 Competition、Desktop/Live、业务账号与 Windows/知识恢复的实际缺项验收。该顺序是继续入口，本轮未启动这些账号或服务操作。
- 本轮分工文档交付分支为 `codex/project-takeover-20261007`，提交与远端推送状态以 Git 为准；未修改远程 Issue #212。GitHub 账号读回具有 admin 权限；没有更改协作者的远程权限。

下文的日期段落是历史快照，不能覆盖本节和已合并事实。模块 `done` 仅限原工作包验收范围，不能推导整版 MVP 或最新实机已验收。

### 2026-09-20 主分支状态更新（历史快照）

- PR #49 已合并为 `7f57f46b`：Competition Runtime 的离线 `tool_proposal → waiting_approval → allow_once → ToolGateway → continuation` 循环已集成；原始任务 deadline、审批过期、取消、幂等和载荷上限由测试覆盖。该证据仅为 Fake/离线，不代表真实 AgentArts 工具闭环。
- PR #54、#77 已集成 Desktop 取消受理语义和过期审批 fail-closed 展示；Desktop 仍没有完整真实比赛链验收。
- PR #69～#76、#79 只合并到了各自堆叠基线分支，并未进入 `main`；其工作区、语音、记忆和认知增量只能作为待重建候选，不能计为主分支能力。
- PR #58 已进入 `main`，提供固定合成评估 runner；PR #79 仅在堆叠语音分支。两者都不是模型质量、真实麦克风或 AgentArts 成功证据。
- PR #80 仅合并到旧 `codex/competition-tool-loop` 分支，尚未进入 `main`；PR #81 已进入 `main` 并修复通知摘要毫秒精度；PR #83 以 `086b9674` 进入 `main` 并交付受限 `workspace.list` / `workspace.read_text`。当前文档基线以接口目录页首为准。
- 旧 #63、#65、#68 已关闭且未直接进入 `main`；#83 已重建工作区列表/读取，#84 已作为 #68 的替代 PR 合入 Competition 审批消费链。当前开放的 #51、#78 仍为 Draft；#56、#61、#62 与最新主分支冲突，不能作为已集成能力计算。旧状态文档 PR #48 已被本次更新替代。

### ARCH-03：Runtime Application 自主管理任务分派

- 负责人：`goo122`；评审者：`zemeng` 或 `Potatos498`。
- 分支：`codex/arch-03-runtime-dispatch`；状态：`done`（PR #24 已合并为 `0f7dc1e`）。
- 范围：Runtime Application 持有 `TaskRuntime`、文本应用和活动执行注册表；`task.submit` 成功后由 Runtime 自动启动文本任务；Desktop 只提交任务、订阅事件、展示状态和管理可信模型配置。
- 验收：公开 `@personal-agent/runtime/application` 入口；重复提交不重复执行；Unavailable、取消、事件顺序和活动任务关闭保护有测试；Desktop 架构门禁禁止 Agent/Model 直连、旧 `runtime/text` 入口和直接 `runTask`。
- 限制：仍是 Electron 主进程内的 Runtime Application，不是独立守护进程或 IPC 服务；ARCH-03 本身未冻结工具或思考参数。PR #26 后续加入可选工具装配，但真实盘古和外部账号仍未调用。
### ARCH-01：目录与依赖治理

- 负责人：`goo122`；评审者：`zemeng` 或 `Potatos498`。
- 分支：`codex/architecture-standard`；状态：`done`（PR #16 已由非作者评审并于 `87d0974` 合并）。
- 范围：项目目录规范、ADR、模块模板、架构门禁，以及移除 `packages/agents → apps/runtime` 反向生产依赖；不新增业务能力、不拆 Runtime 进程、不移动其他协作者 worktree。
- 验收：根级生产 `src/` 移除；`npm run check:architecture` 已检查 11 个 workspace 的 README、公开入口、依赖声明、依赖方向、连接器边界、公共 exports、跨包相对导入和循环依赖；全 workspace 类型检查通过，测试 106 项为 105 通过、1 项真实 Open-Meteo 验收按设计跳过。
- 完成边界：已满足目录、依赖门禁和测试验收，并完成非作者评审与主分支合并；ARCH-01 不包含 Runtime 进程拆分或 Agent/Model 编排迁移。

### ARCH-02：Runtime Application 编排边界

- 负责人：`goo122`；评审者：`zemeng` 或 `Potatos498`。
- 分支：`codex/arch-02-runtime-application`；状态：`done`（PR #21 随堆叠集成在 PR #24 回流 `main`）。
- 范围：将 Agent/Model 选择、ModelGateway、文字 Agent 执行、Fake/Unavailable/Pangu 模式和连接测试移入 `apps/runtime/src/application/`；通过 `@personal-agent/runtime/text` 公开入口供 Desktop 调用。
- 不在范围：不拆 Runtime 进程、不新增 IPC 协议、不把 API Key 暴露给 Renderer、不接入工具调用或真实付费模型。
- 验收：Desktop Electron 生产代码不再导入 `@personal-agent/agents` 或 `@personal-agent/models`；Runtime 显式声明 Agent/Model 依赖；Fake、Unavailable、取消语义保持有效；架构门禁、全 workspace 类型检查和全仓测试通过。
- 剩余限制：模型配置与 Windows 加密存储仍由可信 Desktop 主进程负责；PR #26 后续提供可选工具装配，但真实模型工具链未验收；Runtime 仍是 Electron 进程内的模块化应用层，不等同于独立守护进程。

## 1. 里程碑

### COMPETITION-01：华为 ICT AgentArts Competition Profile（2026-09-09）

- 决策：项目参加华为 ICT 大赛创新赛道的 AgentArts 赛题；当前只实施 Competition Profile，通用 Local Profile 可选保留。
- 主路径：Desktop/Voice → Runtime/World State/Goal/Event → AgentArts Agent/Workflow → Tool Proposal → 本地 Policy/Approval/ToolGateway → 目标系统读回/Evidence → AgentArts 最终结果。
- 强制边界：AgentArts 必须真实承担构建、编排、评估与部署；云端不能持有本地授权或设置本地任务终态；正式 Demo 不静默回退 Local。
- 当前状态：架构 `accepted`；AgentArts Adapter、云端部署/API、Golden Path、统一世界状态和评估均为 `unavailable`。
- 依据：[Competition Profile](competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)、[ADR-0007](adr/0007-huawei-ict-agentarts-competition-profile.md)。

### INTERFACE-01：分层接口冻结（2026-09-09）

- 决策：不冻结整套 wire 1.0.0，只冻结有完整证据的 Core Runtime Profile 1；其余接口逐项登记为 `provisional` 或 `unavailable`。
- 冻结范围：Request/Response/Event 信封与错误语义，`system.handshake`、`task.submit/get/list/cancel`、`conversation.list`、`approval.list` 及 TaskSnapshot 基础字段。
- 证据：PR #31 会话上下文已合并；PR #34 实现提交 `e5e20cad16566c6bdf821b7880efad96f0513ef1` 已由 `zemeng` 非作者批准、Foundation CI 通过并合并为 `bcbeaa2`；Desktop 通过公共 Client 恢复任务、会话和脱敏审批。
- 不冻结：事件订阅生命周期、Host 生命周期、Model/Agent/Tool、持续授权、Evidence/Artifact、设置、连接器、语音、知识/记忆、MCP/Skills、Windows、AgentArts 与分发。
- 依据：[接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)、[ADR-0005](adr/0005-layered-interface-freeze.md)、[Runtime 查询接口](modules/RUNTIME_QUERY_API.md)。

### MOD-04/05 离线验收增量（2026-09-07，已集成）

历史工作包负责人 goo122；分支 `codex/mod-04-05-acceptance`；PR #26 已合并为 `29bf54a`。本轮新增文字 JSON 工具提案、模型网关超时取消、SQLite 授权与参数绑定、持久审批和 Agent 恢复、工具执行证据与幂等重放。全仓 check、18 项定向测试和两项桌面 smoke 通过，详见[本轮验收记录](modules/MOD-04-05-ACCEPTANCE.md)。后续模型与 Agent 工作按 MOD-04A（goo122）/04B（zemeng）拆分，历史归属不变。

离线工作包已完成非作者评审并集成。真实模型与天气组合调用仍未执行，因此 MOD-04/05 整体保持 review；已补齐任务级持久授权、审批恢复和 Evidence，但不代表跨任务持续授权、真实 SecretStore、流式、多 Agent 或真实写入恢复已经完成。真实盘古验收仅在 Local Profile 以后被明确启用时安排，不阻塞当前 AgentArts 比赛路径。

| 阶段 | 交付 | 退出条件 | 当前状态 |
| --- | --- | --- | --- |
| M0 设计基线 | PRD、架构、协作规范、工作包 | 文档检查通过；待决项登记 | 已建立并在 2026-09-09 同步分工、接口目录和 ADR |
| M1 基础闭环 | 窗口、Runtime、盘古、工具、语音基础 | 真实请求到工具与验证链路；取消有效 | MOD-01/02/03 已集成；Core Runtime Profile 1 已冻结；真实模型工具链未完成 |
| M1.5 Competition Profile | AgentArts 基础、Agent/Workflow、部署 API、可信工具 Golden Path、Demo/trace | AgentArts 构建/编排/部署可读回；一条真实工具闭环；不静默回退 Local | main 已有离线 Coordination、审批工具循环和固定合成评估；#72 的 Workflow 输入已进入 main，真实部署/API/trace 与工具读回未完成 |
| M1.6 持续认知创新 | 版本化世界状态、Goal/Event、目标/事实/决策图谱、最小计划修复 | 事实变化产生可回放影响；AgentArts 只更新受影响计划；Evidence 闭环 | main@4b5ec614 已有版本图、SQLite/Fake 原子 appendBatch、显式修复预览/提交及公开 Memory 查询/变化流和持久事实投影；默认私人 Calendar 来源绑定及真实 AgentArts/Evidence 闭环仍未完成 |
| M2 首次可用 | Obsidian、提醒、研究天气、TraceGuard 只读、全部 P0 | 所有 P0 逐项验收，不只演示单场景 | 天气、待办/日历 Fake、研究源和部分只读工具已集成；完整 P0 与真实账号验收未完成 |
| M3 信息管家 | 邮件、日历、订阅、通知、专业协作 | 真实连接器增量同步与授权写入验证 | 邮件、订阅、通知策略已集成；桌面通知消费、完整真实账号与授权写入验收未完成 |
| M4 行动与扩展 | 电脑控制、编程、治理、流程学习、社交扩展 | 指定应用可控可验证；平台能力矩阵有证据 | 受限工作区列表/正文读取已由 PR #83 进入 main，仍为 provisional；Windows 操作、写入与治理闭环未进入 main |
| M5 参赛/分发 | 演示、打包、技术贡献材料 | 规则核验、真实证据、隔离安装运行卸载 | 未开始 |

## 2. 模块执行台账

模块状态以已合并代码和可复现证据为准；PR 合并不自动把整个 MOD 标记为 done。MOD-01/02/03 已完成基础底座，MOD-04/05 与 Competition 工具循环已有离线证据；MOD-20～25 的当前增量均已进入主分支。真实 AgentArts、真实设备、外部账号和写入读回仍分别验收。每行可拆多个子任务，只有全部约定交付通过后模块才为 done。

| 模块 ID | 计划阶段 | 状态 | 当前执行人 / PR / 证据 |
| --- | --- | --- | --- |
| MOD-01 | M1 起步门槛 | done | goo122 / PR #1 / 合并提交 dbbc547 / 构建、迁移和存储测试通过 |
| MOD-02 | M1 起步门槛 | done | goo122 / PR #1 原始 14 operation；PR #34 增至 17 operation 并完成 Desktop 消费验证；只冻结 Core Runtime Profile 1，不冻结整包 |
| MOD-03 | M1/M2 | done | goo122 / PR #5 / 合并提交 e14aebf / 7 项 Runtime 测试及评审通过 |
| MOD-04A | Local Profile 可选模型层 | review | `goo122` / 历史 PR #10、#11、#26 已合并；ModelGateway、Pangu 文本 Provider、JSON 提案适配离线通过；代码保留，但新增 Local 能力不进入当前比赛优先级 |
| MOD-04B | Competition Coordination；Local Agent 可选 | review | `zemeng` / PR #36、#49、#72（Workflow 输入）、#80（continuation 边界）均已进入 main（2026-09-30 台账核对），离线审批工具循环已验证；真实 AgentArts 调用和多 Agent 结果仍未验收 |
| MOD-05 | M1/M2 | review | goo122 / PR #7、#26、#49 已合并；任务级 SQLite 授权、参数绑定、审批恢复、工具 Evidence、幂等重放和 Competition 离线工具循环已验证；跨任务持续授权、真实 SecretStore 和真实写入恢复尚未完成 |
| MOD-06 | M2 | todo | 未启动 |
| MOD-07 | M2 | todo | 未启动 |
| MOD-08 | M2 | in_progress | `goo122` / PR #93～#95、#97、#98 已经非作者评审并合并；只读端口、脱机及 Obsidian 只读适配器、Policy 检索工具和公开演示资料的 Competition Fake 审批链均完成离线验收。真实私人 Vault 授权/验收、生产注册、可安装插件、私人结果出机控制和 LLM Wiki 未完成 |
| MOD-09 | M1.6/M4 | in_progress | `goo122` 保留在途范围，P7/P8 剩余按当前分工交接；#285 同步消费/实际父子副本、#289 官方 MCP/SQLite 学习验证和 #294 撤回管理/删除恢复已进入 main，#304/#305 原生控件及来源状态保护也已合并。2026-10-08 在 main@74b64c35，按用户逐条确认的 A/B 完成真实 Vault 来源、原生保存/更正、重启读回、撤回、全部历史及回执删除、再次重启无复活；原笔记哈希不变，无云任务；同 head Foundation attempt 2 成功，首次失败保留。Memory 44/44、相关定向 49/49、Desktop 703 通过/2 跳过为 cc64ebdf 基线结果，#307 仅改测试等待时间，后续 main@e86bac53 仅交接文档变化；见 [本次记录](modules/MOD-09-REAL-LOCAL-LIFECYCLE-20261008.md)。用户规范要求的非作者评审、完整 parent→child 许可、真实 AgentArts 消费及真实用户流程仍待核对/验收；详见 [收口验收矩阵](modules/MOD-09-PA020-MVP-PRODUCTION.md#2026-10-06-收口验收矩阵2026-10-07-更新)；接口 provisional，不能将本地通过记为整个模块 done |
| MOD-10 | M4 后研究，无交付日期承诺 | todo | 未启动 |
| MOD-11 | M1 | in_progress | `zemeng` / main@4b5ec614 已具受控 IPC、本机桌面设置/恢复及 SIS/Live 宿主消费；#75 已进入 main（非仅语音堆叠）。当前开发 #302 尚未合并；DPI/透明命中、真实崩溃和比赛实机验收仍未完成；[源码核对](../apps/desktop/README.md#2026-10-07-原功能源码核对) |
| MOD-12 | M1 | in_progress | `zemeng` / main@4b5ec614 已具文字交互、公开会话/任务恢复、取消、大工作区及 Live 发言持久化与每会话偏好；显式会话管理 API 未公布，真实 AgentArts 对话、工具回传及语音组合仍待端到端验收；当前开发 #302 尚未合并 |
| MOD-13 | M1 基础页面、M2 配置闭环 | in_progress | `zemeng` / main@4b5ec614 已具过期审批 fail-closed、脱敏历史分页、受信宿主任务级撤销读回、AgentArts 加密配置/撤销与启动状态消费；生产 settings/connector wire API、跨任务持续授权与真实云验收仍未完成；当前开发 #302 尚未合并 |
| MOD-14 | M1 基础、M2 验收 | in_progress | `zemeng` / #61/#70/#75/#79 已进入 main；main@4b5ec614 已装配 Huawei SIS 听写/WAV 播放、授权 PCM 与原生 Live（听写不自动发送，停止不取消任务）。本机入口不等于 voice.start/stop wire 已公布；真实 SIS、设备、网络续连及 Desktop/AgentArts 联合验收仍待取得回执；当前开发 #302 尚未合并 |
| MOD-15 | M4 后扩展 | in_progress | `zemeng` / main@4b5ec614 已有 voice-wake 根 build/锁文件、有界生命周期、共享 PCM 限定词源及 bindVoiceWake，尚无 Desktop 组合；[PR #302](https://github.com/zemeng5208/PersonalAgent/pull/302) 新增默认关闭、可信可见面板显式启用、最长 10 分钟的共享 PCM 唤醒/听写组合，关闭未确认时锁住本进程新捕获；尚未合并，中文引擎、命中、误触、回声及物理释放仍待 Windows 实测，见[生命周期记录](modules/MOD-15-WAKE-LIFECYCLE-01.md) |
| MOD-16 | 受限记事本执行与实机验收 | in_progress | `zemeng` / Host、Bridge、Runtime 导出与 Desktop 受信确认消费已实现；仅在 Windows 和固定 Host/Bridge 可用时装配受限记事本能力。历史实机证据仅到 `hello_ack`，完整 F9 确认、Policy 授权、UIA 写入及独立读回仍待现场验收，见 [模块记录](modules/MOD-16-WINDOWS-EXECUTION-01.md) |
| MOD-17 | 只读系统观测与实机验收 | in_progress | `zemeng` / CPU、内存与 uptime 提供者、Runtime 工具注册和 Desktop 只读消费已实现；已有 Windows provider 直读证据，完整 Policy/ToolGateway、AgentArts 与 Desktop 实机闭环未验收，见 [模块记录](modules/MOD-17-COMPUTER-STATUS-01.md) |
| MOD-18 | M4 | in_progress | `zemeng` / main@4b5ec614 已有 WorkspaceConfigHost 条件注册受限读取/枚举、补丁预览/暂存/应用与固定命令及进程/任务绑定许可；“写入和命令未交付”为历史滞后。Artifact 服务、真实项目写入/命令、Windows 恢复与 AgentArts 联合验收未完成；当前开发 #302 尚未合并；[消费边界](modules/MOD-18-DESKTOP-WORKSPACE-SETTINGS.md) |
| MOD-19 | M5 | todo | `zemeng` 已确定，未启动 |
| MOD-20 | M2 本地提醒、M3 日历 | in_progress | `Potatos498` / PR #22 已合并（Fake 日历）；#216 合并 iCal 只读订阅源；MOD-20A 交付 CalDAV 只读提供商（ctag/etag 轮询＋time-range 查询＋TZID 换算，20/20 离线测试，见 2026-09-30 登记）；真实日历账号读回与授权写入仍未验收 |
| MOD-21 | M3 | review | `Potatos498` / PR #28 已合并为 `42db8f51`；QQ 增量同步、安全发送语义和受控真实读回已有证据，完整账号生命周期与长期稳定性未验收 |
| MOD-22 | M3 | done | `Potatos498` / PR #8 已合并（RSS 2.0/Atom 增量、趟水位线分页修复、真实源读回验证） |
| MOD-23 | M3 | review | `Potatos498` / PR #27、#81 已合并；通知裁定、持久批次、ack、DST 和毫秒摘要窗口已验证，后续 #266 已接入 Desktop 持久设备回执与安静策略；真实通知及源到展示的整条验收仍按原证据缺项核对 |
| MOD-24 | M2 | review | `Potatos498` / PR #47 已合并为 `2117908a`；OpenAlex、Fake、缓存三态和三项来源披露已验证，长期真实服务稳定性仍为 conditional |
| MOD-25 | M2 | done | `Potatos498` / PR #4、#12、#23 与 Runtime 装配 PR #9 已合并；GeoNames 增强下 26 个世界大城市简体查询 26/26 高置信，真实门控测试 66/66；2026-09-30 置信度收口：`PPLA2`–`PPLA5` 次级席位不再无条件判 `high`（新增 `minMinorSeatPopulation` 默认 100000，实测空档 14574↔211151），GeoNames 已证名可佐证任意人口档；`开罗+Cairo` 提示串用例随之修复；manifest 仍为 `conditional`，不等于长期生产稳定性验收 |
| MOD-26 | M4 起逐平台验收 | todo | `Potatos498` 负责；当前未选定平台工作包，未因分工重置启动 |
| MOD-27 | M1.6 | review | `zemeng` / main@4b5ec61 已有版本图、SQLite/Fake 原子 `appendBatch`、受控 Goal 工具及公开 Memory 查询/变化流的持久投影与确认消费；真实来源、私人数据授权及删除现场验收未完成，见[当前能力矩阵](modules/MOD-27-28-INTEGRATION-HANDOFF.md#当前源码能力与验收矩阵2026-10-07) |
| MOD-28 | M1.6 | in_progress | `zemeng` / main@4b5ec61 已有 KEEP/RECHECK/REVISE 回放、事实投影消费、Goal 创建/修订触发及经 Runtime/Policy/CAS 的受控修复；默认 P5 Calendar 尚缺可信来源版本→Fact ref→completed projection 绑定，真实 Laya/AgentArts 与 Evidence 现场闭环未验收，沿 [#212 既有交接](modules/MOD-28-REVIEWED-REPAIR-01.md#默认-p5-会议链与可信来源交接2026-10-07)继续 |
| MOD-29 | M1.5 第一优先 | in_progress | `zemeng` / AgentArts Runtime 适配与配置入口已有 provisional 实现；真实项目、版本、部署、API 和 trace 读回仍无成功证据 |
| MOD-30 | M1.5 第一优先 | in_progress | `zemeng` / PR #49、#72（Workflow 输入）、#80（载荷边界）均已进入 main（2026-09-30 台账核对），工具提案/审批/continuation 离线链可用；真实 MCP/Skill 与目标系统读回未完成 |
| MOD-31 | M1.5/M3 | in_progress | `zemeng` / PR #58 的[固定合成分类 runner](../tests/manual/agentarts/support/fixed-synthetic-batch.mjs) 已进入 main；[PR #302](https://github.com/zemeng5208/PersonalAgent/pull/302) 新增三标签配对、固定最小修复及同集配对修复入口，显式端口、1～3 次有界重复，只报告限定评分和实际等待耗时，见[评估记录](modules/MOD-31-FIXED-EVALUATION-01.md)；尚未合并，真实角色协作、平台对照与效果评估仍未完成 |
| MOD-32 | M1.5/M5 第一优先 | in_progress | `zemeng` / main 已有手动验收脚手架及历史发布/健康/条件关联 trace 记录；[PR #302](https://github.com/zemeng5208/PersonalAgent/pull/302) 新增显式只读 ShowOpsTrace helper 与脱敏消费验证，尚未合并，见[观测边界](modules/MOD-32-AGENTARTS-OBSERVABILITY.md)；实际 SDK 签名 Provider、账号权限读回、当批请求/部署版本精确关联、费用、回滚和端到端证据仍缺，离线 Fake 不算平台验收 |
| MOD-33 | M6 产品化 | review | `goo122`（2026-10-07 接续；历史作者不变） / #277 与 #297 已合并；新工作包拒绝失败 job 的空 CLI 日志，并在 Windows/gh2.97 完成真实六页只读读回；MOD-33/36 受影响回归 139/139，交付与剩余边界见 [日志验收记录](modules/MOD-33-LOG-READ-ACCEPTANCE-20261007.md)。历史连接器生命周期修复见 [接续记录](modules/DEV-WORKFLOWS-CONTINUATION-20261005.md)；不将只读证据提升为全部账号写入验收 |
| MOD-34 | M6 产品化 | review | `Potatos498`（2026-10-07 接续；历史作者不变） / #277/#290/#297 已合并；历史真实 GLM→审批→patch→tsc→commit 有回执，push unknown 后核实与 PR 创建为人工收尾（#291 不合并）；最新代码的完整自动写入及设备场景仍待对应验收 |
| MOD-35 | M6 产品化 | review | `Potatos498` / #279 的确定性定位器与 zemeng #282 的源码边界、真实 TAP 修正已组合；定向 9/9，完整 coding-tools 55 通过、11 个 Windows 跳过；#279/#282 实现已进入 main，后续改动及真实消费分别验收，见 [登记与验收记录](modules/MOD-35-TEST-LOCATE-01.md) |
| MOD-36 | M6 产品化 | review | `goo122`（2026-10-07 接续；历史作者不变） / #277/#297 已合并；新工作包保留 diff 缓存的 Evidence 引用，旧缓存经原端口刷新；真实 GitHub/Fake 模型/SQLite 恢复和拒绝评论通过，见 [恢复验收记录](modules/MOD-36-EVIDENCE-CACHE-20261007.md)。历史真实 gh+GLM 只读预审仍保留；真实评论写入及最新原场景验收分别记录 |
| MOD-37 | M6 产品化（登记） | todo | `goo122` / API 文档自动维护（exports/接口目录↔docs 漂移比对→文档补丁 PR），负责人自审，同行评审按需；仅登记未开工 |
| MOD-38 | M6 产品化 | review | `Potatos498`（2026-10-07 接续；历史作者不变） / #277/#297 分类、模型 framing、取消/期限与端口绑定修复已合并；Local 增量不计入比赛退出条件，真实标签/修复 PR/Issue 回链仍待验收 |


DEV-WORKFLOWS 历史真实验收：MOD-36 已取得只读模型预审回执；MOD-34 已取得 patch/tsc/commit 及人工 push/PR 收尾回执（#291 是不合并产物），证据与结论见 [真实验收记录](modules/DEV-WORKFLOWS-REAL-ACCEPTANCE-20261005.md)（2026-10-05）。

### 2.1 开工顺序与阻塞边界

1. Core Runtime Profile 1 已冻结，可供 Competition Profile 复用；事件/Host/Agent/Tool 等未冻结面固定精确提交并保留迁移空间。
2. main 中的 provisional Coordination/CloudAgent、ToolExecution 与受限工作区列表/读取只作为受控开发面；语音、记忆和认知堆叠分支必须先从最新 main 重建，不能用“已合并到非 main”冒充集成。
3. PR #84 已将 `Runtime → Fake AgentArts → workspace.read_text → waiting_approval → allow_once → ToolGateway → continuation → 最终回答/Evidence` 离线链合入 main，仍仅为 provisional/mock；PR #86 已在最新 `main@02191e8` 上重建 #56 的 Desktop 只读 AgentArts 配置状态，当前 `head@9058686` 的标准 CI 已通过，等待非作者评审与合并；其进入 main 后再准备 #78 的桌面组合。
4. 离线链稳定后再建立真实 AgentArts 项目、身份、Agent/Workflow、版本、部署和 API 读回；从第一天记录 deployment、trace、usage、失败和回滚。
5. 首条真实闭环必须包含只读工具提案、本地 Policy/ToolGateway、目标系统读回、AgentArts 最终回答和 Evidence；正式 Demo 不静默回退 Local。
6. 现有 `runAgent()`、ModelGateway、盘古/自有 Provider 代码保留为可选 Local baseline；当前不投入独立新功能，不计入比赛退出条件。
7. MOD-25 原工作包的 Potatos 完成记录保留；2026-10-07 最新修订恢复 MOD-20～26 的维护和剩余验收由 Potatos 独立负责。
8. 各负责人可随模块完成公共目录、锁文件、迁移和根装配的必要修改，附兼容说明与消费验证；goo122 负责长期维护。使用隔离分支处理共享文件，不等待指定集成人。

### 2.2 原工作包迁移关系

旧 W 编号保留用于历史检索，执行状态只更新上方 MOD 台账，不维护两套状态。

| 旧 ID | 新模块 | 拆分说明 |
| --- | --- | --- |
| W-001 | MOD-04A | 历史盘古环境验证工作；当前仅在 Local Profile 以后被明确启用时继续 |
| W-002 | MOD-01 | 根工程与存储底座 |
| W-003 | MOD-02、MOD-03、MOD-05 | 分开协议、任务和授权 |
| W-004 | MOD-11、MOD-12、MOD-13 | 分开外壳、悬浮交互与后台 |
| W-005 | MOD-04A、MOD-04B | 历史盘古 Provider 与主 Agent/专业协作拆分；现改由 Competition Coordination/AgentArts 优先 |
| W-006 | MOD-06、MOD-07 | MCP 与 Skills 独立交付 |
| W-007 | MOD-14 | 基础语音归 `zemeng` |
| W-008 | MOD-08 | Obsidian 归 `goo122` |
| W-009 | MOD-03、MOD-20、MOD-24、MOD-25 | 调度核心、日程、搜索、天气分开 |
| W-010 | MOD-17 | TraceGuard 适配归 `zemeng` |

## 3. 待决与风险

- 赛事：华为 ICT 创新赛道及 AgentArts 赛题已确认；仍需正式通知确认届次、截止时间、评分细则和提交材料。
- 模型：未验证盘古账号、具体部署、工具调用、成本与限流。
- AgentArts：仓库已有 provisional Runtime 适配、Workflow 输入和离线工具循环，但区域、真实项目/版本/部署、成功 API/trace、费用和日志条件仍未形成可复现读回证据。
- Profile：当前只实施 Competition Profile；若 Local 兼容工作抢占比赛主路径、或 Competition 失败后静默回退 Local，会造成赛题证据失真。
- 接口：只有 Core Runtime Profile 1 冻结；未提供能力若被 UI、Fake 或 Schema 误当作可用，会形成错误依赖。
- 平台：首批邮箱/日历/社交账号类型未知；先做可替换契约，不虚构全平台能力。
- 运行环境：Windows 兼容范围和基准机器待定。
- 自训练：首期仅偏好与流程学习；参数训练作为研究项。
- 视觉：尚无渲染稿；进入设计时使用用户指定的 Open Design 位置。
- 依赖：2026-09-06 `npm audit` 报告 AJV 8.17.1 存在 1 项中危 `$data` ReDoS 公告；当前实例未启用 `$data`，未发现现有路径可触发，仍应在独立维护 PR 中升级至修复版本并重跑契约测试。

## 4. 文档检查记录

- 2026-09-05：已建立 7 份 Markdown 文档（含 README 和 PR 模板）；仓库链接检查通过，23 个需求编号无重复、无未知引用。Git 已跟踪改动的差异空白检查通过。
- 2026-09-05：新增模块分工与公共开发协议草案；拆为 26 个模块并同步 `goo122`、`zemeng` 与待认领协作者职责，保留旧 W 编号映射。协议尚未冻结、SDK 尚未实现。
- 2026-09-05：检查 10 份 Markdown 文档，仓库链接及编号检查通过；23 项需求全部有模块承接，26 个模块全部进入台账，无重复模块编号或冲突标记。已跟踪差异空白检查通过。
- 2026-09-06：PR #1 已评审并合并，MOD-01/02 转为 done；登记第三位协作者 `Potatos498`。Windows CRLF 下生成文件检查误报已在 MOD-03 分支修复并通过根 check。
- 2026-09-06：登记 MOD-25 天气连接器工作包与执行人 `Potatos498`，同步台账状态、开工顺序与风险项；ROADMAP 相对链接与模块编号一致性检查通过。
- 2026-09-06：PR #5 已合并，MOD-03 转为 done；PR #4 合并最新 main、修复取消语义和静默启用 Fake 的问题，全仓 46 项测试通过，MOD-25 保持 review。
- 2026-09-06：MOD-25 接入 Open-Meteo 真实提供商，并合并上述评审修复（`provider` 必填、stale 回退收窄至可重试外部失败、取消语义、`retryAfterMs`）；更新工作包的交付、验收、证据与限制及台账证据。真实读回与模拟验证分开记录，manifest `verification` 由 `mock` 改为 `conditional`。实测：根 `npm run check` 退出码 0，模块 29 项（28 通过 + 1 项真实读回默认跳过）、全仓 62 项测试通过。ROADMAP 相对链接检查通过。
- 2026-09-06：MOD-25 修复地理编码跨语言解析缺陷。对生产端点实测发现：Open-Meteo 按语言分别建索引且不跨文字系统匹配，`zh` 索引为繁体且不完整，`New York` 在 `zh` 轮查不到纽约市却查到英格兰同名村庄，原实现因此把时区解析成 `Europe/London`。改为非英文配置下并行查询「配置语言＋`en`」两轮、按 GeoNames `id` 合并、名称完全相等优先再按人口降序排序，展示名仍取配置语言。模块测试由 29 项增至 34 项（新增 5 项离线测试，夹具取自真实响应）。实测：根 `npm run check` 退出码 0，全仓 67 项（66 通过＋1 项真实读回默认跳过）；`PA_WEATHER_LIVE=1` 下 21 项全部通过。仍未解决且已记入已知限制：简体书写的外国地名（`东京` 命中江苏同名地点、`纽约` 返回 `NOT_FOUND`），修复需简繁映射表，与零新增依赖约束冲突。ROADMAP 相对链接检查通过。
- 2026-09-06：PR #4 已合并为 main `9f27e9b`。由于 `0da1ccc`、`145fea0`、`b5eed33`、`4c0ec0f` 晚于 `goo122` 原批准，`goo122` 在独立工作树从最终 main 补做合并后审计：Node 24.15.0 / npm 11.12.1 下根 `npm run check` 通过，全仓 67 项为 66 通过＋1 项默认跳过；显式启用真实读回后 Open-Meteo 测试 21/21 通过。审计未发现新增提交破坏既有取消、错误映射或显式 Provider 注入，但确认两项完成阻碍：简体国外城市可误解析；未传日期时 `WeatherService` 按 UTC 日历日取默认值，可能与用户或目标地点当天不一致。MOD-25 保持 review。
- 2026-09-06：MOD-25 修复地点正确性与缺省日期两项审计阻碍（分支 `fix/mod-25-geocoding`，PR #12）。对生产端点实测确认前一轮「两轮查询使解析与语言无关」的声称对中文输入不成立：`language` 同时决定搜索名字集，任何中文串在 `en` 轮恒返回空。改为检索轮由输入文字决定；用 `feature_code` 与人口下限 500000（实测空档 422324↔8804190）判 `confidence`；`locationQuery` 作兜底轮；`strict` 改拒绝低置信度；缺省日期按目标地时区取当地日。实测：根 `npm run check` 退出码 0，全仓 119 项 116 通过＋3 跳过；`PA_WEATHER_LIVE=1` 下 38/38 通过。ROADMAP 相对链接检查通过。
- 2026-09-07：现有 PR 验收同步：PR #12 已由 `goo122` 批准并合并为 `5b833c9`；PR #8 已通过 `goo122` 代码评审且 Foundation CI 通过，但因 PR #12 先合并而与 main 冲突，等待 `Potatos498` 更新分支；PR #19 的 CI 通过但作者为 `goo122`，按协作规范等待非作者评审。PR #16（ARCH-01）与 PR #18（桌面交互里程碑）均已合并，相关模块状态按当前未完成边界更新。
- 2026-09-07：登记 MOD-25 增强工作包「地理编码 GeoNames 第二源」（分支 `feat/mod-25-geonames`，用户明确授权）。动机与实测证据：合并 main 后对 26 个世界大城市以简体中文查询，16 高置信命中、7 个 `NOT_FOUND`（纽约/首尔/温哥华/利马/内罗毕/伊斯坦布尔/胡志明市）、3 个低置信误解析（东京→江苏、伦敦→安大略、罗马→昆士兰）、1 个高置信静默错误（开罗→美国伊利诺伊州 Cairo，PPLA2 人口 1733 被 `ADMIN_SEAT_CODES` 无条件信任，而埃及开罗根本不在 `zh` 索引返回里）。范围：`OpenMeteoProvider` 增加可选 `geonamesUsername`（装配层注入，不进仓库），配置后对汉字输入增加 GeoNames 官方 API `name_equals` 精确名检索层——返回 geonameId 再经 Open-Meteo `/v1/get?id=` 取规范记录（时区/人口/feature_code 齐全，两源同为 GeoNames id 可按 id 合并），命中即「输入串是该地点已知名」的精确语义，参与 exact-match 排序。`secure.geonames.org` 已实测可达（免费账号，日 3 万次额度）；Wikidata/Nominatim 从本机不可达已排除。失败语义：GeoNames 层任何错误降级为跳过该层，回退现有 Open-Meteo 行为。不在范围：`ADMIN_SEAT_CODES` 置信度规则收紧与提示串 exact-match 修复（另行授权）、显示名简繁统一、非汉字输入的第二源检索。本条只是登记，本工作包尚无实现、无测试证据。
- 2026-09-07：MOD-25 增强工作包「地理编码 GeoNames 第二源」实现完成。交付：`OpenMeteoProvider` 新增可选 `geonamesUsername`/`geonamesBaseUrl` 装配项；配置后汉字输入增加 GeoNames 官方 API `name_equals` 精确名检索层（并行于既有语言轮，展示名优先序置于最前），命中 id 经 Open-Meteo `/v1/get` 规范化（与搜索同 id 体系、同字段），`name_equals` 命中作为「输入串是已知名」参与 exact-match 排序（`伦敦`→`倫敦` 不同写法不阻断）；该层尽力而为——账号缺失不发请求、401/额度超限/网络失败降级为仅 Open-Meteo、`/v1/get` 404 只丢该候选、层内取消不被吞。manifest `configSchema` 与工具描述同步。实测：**26 个世界大城市简体查询从 16/26 高置信（7 个 NOT_FOUND、3 个误解析、1 个开罗静默错）提升到 26/26 高置信**（纽约→America/New_York、开罗→Africa/Cairo、东京→Asia/Tokyo 等）；根 `npm run check` 退出码 0；weather 包离线 66 项 62 通过＋4 项门控跳过，`PA_WEATHER_LIVE=1 PA_GEONAMES_USERNAME=<账号>` 下 66/66 全过（新增 GeoNames 端到端 live 测试）。账号不进仓库，由装配层从环境变量注入（README 已写明 `PA_GEONAMES_USERNAME` 约定与 `apps/runtime` 接线归 `goo122`）。未在本工作包内：`ADMIN_SEAT_CODES` 置信度规则收紧、提示串 exact-match 修复（`开罗+Cairo` 类场景现由 GeoNames 层覆盖，机制 bug 仍在）、显示名简繁统一。ROADMAP 相对链接检查通过。
- 2026-09-07：PR #24（ARCH-03）、PR #26（MOD-04/05 离线审批与工具执行）和 PR #25（Desktop 工作区与模型管理）已进入 `main`。合并后复查中，完整 `npm run check`、Runtime Application smoke 与文字 smoke 通过；基础 Electron smoke 仍保留 372px 旧断言而与 420px 实现不一致，workspace smoke 在当前 Windows/DPI 下出现 1.5px 居中偏差。用户决定先保留合并结果，这两项作为 Desktop 回归债务继续跟踪，不据此把 MOD-11/12/13 标为 done。
- 2026-09-07：登记 MOD-23 通知汇总策略工作包（分支 `feat/mod-23-notifications`）。用户本轮明确授权启动，台账由 `todo` 改为 `in_progress`。按 PROJECT_STRUCTURE §11 登记要素：负责人 `Potatos498`、评审者 `goo122`、独占目录 `packages/notifications/`、生产依赖仅 `@personal-agent/contracts`（MOD-03 Runtime 调度经结构兼容 `ScheduleInput` 的建议接入，不导入 apps——与 productivity 同款边界）。公共输入输出：`ConnectorItem` 标准事件流＋用户规则（安静时段〔IANA 时区、DST 安全、支持跨午夜窗口〕、暂停〔含恢复时刻〕、聚合〔窗口/条数上限/来源筛选〕）→ 通知裁定（立即条目或摘要请求，含裁定理由与所应用规则的披露）。Fake 验收：fake 时钟注入验证安静时段进出、暂停与恢复、聚合窗口关闭与上限触发、跨午夜与跨 DST 的安静窗口、dedupeKey 去重；工具经 FakeToolHost 的 schema/scope 校验。不在范围：通知展示（`zemeng` 桌面端）、调度执行（MOD-03）、真实事件源（feeds/calendar 由各自工作包提供）。本条只是登记，MOD-23 尚无实现、无测试证据。
- 2026-09-07：MOD-23 实现完成，台账由 `in_progress` 改为 `review`，模块设计补 [mod-23](modules/mod-23.md)。交付 `packages/notifications`（`@personal-agent/notifications`）：裁定次序＝暂停 > 聚合 > 安静；安静窗口经 `Intl` 换算 DST 安全（纽约回拨夜同一墙上时刻仍安静）、支持跨午夜（start>end＝晚段或早段）、含 start 不含 end；聚合窗口自最早未裁事件起算、`maxItems` 先到先触发、非聚合来源立即交付、摘要交付尊重安静；dedupeKey 去重含已交付持久标记；`planSchedules` 产安静结束与摘要关闭两条建议（scheduleId＝幂等键确定性，字段与 Runtime `ScheduleInput` 结构兼容、不导入 apps）；StoragePort 注入持久化待裁队列，无自有调度器/任务库；工具 `notifications.status` 只读（scope `notifications:read`），storage/policy 必填不静默降级。根 `package.json` build 脚本 +1 行（weather 之后）、锁文件 +14 行纯工作区链接（无新外部依赖），归 `goo122` 集成确认。实测：根 `npm run check` 退出码 0（架构门禁通过），notifications 12 项全过（安静判定/DST/去重/暂停恢复/聚合三触发/调度建议兼容性/工具校验），全离线无网络。ROADMAP 相对链接检查通过。
- 2026-09-07：登记 MOD-21 邮件连接器第一个提供商工作包「QQ 邮箱」（分支 `feat/mod-21-mail-qq`，按 MODULE_ASSIGNMENTS「邮件可按提供商拆分」）。用户本轮明确授权启动并指定范围仅 QQ 邮箱。按 PROJECT_STRUCTURE §11 登记要素：负责人 `Potatos498`、评审者 `goo122`、独占目录 `packages/connectors/mail/`（族入口，单负责人）。公共输入输出：账号游标/查询/动作 → 邮件页（`ConnectorItem`，`occurredAt`=邮件 Date 头的 UTC 瞬间，`sensitivity: 'private'`）、动作结果（`mark_seen` 幂等；`send` 为外部写——**发送超时映射为 `state: 'unknown'` 并要求先核对结果，同幂等键重放返回先前结果不盲重试**，对应 PA-014）。增量语义：游标 = `uidValidity:lastUid`，仅返回 UID 更大的新邮件；`uidValidity` 变化 → `CURSOR_EXPIRED`（与 feeds 同规则）。依赖决策：新增外部依赖 `imapflow`（IMAP，imap.qq.com:993）与 `nodemailer`（SMTP，smtp.qq.com:465）——理由：真实账号集成需要协议正确的客户端，自写 TLS 协议栈未经真实验证风险更高；`fast-xml-parser` 已有获批先例，归 `goo122` 评审确认。Fake 验收：分页与增量、重复事件不重复投递、游标过期、mark_seen 幂等、send 超时→unknown→同键核对不重发；工具经 FakeToolHost 校验。真实验收：QQ 邮箱 IMAP/SMTP 服务开启＋授权码（用户侧操作），live 测试以 `PA_MAIL_LIVE=1` + 环境变量门控，发送类 live 另设独立开关防止误发。本条只是登记，本工作包尚无实现、无测试证据。
- 2026-09-07：MOD-21「QQ 邮箱」工作包实现完成，台账改 `review`，模块设计补 [mod-21](modules/mod-21.md)。交付 `packages/connectors/mail`（`@personal-agent/mail`）：`MailProvider` 端口（listFolders/fetchPage/getMessage/markSeen/send）＋QQ 形状 Fake（收件箱 8 封含已读/无 Date 头/跨 DST 边界夹具）＋`QQMailProvider`（imapflow IMAP 读侧：UID SEARCH 增量、ENVELOPE+FLAGS 元数据、STORE \Seen；nodemailer SMTP 写侧：socketTimeout＋AUTH LOGIN；认证失败→UNAUTHORIZED、超时→TIMEOUT、连接故障→EXTERNAL_FAILURE）＋`MailService`（服务层聚合提供商分页至 limit；条目 `occurredAt`=Date 头、缺失回退抓取时刻并在 contentRef 标注、`sensitivity:'private'` 不含正文、`dedupeKey=folder:uid:messageId`）＋ConnectorPort 与只读工具 `mail.inbox`（scope `mail:read`）。**发送语义（PA-014）**：超时→`state:'unknown'`＋证据链 `unconfirmed`，同幂等键重放返回先前结果不产生第二次发送（离线测试固定）；`mark_seen` 幂等；`uidValidity` 变化→`CURSOR_EXPIRED`。外部依赖 `imapflow@1.7.8`＋`nodemailer@10.0.0`（MIT，锁文件 +288 行含传递依赖）与根 build 一行归 `goo122` 确认。实测：根 `npm run check` 退出码 0（架构门禁通过），全仓 164 项 159 通过＋5 项门控跳过（mail 2：live 读回/发送需授权码；weather 3），mail 离线 12 项全过。**QQ 真实链路未验证**（需用户开启 IMAP/SMTP 并提供授权码，双开关门控命令已写入 README），live 证据待补记后 `verification` 才能由 `conditional` 主张为已验证。ROADMAP 相对链接检查通过。
- 2026-09-07：登记 MOD-20 待办与日历工作包（分支 `feat/mod-20-productivity`）。用户本轮明确授权启动，台账由 `todo` 改为 `in_progress`。按 PROJECT_STRUCTURE §11 登记要素：负责人 `Potatos498`、评审者 `goo122`、独占目录 `packages/productivity/` 与 `packages/connectors/calendar/`、生产依赖仅 `@personal-agent/contracts`。公共输入输出：待办/时间 → 条目（含状态机与 revision）＋触发定义（结构兼容 Runtime `ScheduleInput`，`missedRunPolicy` 对应 PA-009 的补跑/标记错过，`taskIdempotencyKey` 防重复提醒）；日历账号/时间窗 → `ConnectorItem` 事件（`validFor` 承载起止区间）与 `respond` 动作结果（幂等键）。Fake 验收：注入 fake 时钟/日历/FakeStorage/FakeToolHost 验证 CRUD 读回、时区与 DST、触发确定性、窗口增量去重与动作幂等。真实验收：PA-013 的真实日历提供商授权读回留待独立后续工作包。本条只是登记，MOD-20 尚无实现、无测试、无真实读回证据。
- 2026-09-07：MOD-20 实现完成，台账由 `in_progress` 改为 `review`，模块设计补 [mod-20](modules/mod-20.md)。交付两个 workspace：`packages/productivity`（TodoService 状态机 open→done/cancelled 单向、revision 读回；时间解析 UTC↔本地双表示，DST 边界策略＝回拨取较早/跳跃向前推，单测固定纽约与悉尼的四个边界；ReminderTrigger 结构兼容 Runtime `ScheduleInput` 且不导入 apps——ADR-0002；`scheduleId=taskIdempotencyKey` 确定性防重复提醒；`missedRunPolicy` 对应补跑/标记错过；dispatch 回执映射 delivered/missed；StoragePort 注入持久化，不自建任务库）与 `packages/connectors/calendar`（Fake 提供商先行：窗口增量+分页聚合、dedupeKey 含 sequence、validFor 承载起止区间、跨 DST 夹具验证时区、`respond` 幂等键、ConnectorPort 全方法）。工具三个读/本地写（`todo.list/create/update`）+ 一个读（`calendar.events`），provider/storage 必填不静默降级。根 `package.json` build 脚本加两行、锁文件纯增量工作区链接（+28 行，无新外部依赖），归 `goo122` 集成确认。实测：根 `npm run check` 退出码 0（架构门禁通过），全仓 157 项为 154 通过＋3 跳过（weather 3 项真实读回默认跳过；本分支基于 main `e5a16c0`，不含未合并的 feeds）。未满足项：真实日历授权读回（后续工作包）、Runtime 接线（goo122）。ROADMAP 相对链接与模块编号一致性检查通过。
- 2026-09-08：PR #22 第一阶段修复（同步 main 624322c，解根 package.json/锁文件/ROADMAP 冲突）。①DST 回拨歧义统一取较早的 UTC 瞬间——修复快路径在转变附近静默选中较晚解释的缺陷（柏林 2026-10-25 02:30 此前解析为 01:30Z/CET，现按约定取 00:30Z/CEST；快路径增加 ±6h 偏移一致性短路条件，无转变时行为与性能不变）；②修改截止时间时重验既有提醒——due 提前到提醒之后而未同步调整 → INVALID_ARGUMENT；③日历搜索覆盖所有分页（翻页聚合，后续页的「夜班交接（跨 DST）」事件可命中；getItem/search 路径补 async）；④PR 正文把「PA-009 全部」修正为「PA-009 的离线模块工作包部分，真实通知投递链路属装配工作包」。验收：productivity 16 项（+柏林回拨/+改期重验）与 calendar 10 项（搜索测试扩展跨页断言）全过零回归；根 npm run check 退出码 0。ROADMAP 相对链接检查通过。
- 2026-09-07：PR #8 第四次解决与最新 main 的合并冲突（PR #19 删除无关报告、PR #20 状态同步、PR #21 Runtime 文字编排合入后再度 `CONFLICTING`），恢复可合并。仍仅 `docs/ROADMAP.md` 一处冲突：MOD-22 台账行按 main 侧同步记录更新评审状态（`goo122` 代码评审与 Foundation CI 已通过）并保留本侧完整证据链，main 侧「当前与最新 main 冲突、等待负责人更新分支」的表述随本次合并失效；变更记录保留双方条目。根 `package.json` 与锁文件自动合并。未使用 `reset --hard`、强制推送或清理未跟踪文件。实测：根 `npm run check` 退出码 0（架构门禁通过），全仓 207 项为 203 通过＋4 项真实读回默认跳过（与上一轮相同，PR #19/#20/#21 未改变测试计数）；`PA_FEEDS_LIVE=1` 重跑 74/74 通过（含两项真实读回）。ROADMAP 相对链接检查通过。
- 2026-09-07：PR #8 修复长 feed 分页缺陷（第一阶段修复计划）。根因：游标唯一去重结构 `seen` 同时承担「当前分页进度」与「历史去重窗口」两个职责，200 键上限在长趟中途淘汰头部条目，使其重新进入分页——超过 200 条的 feed 翻页死循环且重复投递。修复：CursorState 增加独立的趟水位线 `pass`（lastTime/lastId/delivered，排序键＝occurredAt 降序＋externalId 升序的稳定组合）；趟开放期间水位线之上的条目视为已交付，不依赖 `seen` 窗口；趟取尽即清除水位线，回填保护（无时间水线的原设计论证）不变；304 中途命中时 carryValidators 原样保留趟状态；游标大小上限与 SEEN_LIMIT=200 不变。验收测试 +6：300 条/每页 50 六页取尽零重复、1000 条 20 页取尽、同游标重放一致、取尽后更新只返回新增（seen 窗口内规模）、中途 304 保留趟状态后从水位线继续。既有 73 项（XML 安全/重定向/脱敏/ETag/304）零回归。实测：根 npm run check 退出码 0，全仓 236 项 231 通过＋5 门控跳过。ROADMAP 相对链接检查通过。
- 2026-09-08：MOD-04C（Runtime-owned 多轮文字上下文）在分支 `codex/mod-04-conversation-context` 完成离线实现：Runtime 从既有 `tasks`/`task_events` 读取同一会话最近 20 个成功任务，过滤失败/取消任务并剥离模型元数据；Agent 支持 `initialMessages`，应用检查点覆盖审批恢复与重启入口。Runtime 定向回归 30/30、根构建通过；尚未由非作者评审、合并或进行真实盘古验收，状态保持 `in_progress`。
- 2026-09-09：PR #31 已合并多轮上下文；接口请求 PR #32 已合并；PR #34 的 `task.list`、`conversation.list`、`approval.list` 和 Desktop 恢复已由 `zemeng` 非作者批准、Foundation CI 通过并合并。PR #33 的桌面本地外壳增量也已合并。
- 2026-09-09：完成接口冻结评估。只冻结 Core Runtime Profile 1；事件生命周期、Host、Model/Agent/Tool、连接器、Evidence/Artifact 和持续授权保持 `provisional`，无生产提供者的设置、语音、知识/记忆、MCP/Skills、Windows、AgentArts 与分发接口列为 `unavailable`。
- 2026-09-09：按新分工拆分 MOD-04A/04B，新增 MOD-27～32，并接受核心认知依赖倒置和 AgentArts 本地信任边界；这些新接口和模块尚未实现，不能因文档完成而提升状态。
- 2026-09-09：确认华为 ICT 创新赛 AgentArts 赛题；新增 Competition Profile 与 ADR-0007，当前只实施比赛主路径，Local Profile 仅可选留存现有代码，不新增且不进入比赛退出条件。
- 2026-09-30：MOD-25 遗留两项收口（用户本轮授权「做」）。①置信度收紧：次级行政中心（`PPLA2`–`PPLA5`）不再无条件判 `high`，需人口 ≥ 新增选项 `minMinorSeatPopulation`（默认 100000，取自实测空档：错误小席位 凤凰 14574 / 开罗-伊利诺伊 1733 ↔ 正确最小席位 丽江市 211151）或 GeoNames `name_equals` 已证名（已证名同时修复阳朔/同里型无人口误判）；`PPLC`/`PPLA` 维持无条件 `high`。②连带修复：`开罗+Cairo` 曾因小席位被无条件判 `high` 而把提示串层整个挡住，收口后提示串正常救回到 `Africa/Cairo`（离线测试固定）。行为变更提示：`apps/runtime` 的 `createOpenMeteoRuntime` 以 `strict` 装配，无人口次级席位（如未配置 GeoNames 账号时的 `婺源`）从可用变为拒绝并给出候选，属修正方向，点名 `goo122` 知悉。第三项遗留（显示名简繁混杂）维持 README 已有结论：根因在 GeoNames zh 备用名本身混合，映射表方案已否决，不在本包修。验证：weather 69 项（65 过＋4 live 门控跳过）0 失败、runtime 集成 3/3、`check:architecture` 通过。真实验收已于合并评审期间在 #227 分支补跑（2026-09-30 04:56Z，`PA_WEATHER_LIVE=1`）：48 项 47 过 0 失败 1 跳过（GeoNames 项无账号），真实端点上五个既往误解析全部判 `low`、提示串救回 6 例全部正常，结果已录入 README。
- 2026-09-30：登记 MOD-20A「CalDAV 只读提供商」工作包（分支 `feat/mod-20-caldav`，P1 业务连接器，响应 #212 分工收窄至 P0–P4 后的首个独立包，亦为证据索引点名的演示链缺口）。按 PROJECT_STRUCTURE §11 登记：负责人 `Potatos498`、评审者 `goo122`、独占目录 `packages/connectors/calendar/`（族入口单负责人）、无新依赖（复用 contracts；XML 解析自研宽容正则，经注入 `CalDavFetchLike` 夹具离线测试）。公共输入输出：日历集合 URL＋宿主注入 Authorization → `pollChanges()`（ctag+href→etag 快照，变更检测原语）、`fetchWindow`（calendar-query time-range＋客户端二次过滤）、`getEvent`（单条读回，保留 cancelled）；TZID 事件经 Intl 换算 UTC（DST 边界有测试）。不在范围：CalDAV 写侧（respond 显式 UNSUPPORTED_CAPABILITY）、日历集发现（well-known/calendar-home-set）、DURATION 事件、ConnectorHost 装配（归共享集成槽）。Fake 验收：20/20 离线（含 429/401/5xx/网络/畸形响应映射、207 成功语义、分页、DST 回拨歧义取较早）。真实验收（待真实账号）：Nextcloud/Radicale 等服务器上 ctag/etag 轮询、TZID 事件读回、取消读回，`verification` 维持 `conditional` 直至完成。本条只是登记与实现交付，真实验收未完成前 MOD-20 状态不因本包翻转为完成。
- 此记录不构成任何运行时能力通过证明。

## 5. 继续入口

### MOD-04B Competition 文字协调消费实现

- 负责人 zemeng；实现基线 PR #38 / `87ee444`，已同步 PR #39 / `188f925`；
  状态 review（受影响类型检查与无隔离测试通过；workspace 测试受本机 `spawn EPERM`
  阻断，待非作者评审与集成）。
- 工作树 `.worktrees/zemeng-mod04b-coordinator`，分支 `codex/zemeng/mod04b-coordinator`。
- 复用已有文字端口，交付 CompetitionCoordinator 与显式 Unavailable；不修改 Runtime 或公共契约。
- 详见[工作包](modules/MOD-04B-COMPETITION-TEXT.md)。真实 AgentArts 与工具闭环仍 unavailable。

### MOD-28-IMPACT-01（本地依赖影响与显式修订提案）

- 负责人 zemeng；状态 review（待非作者评审与集成）；串行延续 `codex/zemeng/mod27-goal-graph` 的 MOD-27 增量。
- 范围 `packages/cognition`：KEEP/RECHECK 影响分析及显式 summary 候选的 REVISE 差异；不接云、不写 Runtime。
- 依赖、验收与剩余边界见[工作包](modules/MOD-28-IMPACT-01.md)。

### MOD-27-GRAPH-01（云审批期间的本地工作包）

- 负责人 zemeng；基线 5944061；状态 review（待非作者评审与集成）；分支 `codex/zemeng/mod27-goal-graph`。
- 范围 `packages/goals`：版本化 Fact/Goal/Decision/Plan、依赖引用、修正/撤回历史和冲突校验。
- 纯领域增量，无云调用、生产持久化或公共存储端口变更；详见[工作包](modules/MOD-27-GRAPH-01.md)。

### COMPETITION-PORTS-01（本地开发增量）

- Profile：huawei_ict_agentarts；负责人 goo122；消费评审 zemeng；状态 in_progress。
- 基线 bafb541；分支 codex/competition-coordination-ports，工作树 .worktrees/competition-coordination-ports。
- 新增 CoordinationPort / CloudAgentPort 文字首片、显式 Fake、Runtime 注入；不调用真实服务、不扩展 Local。
- 端口 provisional，真实 AgentArts 仍 unavailable；完整范围与验证见 [工作包](modules/COMPETITION-PORTS-01.md)。
- 下一步为 zemeng 消费评审，然后补云适配与工具提案/执行结果契约；不能将文字 Fake 视为 Golden Path 完成。

当前继续入口以[接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)和模块台账为准。Core Runtime Profile 1 可稳定消费；PR #89～#91 已将 provisional Memory 端口/Fake、SQLite 事实与 delivery checkpoint 重启恢复，以及未生效暂存 → provider 确认 → 原子激活的持久 `KEEP/RECHECK` 投影合入 main。PR #98 已完成公开演示资料知识检索的 Fake Competition 审批链离线验收；真实知识工具提案、私人 Vault、生产 Memory capability、自动调度与真实数据仍未验收。MOD-05 已具备任务级持久授权、审批恢复和本地 Evidence，但跨任务持续授权、真实 SecretStore、公开 Evidence 内容和真实写入恢复仍未完成。

### MOD-25 地理编码修复工作包（PR #12，历史验收）

- 任务：M2-C-025 / 天气连接器；关联 MOD-25 / PA-010。
- 负责人：`Potatos498`；评审者：`goo122`；PR #4 已合并（main `9f27e9b`），本轮修复 PR #12 已由非作者评审并合并（main `5b833c9`）；状态：`done`（仅针对本工作包边界）。
- 范围：`packages/connectors/weather/`；不修改公共契约、根锁文件与根装配（均归 `goo122`）。
- 输入与依赖：明确地点或配置的默认地点、可选 `locationQuery`（拉丁/英文名提示）、日期、单位；依赖 MOD-02 的 `ConnectorItem` 契约与 `ConnectorPort`，以及 testkit 的假时钟和假 ToolHost。真实数据来自 Open-Meteo（免密钥、无账号）。
- 交付：`WeatherProvider` 新增必需方法 `resolvePlace`（解析与取预报共用同一地点，避免缺省日期与坐标裂脑）；`ResolvedPlace` 新增 `confidence` 与 `featureCode`；`ForecastRequest`/`WeatherQuery` 新增 `locationQuery`；地理编码检索轮由输入文字决定（配置语言 + `en` + 输入含汉字时的 `zh`），按 GeoNames `id` 合并、保留配置语言的显示名、删去按 `admin1`/`country` 相等的排名子句；`assessConfidence` 用 `feature_code` + 人口下限 500000（可经 `minCorroboratedPopulation` 配置）判 `high`/`low`；`locationQuery` 是兜底轮（仅原始输入零候选或 `low` 时并入）；`strict` 语义改为拒绝 `low` 而非拒绝同名；缺省日期按目标地时区取当地日；工具入出参 schema 同步（`locationQuery`、`confidence`、三处 `description` 注解）；59 项测试与包 README。
- 验收：根 `npm run check` 退出码 0；weather 59 项 56 通过 + 3 项真实读回默认跳过（全仓 119 项 116 通过 + 3 跳过）。汉字输入在 `language:'en'` 下仍解析到正确地点；`东京`/`伦敦`/`罗马`/`丽江`/`广东` 判 `low`，`北京`/`巴黎`/`纽约市`（`PPL` 8.8M）判 `high`；`England`/`Texas`/`France` 判 `low`；`strict` 下 `北京`/`巴黎` 可用、`东京`/`England` 被拒且消息含候选与「改用英文名」提示；`婺源`（high）忽略会排错的 `Wuyuan`、`丽江`（low）+ `Lijiang` → 云南；`feature_code` 缺失保守判 `low`；缺省日期 `Pacific/Kiritimati` 在 `2026-09-05T12:00Z` 取 `2026-09-06`、显式 `date` 不触发解析；解析失败无 stale 回退、显式 `date` 保留 stale 回退；`FakeToolHost` 经 ajv 真校验工具入参与出参。
- 证据：[weather 说明](../packages/connectors/weather/README.md)（含 2026-09-06 对生产端点的真实读回原始输出、`curl` 直取交叉核对、20 行地名实测解析表与置信度误判清单）。manifest `verification` 保持 `conditional`。
- 限制：见包 README「已知限制」——简体外国城市是「被检出并标注」而非「被纠正」，`ranked` 仍会返回 伦敦/安大略（带 `confidence:'low'`）；置信度有实测误报（阳朔、同里）与漏报（凤凰、Pingyao、Wuyuan），最差组合是零候选 + 提示串落错省却标 `high`（平遥）；显示名简繁混杂（D7）不可在包内修；`locationResolution:'strict'` 的语义改变影响 `apps/runtime` 生产装配，已在 PR 点名；`record.externalId`/`dedupeKey`/`contentRef` 取值语义变更（并入 `locationQuery`、缺省日期变当地日）；缺省日期时解析自身失败无法回退 stale。

### MOD-03 完成记录

- 任务：M1-A-003 / 持久任务与事件核心；关联 MOD-03 / PA-004、PA-009。
- 负责人：goo122；PR #5 已评审并集成，合并提交 e14aebf。
- 范围：apps/runtime、根工作区装配和 Runtime CI 示例；依赖 MOD-01/02。
- 交付：SQLite 持久任务、状态转换、事件回放、进度、检查点、取消信号、异常退出待核实恢复、外部写入超时防重、一次性调度补跑/跳过，以及公共 Client 最小往返。
- 验收：Runtime 7 项测试通过；根 check 共 33 项测试通过；demo:runtime 输出 succeeded 和 7 个持久事件。
- 证据：[Runtime 说明](../apps/runtime/README.md)；测试只使用本地 SQLite 与固定 worker，不调用真实模型、账号或平台。
- 限制：不是后台守护进程；没有 IPC、循环调度、事件裁剪、真实模型、权限工具或连接器；真实 PA-004/PA-009 闭环未完成。

### MOD-02 完成记录

- 任务：M1-A-002 / 公共协议与联调 SDK；关联 MOD-02 / PA-004、PA-023。
- 负责人：goo122；PR #1 已评审并集成，合并提交 dbbc547。
- 范围：packages/contracts、packages/client、packages/testkit、对应示例与根依赖装配；依赖 MOD-01 的本地底座。
- 交付：PR #1 初始 14 operation 与 9 类事件 Schema、生成 TypeScript 类型和漂移检查、客户端、JSONL 分帧、六种 Fake 场景、Fake 工具/时钟/存储/连接器、消费者和提供者示例；PR #34 增加 3 个查询 operation，当前共 17 个。
- 验收：根 npm run check 共 26 项测试通过（storage 4、contracts 4、client 5、testkit 13），包含 SQLite 事件持久化后迁移及回放；npm run demo:protocol 通过。
- 证据：[testkit 说明](../packages/testkit/README.md)；wire 1.0.0、开发包 0.1.0-alpha.1。PR #34 的查询子集已完成 Desktop 消费验证；项目内独立源码副本 .cache/clean-mod-02 的早期 npm ci、check（26/26）、dev、demo:protocol 全部通过。
- 限制：进程内 Mock 不能替代 C#、第三方连接器或真实平台联调；只有 Core Runtime Profile 1 冻结，整包不按单一状态宣称。

### MOD-01 完成记录

- 任务：M1-A-001 / 工程与存储底座；关联 MOD-01 / PA-004。
- 负责人：goo122；PR #1 已评审并集成，合并提交 dbbc547。
- 范围：根配置与锁文件、packages/storage、scripts/dev、公共 CI，以及对应说明和状态文档。
- 依赖：无模型或真实账号；使用本机已验证 Node 24.15.0、npm 11.12.1。
- 交付：npm 工作区、严格 TypeScript 构建、SQLite WAL 连接和事务迁移、独立存储示例。
- 验收：类型检查和 4 项存储测试通过；跨进程持久化、迁移保留数据、失败回滚通过；独立源码副本 npm ci/check/dev 通过。
- 证据：[存储说明与验证记录](../packages/storage/README.md)、PR #1 和合并提交 dbbc547。
- 排除：公共 SDK、桌面、Runtime 任务状态机、模型与真实平台调用；PA-004 整体未完成。

### MOD-05 初始宿主工作包（PR #7，历史验收）

- 任务：M1-A-005 / 权限、工具与连接器宿主首片；关联 MOD-05 / PA-023。
- 负责人：`goo122`；评审者：`zemeng` 或 `Potatos498`；状态：review。
- 范围：`packages/policy/`、`packages/tool-gateway/`、`packages/connector-host/`，以及 `packages/client/`、`apps/runtime/` 和根工作区的必要兼容装配；不接真实账号或天气生产请求。
- 交付：授权引用绑定任务、工具、scope、到期时间和可选次数并支持撤销；工具输入/输出校验、用户在场、deadline、取消与外部写入 `RESULT_UNKNOWN`；连接器声明式凭据白名单、注册/健康/生命周期和同连接器并发连接锁；公共 Client 可携带任务 ID，经 Runtime 发现并调用工具，Runtime 仅允许 running 任务执行并记录 confirmed/unknown 的 `tool.completed` 事件。
- 验收：无授权或伪造引用拒绝；调用者不能自报 scope；一次性授权只在通过输入与权限检查后消耗；外部写入中断不盲目重试；未声明凭据拒绝；并发连接只创建一个实例；全部测试只使用内存策略、假工具和假 SecretStore。
- 证据：[授权策略](../packages/policy/README.md)、[工具网关](../packages/tool-gateway/README.md)、[连接器宿主](../packages/connector-host/README.md)；Node 24.15.0 / npm 11.12.1 下根 `npm run check` 通过，全仓 82 项为 81 通过＋1 项天气真实读回默认跳过，其中 MOD-05 定向 14 项、Runtime 8 项（含公共 Client→授权工具闭环）；`npm run dev`、`demo:protocol`、`demo:runtime` 均通过。
- 当时限制：授权和账号会话尚未持久化，重启后失效；无审批 UI、持续授权管理、真实 SecretStore、工具运行证据存储和恢复执行器。PR #26 后续补齐任务级 SQLite 授权、审批恢复、执行记录和本地 Evidence；账号会话、跨任务持续授权、真实 SecretStore、公开 Evidence 内容与真实写入核实仍未完成。

### MOD-05 × MOD-25 初始垂直集成（历史验收）

- 任务：M1-A-005I / MOD-05 与 MOD-25 首条 Runtime 垂直集成；关联 PA-010、PA-023。
- 负责人：`goo122`；评审者：`zemeng` 或 `Potatos498`；状态：review。
- 范围：`apps/runtime/src/weather-runtime.ts`、Runtime package/export、根 workspace/build 装配和 Runtime 集成测试；不修改 `packages/connectors/weather/` 内部实现。
- 交付：`createWeatherRuntime` 组合入口、严格模式 `createOpenMeteoRuntime`、显式 Provider 注入、Client→Runtime→Policy→ToolGateway→weather.forecast 链路测试。
- 验收证据：Runtime 定向测试 11/11；根 `npm run check` 通过；`npm run dev`、`npm run demo:protocol`、`npm run demo:runtime` 通过；weather 全包 34 项为 33 通过 + 1 项真实读回默认跳过。
- 已验证：授权成功、撤销后拒绝、非 running 任务在 Provider 调用前拒绝、生产严格 Open-Meteo 注册不发起网络请求；测试仅使用显式 `FakeWeatherProvider`。
- 剩余限制：授权、连接器会话和 Evidence 仍为内存能力；真实 Open-Meteo 长期稳定性与多时段采样未验收；这些是 MOD-05 或真实生产验收边界，不否定 MOD-25 当前工作包已完成。

### MOD-04A/04B 已集成工作包与后续边界

- 任务：M1-A-004A / 模型网关与单主 Agent 有界执行循环；关联 MOD-04A/04B / PA-003、PA-012。
- 历史负责人：goo122；PR #10、#11 已由非作者评审并合并；后续负责人：MOD-04A `goo122`、MOD-04B `zemeng`。状态：review/in_progress（历史工作包已合并，真实盘古与完整 Agent 能力仍未验收）。
- 范围：packages/models、packages/agents、根构建入口与对应测试/说明。
- 交付：能力声明与验证等级、Fake/Unavailable/Pangu 占位 Provider、模型 deployment/usage 记录、工具提案校验、一次修复上限、maxSteps/maxTokens/deadline/取消边界、RuntimeToolInvoker 和 unknown reconciliation 回调。
- 验收：模型测试 4/4；Agent 测试 4/4；Fake 天气请求经过 Runtime、Policy、ToolGateway；模型不能提供授权；unknown 不生成成功回答；仓库 npm run check、npm run dev、npm run demo:protocol、npm run demo:runtime 均通过。
- 证据：仅使用 Fake Provider 和本地 Runtime；没有真实盘古、付费模型或网络调用。
- 限制：Pangu Provider 明确不声明 toolCalling/structuredOutput/vision；文字 JSON 提案只有离线验证。真实盘古工具闭环、ModelPort/CoordinationPort 依赖倒置、多 Agent、流式输出和真实连接器仍未完成；ARCH-03 已将 `task.submit` 后的执行分派和生命周期管理收归 Runtime Application。

### DESKTOP-01 当前工作包（2026-09-05）

- 任务：原版定稿移植；MOD-11/12/13；PA-001/002/004。负责人 zemeng；待评审者 goo122（未发出评审请求）。
- 分支 codex/desktop-final；依赖底座提交 002e88a，公共客户端/契约 0.1.0-alpha.1。根配置、锁文件与公共 Schema 保持原样。
- 范围：apps/desktop 内 Electron 窗口、orb/conversation/admin/ui、模块入口与测试；状态 review，未提交、未合并，不代表整个模块完成。
- 实测：底座 build；关键测试 2/2；Electron 44.2.0 原生 90px 热区、离开收起、拖动抑制、372px 面板、SDK 提交取消、独立后台关闭后任务保留及取消确认终态；无页面异常。实际截图已直接观察。
- 外观证据：恢复后的原版与产品待机球体在原稿 132px 画布下逐像素一致，170 点。恢复覆盖 10 个设计源码/说明文件，修改前内容另留备份。
- 环境：Windows，Node 26.3.0 / npm 11.16.0；与底座声明的 Node 24.15.x 不同，目标 Node 版本待集成环境验证。
- 继续入口：[桌面模块说明](../apps/desktop/README.md)。真实 Runtime、语音、模型、账号配置、物理多屏/DPI、系统背景模糊及分发仍待接入/验收；fake 仅在显式联调模式使用。
