# MOD-06 / MOD-07 首版 Competition 纵片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；PA-005 MCP / PA-006 Skills。
- 状态：`review`，不等于整版 MVP 或接口 frozen。
- 负责人：本专项代表 zemeng；范围 `packages/mcp/**`、`packages/skills/**` 和本文。根/Runtime/IPC/Renderer/lock 由 P8 唯一消费；远端 PR/合并由专线处理。
- 工作树：`.worktrees/mcp-skill-mvp`，`codex/mcp-skill-mvp`，基线 `01ca1c7541f5b29c47b06df50542f6e8cc0bc9ab`。未修改共享生产文件、凭据、数据库或其他工作树。
- 依赖：现有 provisional RegisteredTool/ToolContext/ToolHost、AgentToolPort/AgentWorkerContext、ToolGateway/Policy/Runtime checkpoint；无 Schema/wire/迁移变更。接口目录此前 unavailable，本次仅模块生产实现，不自行提升冻结等级。

## P8 准确装配

1. 根 dependency/唯一 lock：`@personal-agent/mcp` / `@personal-agent/skills` `0.1.0-alpha.1`。MCP 依赖 SDK `1.31.0` 与 filesystem `2026.8.31`，来源与许可见包 README。Skills 只按类型消费现有 agents 端口，不新增 Local Agent 执行。
2. 新包 build 放在已有 contracts/agents 产物之后；新模块 tests 依赖现有 policy/tool-gateway 产物。发布保留 Skill bundle；不更新 Node/根工具链。
3. trusted main：`createReadonlyMcpHost({nodeExecutable,rootPath,enabled?})`；入口来自已安装固定官方包，不接模型命令/args/server URI。必须 `await start({deadline,signal})`，真实发现确认后 health.connected 才能 available。`RuntimeApplicationOptions.tools: [...existingTools,...mcp.tools]`，或者明确 `register(ToolHost)`；两者不能重复注册。`await setEnabled(false)`、`await stop()` / `await dispose()`；dispose 释放 register 创建的注册，tools 数组则由其装配宿主统一释放。
4. `competitionToolAvailability` 唯一条 `{toolName:'mcp.workspace.read_text',toolVersion:'1.0.0',available:()=>mcp.health().connected}`。仍需宿主批准 root/path 范围；连接成功不会签授权。disabled/error 时目录不对云公布；已有 task snapshot 缓存不得覆盖实时执行检查。
5. `CompetitionToolExport` 默认拒绝未明确授权的内容出机。PR269 续修提供两阶段 PUBLIC 限定用途许可：读前 preflight 不要求尚不存在的 hash/receipt，原 ToolGateway/Policy 确认后 project 才核字节/SHA、完整参数、原执行记录与 native 精确内容许可，导出真实有界 PUBLIC 正文。真 I/O 前用 final phase 和原 projection 重查；超许可上限拒绝，不假称 hash 已读正文。私人路径、绝对路径、许可/run/raw Evidence 不出机，manifest/annotations 不签权。
6. Skill：`createReferenceSummarySkill({tools:existingAgentToolPort,isToolAvailable:()=>mcp.health().connected,enabled?})`；`manifest()` 提供 ID/version/digest/inputSchema/capabilities。受信 worker 调用 `invoke({skillId,version,digest,path},context)`。传现有 taskId/deadline/signal/saveCheckpoint/loadCheckpoint/reportProgress；端口必须是原 Runtime 授权/锁/执行路径。**不把 Skill 包成工具后嵌套调用 tool.invoke**；两步 worker 应由 Application dispatcher 调用，Runtime 根据返回 state 管理 waiting_approval/waiting_reconciliation/确认和终态。外部 schema/API 路由由 P8 装配，模块不私造公共 wire operation。
7. 管理后台仅健康投影：MCP `configured,enabled,connected,state,errorCode?,protocolVersion?,discoveredTools,exposedTools`；Skill `configured,enabled,connected,state,id,version,digest`。启停从 trusted main 管理，Renderer 不获得 Node、shell、root、PID、凭据、AgentToolPort。Skill ready 依赖真实 MCP health，注册工具不等于连接。
8. Skill checkpoint key `skill:workspace-reference-summary:v1`，同任务固定输入/version/digest；已确认读取不重复，started/unknown 不重放，pending 审批复用稳定 runId。`setEnabled` 同步，`dispose` 同步；MCP lifecycle 异步须 await。
9. 恢复增量新增可选 `ReferenceSummaryOptions.reconciliation: SkillReadReconciliationPort`，root exports 同时提供 `SkillReadReconciliationQuery`。端口 `currentConfigurationRef(): string | undefined`，`readConfirmed(query): Promise<ToolInvocationResult | undefined>`；query 扩现有 AgentToolInvocation，固定 `toolName/toolVersion/arguments:{path}`，加 `skillId/skillVersion/skillDigest/argumentsDigest/configurationRef`。P8 用可信主进程的 workspace readBinding（root/Node 当前身份+会话 generation）的 SHA-256 作为不透明 ref，首次 Skill 开始存 checkpoint；未启用/变更/撤销为 undefined。原始路径不进入 manifest/UI/云。
10. adapter 只读 `runtime.readToolExecutions(taskId)` 中 evidenceId=原 runId 的记录，验证 confirmed、policyDecision allow、executionStarted、toolName/version，使用 `runtime.matchesToolExecutionInput(record,{arguments:{path},scopeRef:runId})`，读取原 `runtime.loadCheckpoint(taskId,'tool-result-'+runId)`，核对原 task/Evidence refs。验证 query 的 Skill 与原绑定和当前配置，不接受 Renderer receipt，不调用 invoke/grant，不新建/替换 runId。argumentsDigest 为参数摘要；Runtime inputDigest 仍用原公开匹配函数。Skill 原始 started/unknown 经确切确认可晋升 read-confirmed，只继续摘要；无确认/错 Evidence/path/SHA、配置变化保留待核实或明确拒绝。旧 48fbedd9 checkpoint 缺原配置引用不能猜 root，仍 unknown；Runtime 统一决定 waiting_reconciliation/终态。
11. 当前 PUBLIC 端口 `createPublicReferenceExport/createWorkspaceReferenceExport` 为 policy `3.0.0/workspace-reference-3.0.0`。native 同步 `readPreflight(ReadQuery)` 不依赖 receipt/digest，ReadQuery 为原四字段加完整 arguments；返回明确 PUBLIC/purpose/id/expiry/maxExportBytes。`readConfirmed(ReadQuery+digest)` 只读原执行/参数/scope/Policy/结果/Evidence；`readAuthorization(ReadQuery+digest+byteLength)` 核同预许可身份/目的/期限/上限的精确内容授权。project 返回 source/content/byteLength/contentDigest/truncated:false/readConfirmed:true。真正 I/O/恢复 continuation 必须 accepts(...phase:'final',projection,signal)，不能以默认 preflight 代替。native getter metadata 由 reference-tools-host 从原 pending proposal 或 Skill 绑定推导，命名 readPublicReferencePreflightCandidate/readPublicReferenceCandidate/readConfirmedPublicReference；hostUserNamespace、当前配置、原 deadline/取消/版本/参数/稳定 run 均复查。P8 唯一 native/main、CloudRuntime 原循环接线、P6 workspace 消费；详细类型与无重读等待恢复见 packages/skills/CLOUD_HANDOFF.md。无第二授权/任务/数据库体系。
12. complete Skill checkpoint 重放也验证原 configurationRef；原会话撤销/替换而新服务 connected 时不返回旧摘要，不重复工具读取或确认 Evidence。

## 当前消费与云边界

P8 2026-09-30 回报：总装已有 `apps/runtime/test/reference-skill-application.test.mjs` 的实际官方 SDK + SQLite 原确认恢复和 routine exact-read 两条 case 通过；原 TaskRuntime run/Evidence 复用，确认恢复零重读。本包未重复执行该集成用例，最终准确 HEAD/日志、后台 UI/真实云验收归 P8 的统一收据。

云包 PR269 已提供 `skill.workspace_reference_summary@1.0.0` descriptor、原 worker selection/receipt/final guard 端口，显式 type/enum，不直接把 const-only manifest schema塞目录。原 `goal/availableTools/tool_proposal/continuation` 复用；Skill 在 Gateway 工具锁之前由原 Runtime worker 分派，内层 MCP 才走 ToolGateway。当前缺完整共享目录/原生异步许可消费读回，源码存在不等于云实际选择已验证。原生提交 Skill 不替代真实云选择；不以 roleLabel/goal 约定新命令，不私造 Cloud DTO。

P8 Native 已选公开 source alias 的 owned 接口增量：factory 接同步 readPublicSkillSourceRefs，cloudSkillCatalog 在 availability 确认后取本 task/currentconfig 的 alias，并复查配置/任务/取消/期限/selector。describe(sourceRefs) 只发布非空合法去重 sourceRef enum，PUBLIC_ENUM_PATHS 增 /sourceRef；缺来源 unavailable，不再向 AgentArts 给未知 free string。alias 仅发现，无路径/正文/额外授权。descriptor 和 host 的相关 prepared cases 尚未执行；本增量只 TS/JS/MJS 语法与 diff，统一真实选择/Native/SQLite/云读回归 P8。

## 验证收据

2026-09-30，本任务安装到忽略目录，未改根 lock。PATH Node `26.3.0` / bundled Node `24.19.0`，项目约束 `24.15.x`；未擅自升级/另装 Node，因此精确项目 Node 版本验收交统一环境。使用仓库 TypeScript `5.9.3` / `@types/node 24.10.1`。

- 已完成新包与必要现有依赖的局部 tsc；首次真实官方 stdio initialize/discover 返回 14 工具，只映射一个只读工具，关闭子进程后退出。
- 新增单文件验证已通过：MCP `real-stdio.test.mjs` 2/2；Skills `real-skill.test.mjs` + `skills.test.mjs` 5/5。两个真实官方服务实例均返回合成文件预期正文及 digest，Gateway Policy 单次授权耗用正确；schema/取消/停用拒绝，Skill version/digest/输入绑定、未知不重试、已确认步骤去重通过。测试使用 bundled Node `24.19.0`，两包 tsc 及测试串行总命令约 7 秒。真实 Skill 的 checkpoint/AgentToolPort 为内存测试装配，Evidence 数组为空；未伪造真实 SQLite Evidence。
- 定向架构边界 `node --test tests/architecture/dependency-boundaries.test.mjs` 1/1、`git diff --check` 通过；未运行全仓 check/build/smoke。
- 恢复增量仅 `packages/skills` tsc +新增 `reconciliation.test.mjs` 1/1（约 2.17 秒，bundled Node 24.19）。started → trusted confirmed → 纯摘要恢复，原工具 invoke 次数不增加；无确认/错 Evidence、配置变化、禁用和取消期间不晋升。该端口/确认 Evidence 为显式离线夹具，不等同 P8 的实际 SQLite Evidence；未重跑旧 7 项/服务/模型/全构建。
- 公开出机与 complete 缓存增量：bundled Node `24.19.0` 两包定向 tsc 通过；仅新增 `packages/mcp/test/public-export.test.mjs` 与受改 `packages/skills/test/reconciliation.test.mjs`，2/2 通过（测试约 2.60 秒）。错 task/proposal/path、参数替换、无许可/过期/撤销、错原确认/换 run、配置或在途取消拒绝，许可 SHA 匹配后仅三字段投影；complete 旧摘要在配置替换/undefined 拒绝且读取/执行次数不增加。出机授权/原确认 callback 使用明确的离线夹具，不代表原生 UI、SQLite adapter 或真实云已经完成。没有新 SDK 服务/模型调用或重跑旧 7 项。
- 测试用公开合成文件仅位于任务忽略目录；没有私人目录/凭据/真实模型/云/第二 Laya。
- PR269 本机续修本轮仅语法解析/diff，未 build/类型检查/测试/SDK/模型/云调用。prepared 首读无receipt、PUBLIC正文、原结果拒绝后零重读恢复、restart final、撤销/到期/换 scope/hash/bytes/fullargs、缺PUBLIC metadata、超上限和原生候选 run不互冒用例留 P8 统一；历史 2.0 测试不算 3.0 新策略验证。native getters 只读取原 Runtime checkpoint/record，metadata 不含正文，readonly receipt adapter独立核实。
- 未验证：P8 实际总装、真实 SQLite TaskRuntime Evidence/审批恢复、AgentArts 云端部署/选择/continuation、后台 UI 启停投影、精确 Node 24.15、第三方/远程服务。这些不由本包测试替代，不宣称 MOD done 或 MVP 完成。

## 限制与后续

固定参考 filesystem 服务本身提供写工具，但宿主只映射固定 read_text_file，annotations 不成为权限来源；不是 OS 沙箱。调用失败/断连不自动重试，恢复必须依赖 Runtime 既有记录。Skill 是固定受信 bundle 的确定性两步能力，不是任意外部脚本执行引擎。P8 消费具体反馈后仅修 owned 模块。
