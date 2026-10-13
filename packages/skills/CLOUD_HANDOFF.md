# MCP/Skill PR269 本机续修交接

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile `huawei_ict_agentarts`，PA-005/006/023/026/027。从云 `fe0666021cae04b3873393cca25b9b0b32713ec5` 普通合并到原本机树，保留 d94 历史、完整 worker selector 和恢复校验。仅修改 MCP/Skills、reference-tools-host 及专属 case/docs；原 Runtime CloudRuntime、P6 workspace-host、P8 main/native/rootlock 均未编辑。不新 PR，普通 FF 更新原 `codex/cloud-mvp-mcp-skills` / PR269。

## 最小两阶段端口

所有公开 types 从 `@personal-agent/mcp` 根 exports 消费：

| 类型/端口 | 精确语义 |
| --- | --- |
| `PublicReferenceExportQuery` | `{taskId,proposalId,path,configurationRef}`，四字段同原任务、提案、路径和当前配置 |
| `PublicReferenceReadQuery` | 上述四字段 + `arguments: Record<string,unknown>` 完整原输入（workspace 含 maxBytes），始终留本机 |
| `PublicReferenceExportPreflight` | `{authorizationId,expiresAt,sensitivity:'PUBLIC',purpose:'reference-summary'或'coding-reference',maxExportBytes}` |
| `PublicReferenceContentQuery` | ReadQuery + `contentDigest` + 实际 `byteLength` |
| `PublicReferenceExportAuthorization` | 同原 Preflight scope/id/expiry/上限 + 精确 `contentDigest` |
| `readPreflight(ReadQuery)` | native PUBLIC 来源/目的预许可与原任务读取资格；没有 digest/receipt 要求，不读文件，不签权 |
| `readConfirmed(ReadQuery+contentDigest)` | 只读原 Runtime `{runId,result}`；核原 proposal/run/tool/version/fullargs/scope/Policy/Evidence/结果 checkpoint |
| `readAuthorization(ContentQuery)` | confirmed 原读取之后核 native exact-content 许可，缺失拒绝；原 PUBLIC 预许可可具体化原 SHA，不由模型赋权 |

`createPublicReferenceExport` 是 MCP 原 schema、policy `3.0.0`；`createWorkspaceReferenceExport` 保留原 `WorkspaceReadResult`（utf-8/byteLength/content/sha256），policy `workspace-reference-3.0.0`。不互相冒 result。options 还含 `currentConfigurationRef()`，全部同步 native 只读 callbacks；撤销/断连为 undefined，配置引用绑定真实 session/root/generation，不恢复旧 ID。

两者复用原 `accepts/project`：

1. `accepts({taskId,proposalId,arguments,phase:'preflight'})`，不用还不存在的 digest/确认收据。只核原四字段/完整参数和明确 PUBLIC、限定目的、原生许可身份/期限/上限；实际读取仍经过原 Policy/Gateway。
2. 原工具 confirmed 后 `project({taskId,proposalId,result,signal})`。完整结果必须与原 confirmed record 对应的结果一致，path/byteLength/SHA/fullargs/run/Evidence 全由模块及可信 adapter 核验，之后才能具体化 native 精确内容许可。
3. 投影为 `{source,content,byteLength,contentDigest,truncated:false,readConfirmed:true}`；source 是 approved-reference 或 approved-workspace-reference。content 是确切批准的、完整有界 PUBLIC 正文，不是 opaque hash。超 native maxExportBytes 拒绝，不截断；上限不超过现读取 262144 字节。模型接收正文作为不可信资料，不赋工具权限。路径、许可 ID、run/raw Evidence 不出机。
4. **真实 CloudAgentPort I/O、异步凭据读取之后及 continuation replay**：`accepts({...原proposal,phase:'final',projection:原Runtime持久 continuation.result,signal})`。重新核原收据、精确内容许可和实际投影，即使本机重启没有 helper map 也不能仅 preflight 放行。默认 phase 只保旧第一读兼容，不能用于最终 I/O。
5. 精确内容许可 pending/deny/撤销/未知时，原 confirmed tool result 和 pending proposal 留在原 Runtime；shared worker 按已有等待/核实状态恢复，只重 projection，不能重 execute、新 task/store、伪造确认或 failed 后自动重开。helper 的 UNAUTHORIZED 不是“原读取没有发生”。进一步内容 native 对话由 P8 处理；缺许可不外发。

原不同 policy 版本的 continuation 不默迁到新正文策略。callbacks 的 missing metadata 不默认 PUBLIC。scope/id/expiry/参数/config 变化拒绝，取消 CANCELLED，dispose 永久拒绝。

## Desktop/P6/P8 接线

`reference-tools-host` 的 `publicReferenceExport` 增加 readPreflight，另外两个 callback 改上述精准 query；currentConfigurationRef 仍原 current()。publicReferenceAvailability/publicSkillAvailability 只是可发现性，不能签权。

factory 新增同步 `readPublicSkillSourceRefs(input)`，input 为原 cloudSkillCatalog 输入加当前 configurationRef。P8 从已经 Native 确认的本原 task/current root/config/期限来源，返回 `['public-reference']` 或 `[]`，只给公开 alias、不读正文。host 先 await publicSkillAvailability，再取 alias 并复查 task/config/取消/期限与原 selector 身份，调用 `describe(sourceRefs:readonly string[]=[])`；缺回调、空或非法 alias 不发布 Skill。该目录只公布 Native 已确认来源，不替代之后 proposal/source/preflight/exact 许可检查。

P6 仅消费 createWorkspaceReferenceExport；native candidate 查询若严格四字段，应从 ReadQuery 明确取四字段，再以原 Runtime 核完整 arguments，不能丢 maxBytes 或借其它 run。P8 提供原生 PUBLIC 来源/目的预许可，confirmed 后 exact SHA/bytes 内容许可及撤销；不使用 Node 绕工具预读未知文件。所有 selector、发布目录和 main/public exports/唯一 lock 由原负责人装配。

reference-tools-host 新增 native-only getters：`readPublicReferencePreflightCandidate(query严格4)` 返回冻结 query/runId/toolName/toolVersion/arguments/deadline，无 SHA/body；`readPublicReferenceCandidate(query严格4)` 核原 confirmed 记录/Policy/参数/scope/同 task Evidence/结果字节 SHA 后附 contentDigest/byteLength；`readConfirmedPublicReference(ReadQuery+contentDigest)` 独立返回原 run/result。factory 注入同 trusted `hostUserNamespace`，bindTask 在原 task checkpoint 保存 namespace fence；所有 getter 每次复查当前 config、profile、namespace、deadline、取消和原 proposal/manifest，停止清会话 pin。原 parsed pending 必须由 Runtime **先**保存到现 competition-loop 再 native preflight。Skill sourceRef 第一次尚无 selection path 时，需要 P8 `resolvePublicSkillPath({taskId,proposalId,sourceRef,configurationRef})` 仅从现 native PUBLIC alias 映射路径（不读文件/签权），或已有原 selection/Skill intent 绑定。getter 不从云字符串猜 path；Skill run与Competition run各核原绑定，确认结果不可互借。

## 原 CloudSkill worker/循环

保留 `createCloudSkillSelectionPort`、`VersionedSkillWorkerPort`、`CLOUD_SKILL_TOOL_NAME=skill.workspace_reference_summary@1.0.0`、原 skill:cloud-selection:v1 checkpoint，绝不 RegisteredTool 占位或嵌套 tool.invoke。

- `CloudSkillSelectionOptions.publicReferenceExport` 注入同一 native MCP 两阶段端口。`PublicSkillSource` 现在是 Preflight + 本地 path/公开 sourceRef/configurationRef/原输入 revision；首读前不臆造内容 SHA，purpose 必须 reference-summary。
- `describe(sourceRefs)` 保留显式 type +公开 id/version/digest/sourceRef enum，PUBLIC_ENUM_PATHS 为 `/skillId`、`/version`、`/digest`、`/sourceRef`，host 批准后沿原 availableTools。sourceRef enum 是 Native 刚确认的 alias 副本并去重，不发布私路径；无明确来源不会提供 free string 或猜默认 alias。
- 同已存在的 ReferenceSummary worker/原 REFERENCE_SKILL_TASK intent/config/readback，从原 coordination worker tools.invoke **之前** dispatch；不新 runTask/framework/store。
- worker 内层 MCP 仍原 ToolPort/Policy/Gateway。confirmed 后只读原 MCP 收据，走同精确 native PUBLIC 出机切面，才用与本地 worker 同一纯函数投影实际摘要。
- confirmed receipt 带 `content/byteLength/summaryDigest/truncated`、`contentDigest`（原来源 SHA）、selectionRef/sourceRef/state。摘要仅前两条非空行最多 480 字符，UTF-8 字节数与摘要 SHA 实算；truncated 表示相对归一化来源是否省略，绝不把来源 hash 冒摘要。原路径、resultSummary 元数据和 raw Evidence 不外发。
- `assertReceiptAllowed` 在每次真正 I/O 前只读原收据、重验原 native scope/exact content、重投影比 persisted receipt；pending/unknown 不允许 confirmed continuation。许可拒绝时原 worker read-confirmed/complete 留在同任务，继续只投影，读取次数不增加。
- Skill run skill-read-task-digest 与 Competition run competition-tool-task-step 不互冒。Native readConfirmed adapter 必须按原 Skill intent/selection/proposal 精确映射原 MCP run，原 readonly reconciliation 保留。输入 revision 由可信 Runtime 绑定，UI progress revision 不重新授予源许可。

## 验证与限制

本轮只 JS/MJS 与 TypeScript 语法解析、git diff --check；**没有 build、类型检查、test execution、SDK/server、模型或云调用**。prepared case 为显式 offline permission/worker/receipt，不冒原生/SQLite/真实云证据。继承 d94 与 P8 已有收据，不重测、不把历史成功算本增量验证。

P8 所有源码接线后统一本机验证：

- 首次没有 digest/receipt 时 preflight 可达，原 Gateway 一次读取确认后 native 精准 PUBLIC 正文与字节/SHA 进入真实 AgentArts continuation，得到基于正文的回答。
- native exact permission pending/deny、过期/撤销、scope/config/完整 maxBytes 变化、缺 metadata/PRIVATE、wrong run/hash/byte/path、取消、超上限拒绝出机。
- confirmed 后拒绝投影，再许可/恢复同 task/run/结果/Evidence；重启 continuation final phase 重验且工具执行次数保持一。
- Skill 首读 pending/unknown/confirmed 恢复、摘要正文/字节/SHA/省略标记正确、真实 I/O 前撤销拒绝，同记录零重读。
- Native 来源选择后 availableTools 必须包含真实 sourceRef enum，AgentArts 可按公开 alias 提案；缺来源/非法 alias/目录读取期间配置变化/取消/到期不发布。此增量已备 descriptor/host offline cases，仅语法检查，不计为执行通过。

模块 prepared entry：packages/mcp/test/public-export.test.mjs（MCP）、workspace-export.test.mjs（workspace）、packages/skills/test/cloud-selection.test.mjs、apps/desktop/test/reference-export-candidates.test.mjs。两种读格式共享 public-export-fixture.mjs，各入口只注册自身 case，workspace glob 不重复执行同一 case。

无 wire/DB/根 lock 修改；新增内部私有校验和纯摘要函数，无额外依赖。根既有 build 顺序与依赖版本由 P8 维护。未知、无服务、缺端口仍 unavailable，不回退 Local，不宣称 MOD/MVP done。
