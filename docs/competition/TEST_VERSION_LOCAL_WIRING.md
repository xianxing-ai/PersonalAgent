# 测试版本：本地 MOD 公开接线与验证边界

> 公开脱敏投影：历史命令中的机器专属路径已改为接收者可配置占位或仓库相对路径；日期、数值、失败与原哈希保留。占位不是可直接执行的配置，运行前使用本机受信Node/npm、工作树及运行环境路径。

## 当前接线与真实边界（2026-10-15）

各MOD负责人自己完成实现、公开契约、实际调用方接线、必要测试、Evidence及文档；新具体分工见 [接线总包](COLLABORATOR_WIRING_PACKAGE.md)，逐MOD输入输出/调用方/命令/缺口见 [全MOD清单](../modules/CURRENT_MOD_WIRING_HANDOFF.md)。根composition协调共享入口，不替全部模块代接代验。

最新 [完整实测](evidence/test-image-v3-20261015/full-workflow-results.json) 与 [发布回执](evidence/test-image-v3-20261015/owned-release.json) 已证明ARM64镜像上传SWR、云精确版本目录与日志读回，以及同版镜像本机Docker+本机Runtime/Laya+AgentArts新代理的孙悟空/鹈鹕主影子和单次CAS，共41条Evidence。不是远端Runtime两条全链，不是28真实业务全部通过；各分支父succeeded，协调锚点created。鹈鹕首次partial失败保留。

本机Laya完整输入182–618ms未达150ms，未校准站点均实际升级DeepSeek；本轮主影子串行，日常机会/收益开关仍需真实消费验证。DeepSeek经AA代理，底层平台MaaS来源如实记录，无客户端直接fallback；语音百炼沿用公开端口，SIS经AA流式桥仍未验。新增接口仍provisional，缺provider能力unavailable；不改变Core wire冻结范围。

下文按原轮次保留具体接口/试验记录；其中“未发布”“模型未跑”“主影子未通过”只适用于其早期阶段，当前事实以上述回执为准。旧fixture不能扩展为真实账号、物理设备或平台服务验收。


2026-10-15，Competition Profile；工作树 `laya-owned-runtime/PersonalAgent`，分支 `codex/laya-owned-runtime`。
这是测试宿主组合增量；本文件早期记录的未发布状态已由后续SWR回执更新，提交/合并状态仍以Git/PR实际读回为准。接口成熟度仍以 CURRENT_INTERFACE_CATALOG 为准；下表的源码存在、工具注册、离线调用、真实读回是不同状态。

## 本轮实际组合

`tests/manual/agentarts/test-version-tools.mjs` 仅调用公开包 `register`，返回已有 RegisteredTool 数组。
`pelican-test-version.mjs` 使用 `config.business` 创建组合，再通过既有 Runtime Application 的 `options.tools` 注入；不创建另一个 ToolGateway、调度器或数据库。
缺失配置明确记录 unavailable，不扫描环境变量、私人邮箱凭据或默认创建 Fake。提供者由可信调用方显式传入，OpenAlex 可用 `@personal-agent/research` 的 `OpenAlexProvider` 构造。
同名工具在创建模块前拒绝，保留 descriptor 的版本、scope、副作用、恢复语义；dispose 移除本组合目录且可重复调用。

| 功能 | 公开 export / descriptor | 版本 / scope | Runtime 与镜像路径 | 当前边界 |
| --- | --- | --- | --- | --- |
| 邮件账号与增量读取 | `@personal-agent/mail.register`；`mail.accounts`、`mail.inbox` | `0.1.0-alpha.1` / `mail:read` | business.tools → options.tools → 本地 Policy/ToolGateway；镜像提案必须使用实际工具名/版本，结果经可信宿主回传 | 注册组合、mock 直接调用已测；真实账号待显式配置与授权；镜像邮件闭环未测 |
| 已读 | 同上，`mail.mark_seen` | 同版本 / `mail:write`；external_write | 同上；注册不授予写权限 | descriptor 已测，真实写入未测；不默认增加 automaticTools |
| 草稿 | 同上，provider 有 `saveDraft` 时注册 `mail.save_draft` | 同版本 / `mail:draft`；external_write，recoverySupport=false | 同上；未知结果仍由 Runtime 阻断重写 | 代码存在；默认 Fake 不支持，真实 Drafts APPEND/读回未测 |
| 发送结果核实 | provider 有 `reconcileSend` 时注册 `mail.reconcile_send` | 同版本 / `mail:read` | 同上，绑定原 messageId 与幂等键 | 条件注册；本轮未测。register **没有 mail.send**，不能承诺镜像直接发送 |
| 研究 | `@personal-agent/research.register`、`OpenAlexProvider`；`research.search` | `0.1.0-alpha.1` / `research:read` | business.tools → options.tools → 可信执行结果；保留 record 的 DOI/来源、publishedAt、publishedTimeKind、fetchedAt、freshness/cache.lastError | mock 投影与失败 stale 已测；本轮未联网；不支持通用网页正文搜索 |
| 通知状态 | `@personal-agent/notifications.register`；`notifications.status` | `0.1.0-alpha.1` / `notifications:read` | 显式 storage/policy → business.tools → options.tools | mock 状态读取已测；不触发 drain，不等于桌面通知投递 |

外部副作用仍需既有用户授权和 Policy；测试 fixture 授权不向真实账号迁移。
`test-version-business.test.mjs` 直接执行公开注册返回的工具，因此不构成 Policy/Evidence 或镜像调用验收。主控另行运行的 Runtime/镜像测试应记录实际任务、tool run、结果和 Evidence，再提升对应链路结论。

## 其他 MOD：源码核实后的可用端口与缺口

| 功能 | 公开 export / descriptor/version/scope | Runtime 入口与消费状态 | 镜像回传 / Evidence 与待办 |
| --- | --- | --- | --- |
| 邮件分类、读取进度 | `@personal-agent/cognition.createInboxPageConsumer`、`MailTriagePipeline`、`LayaTriageService`；不是额外 Tool descriptor | `@personal-agent/runtime/application.createInboxTriagePipeline`；公开 consumer 在分类完整且 cursorAdvanced 后才确认页，使用 accountRef/folder 隔离 | 本轮未把此 pipeline 装入 pelican；工具页分页测试不证明持久游标、分类或 Laya/DeepSeek 语义分流已接通。需要主控提供 classifier 与 Runtime pipeline 实例，按结果决定通知/草稿 |
| 通知裁定与投递 | `NotificationService.ingest/drain/acknowledge/planSchedules`；宿主 API，无独立工具 scope | 显式 StoragePort/用户 policy；调度建议交已有 Runtime；register 仅 status | 尚未组合 ingest→Runtime 调度→drain→桌面回执→ack；ready_for_delivery 不能记成 delivered |
| 知识搜索 | `@personal-agent/knowledge/tool.createKnowledgeSearchTool/register`；`knowledge.search` / `0.1.0-alpha.1` / `knowledge:read` | 可作为显式 tools 注入；Runtime 有 `createTrustedKnowledgeTools` | 本轮未绑定 Vault、租约或生产工具；需保留 path/line/revision，外发另需许可 |
| Wiki | `@personal-agent/knowledge/wiki.createWikiPort/openReadOnlyWiki/createUnavailableWikiPort`；host-only，无工具 descriptor | search/scanPages/readCitation/readReference；绑定 sourceId/namespace/configRevision/dataLevel/validUntil/isCurrent | 本轮不自动把 Wiki 内容外发；无绑定保持 unavailable；引用本身不授予读取权限 |
| 记忆 | `@personal-agent/memory.MemoryQueryPort`；listCurrentFacts/listFactHistory/getFactVersion，类型端口无工具版本/scope | 由宿主注入已有实现，不直接读数据库 | 未新增镜像消费，必须保留事实版本/撤回与来源；类型存在不等于实现已连 |
| 目标与认知 | `@personal-agent/goals.createGraph/appendVersion/parseGraph`；`@personal-agent/cognition.analyzeImpact/buildMinimalRepairCandidate/prepareReviewedRepair` 等 | 宿主公开 API；Runtime 负责实际状态/持久写入；不创建第二认知循环 | 本轮仅核实 export；主控 adaptive selector 负责语义分流，本文件不复制；图谱修改需原 revision 与受信提交链 |
| 本地 MCP | `@personal-agent/mcp.createReadonlyMcpHost`；`mcp.workspace.read_text` / `1.0.0` / `mcp:workspace:read` | 可信绑定工作区后，经现有工具路径；createPublicReferenceExport/createWorkspaceReferenceExport 控制投影 | 本轮未创建/连接 MCP server；需独立连接与读回，不以工具名代替连接证据 |
| Skill | `@personal-agent/skills.createReferenceSummarySkill/createCloudSkillSelectionPort/readLocalSkillDirectory`；固定 reference-summary `1.0.0`，精确调用描述由工厂给出 | Runtime options.cloudSkill；受控工具调用，不允许 Skill 自授权限 | 本轮未装配；云选择与本地执行回执仍要独立验证，不能直接把 instruction 当工具 |
| 语音、唤醒 | `@personal-agent/voice.VoiceSessionManager/createWindowsSystemSpeechPorts/createHuaweiSisRecognitionPort/createHuaweiSisOutputPort/bindVoiceWake`；`@personal-agent/voice-wake.WakeLifecycleController` | 会话/PCM/授权端口，无默认业务工具 descriptor；已有 Runtime transcript consumer | 本轮未打开麦克风、F9或设备；音频与云 SIS 需设备和真实调用证据，保持未验证 |
| Windows 状态 | `@personal-agent/windows-client.createSystemObservationTool/register`；`computer.system.observe` / `1.0.0` / `computer:system:read` | 可显式注入 tools；仅源码公布 cpu/memory/uptime，其他状态应按 unavailable 返回 | 本轮未注册或调用；不把普通系统观测扩展成 UIA/输入执行能力 |
| MOD-29 身份/部署 | `@personal-agent/agentarts` 已有 CloudAgent/owned binding 公开组合；部署引用由可信宿主传入 | Competition Coordination → CloudAgentPort；云结果是不可信输入 | 未部署新版本、未验证真实平台 API；已有本地镜像启动不是云验收 |
| MOD-30 Workflow/工具 | `OwnedWorkflowEngine`、`OwnedWorkflowHostBridge`、`createOwnedWorkflowReceiptVerifier`、`createOwnedWorkflowAdapter` | 节点 proposal → 本地 host task → Policy/ToolGateway → trusted receipt | 仅真实已注册工具可调用；目录覆盖、注册、mock 不提升全28项真实状态；本轮业务镜像节点未调用 |
| MOD-31 多Agent/评估 | owned workflow/role 公开端口与 Runtime subagent 入口由主控组合 | 子任务继续复用 Runtime，不由此文件调度 | 本轮未执行付费评估、主从模型或 GPU，角色必要性/效果单独记录 |
| MOD-32 发布/观测 | 上述桥与 verifier、`tests/manual/agentarts/` 既有入口 | 云版本/trace 和本地 task/tool/evidence 分别记录 | 本轮镜像不发布；没有真实部署/回传/终态读回，不声明 Competition Golden Path 验收 |

## 最小复跑

在已有构建产物的该工作树执行：

```powershell
node --test --test-isolation=none tests/manual/agentarts/test-version-business.test.mjs
```

测试使用显式 FakeMailProvider/FakeResearchProvider/FakeStorage，不读取真实凭据、不产生真实发送或联网请求。
它验证公开注册后的多账号分页、跨账号去重键、UIDVALIDITY 过期拒绝、descriptor/scope、研究来源时间/stale、通知只读状态及释放；显式测试专用 draft fixture 验证条件注册、unknown 不改报成功及取消前拒绝，不覆盖真实 IMAP。实际运行 4 项通过、0 失败（Node 内置 test runner，既有 dist 产物）。不覆盖 Runtime 持久去重或重启恢复，未运行全量 check/构建或真实服务。

## 2026-10-15 V2 公开接线增量（保留以上历史证据）

当前镜像组合入口、全部 F01–F28/owner 导航、受信控制、三层影子、F23 发布读回与配置方式见 [TEST_IMAGE_V2](TEST_IMAGE_V2.md)；统一节点/adapter 清单仍为 [workflow-wiring.json](workflow-wiring.json)。以上 V1 单包 mock 和当时未接线结论保留日期，不能冒充 V2 真实服务验收。

V2 新增 platformVersion/shadowVersion 认证 controller；平台 MCP 复用 SDK 1.31.0，公开执行须注入原 Runtime/ToolGateway 和真实授权上下文。知识 local/platform 只绑定现有 KnowledgePort，缺端口不会互相回退。MOD32 观测投影复用已合并 main 公开模块，真实只读 HTTP 仍需官方签名；评测 reader/响应契约与平台 learning API 未配置时明确 unavailable。

Engine 暂停/恢复及全部模板的控制夹具不提升邮件/通知/研究的真实闭环结论。最小修复/安全读重试算法等待用户设计，原操作和失败 Evidence 保留；当前不自动重提未知或失败副作用。V2 产物和检查只以其独立 test-kit 回执为准，镜像不发布。

V2 增加真实的数据重放 endpoint：`shadowVersion:1, operation:replay`，消费宿主签名的冻结 snapshot（asOf/sourceVersions/已核实 records）及 requestedActions。相同 read 工具/版本/参数摘要/来源版本复用原结果；历史 failed/unknown 保留原态，write 只留 timeline，缺证据/反事实返回 unknown。整包 HMAC 与响应验证绑定原 task/session/revision/deadline，响应为 replay_result；没有工具调用、新授权或新库。精确字段与边界见 [V2 replay 接口](TEST_IMAGE_V2.md#已实现的冻结历史-replay-endpoint)。旧 Engine.mode=trace_replay 不会自动调用它；F22 historical_trace adapter 待协作者显式绑定公开 replay 服务，不能记录为已自动接通。未在本文补填尚未生成的测试数或产物散列。
