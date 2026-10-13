# MOD-28：Goal review 来源的受控计划修复

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 profile 为 `huawei_ict_agentarts`。本包补齐 P5 的已选结构化候选 → AgentArts 候选 → 现有 Runtime/Policy 工具 → 图版本/Evidence 读回。根已授权 P5 唯一修改 `local-repair.ts` 及专属测试；P8 仍唯一修改 Runtime Application 构造与 main。复用 `cognition.commit_repair`，不增加 repair registry、wire operation、任务库或执行循环。

## 接口与装配（provisional）

`prepareReviewedRepair(snapshot, at, review, candidate?)` 由 cognition 公开导出。它只为精确 offered、eligible selected REVISE、带结构化 repair 的受影响节点生成 binding/request/preview；RECHECK、uncertain、缺 repair 或 restricted scope 返回 unavailable。图版本、目标版本、依赖身份与版本、原有合法范围均严格校验，复用既有 repair preflight。策略 description 不成为节点 summary。

`goal-cognition-host` 与 `proactive-host` 的可信 getter：

- `readRepairBinding(sourceTaskId)`：当前许可、generation、review、graph 仍有效时返回 `{reviewTaskId, graphNamespace, bindingVersion, graphRevision, selectionDigest, candidateDigest, targets, dependencies}`，否则 undefined。refs 是本地真实 `{id, revision}`，不直接出云。
- `readPreparedRepair(sourceTaskId)`：读取现有 `competition-repair-candidate` 1.0 checkpoint；仅允许 source task succeeded，以本地原 scope 反解 opaque refs，并重新执行预览。返回 `{kind:'prepared', binding, request, preview}` 或 unavailable。非法替换明确拒绝。

P8 在既有 Competition Runtime 构造传入 `repairCandidateVersion:'1.0'` 与：

```js
localRepair: {
  graphNamespace: namespace,
  bindingVersion: 'desktop-reviewed-execution-v1',
  withSourceLock: work => existingSourceLock(work),
  reviewedSource: {
    resolve({sourceTaskId, reviewTaskId}) {
      const value = proactiveHost?.readPreparedRepair(sourceTaskId);
      return value?.kind === 'prepared' && value.binding.reviewTaskId === reviewTaskId
        ? value : undefined;
    },
  },
}
```

纯 Goal 模式不伪造 memory、Fact、sourceTool 或 Evidence。原 Fact 配置的 sourceTool/memory/resolveBinding/matchesSource 原样保留，也可与 reviewedSource 同时存在。构造检查接受完整 Fact 来源或 trusted reviewedSource；固定 namespace、bindingVersion、source lock 始终必需。

既有 `submitLocalRepair` 进程内请求兼容原 `{sourceTaskId,evidenceId,idempotencyKey,deadline}` 与新 `{sourceTaskId,reviewTaskId,idempotencyKey,deadline}`。公共 wire 不变。Goal 来源需真实 succeeded Runtime review/checkpoint、精确 conversation/namespace、完整 review digest、immutable cloud candidate digest、合法 selected option 与 binding、当前目标及依赖版本。Runtime 独立反解 cloud refs，不能信任 resolver 自报授权。执行仍通过既有 ToolGateway、`cognition:repair` Policy/审批和当前 source lock，最终 guard 到 CAS/持久读回之间无异步等待。

## 云端数据与真实兼容限制

初始 goal 字符串的 JSON 数据包含 action、strategy、受限 nodes、`repairContext:{expectedGraphRevision,targets,allowedDependencies}`。targets 含 opaque NodeRef、原节点 summary 与 requestedDependencies；不含 sourceRef、private Fact 正文、凭据或路径映射。AgentArts 提案仍是已有 repair_candidate 1.0；不伪造 confirmed continuation，也不将候选说成执行。

当前云 router 原先只从真实 confirmed continuation.result 读取 repairContext，且要求 requestedSummary。本包新初始 goal 使用 summary 基线以允许语义修订。唯一云作者已收到最小结构样例并负责兼容；在实际云返回读回前，本路径的云兼容仍未验收。缺结构化候选或装配时保持 unavailable，不静默 Local 回退。

## 反馈与恢复

source 任务仅受理/返回候选时不会显示 applied。已有 tick/applyDecision 在当前许可内提交独立受控修复任务，保存既有 Runtime checkpoint 的 repair task ID；未知受理先按固定幂等键读回，不另起写入。审批与真实终态保持。

只有 `cognition.commit_repair` 的真实 confirmed、policy allow、executionStarted Evidence，精确 intentDigest/input 绑定，提交历史 snapshot 完整持久读回，以及涉及节点的当前 revision 都一致时，Desktop 才设置 executionVerified/graphUpdateVerified=true；修复任务 succeeded 后才显示 applied。updatedNodes 明确列出本次实际变化的 Goal/Decision/Plan，不把 Plan 更新说成全部 Goal 修改。后续节点版本变化保留执行已发生，当前核实降为 false。

重建恢复原 review/source/repair task IDs 和已核实回执，不恢复云许可或后台推理。started 取消或写中结果未知保留 waiting_reconciliation，不重放。代码回滚不能撤销已提交图历史。

## 已运行的必要验证

- cognition 与 Runtime 定向 TypeScript 编译通过。最初 Runtime 类型失败源于 agents/dist 旧版本；只重编当前 agents 产物后通过，未改其源码。
- 3 个 reviewed-repair 域检查通过；只读预览与范围/替换/uncertain/restricted/版本拒绝。
- 13 个既有 Fact local-repair 检查通过，保留来源 Evidence、审批、冲突、锁、未知写入与恢复行为。
- 3 个新增 reviewed-local-repair 检查通过，包含纯 Goal 来源实际 SQLite/Policy/CAS/Evidence 和持久重建、4 个来源/候选/图/许可变化零追加场景，以及取消 started 后未知状态不重放。
- Desktop 专属检查 13 项通过，包括 Fake Laya/AgentArts 候选经真实 Runtime 审批、SQLite 图 5→7、Decision/Plan revision 1→2、Evidence 和目标读回后才 applied；重建保持 task ID/verification 且不恢复许可，后续 Plan revision 3 降核实。
- 没有启动/训练真实模型、联网邮箱/日历、全仓 check 或重复全包测试。真实云 router、P8 main 生产装配、实际用户目标/会议仍待集成验收；MOD/MVP 未 done。

## 当前源码接线核对（2026-10-07）

来源基线为 `main@4b5ec61`。以上工作包分工、验证数量和云兼容结论保留历史含义；
P8 main 的源码装配已存在，真实生产运行与云端返回仍未由本次核验。

[Desktop main](../../apps/desktop/electron/main.js) 的非 synthetic Competition
Runtime 构造已传入 `repairCandidateVersion: '1.0'`、固定 namespace/bindingVersion、
既有 `withReviewedRepairLock` 及 `reviewedSource.resolve`。resolver 读取
`proactiveHost.readPreparedRepair(sourceTaskId)`，仅接收 prepared 且精确匹配
`reviewTaskId` 的候选。[Goal host](../../apps/desktop/electron/goal-cognition-host.js)
提供可信 binding/preparation 与提交、反馈读回，
[proactive-host](../../apps/desktop/electron/proactive-host.js) 转发同一入口；
不存在需要补建的另一修复宿主。

[Runtime local-repair](../../apps/runtime/src/application/local-repair.ts) 与
[Runtime Application](../../apps/runtime/src/application/runtime-application.ts)
已消费 Goal review 来源，继续通过既有 Policy、工具、source lock、原子图 CAS 和
历史读回完成执行核实。源码场景见
[reviewed local-repair 检查](../../apps/runtime/test/reviewed-local-repair.test.mjs) 与
[Desktop Goal host 检查](../../apps/desktop/test/goal-cognition-host.test.mjs)。
候选受理、模型选择或 source task 成功仍不能单独证明修复已执行；必须满足原有
confirmed Evidence、精确输入与提交历史、当前目标版本的核实条件。

本次仅校正接线记录，没有执行真实云 router、真实 Laya/AgentArts、Electron 或实际
用户目标/会议链路。源码已装配不等于云候选兼容或现场验收通过；缺候选、许可或可信
绑定仍保持 unavailable，保留原恢复语义与 MOD/MVP 未 done 的边界。

### 默认 P5 会议链与可信来源交接（2026-10-07）

沿 `main@4b5ec61` 的既有入口核对，公开资料主动认知链和 Calendar 会议链具有不同的
来源绑定。默认 [main](../../apps/desktop/electron/main.js) 创建
[P5 composition](../../apps/desktop/electron/cognition-p5-composition.js) 时只传入
`calendarReadPort`，没有传入 `goalCognitionHost`、`readCommittedMeetingProjection`，
也没有 `facts` 与 `readMeetingSourceRevision` 的组合。源读取已挂载不代表会议修复已挂载；
无可信 binding 的消费继续保存 `requires_review`，不调用模型、不写 Graph。

已有核心消费入口是
[createCommittedMeetingProjectionReader](../../packages/cognition/src/reviewed-meeting.ts) 和
[Goal host meetingReviewedRepairPort](../../apps/desktop/electron/goal-cognition-host.js)：
读回真实来源版本、精确 Fact ref 与已完成投影后，复用原 Goal review、Runtime repair、
Policy 和 CAS。没有另一个 Fact 来源、模型入口或执行宿主需要重建。

| 既有入口 / 责任人 | 当前消费事实与下一依赖 |
| --- | --- |
| Calendar / Potato：[calendar-meeting-host](../../apps/desktop/electron/calendar-meeting-host.js) | `confirmedRead` 核对原 Runtime 任务、配置、UID、sequence 与 confirmed Evidence；`bindMeeting` 仅绑定已经存在的 Fact；`readBaseline/readCurrent` 仅在本次 `refreshMeeting` 的绑定范围内可用。缺 Calendar 来源版本到已提交 Fact 的可信读回。 |
| Memory / Runtime / goo：[CompetitionFactHost](../../apps/runtime/src/application/competition-fact-host.ts) 与 [SQLite projection](../../apps/runtime/src/application/sqlite-fact-projection.ts) | 已有持久 Memory→Graph→completed impact。当前 CompetitionFactHost 的写入入口是公开 Vault 的 `recordPublicSource`，projection feed/query 固定 `public`；不能将私人 Calendar 伪装为公开资料以取得该路径。 |
| 核心认知 / zemeng：committed reader 与 Goal host | 需要可信 `readSourceRevision(event, context)` 返回 `{source, sourceRevision, meetingFact: {id, revision}}`，以及同 namespace 的原始 `listImpactReceipts` completed projection；检查真实当前 Fact、摘要和投影链接后才复核。 |
| 根 Desktop composition / zemeng | 可信来源读回交付后，复用原 Goal host 的会议端口，接入现有 P5 可选装配。当前 [proactive-host](../../apps/desktop/electron/proactive-host.js) 未转发该会议端口；单独增加空转发不能完成来源链。 |

来源顺序也须在 Calendar 业务消费端验证：现 `meetingRecord` 每次要求 Graph 当前 Fact
仍为旧 baseline 的精确 revision、summary、sourceRef，且 reason 含对应
`[sourceRevision: sequence]`。通用 Memory 投影的 reason 没有此 Calendar 标记；
若直接先更新 Fact 再读取旧 baseline，会被当前版本核验拒绝。不得通过放宽核心可信读回、
猜测 event 文本或给无 binding 分支返回 `KEEP` 掩盖该缺口。

继续沿既有 #212 / [P1-A 日历交接](POTATOS-MVP-TASKS-20260930.md) §4
和 [P8 Runtime 交接](MVP-P8-CLOUD-RUNTIME-HANDOFF.md)「仍需云 Runtime 实现」第 5 项的
Calendar Fact/Goal 依赖项处理，不新增任务或 wire DTO。验收顺序如下：

1. Potato 用同一可信配置下两个独立 succeeded/confirmed 单条读取任务证明 UID 相同、
   sequence 增长和 UTC 时间确有改变；保留原 checkpoint/Evidence 与旧 baseline。
   `NOT_FOUND`、取消和同版本读回分别处理；读取许可不自动授权私人正文出云。
2. Potato 提供业务来源绑定，goo 核对原 Memory/projection 装配与敏感范围，读回本次
   sourceRef/sequence 对应的精确已提交 Fact ref、当前摘要与 completed projection。
   验证旧 baseline 与新 Fact 的消费顺序，不直接从 Renderer/event 文本断言投影已完成。
3. zemeng 在原 composition 注入上述可信端口与原 Goal host，验证 P5 本次 review 的
   Fact、sourceRevision、namespace 和 projection 一致；错 UID、错版本、pending projection、
   配置撤销、取消/超时均不能启动修复或产生 Graph 写入。
4. 用已有 Goal/Plan 对该 Fact 的真实依赖完成 KEEP 或复核；需要修复时仍经原 Runtime
   Policy/审批、精确输入、CAS、confirmed Evidence 与历史读回。重启恢复未知结果不重发，
   无关依赖不被改写；只读日历来源不因此获得外部日历写能力。

本轮另用公开 P5 composition 配备显式合成 `reviewedRepair` binding 与实际 TaskRuntime
SQLite 验证五个持久分支：无 binding、KEEP、pending review、缺可选 feedback、confirmed
repair。省略已清空的 `retryableInference/selection/repairTaskId` 后满足既有 JSON 无损
checkpoint 合同；重开后不重复 review/repair。confirmed 分支的可信 feedback 为明确
合成端口，Graph CAS 与持久读回实际运行；没有真实 Runtime repair 任务、Policy/Evidence、
Laya、Calendar 或云执行。本证据证明这些绑定消费与持久化分支，不证明默认 main 已接通
Calendar Fact 链，也不改变真实现场验收未完成的状态。

## 公开会议复查选项的完整范围（2026-10-08 续接）

原buildMeetingRepairOptions对可信会议Fact的选中scope无条件调用100-target结构候选。
真实PUBLICVault recordPublicSource/drain/processImpacts得到completed Fact1→2，加原
公开Goal工具写入及101个合成Plan，graph104完整publicImpact/meeting scope均102条
RECHECK。原Runtime默认大scope guard不替custom callback处理这个helper：before
20891/ea1fd2观测task failed/EXTERNAL_FAILURE（内层INVALID_ARGUMENT）、custom1、
infer0/无REVIEW/dispatch0，完整失败DB保留。

仅helper scope>100跳过可选candidate并安全读取其kind，保全部精确scope及原recheck/
defer，100项边界仍可revise；不扩大public repair100上限，不改selector/Runtime/custom
callback/CAS/身份/隐私/许可/Schema，也不迁移或重试旧failed任务。EXACT2 sourcec9e29d4c/
test33f2d069冻结23artifact manifest SHA256
28ac847001237874177f86d180197ba7df9f4820677761bf906b1b0f42258e92。
新增100/101回归原源码f7cfd3 actual1，修后80345f完整受影响文件18/18、cognition build
c95a92 actual0。fresh公开Fact/可信custom callback after15484/24f264 actual0：102完整
affected、仅recheck/defer、无repair、custom1/infer1/dispatch0；同completed receipt重放
同task/完整review且不再infer。原9个before证据中两个源路径对应immutable旧base副本，
其余七个原字节保留；两DB/完整日志和scope独立只读核对。

此处证明公开Fact选项消费者，不证明Calendar sourceRevision/P5默认binding、Policy
ledger、真实Laya/HTTP或Desktop102云交接；合成Plan、Gateway context和Laya明确标记。
根已整合到f0548d8，后续必要固定HEAD完整检查另行记载，不挪用先前d3cb绿结果。

## 此批固定源码完整检查与既有 Calendar 交接（2026-10-08）

固定1f548bb479a54bf807f30d7c707d8bfec61450d9、tree14baef295592c3fe3ff36d2fa9408538ba7b0e13，
Node24.15/实际4CPU、原 npm run check 的49829/a721c2 actual1，于01:14:12.383Z结束。
原raw33组2494项2443通过、1失败、0取消、50跳过；Desktop641/630通过11跳过、
Runtime439/439，构建/类型/生成/架构/合同已执行，root integration未执行。
完整日志248081B，SHA256 e1586ab7dca74c157124f2c230d284d2751a6aa5cb5caf5368099aaeaad6fe73。

唯一独立失败仍为 Potato 的原 Calendar `test/cloud-business.test.mjs:88`：预期TIMEOUT，
实际EXTERNAL_FAILURE；源码和测试与main4b5ec61逐字相同。原leaf失败、摘要和重复的
failing-tests列表不是三个故障，不放宽断言或期限、不改Calendar文件。此问题沿#212
原c7失败交接由Potato处理；同固定HEAD原完整文件隔离a28ffe actual0、8/8，日志SHA256
09513b55f94ab6b00aaac647261b5fdf83232afe9258bdb288311678c4c4e788，
不能据此抹掉整仓失败或声称旧根因已解释。此轮覆盖前述六项已整合源码，不覆盖
后续Interest收据或新面板/Live启动恢复；有新增源码时另作必要固定HEAD检查。
