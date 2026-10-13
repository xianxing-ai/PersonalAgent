# 辅助子任务模型配置与真实 child 绑定

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

工作包：SUBAGENT-MODEL-CONFIG；负责人 zemeng；非作者评审 goo122 / Potatos498。
Profile：`huawei_ict_agentarts`。隔离工作树登记：`.worktrees/subagent-model-config`，
分支 `codex/zemeng/subagent-model-config`，基线 main `4249ace1`（含批准的 #244/#246）。
状态：review；本包不承担共享 main/preload/Admin/Runtime Application 挂载。

## 默认 Competition 子任务执行策略（完整 MVP 增量）

`SubagentHostOptions` / `DesktopSubagentDispatchToolOptions` 新增受信进程内端口：

```ts
runDefaultWorker?: (subtask: SubtaskDefinition, worker: WorkerContext, tools: AgentToolPort) => Promise<WorkerResult>;
getToolsForSubtask?: (subtask: SubtaskDefinition, worker: WorkerContext) => AgentToolPort | undefined;
```

P8 注入 `RuntimeApplication.runDefaultSubagentWorker`；它复用主 Competition 配置与原
Coordination worker，无需独立模型 API。SubagentHost 已在同一 TaskRuntime 中调用 child
runTask，注入端口不得再次对该 child 调用 runTask 或复制协调/工具循环。默认 worker
负责 application-profile/deadline、Cloud 配置身份与 competition-max-steps/checkpoint，
用第三参数限定 tools 构造同源 catalog，并保留 Policy/Gateway/真实 Evidence 与本地终态。

只在 subtask.model 未指定时走注入 Competition 策略；显式 model（含未知模型）只查对应
独立 API，空白 model 拒绝。不在默认 worker 失败后回退 API。Standalone 未注入时保留
现有 registry/default API 兼容路径；生产 P8 必须注入真实 Competition worker。
`subtask-execution-binding` 固定 competition/model，旧 agent-loop / cloud binding 不能换策略。
默认 cloud 无原生 reasoning 支持声明，thinkingDepth 仅控制单独步骤预算。

host 对每个 child 调用窄工具 getter（或现 getTools），剔除 subagent.dispatch 防递归，
冻结完整工具描述到 subtask-tools-binding。invoke 验证 child task、deadline 和当前描述；
重启/审批恢复改变工具范围拒绝，不能利用原 grant 扩权。角色/目标/原期限沿 subtask-parent
持久绑定。多个 child 并行复用原 dispatchSubtasks，checkpoint 按单 child 切片、同步合并，
保留兄弟 progress。原 deadline、父取消与实际子终态仍由原 TaskRuntime 负责。
Competition 审批恢复读原 competition-loop，并匹配 competition-tool-childId-step 的
allowed approval/工具/arguments digest/未撤销 grant；重聚合只读真实 child，不重执行父 dispatch。

配置宿主新增 `isDefaultExecutionAvailable?: () => boolean` 受信回调，由 P8 注入实际
Runtime `isDefaultSubagentAvailable()`。snapshot.defaultAvailable/defaultExecution 只按该
回调严格 true（异常/未注入/非 Competition/释放均 false），不根据 enabled API 数量推断。
`defaultModelAvailable` 仅说明独立 API 的 defaultId 真正存在且可选；configured 仍仅表示
有独立 API 配置。独立控件明确区分默认 AgentArts worker 与独立 API 默认选项。
调用器可用不等于云端结果已验证；真实验收必须由 P8 读原父子 task/tool/Evidence。

本增量只构建新增 main 所需 calendar/cognition dist 与 Runtime；4 个新增定向用例验证
默认端口双 child 与显式 API 并行/保存/重放、未知模型无默认回退、原审批单次恢复及范围变化
拒绝不消费 grant、父取消双 child、enabled API 不冒充默认可用。真实 AgentArts 两 child
分派与协作汇总、共享装配/readback 由 P8 单独执行，本包离线端口夹具不作真实云证明。

## 受信挂载接口（P8 唯一写入）

```js
import {createModelApiConfig} from './model-api-config.js';
import {createConfiguredSubagentModelGateway} from '@personal-agent/runtime/application';
const modelApiHost = createModelApiConfig({
  userData, safeStorage,
  profile: 'huawei_ict_agentarts',
  // Runtime/Application-owned adapter; Electron never imports model implementations.
  createGateway: createConfiguredSubagentModelGateway,
});
const subagentTool = createDesktopSubagentDispatchTool({
  getRuntime: () => runtimeApplication.runtime,
  getTools: () => runtimeApplication.tools,
  getModelGateway: modelApiHost.getModelGateway,
  getModelReasoningEfforts: modelApiHost.getModelReasoningEfforts,
});
// 主进程退出时调用；不得向 Renderer 暴露 host 或 gateway。
modelApiHost.dispose();
```

P8 在 `apps/runtime/src/application.ts` 现有 subagent-host 导出组中加入
`createConfiguredSubagentModelGateway`、`resumeRuntimeSubagentTask`、
`readRuntimeSubagentSummary`。该工厂及模型 Provider 构造位于 Runtime，
Desktop 不导入 models/agents。工厂可选第二参数是受信 provider decorator；当前配置宿主
在返回网关的外层传播撤销与取消信号，不改变 Policy/工具授权，也不新建模型执行循环。

共享 IPC 使用既有可信窗口/发送者校验与模型设置权限，限定以下分派：

| 控件调用 | 主进程处理 | 返回 |
| --- | --- | --- |
| `modelApi.state` | `modelApiHost.snapshot()` | 脱敏 snapshot |
| `modelApi.configure` | `modelApiHost.configure(payload)` | 脱敏 snapshot |
| `modelApi.remove` | `modelApiHost.remove({id})` | 脱敏 snapshot |

`configure` 只接受 `id? / provider / baseUrl / model / displayName / apiKey? /
enabled? / makeDefault? / reasoningEfforts? / reasoningSupportConfirmed? /
expectedConfigurationRef?`，provider 为 `pangu` 或 `openai-compatible`。
不导入环境密钥，不发起连接测试。空密钥仅在同一记录、供应商和规范化 Endpoint
不变时保留；改变目的地须新密钥。整个配置使用 Electron safeStorage 加密，原子写入
用户数据目录。解密或安全存储失败明确不可用，不回退明文。

Renderer 导入独立的 `src/app/model-api-controls.js`：

```js
const controls = mountModelApiControls(root, restrictedInvoke);
controls.render(await restrictedInvoke('modelApi.state'));
// 页面切换/窗口释放
controls.close();
```

控件只向 IPC 短暂提交新密码，提交前清空输入，完成后清空 payload；快照没有密钥。
模型选择使用 snapshot.models 的稳定 `id`；无选型时只取 `defaultId`，未知/停用模型
返回 unavailable，不回退旧盘古配置。P8 应把稳定 ID 绑定到原有子任务选型控件及可用
模型目录，不将本地配置表直接导出到云端。保留 AgentArts/Live/SIS 的现有配置。

`createGateway` 必须由 Runtime/Application 注入，接收供应商、Endpoint、模型、配置版本部署 ID
和仅在请求时读取密钥的回调，并返回已有 `ModelGateway`。没有注入时模型保持不可用；
Desktop 不导入或构造 Provider。模型均经已有 ModelGateway 和 StructuredToolProvider；后者是文字 JSON 提案协议，
能力等级 conditional，不是原生工具调用。原生推理支持默认为空，只有显式声明
`reasoningEfforts`（`none/low/medium/high` 的子集）并确认
`reasoningSupportConfirmed: true` 后才发送对应参数。修改既有声明必须提供当前
`expectedConfigurationRef`；版本不匹配拒绝保存。每次保存都换 bindingId；未传列表时
重置为空，控件在供应商、Endpoint 或模型编辑时清空声明及确认，避免继承旧能力。
声明绑定供应商、Endpoint、模型和配置版本，始终标记 conditional，真实支持仍未验证。
`thinkingBudget` 及 Anthropic 路径未实现，不提供支持选项，网关拒绝 budget 输入。

安全 snapshot 的 `models[].configurationRef` 是不含凭据的配置版本。
`getModelGateway(modelId?, expectedConfigurationRef?)` 与
`getModelReasoningEfforts(modelId?, expectedConfigurationRef?)` 必须共同使用同一版本；
过期版本分别返回 undefined / []，不回退新模型或默认配置。
`getModelReasoningState(modelId?, expectedConfigurationRef?)` 返回安全的配置可用状态、
支持列表、版本及条件验证说明；不得把 gateway 或密钥回调发给 Renderer。
P8 在每个会话提交时冻结稳定 modelId、configurationRef、thinkingDepth；包装两个 getter
时固定该引用，未选模型时也须先固定当时 defaultId。配置修改不更新其他会话的选项或
已提交任务，过期引用明确 unavailable。共享提交与恢复挂载归 P8，不在此包另造会话库。

控件导出 `describeModelThinking(entry, depth)`，只用于安全呈现：深度 0/1/2/3/4/5
精确映射 none/low/low/medium/high/high，仅支持列表包含该值时产生原生 effort；不做近邻替代。
步骤预算单独为 max(2, (depth+1)*2)，未指定为 6。Runtime 独立重复校验，并记录
`subtask-thinking-binding` 的 depth、stepBudget、请求与实际 effort、条件验证和 budget 不支持状态。
原生 effort 沿现有 runAgent → ModelGateway → StructuredToolProvider → Provider 传递，
OpenAI 兼容 Provider 序列化为 `reasoning_effort`。未声明档位只使用步骤预算，不声称原生支持。
配置宿主与 Runtime 工厂拒绝显式未知 profile，不创建 Local fallback。

## Runtime 行为

- runAgent 使用 childWorker.taskId；模型循环的 runId 与授权引用采用 #244 的已有规则，
  工具调用经 Runtime Application → Policy → ToolGateway，Evidence 绑定真实 child。
- 无网关行为保留 main #232 的 UNSUPPORTED_CAPABILITY 回归；生产不生成角色完成文本。
- 父级进度写入已有 TaskRuntime；父/child checkpoint、取消、deadline 与去重沿既有路径。
- 更改、停用、删除、释放配置会中止该记录正在运行的请求，旧 gateway 引用随后拒绝调用。
  每次配置产生持久 bindingId，网关 deployment 绑定该版本；子任务记录 subtask-model-binding。
  等待期间替换模型配置，恢复会拒绝旧提案，不能只凭同一个稳定选型 ID 换端点继续执行。
- 子任务 waiting_approval / waiting_reconciliation 在已有 SubtaskProgress 中显示 pending，
  不计入成功或失败；父进度 checkpoint 也保留 pending，避免缓存不可恢复的 failed。
  汇总从真实 child 读回，覆盖历史失败缓存；结果同时提供 descriptor 要求的 summary。
- `resumeRuntimeSubagentTask(options: SubagentHostOptions, childTaskId: string, parentSignal?: AbortSignal)`
  返回 `Promise<TaskSnapshot>`；options 的模型/工具 getter 与初次派发相同。
  P8 在 resumeTask 的 application-goal 读取前识别 subtask-parent，调用该 helper。
  它校验 parentTaskId/subtaskId/goal/model/parentDeadline、child 会话与幂等身份，
  验证 `agent-run-${childTaskId}-${agentLoop.step}` 的已允许审批、原工具和参数 digest、
  未撤销 grant，随后以 `resume: true` 复用相同 child 与 runAgent/agent-loop。
  不延长期限，不重开终态，不生成授权，不在 waiting_reconciliation 盲目重做工具。
  已完成的工具保留既有 replay/checkpoint；parentSignal 取消沿 requestCancel 传 child。
- `readRuntimeSubagentSummary(runtime, parentTaskId, definitions?)` 只读真实子任务与进度，
  返回原 SubtaskExecutionSummary 加 descriptor 既有 summary。definitions 未传时由已有
  inputDigest/child binding 恢复。P8 可在 child 完成后重聚合并展示；该读回不修改父终态，
  不能把尚未完成的父工具直接确认，父等待/恢复挂载仍归 P8。

## 验证与限制

本树只编译 Runtime 的必要依赖与 Runtime，运行专属子任务及模型配置测试；无全仓 check、
全套 smoke、真实端点或新付费调用。覆盖无网关、未知选型、真实 child/task authorization
绑定、Policy 单次消费、Evidence、两模型选择、去重、取消、等待审批不成功、密钥边界及撤销。
设置控件独立预览的渲染不代表共享 Desktop 的 IPC/挂载已验收。
本地 PATH 为 Node 26.3 / npm 11.16，与锁定 Node 24.15 / npm 11.12 不同；
CI 与 P8 在约定环境的整体验收独立记录。
真实云、原生工具与 reasoning、本机 safeStorage、Desktop 完整用户旅程仍未验证。
不改变公共 wire Schema、迁移、依赖或锁文件，也不新增 Local Profile 路径。

局部测试命令：

```powershell
node --test apps/desktop/test/model-api-config.test.mjs apps/runtime/test/subagent-host.test.mjs apps/runtime/test/subagent-end-to-end.test.mjs apps/runtime/test/subagent-task-binding.test.mjs
node --check apps/desktop/electron/model-api-config.js
node --check apps/desktop/src/app/model-api-controls.js
git diff --check
```

初轮 12 个用例通过；默认选择取消的小修改后仅重跑配置的 3 个用例，通过。
CI 指出 Desktop 直接导入 models 的架构边界错误后，将模型构造移入 Runtime 工厂并注入，
保持原门禁；Runtime 单包编译、6 个 task-binding 与 3 个配置用例及单个架构门禁通过。
新增 Runtime 工厂无凭据拒绝与一次真实 SQLite approval allowed → 同 child 同 invocation
恢复 → Evidence → 重新聚合的离线检查，未重复全依赖构建或旧 12 项。
模型配置版本绑定的新失败用例验证：等待期间变更部署，旧提案不执行、不消费已批准 grant。
正常合并 goo122 在同分支提供的 factory 注入修复（0777c30/eb89233/b7a9e5d），保留其
createGateway 接口与返回值检查，合并后只重跑 3 个配置用例及单个架构门禁，通过。
独立浏览器预览检查保存后模型选中、默认选中和密码清空，截图位于本树忽略目录
`.cache/model-api-controls-preview.png`；该预览只使用合成值与 Fake IPC。

显式推理配置增量：Runtime 单包 tsc、6 个模型配置用例（3 个新增）、2 个受影响
factory/等待版本冲突用例通过。参数捕获使用真实 runAgent/StructuredToolProvider/OpenAI
兼容 Provider 与 Fake fetch，4 个持久 child 分别发送 low / high / 无原生参数 / 无原生参数；
模型 ID 保持一致且不发送 thinkingBudget。新增用例还验证声明确认、重复/未知值拒绝、
安全回读、加密恢复、getter 副本、版本 CAS、旧引用撤销与未知 profile 无回退。
syntax 和 git diff --check 通过。独立浏览器 Fake IPC 预览确认 low/high 保存、密码清空、
更改模型后声明及确认取消，证据 `.cache/model-api-reasoning-preview.png`。
无真实模型请求、付费调用或整套 Desktop smoke；会话提交快照与共享视图集成仍由 P8 验证。
旧 PR #250 已合并 992f3fa 基线；本推理增量是后续独立提交，不声称已随 #250 合入。
