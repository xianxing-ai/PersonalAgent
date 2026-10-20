# MOD-31 H3：候选试跑回执比较与采用建议

日期：2026-10-20。Profile：`huawei_ict_agentarts`。负责人：zemeng5208；执行者：MOD-31 开发对话。
状态：`in_progress`，独立工作树 `.worktrees/harness-candidates`，分支 `codex/harness-candidates`，基线 `9eb2fb08`。
#364 已于 2026-10-17 合入，不从旧评估分支重复实现。

本包本人负责：唯一候选契约、比较器、原 Runtime 工具消费者、必要关键测试和本文。
Windows/coding 对话负责真实隔离试跑与原 F15 采用接线；H1 核心写入者负责共享 RuntimeApplication 的
实际工具目录装配与 owner/executor 解析，不进入对方工作树修改。

## 唯一 provisional 契约

`@personal-agent/contracts/harness-candidates` 导出 `HarnessCandidateBinding`、`HarnessCandidateTrial`、
`HarnessCandidateContext`、`HarnessCandidateComparison`、`parseHarnessCandidateBinding`、
`parseHarnessCandidateTrial`、`harnessCandidateArtifactDigest` 和 `harnessCandidateRecipeFingerprint`。
恢复结果 `HarnessTrialRecovery` 只读回原 session 的 clear/in_progress/unknown 与既有 checkReadback；
clear 只代表 journal 无挂起操作，不等于验证通过，不重写原 UNKNOWN 或 Evidence。
Schema 位于 `packages/contracts/schema/harness-candidates.json`，类型及运行时 Schema 由原 generate 脚本生成。
Trial 组合既有 `CodingRepairSession`、`CodingRepairCheckReadback`，不另建跨包 DTO、任务库、调度器或授权层。

绑定字段：version/candidateId/artifactId/taskId/trialTaskId/workspaceId/sessionId/baselineSnapshotId/
inputDigest/configurationDigest/workflowVersion/runtimeVersion/recipeFingerprint/artifactDigest/
parentArtifactDigests/executionKind。taskId 是共同 owner；trialTaskId 是原实际执行者，必须等于 session.taskId。
workspaceId 是原用户工作区，不用它冒充隔离目录；session 是各候选独立隔离身份。

artifactDigest 精确复用已有 F15 元数据指纹：按 path 排序的 path/sha256/packageId/kind，
以及按 id 排序、dependencies 排序的包图；不包含 snapshotId 或正文。
原 `codingSnapshotFingerprint` 委托唯一实现，保持已有哈希语义。
recipeFingerprint 为 recipeId 排序、每项 packageIds 排序后的 recipeId/packageIds/required 的 JSON SHA256。
configurationDigest 还须由宿主绑定实际命令配方实现、模型/参数与执行环境；相同 recipe 名不证明相同命令。
所有输入仅接受 metadata，正文不进入比较结果或 Evidence。

## 真实调用方和安全边界

试跑工具锁定 `coding.repair.trial@1.0.0`，输入为 `{candidateId,patches,recipeIds}`，组合可带原 `parentTrialRunIds`，
候选/baseline/原输入/配置/版本来自可信宿主；每次实际试跑使用独立 session、原 Gateway run 与真实验证回执。
外层工具所需 scopes 覆盖内部原 host 的 read/write/apply/execute，不直接调用别的 RegisteredTool.execute，
不 publish。结果中引用本次外层 run，须等原 Runtime confirmed 后才能比较。

`createRuntimeHarnessCandidateTools(application, options)` 由 `@personal-agent/runtime/application` 导出。
options 缺失时返回空工具集合；包含：

```typescript
getBinding(context: ToolContext): HarnessCandidateContext | undefined;
resolveTrialOrigin(ownerTaskId: string, runId: string, context: ToolContext):
  {actualTaskId: string; arguments: Record<string, unknown>; scopeRef: string} | undefined;
```

共享宿主必须先验证当前比较执行者属于原 H1 plan/marker，再返回冻结绑定；origin 仅能指向原 owner
或同一持久计划验证的实际执行者。模型持有其他任务 runId 不构成跨任务权限。
工具只放原执行子智能体目录，root 不获执行工具；实际装配由 H1 写入者交付。
缺少调用方注册或可信 owner resolver 时，本包接口仍不能声明为产品全链完成。

`harness.candidates.compare@1.0.0` 输入严格为 `{trialRunIds:string[]}`，不接模型提供的回执或绑定。
它核对自身原 started/allow Gateway 操作、原调用参数与 scope；再核对每个 trial 的原 task/run、
tool/version、executionStarted/allow/confirmed、完整参数摘要、原 execution Evidence 和缓存结果。
最终核对候选/session/验证引用与原操作；当前绑定以原 checkpoint once 固定，取消或期限失效立即拒绝。
不调用 Shell、模型或目录写入工具；不在此复制执行循环。
Runtime 将推荐精确关联 `recommendation.trialRunId`；纯比较器缺少可信来源时不填该字段。

### 实际 Runtime bindings 适配

`apps/runtime/src/application/harness-candidate-bindings.ts` 公开 `createRuntimeHarnessCandidateBindings(application, options)`。
H1 共享 `application.ts` 的 export 与工具装配由其唯一写入者完成，本包不改共享文件。
factory 及 compare factory 均在调用时才读取 `application.runtime`，可先建 RegisteredTool descriptors，再构造 Runtime。

```typescript
resolveHarnessScope(context: ToolContext, source?: {
  actualTaskId: string; runId: string; scopeRef: string;
}): RuntimeHarnessCandidateScope | undefined;
readConfiguration(scope: RuntimeHarnessCandidateScope, context: ToolContext):
  HarnessCandidateContext | Promise<HarnessCandidateContext>;
```

Scope 包含 ownerTaskId/actualTaskId/parentTaskId/scopeRef/configurationRef/inputDigest/deadline/workspaceRef。
H1 先验当前 caller，再允许同 owner 或原计划/marker 中的历史 executor；源任务可已 settled。
configurationDigest 与真实 configurationRef 相等，inputDigest 另行绑定原 owner 输入，不因配置跨任务稳定而允许借回执。
scope.workspaceRef 是原根/Node/工具配置的 opaque 授权绑定，区别于 F15 实际 workspaceId。
冻结记录及 source scope 保留并复核 workspaceRef；session.workspaceId 只与冻结 context.binding.workspaceId 比较。
返回 `trial`、`adoption`、`recovery` 端口组和 `compare` options，调用方分别组合 Windows 原 host 和三个 factory。

helper 验原 application-tool-invocation、started/allow 和完整参数摘要，原 checkpoint 中只另存不含补丁的 run/scope/digest 定位。
run→session 以含原定位和 CodingRepairInput 的单个 saveOnce 行保存并读回，不维护第二补丁库。
精确补丁每次只从原 invocation 读取；confirmed 原记录、execution Evidence、task/session/artifact 均复核。
恢复只开放原 actual executor 的 session，原 unknown 操作不要求被伪造为 confirmed。
readTrial 还须与原 saveOnce 的完整 session 逐字段相等，不能整套替换为同 owner 下的另一 session。

真实 waiting_reconciliation 使用 factory 返回的 **host-only** `readOriginalSessionForRecovery(input)`：
input 为 ownerTaskId/actualTaskId/trialRunId/expectedRevision/configurationRef。H1 先校验原生 task.reconcile
用户权限、原 owner/plan/marker 和实际 workspace/config，再调用；不能将此函数注册到模型工具目录。
reader 不创建 ToolContext、不调用 active scope gate、不要求 running 或 harness 开关；只核对原等待任务
revision、operation/参数摘要/Evidence、saveOnce session 与冻结配置/基线，再返回原 metadata。
允许过期或禁用后的原会话只读核实，但不接受更换 workspace/config，不写状态、回执或 Evidence。
H1/Windows 随后仅读原 journal/current metadata，并在异步读回前后复核 revision；clear 仍不是验证成功。

### 经验 consumer 的唯一来源读取

`adoption.readSelection` 完成原 confirmed trial/compare 及当前 started adoption 校验后，在原 owner
以 saveOnce 写 `harness-candidates:adoption-origin:<adoptionRunId>`。记录 version/ownerTaskId、精确
adoption/trial/comparison 的 taskId/runId、owner inputDigest、configurationRef/workspaceRef、实际 workspaceId、
baselineSnapshotId、candidateId/artifactId/artifactDigest、三个原 Gateway inputDigest 及 trial/compare 原结果摘要。
不另写 `selection` 或 `owner-session` 格式，不复制补丁正文；同 adoption run 的来源改变即拒绝。

factory 顶层公开两个 **host-only 同步纯 reader**：

```typescript
readOriginalSessionForProvenance({ownerTaskId, actualTaskId, runId}): CodingRepairInput | undefined;
readAdoptionOrigin({ownerTaskId, actualTaskId, runId}): RuntimeHarnessCandidateAdoptionOrigin | undefined;
```

请求类型是 `RuntimeHarnessCandidateProvenanceRequest`。二者仅读原 canonical `{operation,input}` 和来源记录，
要求 owner/实际任务 succeeded、未取消、原 Gateway confirmed/allow/started、精确调用参数摘要及 execution Evidence。
session、配置/基线、原 compare/trial 的结果摘要和采用结果实际 session/artifact 均复核。
其中 `inputDigest` 是原 owner 输入；`adoptionInputDigest/trialInputDigest/comparisonInputDigest` 是三条原
ToolExecutionRecord.inputDigest，不可混用。

经验 consumer 从原 publication.sessionId 精确匹配该 owner 原 confirmed prepare_adoption 的 canonical session，
再读其固定 origin；不猜“最新 compare”，不重新写同名 session key 或建立第二套 journal。
reader 不构成用户授权，不进入模型工具目录；经验 `proposeFromConfirmed` 仍必须执行 H1 assertOrigin、四条
原 confirmed 回执、实际发布/测试读回和当前 workspace/configuration fence。本包不代验经验激活或学习效果。

采用只消费 owner 最新的 confirmed 比较（后续 pending/unknown/failed/弃权不回退旧选择），
重算同一输入的比较并与原确认结果逐字段核对，再交精确选中补丁。
组合核原 refs/祖先无环和原候选输入，首版只接受精确补丁并集；同一路径冲突明确 unsupported。
不存在模型摘要、任意跨任务 runId 或 isolated publish 的授权捷径。

## 比较、组合和采用

比较绑定同一 owner/workspace/baseline/input/configuration/workflow/runtime/recipe/执行表面。
候选 artifact/session、验证 run 须独立；源摘要、测试指纹、包图、必选 recipe 的实际包集、当前 snapshot、
验证文件指纹、exit/status/Evidence 均核对。测试或包图变化需要另一明确实验，不在本比较中放行。
已知失败保留 failed，缺失/过期/未知保留 unknown，不把候选自报、编译或签名当正确性证明。

默认 `unique_verified` 仅在唯一候选满足当前必要验证时建议选择；多个通过保留弃权。
可信宿主可显式选 `fewest_changed_files`，只比较实际变化文件数且不任意打破并列。
这不是语义质量评分，也不证明最优修复。输出 `verification: unverified`，仅建议/产物引用。

组合记录须关联实际观察的父 artifact 摘要，提供新 artifact/session 和新验证 run；循环来源、
继承父验证或缺父产物均拒绝。组合正文生成、真实父产物读取与写入属于隔离 runner；其可信回调
须按原 parentTrialRunIds 读回已确认父产物、原参数及范围，核对实际组合输入并在执行前后复核，
不接受模型提供 digest。未绑定该真实读取端口时保持 unavailable；本包不伪造组合结果。
对应源码保存于 Windows runner 的 #450，实际共享调用方由 H1 包接线，行为回归按用户新优先级统一安排。

推荐中的 publishRequest 是原产物的参数引用，**不是发布授权或已采用结果**。
isolated session 不能直接 publish。最终采用应从原 confirmed trial 的精确 patch 读回，进入原 F15
main 会话重新 apply/check 必选 recipes，再经原 Policy/CAS/publish/readback；不得切换 isolated 的 mode，
不得将候选验证继承为主目录验证。未知写入必须核实原 operation。
Windows runner 提供 `coding.repair.prepare_adoption@1.0.0` 的实现，输入仅 `{trialRunId}`，
宿主从已确认比较和原 invocation 读精确补丁；返回新的 main checkReadback，待原 Gateway 确认后
另调原 publish。`coding.repair.reconcile_trial@1.0.0` 只核实原 session，不生成新试跑或重放写入。
这些实际工具由 runner 包及共享 H1 调用方分别提交源码和回执，本包不代签其验证。
经验激活未接 goo122 的公开能力，不宣称跨任务学习完成。

## 验证与 Evidence

已完成唯一契约生成、新增 `.mjs` 语法检查，以及三个新增 TypeScript 模块的 parser 语法诊断；均通过。
2026-10-20 用户进一步要求先接齐全部源码、只做最必要小检查，之后统一集成验证：
本包未安装依赖、未运行 workspace 构建、全量类型检查或行为回归，不将语法检查当类型/行为通过。
新增 bindings 接线所需两个 Runtime 模块已补最小 `noEmit` 定向语法/语义诊断，0 项诊断；
源码映射使用本树新增 contracts/agentarts，脚本和日志在 `.cache/harness-bindings-typecheck{.mjs,.log}`。
这不等于 workspace 全量 typecheck、构建或行为回归。bindings 专属测试语法通过；为修复真实调用方
workspaceId/workspaceRef 差异，仅用 Node 24.15.0 源码 loader 执行 `factories are lazy` 一个 Fake 端口单例，
1/1 通过，日志 `.cache/harness-bindings-single-case.log`，其余行为回归未运行。loader 首次使用 strip-only
因既有 ProtocolError 的 TypeScript parameter property 不受支持而失败，改用 `--experimental-transform-types` 后通过，
没有编译产物或安装依赖；该检查不是正式 dist/Runtime 集成通过。
只读增量审查发现的原 session 绑定缺口已修。针对普通工具无法从 waiting_reconciliation 进入的阻碍，
本包已交上述 native-only reader，另用同一源码 loader 运行 `native recovery reads` 一个必要 Fake 端口单例，
1/1 通过，日志 `.cache/harness-bindings-native-case.log`；原 state/Evidence 不变，过期 revision/换配置拒绝。
H1/Windows 实际 native 调用方及真实 journal 联合路径仍待统一集成验证，不因目录或两个 Fake 单例宣称闭环已验。
经验来源接线另做一个必要源码 loader Fake 单例 `host-only provenance pins`，1/1 通过，
日志 `.cache/harness-bindings-provenance-case.log`；覆盖只读 canonical main session、固定原来源及原输入摘要替换拒绝。
定向 noEmit 诊断仍为 0；未扩大为全量行为回归，经验实际 sourceconsumer 组合验收另记。
以上只读审查不是仓库非作者 Approve，也不代替后续联调。
本包用显式 synthetic trial 验证契约、绑定/失败/unknown/弃权/组合边界，Runtime 用真实 SQLite/
Policy/ToolGateway 消费 synthetic 端口；Windows 真实 host/Node 固定配方由 runner 工作包独立取证。
没有真实 AgentArts/付费模型调用或云发布授权，平台效果验收 not_run；这些必要工程检查不代替平台验收。
未运行全仓 check，按用户新优先级交主控在代码接齐后统一安排；接口保持 provisional，不新增 Core wire、依赖或数据库迁移。

所有源码、实际接线和验证结果将经独立 PR 交付；拟审查者 goo122，拟合并者 Potatos498，
尚无独立批准或合并记录。本包不自行合并。
