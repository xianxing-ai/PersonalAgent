# DEV-WORKFLOWS-INTEGRATION-01

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

状态：`review`（生产组合、模块/SQLite受控检查已交；真实账号、原设备整链及非作者集成待验）。负责人：zemeng；真实集中验收：Potatos498。

## 范围和入口

用户本轮明确授权新增可选 `local` 开发工作流。该增量不替换 Competition Profile，不改现有 RuntimeApplication 或 Desktop 默认路径。

公开入口已由 `apps/runtime/package.json` 的 `./dev-workflows` export 提供，为 `@personal-agent/runtime/dev-workflows`，导出 `createDevWorkflowsRuntime`、`DevWorkflowsRuntimeOptions`、`DevWorkflowRequest`。公开 exports、依赖和锁文件继续由根集成负责人维护；本可选工厂不会自动装配到默认 Competition/Desktop 路径。模块接口仍为 provisional，源码及受控测试不等于真实账号写入、原 Windows unknown 恢复或比赛验收；真实只读验收的协作者报告与完整写入整链缺项见续接清单。

工厂装配既有 TaskRuntime、Policy、ToolGateway、ModelGateway，并消费 MOD-33 GitHub、MOD-34 CI 修复、MOD-36 PR 审查和 MOD-38 Issue 分诊的公开包入口。无第二套任务数据库或状态机。

## 受信配置

`model`、`maxSteps`、`maxTokens` 必须明确提供。ModelProvider 始终由 ModelGateway 包装；未配置不偷偷选择 Fake 或替代模型。

生产宿主提供 `github: GitHubProvider`、`workspace: {read, patch, command}`、`git: GitToolsOptions`（`readVerification` 由组合生成）以及 `ciFix` 的受信 sourcePaths、verifyRecipeId、分支与来源修订。GitHub 注册全部工具；workspace 注册 read、patch、固定 recipe command；Git 注册 head、commit、push。允许额外 `tools` 作为明确 Fake 或受信宿主扩展，重复工具名注册拒绝。

`githubRepairLinks: true` 显式追加 `github.actions.repair.link/get`，默认仍只有原13个 GitHub 工具。
此选项必须同时有显式 GitHub provider；新注册仅拥有自己的工具/service生命周期。
关联写需要单独 exact-arguments 审批、实时 presence 和真实凭据的 Checks(write)，旧 PR/token
许可不推导新权限，也不降级为 commit status。`ciFix.sourceRunBacklink` 由可信宿主显式绑定
toolName 与原 runAttempt；无该配置仍只有 PR 引用原 run，不宣称原 run 页面已回写。
配置关联后缺外部写端口在修复前返回不支持；issue-only 无 run 时不能设置此选项。
成功后 `sourceRunLink` 仅表示同 source SHA 的新 neutral Check Run 关联，原 CI 状态不变。

GitHub token getter和 Git `getCredentials` 由同一受信宿主安全存储适配，凭据不进请求、模型上下文或持久 checkpoint。`isUserPresent` 为实时可信会话回调，写工具需要此回调返回 true，并仍要求逐次审批；审批本身不代表当前用户在场。

Issue 修复复用 MOD-34 `createCiFixWorkflow`。宿主可提供 `failedRunForIssue(repo, number)`，或使用 `ciFix.expectedHeadSha` 绑定 issue-only 源码修订。传入最新 issue URL、number、fingerprint，由 MOD-34在PR正文关联 Issue。缺修复配置返回人工处理，不宣称已修复。

## 提交、暂停和恢复

`submit({request, conversationId, idempotencyKey, deadline})` 受理并持久化原请求，不自动开始；`start(taskId)` 执行。request 区分 `ci_list`、`ci_fix`、`ci_link_readback`、`code_review`、`issue_list`、`issue_triage`。同幂等键替换请求或 deadline 被拒绝。`readResult(taskId)` 读取模块真实结果，TaskRuntime 的 snapshot 仍为最终状态事实来源。

`ci_list` 的 `input` 复用 coding-tools 公开 `CiRunListRequest`，通过
`createCiRunDiscoveryWorkflow().listFailedRuns` 和既有 `github.actions.run.list` 读取一页失败运行。
固定 status=failure，默认 page=1/perPage=30，单页最多30项；仓库、分支、分页及期限绑定原请求。
不调用模型，不要求 Git/工作区/ciFix 配置，不自动轮询；仍走原 Runtime 审批、原一步预算、
持久 checkpoint 和 unknown 原执行核实，不能把重启当作重新授权。
成功返回已校验的 items/page/nextPage/hasMore/evidenceRefs。列表不是稳定快照或修复许可。
可信宿主明确选择运行后，以 `ci_fix` 的 repository 与 String(selected.id) 提交独立任务，
用发现 taskId 和 runId 组成稳定幂等键；修复重新读取来源，并单独审批工作区/Git/远端写入。
下一页按 nextPage 显式提交，不为整页自动创建子任务或分配修复预算。

`ci_link_readback` 的 input 复用公开 `GitHubInputs['actions.repair.get']`，由可信宿主明确提供
原 CheckRun ID 与完整原 run/attempt/SHA/PR head/workflowExecutionId identity。
单次只读经过独立审批，页外不会查列表猜 ID，不调用模型/写工具或自动确认另一任务。
成功返回 state=checked、receipt 和本次 Evidence；这不是原未知写入已确认的 Runtime 回执。
受信核实者须校验原 execution/input/budget/evidence，按现有核心恢复接口安装原确认缓存，
然后 `resumeConfirmed` 才能消费；只读核实或知晓 CheckRun ID 不授予再写权限。
registered RESULT_UNKNOWN 本身保持固定错误，不携 provider 的 partial CheckRun ID。
可选注册提供同步受信 observeUnknown 钩子，仅在 unknown schema 校验成功后观察克隆的
原输入/候选响应和原 ToolContext；保存失败或误用异步钩子均不改变 unknown、不等待或重试。
本 Runtime 将合法候选 ID 持久保存到原 task/run checkpoint，绑定原审批参数 digest、
工具版本、ci-fix journal 和原已获准执行记录；忽略 provider 的 URL/externalId 等附带文本。
readResult 仅在原 task waiting_reconciliation、source-backlink 仍 inflight 且原执行
started/unknown、全部绑定一致时返回 sourceRunLinkHint={state:'unverified',toolRunId,input}。
input 复用完整原 identity 加候选 checkRunId，可由宿主显式提交上述 ci_link_readback；
提示不是确认、授权或稳定快照。缺 ID、候选保存失败/冲突、绑定变化、取消或其它状态时
不显示提示，仍等待原执行核实，不依名称列表猜测、自动 GET 或重复 POST。

`code_review` 的 publish=true 结果保留完整 prepared report，发表状态仍为真实
confirmed/pending/unknown/unsupported；publication 提供当前 findingIndex、totalFindings 和
confirmedFindingIndexes，evidenceRefs 保留预审和此前已确认评论证据。
后续finding暂停或不支持不抹掉只读意见，也不把未发表意见计为已确认。
审批重启通过原发表checkpoint消费已确认结果，原COMMENT不重发；unknown仍需原执行核实。

`issue_list` 的 `input` 复用公开 `IssueListRequest`，经既有 MOD38 `listIssues` 和
`github.issue.list` 走原 Runtime 审批；成功返回该页 items/page/nextPage/hasMore/evidenceRefs。
页号、仓库、筛选条件和期限属于持久原请求，重启恢复不替换页，不调用模型或写标签。
列表不是稳定快照，列表标题/正文仍是不可信数据，不授予后续修复许可。

可信宿主显式选择返回项，再用现有 `issue_triage` 提交各自独立 task；使用稳定的发现批次与
Issue 身份作为幂等键，不因审批/进程重启重新生成键。下一页只能按读回 nextPage 显式提交。
`issue_triage` 会重新读取原 Issue、核实分类证据，并单独审批写入；宿主提供受信 repairGoal，
不得从 Issue 正文推导权限或命令。此入口不自动轮询、创建子任务或为整页重复分配模型预算。
独立 task 使 MOD34 原 `ci-fix-v1` 日志、预算、审批与 unknown 记录不被另一 Issue 覆盖。
公开请求联合新增可选分支，不改变既有 wire、工具 scope、配置格式或默认 Desktop profile。

所有 GitHub 读写和 workspace/Git 执行均经 AgentToolPort → RuntimeToolInvoker → TaskRuntime 请求路径 → ToolGateway → Policy。首次调用 `requestToolApproval` 绑定原 task、runId、工具、范围和参数 digest；pending 暂停原任务。宿主用原 `runtime.respondApproval`（含 revision）决定，然后 `resume(taskId)`。拒绝审批取消任务；未知结果不因审批被重发。

unknown 暂停为 `waiting_reconciliation`。受信宿主先用原 Runtime 核实接口保存原执行的 confirmed Evidence 和缓存，再 `resumeConfirmed(taskId, originalReceipt)`；它调用 `prepareConfirmedReplay`，拒绝缺失、参数变化、取消或仍有未知执行的任务。workflow 的 `confirmedReplayReady(runId)` 只接受该 task 的已授权 confirmed 执行和缓存；实际回放仍由 Runtime 校验工具、版本、原参数 digest 并返回缓存。既不重开已终结任务，也不新建重试任务或盲目重写外部副作用。

原绝对 deadline 在恢复时保持不变。取消和 deadline 由原 TaskRuntime 信号贯穿模型、工具和子工作流。`close()` 取消活跃任务、等待执行结束，然后注销工具与关闭数据库。

## 命令验证到 Git commit 的证据

组合包装原 `workspace.run_allowed_command`，不更改原命令工具。执行前后读取绑定分支的真实 HEAD 和受信 allowedPaths 文件 SHA256；命令 exitCode=0 且前后 HEAD/文件 fingerprint 相同，才保存 task/run 绑定的验证 receipt。

Git `readVerification` 还要求原命令 ToolExecutionRecord 已开始、Policy allow、state confirmed，持久 tool-result 的 exitCode=0 与 receipt 一致。Git commit 自行复验当前 HEAD/完整文件 hashes 与该 receipt，并拒绝其它路径或 index 变化。模型返回“测试通过”不能生成 commit 授权或验证证据。

## 验收交接

初始 writer 仅执行静态审阅；后续已授权的本分支实现执行实际模块、SQLite 恢复与全仓检查，
按续接清单记录对应提交和日志，不用旧静态审阅说明替代当前验证。
候选 ID 恢复使用真实 GhCliProvider 逻辑与明确合成 transport/SQLite：一次 POST 返回 ID 后
GET 失败，原任务保持 unknown，重启后提示保留，独立审批只读 GET 成功也不自动确认原任务。
另覆盖缺 ID、非法 provider 输出、保存失败、候选绑定变化及冲突；真实账号和原设备另验。
最新候选提示增量固定 Node24.15 完整 check 已实际 exit0：31workspace1990通过、0失败、
50平台跳过，Runtime347/GitHub96、根integration19与架构/契约/生成/build/typecheck通过。
独立复核14/14；缓存同名hint剥离、cancelRequested隐藏均保留失败回归，具体提交/Windows
门禁与剩余真实验收以同目录续接清单及当前PR精确head为准，整体模块仍review/provisional。

生产组合与 exports 已交，必要检查按对应改动执行仓库实际脚本，避免无变化重复测试：

```sh
npm run check
npm run test --workspace=@personal-agent/runtime
```

补充集中验收必须覆盖：审批后同 task/run 恢复；重启后原请求和缓存保留；unknown readback 后 cached replay 零重复写；未知结果无 readback 不恢复；命令前后源码变化不能产生 commit receipt；伪造模型验证不能 commit；拒绝审批、撤销授权、缺实时 presence、deadline 和取消；Issue 修复新PR正文关联原 Issue；PR head/base 变化拒绝评论。真实服务验收仅在用户明确授权的环境执行，Fake/类型检查通过不替代真实闭环。
