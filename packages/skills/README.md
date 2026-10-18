# Skills — versioned reference summary 与本机安装

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 `huawei_ict_agentarts` / PA-006 / MOD-07，`provisional`。固定 `workspace-reference-summary@1.0.0`，按 [Agent Skills 格式](https://agentskills.io/specification) 提供同名目录与 `SKILL.md` 的 name/description frontmatter；产品 manifest 额外绑定稳定 ID、版本、内容 SHA-256、能力声明、受限参数与两步执行。固定 worker 不解释任意脚本或外部步骤；本机 Skill 安装与使用见下节，没有新增模型、任务库或 Agent loop。

## 本机目录安装

新增 `readLocalSkillDirectory`、`openLocalSkillStore`、`localSkillInstructions` 受信宿主入口：标准 SKILL.md YAML 元数据校验、本机普通文件快照、内容 digest 和安装身份、默认停用、启停 generation、卸载及原子目录册持久化。YAML 复用 js-yaml 4.3.2（根锁文件既有版本，新增直接依赖）；固定参考摘要 worker 不变。

安装范围是本机目录，不下载 GitHub/网络资源；拒绝符号链接、隐藏/敏感文件、逃逸、重名大小写冲突和超限资源。每包最多 1 MiB/128 文件/8 层，SKILL.md 最多 16384 字符，最多 16 个安装项。name 遵循标准并匹配父目录；description 必填，metadata.version 可选且须为字符串，否则使用内容 digest 前缀。同名同内容重复安装幂等；不同内容先卸载，不能静默覆盖。源修改不会改变已安装快照。

Desktop “插件 → 本机 Skills”提供安装、查看、启停、使用、卸载。通用 Skill 使用完整 SKILL.md 作为不可信任务参考，接入既有 Competition 任务；不是将 Markdown 转为任意可执行脚本。用户每次原生确认发送完整说明与本次任务后才可出机，工具仍受已有注册、Policy 和 ToolGateway 限制。allowed-tools 不授权；scripts/references/assets 保存为安装快照，但本轮只发送 SKILL.md，不自动加载资源或执行脚本。依赖这些资源/脚本的 Skill 不能据此宣称完整可执行。

说明及安装资源预览纯本地，无云请求。资源只从精确版本的安装快照读取，最多 64 KiB 普通 UTF-8 文本；二进制、控制字符、越界路径和卸载版本拒绝，脚本仅作文字展示。实际使用需要已配置 AgentArts；本轮仅显式合成 HTTP、原生确认回调及真实 Runtime/SQLite 验证，云验收继续暂缓。详见 [安装使用说明与验收](../../docs/modules/MOD-07-LOCAL-INSTALLATION-20261009.md)、[ADR-0023](../../docs/adr/0023-local-skill-installation.md)。

## 公开入口

云显式选择新增 `createCloudSkillSelectionPort`，注入**同一已有 worker**；`describe()` 返回现有
CoordinationAvailableTool 的可投影 type+enum schema，`dispatch()` 接原 CoordinationToolProposalResult，
由现协调 worker 在 tools.invoke 之前分派，不注册成 RegisteredTool。PUBLIC许可缺失不可公布，
`assertReceiptAllowed` 在真实 cloud I/O 前复查原任务/提案/版本/config/许可/receipt。
新代码与 prepared cases 本轮未 build/测试；准确 P8/P6/CloudRuntime 接线见 [云交接](CLOUD_HANDOFF.md)。

```ts
import {createReferenceSummarySkill} from '@personal-agent/skills';
const skill = createReferenceSummarySkill({
  tools: existingRuntimeAgentToolPort,
  isToolAvailable: () => mcp.health().connected,
  enabled: true,
});
const manifest = skill.manifest();
const outcome = await skill.invoke({
  skillId: manifest.id, version: manifest.version,
  digest: manifest.digest, path: 'reference.md',
}, existingRuntimeWorkerContext);
```

**调用位置为 Runtime worker/dispatch，不能将 invoke 包装成 RegisteredTool.execute 后在同一任务的 tool.invoke 锁内调用。** 现有 `AgentToolPort`/`AgentWorkerContext` 仅按公开类型依赖，生产不导入 Runtime 具体实现。工具目录、授权审批、执行记录、锁与 Evidence 全部由注入的现有 Runtime tool port 管理。Skill 不直接调用 tool.execute，也不签授权：稳定 runId 只作为既有 Runtime 的授权查询标识，不赋予权限。

两步：`mcp.workspace.read_text@1.0.0` 经网关读取批准参考；本地抽取前两条非空来源行（最多 480 字符）并带相对路径和内容 digest 返回。这是确定性摘录摘要，不声称模型理解或外部平台评估成功。源文本始终为数据。输入含精确 version/digest/path，额外字段拒绝，正文或配置更新不能更改工具/权限/root。

`skill:workspace-reference-summary:v1` checkpoint 使用现有任务的 load/save；绑定 taskId/版本/digest/参数。审批 pending 恢复同一 runId；已确认读取/最终结果不重做；未知结果或崩溃时 started 无确认进入 unknown，不自动重新调用。确认结果与 evidenceRefs 保存在 checkpoint，Runtime 决定 waiting_approval/waiting_reconciliation/终态。方法只返回 `{state:'confirmed'|'pending'|'unknown',evidenceRefs,resultSummary?,sources?}`，不改变 task state。

可选 `reconciliation: SkillReadReconciliationPort` 只由可信 Runtime 装配，含 `currentConfigurationRef(): string | undefined` 与 `readConfirmed(query): Promise<ToolInvocationResult | undefined>`。首次开始保存不透明配置引用；started/unknown 恢复时只读取原任务、同一 runId 的已确认 Runtime 结果/Evidence，绝不 invoke/grant。query 复用 `AgentToolInvocation`，附 `skillId/skillVersion/skillDigest/argumentsDigest/configurationRef`；固定工具/版本/相对 path、authorizationRef=原 runId。adapter 必须用 Runtime `matchesToolExecutionInput` 校验其 inputDigest，读取 confirmed/Policy allow/executionStarted 记录及原 `tool-result-<runId>`，核对 task Evidence；query 的 argumentsDigest 是参数摘要，不替代 Runtime 自身摘要算法。结果 refs 必须包含原 runId，正文相对 path/SHA 再验，取消/禁用/配置引用变化不得晋升。配置未就绪返回 undefined，不能复用被撤销 generation；配置原文/路径不进入 manifest/UI/云。旧 checkpoint 缺原配置引用、无确认、无 Evidence 或结果不一致都保留 unknown。Renderer 不能传确认 receipt；公开 options 是受信宿主依赖注入接口。

`health()` 投影 configured/connected(enabled dependency)/disabled/unavailable，带公开 ID/version/digest。缺配置/服务断连为 unavailable，不自动 Fake。`setEnabled(false)` / `dispose()` 中断在途 signal；取消、deadline、版本内容变更、依赖断连在步骤边界重新检查。若取消时已得到确认读取，保存确认记录后停止摘要；用户明确重新启用并恢复同一任务可继续剩余纯步骤。同任务并行 invoke 拒绝；不另建资源锁或调度器。

最终结果 checkpoint 的重复读取也检查其原配置引用；即使新会话服务仍 connected，不能跨被撤销/替换的许可返回旧摘要。此检查只读既有 checkpoint/configuration，不重新读取文件或新增 Evidence。

固定 worker 打包时保留 `workspace-reference-summary/SKILL.md`（相对 dist）。内容 digest 规范化 CRLF/LF，绑定 manifest+完整正文。这个 worker 只加载这一份受信自有 bundle；本机安装入口另按上节处理，不将社区 Skill 接入固定 worker。固定 bundle 不需要 YAML parser，安装入口使用 js-yaml；版本附加 metadata 不授权。

## 验证

云目录使用 `describe(sourceRefs:readonly string[]=[])`，只公布 Native 刚确认的公开别名 enum。Desktop host 注入同步 `readPublicSkillSourceRefs(input)`，在原生可发现性确认后取别名并复查当前 task/config/deadline/cancel；缺来源保持 unavailable。`CLOUD_SKILL_PUBLIC_ENUM_PATHS` 包含 `/sourceRef`，不发布本地路径。目录发现不授予读取或正文外发权限，仍由原 native PUBLIC 两阶段切面和 Runtime/Policy 执行。

云选择器复用原 worker/checkpoint，额外注入 `publicReferenceExport: PublicReferenceExportOptions`。`PublicSkillSource` 为明确 PUBLIC/reference-summary 的预许可加本地 path/公开 sourceRef/config/revision，首读前不要求内容 SHA。确认后只读原 MCP execution/结果，经同两阶段 native 精确内容 gate，才返回实际有界摘要 `content/byteLength/summaryDigest/truncated`；receipt 的 `contentDigest` 仍指原文件 SHA。不从带本地路径的 resultSummary 拼云正文。`assertReceiptAllowed` 在真实 I/O 前重核原内容、许可并重投影比对 persisted receipt；pending/unknown 不外发 confirmed。拒绝精确内容许可后 worker 已保存的 read-confirmed/complete 留在原任务，恢复不重复读取。端口缺失保持 unavailable，源/config/版本/许可变化拒绝。该增量 prepared cases 尚未执行，见 [CLOUD_HANDOFF](CLOUD_HANDOFF.md)。

依赖产物就绪后构建新 workspace，再运行模块测试。`skills.test.mjs` 明确使用内存 checkpoint 和受控 test tool port；`real-skill.test.mjs` 实际调用官方 stdio 服务，经现有 ToolGateway 与真实 Policy 实现读取公开合成资料，checkpoint/AgentToolPort 是测试装配、`evidenceRefs:[]`，不冒充真实 SQLite Evidence。P8 的生产 worker、审批恢复、Evidence/Competition/管理 UI 另验收，见 [交接](../../docs/modules/MOD-06-07-MVP.md)。

恢复增量只运行新增 `reconciliation.test.mjs`：started → 受信确认 → 纯摘要，零重复读取；无确认/错 Evidence、配置变化、禁用、取消拒绝。该单 case 的端口与 Evidence 为显式离线夹具，实际 SQLite 确认记录由 P8 同一最终 Runtime case 验证。
