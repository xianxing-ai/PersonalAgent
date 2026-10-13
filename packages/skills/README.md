# Skills — versioned reference summary

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 `huawei_ict_agentarts` / PA-006 / MOD-07，`provisional`。固定 `workspace-reference-summary@1.0.0`，按 [Agent Skills 格式](https://agentskills.io/specification) 提供同名目录与 `SKILL.md` 的 name/description frontmatter；产品 manifest 额外绑定稳定 ID、版本、内容 SHA-256、能力声明、受限参数与两步执行。没有通用脚本/YAML/外部 Skill 引擎，没有新增模型、任务库或 Agent loop。

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

打包时保留 `workspace-reference-summary/SKILL.md`（相对 dist）。内容 digest 规范化 CRLF/LF，绑定 manifest+完整正文。当前只加载这一份受信自有 bundle；不宣称导入任意社区 Skill。官方规范用于可移植格式，无额外 parser 依赖/源码复制；版本附加 metadata 不授权。

## 验证

云目录使用 `describe(sourceRefs:readonly string[]=[])`，只公布 Native 刚确认的公开别名 enum。Desktop host 注入同步 `readPublicSkillSourceRefs(input)`，在原生可发现性确认后取别名并复查当前 task/config/deadline/cancel；缺来源保持 unavailable。`CLOUD_SKILL_PUBLIC_ENUM_PATHS` 包含 `/sourceRef`，不发布本地路径。目录发现不授予读取或正文外发权限，仍由原 native PUBLIC 两阶段切面和 Runtime/Policy 执行。

云选择器复用原 worker/checkpoint，额外注入 `publicReferenceExport: PublicReferenceExportOptions`。`PublicSkillSource` 为明确 PUBLIC/reference-summary 的预许可加本地 path/公开 sourceRef/config/revision，首读前不要求内容 SHA。确认后只读原 MCP execution/结果，经同两阶段 native 精确内容 gate，才返回实际有界摘要 `content/byteLength/summaryDigest/truncated`；receipt 的 `contentDigest` 仍指原文件 SHA。不从带本地路径的 resultSummary 拼云正文。`assertReceiptAllowed` 在真实 I/O 前重核原内容、许可并重投影比对 persisted receipt；pending/unknown 不外发 confirmed。拒绝精确内容许可后 worker 已保存的 read-confirmed/complete 留在原任务，恢复不重复读取。端口缺失保持 unavailable，源/config/版本/许可变化拒绝。该增量 prepared cases 尚未执行，见 [CLOUD_HANDOFF](CLOUD_HANDOFF.md)。

依赖产物就绪后构建新 workspace，再运行模块测试。`skills.test.mjs` 明确使用内存 checkpoint 和受控 test tool port；`real-skill.test.mjs` 实际调用官方 stdio 服务，经现有 ToolGateway 与真实 Policy 实现读取公开合成资料，checkpoint/AgentToolPort 是测试装配、`evidenceRefs:[]`，不冒充真实 SQLite Evidence。P8 的生产 worker、审批恢复、Evidence/Competition/管理 UI 另验收，见 [交接](../../docs/modules/MOD-06-07-MVP.md)。

恢复增量只运行新增 `reconciliation.test.mjs`：started → 受信确认 → 纯摘要，零重复读取；无确认/错 Evidence、配置变化、禁用、取消拒绝。该单 case 的端口与 Evidence 为显式离线夹具，实际 SQLite 确认记录由 P8 同一最终 Runtime case 验证。
