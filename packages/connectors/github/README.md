# GitHub 连接器（MOD-33）

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

`@personal-agent/github` 是 DEV-WORKFLOWS 的 Local Profile 增量。接口为
provisional，真实 GitHub 部分只读已验证，含本轮 Windows CLI 失败日志分页；账号写入和完整消费者闭环尚未验收；不纳入 Competition
Profile 的完成证据。生产 provider 不自动回退 Fake。

公开入口导出 `GitHubInputs`、`GitHubOutputs`、`GitHubOperation`、`GitHubPort`、
`GitHubProvider`、`GitHubReadContext`、`GitHubService`、`GitHubConnector`、
`GhCliProvider`、`SpawnGhCommandRunner`、`FakeGitHubProvider`、`register`。

可信组合注入：

```ts
const provider = new GhCliProvider({
  runner: new SpawnGhCommandRunner('/trusted/path/gh', trustedEnvironment),
  readToken: context => restrictedSecretReader(context),
  repositories: ['owner/repository'],
});
const dispose = register(toolHost, {provider});
```

`readToken` 由 Connector Host 的受限凭据适配提供，模型、Renderer 和工具输入不能
提供 token、CLI 路径、环境或 runner。runner 只接收 argv，不执行 shell；不继承进程
环境。宿主显式提供所需 PATH/SystemRoot/TEMP 等可信值。仅支持 github.com。
凭据通过 GH_TOKEN 环境传给 gh，命令参数、返回值和错误不含凭据。

每个 GhCliProvider 在构造时绑定原 runner 对象，API、日志读取和 dispose 使用同一
依赖。宿主复用 options 为新 Provider 更换 runner 时，旧实例不会转用或释放新
实例的依赖。原 runner 的 run/dispose 方法仍实时，readToken 与仓库白名单保持
原 options 检查语义，凭据更新和白名单撤销不会被配置快照冻结。

stdout/stderr 共用原1 MiB字节上限，完整收集后分别严格UTF-8解码，保留合法BOM和
跨chunk的中文字符。非法编码固定失败，不把替换字符作为issue/diff/写回执内容接受，
错误不回显原始字节；取消、期限和超限错误优先。已派发写入的解码失败仍由Provider
保持unknown，不能据此判定未执行或自动重发。实际子进程回归使用明确合成GH transport，
不等于真实账号验收。

工具版本为 `0.1.0-alpha.1`。全部输入拒绝未知字段；`repo` 必须在宿主白名单。
所有操作需 `ToolContext.signal/deadline/authorizationRef/scopes`；读工具 scope 为
`github:read`，写工具为 `github:write`，写工具声明 `external_write`、
`requiresPresence: true`、`idempotencySupport/recoverySupport: false`。
**审批由 Runtime Policy → ToolGateway 校验及消费**。连接器的 context guard 只是
防误调用，不能替代授权验证；不要给模型或认知模块直接 provider 引用。

| 工具名（均有 github. 前缀） | 输入（公共 DTO 为准） | 输出 |
| --- | --- | --- |
| repo.get | repo | fullName/defaultBranch/private/url |
| actions.run.list | repo/page?/perPage?/status?/branch? | GitHubPage&lt;GitHubRun&gt; |
| actions.job.list | repo/runId/page?/perPage? | GitHubPage&lt;GitHubJob&gt; |
| actions.log.read | repo/runId/jobId/offset?/maxChars? | TextPage |
| issue.get | repo/number | GitHubIssue |
| issue.list | repo/page?/perPage?/state?/labels? | GitHubPage&lt;GitHubIssue&gt; |
| issue.label | repo/number/labels/expectedUpdatedAt | GitHubWriteResult |
| issue.comment | repo/number/body | GitHubWriteResult |
| pr.get | repo/number | GitHubPullRequest（含 headSha/baseSha） |
| pr.diff | repo/number/expectedHeadSha/expectedBaseSha/offset?/maxChars? | TextPage |
| pr.create | repo/title/body/head/base/expectedHeadSha/draft? | GitHubWriteResult |
| pr.comment | repo/number/body | GitHubWriteResult |
| pr.review.comment | repo/number/body/commitId/path/line/side? | GitHubWriteResult |

## 可选修复 PR 关联（provisional）

默认 `register` 继续只注册上表 13 个工具。可信宿主可显式调用
`registerGitHubRepairLinks(toolHost, {provider})`，额外注册下列两个工具；
`githubRepairOperations` 是这两项的独立清单。缺少 opt-in 或显式 Fake fixture 时，
不会生成关联或伪造成功。独立 registration 的释放只移除它自己的工具，不释放
调用方持有的 provider，也不影响默认 registration。

| 可选工具名 | 输入 | 输出与权限 |
| --- | --- | --- |
| github.actions.repair.link | GitHubRepairIdentity | confirmed 完整 GitHubRepairReceipt / unknown；github:write，external_write，requiresPresence，禁止自动重试 |
| github.actions.repair.get | GitHubRepairIdentity + checkRunId | 原对象 GitHubRepairReceipt，无 state；github:read，只读核实 |

`GitHubRepairIdentity` 精确绑定 `repo/runId/expectedRunAttempt/sourceSha/repairPrNumber/repairHeadSha/workflowExecutionId`。
运行/attempt/PR/check 编号均为正安全整数，SHA 接受 40 或 64 位十六进制并规范化为小写；
真实 GitHub 若不接受 64 位 SHA，受控返回失败或 unknown，不替换 SHA、API 或目标。
`workflowExecutionId` 必须由可信工作流把原稳定工具 runId 做 SHA-256 得到，严格小写
64 位十六进制；模型不能提供执行身份。未知输入字段均拒绝，输入不允许自定义 check
名称、状态、结论、URL 或正文。

写前从 GitHub 最新 run 核对同仓库、runId、attempt、source SHA、completed/failure，
从同仓库 PR 核对 open、编号、原仓库 base/head、修复 head SHA 和规范 PR URL。
然后只 POST 一个全新的 CheckRun：固定独有名称由完整规范 identity 的 SHA-256
生成，`external_id` 也绑定该 identity；`head_sha` 使用原失败 source SHA，
`status=completed`、`conclusion=neutral`，`details_url` 固定为同仓库修复 PR。
固定 output 明确声明仅关联 PR、保留原 CI 结果，不宣称修复已通过。
`githubRepairCheckName(identity)` 是消费者核实固定名称的公开纯函数。
不同 workflow execution/run attempt/修复 PR head 会产生不同名称；同一原 unknown
不得以同名重新 POST，GitHub 不提供这里所需的创建幂等保障。

POST 回执还需 GET 返回的**同一个** checkRunId，严格核对编号、仓库 API URL、
名称、external identity、source SHA、details URL、completed/neutral 和固定 output。
Check 页面 URL 只允许 `https://github.com/{repo}/runs/{checkRunId}`，或该 URL 的
单一 `?check_suite_focus=true` 参数；拒绝其他参数、fragment、userinfo 或跨仓库/域名，
保存实际安全 URL。`GitHubRepairReceipt` 返回完整 identity、checkRunId、
externalId（字符串 check 编号）、url/name/detailsUrl/status/conclusion/evidenceRefs。
这是在原提交上的**新 neutral CheckRun 关联**，不是在 Actions 原 run 页面写评论，
也不 PATCH 原 CI、创建 success check 或使用 commit status 回退。

派发后超时、取消、传输/解析失败、回执字段矛盾或 GET 核实失败全部返回 unknown；
能取得原安全 checkRunId 时保留编号/URL，不自动再次 POST。registered 写工具继续把
unknown 转为 RESULT_UNKNOWN，由原 Runtime 进入 reconciliation。可信宿主可在独立
registration 选项中提供同步 `observeUnknown(input, result, context): undefined`，在
抛出标准错误前保存原回执的候选元数据。钩子只接收通过输入/输出 Schema、授权引用与
scope 检查的 unknown；input/result 为独立克隆，context 保留原完整 ToolContext，
供宿主精确绑定原 task/tool run/action/version/参数摘要与执行记录。
confirmed、只读结果、非法 unknown 和未授权调用均不触发钩子。
候选编号不等于已核实回执或新授权；宿主仍需过滤安全 checkRunId，并执行原对象 get
及原执行证据校验。合法但缺 ID 的 unknown 也可观察，不能据此造编号提示、按同名
列表猜测对象或重发写入。保存失败/钩子异常仍固定 RESULT_UNKNOWN，禁止重试；
同步返回类型拒绝 async 钩子，运行时意外 thenable 的拒绝会吸收且不等待，不能拖延
工具或改变 unknown。标准错误本身不携带编号，宿主持久候选承担后续恢复入口。
独立 get 只 GET 原编号并核对完整预期 identity/固定字段，不查询另一个 run/PR 来
替代原写证据；它不授予新写权限、不自动确认 Runtime 原 unknown，后者仍由可信
宿主按原授权、任务/run 和证据校验。原 run 或 PR 后续变化也不由这份关联回执证明。

真实接入需要 GitHub Checks(write)，并具备预读 run 的 Actions(read) 和 PR 读取权限；
已有 PR 操作许可或 token 不自动支持新 check 写入，凭据存在不代表用户授权。
参见官方 [Create a check run](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#create-a-check-run)
与 [Get a check run](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#get-a-check-run)。
支持所需权限的 GitHub App user/installation token 或 fine-grained PAT 由宿主注入。
GitHub API 不提供这里的原子 run-attempt/PR-head 条件创建：预读与 POST 间仍有竞态，
关联回执不代表修复分支最新状态或 CI 验收。当前仅有显式 Fake/合成 Gh 回归，真实
Checks 权限、账号写入与原持有者完整工作流仍未验收，保持 provisional。

## 原有接口边界与验证

分页默认 page=1、perPage=30，上限分别 10000、100。满页保守返回 nextPage，最后可能
需要读一页空结果；issue.list 过滤 PR，但游标以 GitHub 原始页推进，不因过滤跳页。
REST 分页不是快照，变化期间可能重复/遗漏，消费者按编号去重并重读目标。
文本默认每页 16384 字符、上限 65536；offset 以**脱敏后的 UTF-16 字符偏移**计量。
CLI stdout+stderr 总上限 1 MiB；超过明确失败，不将部分 diff/log 冒充完整内容。
失败日志先验证 job.run_id，再通过 `gh run view --job --log-failed` 读文本。
不把临时签名下载 URL 或 zip 日志作为输出。

可信宿主必须注入支持目标 Actions 日志归档布局的 CLI。当前真实只读验证使用官方
`gh 2.102.0`；这不是最早支持版本的声明。已确认 `gh 2.46.0` 只匹配逐步骤日志，
对仅含合并 job 文件 `0_check.txt` 和 `check/system.txt` 的归档会跳过全部步骤，
使 `--log` 与 `--log-failed` 均成功退出但返回空文本。宿主验收需要检查原失败 job 的
实际非空日志和完整分页，不能仅凭退出码确认读取成功；CLI 路径仍由可信组合注入。
Provider 对 `conclusion=failure` 的 job 拒绝原始空/纯空白日志，返回脱敏
`EXTERNAL_FAILURE`，不重试或自动换 CLI。成功 job 的空失败日志及非空原日志的分页末尾空页
保持原语义；此检查不校验日志归因，也不表示真实模型或账号写入已经可用。

2026-10-06 的真实 `GhCliProvider + SpawnGhCommandRunner` 在固定 Node24.15、官方
gh2.102.0 下读取授权仓库 `zemeng5208/PersonalAgent` 的失败 run `37474438969` /
job `112306058042`：正式 Schema 六页通过，offset 连续，末页 `nextOffset:null`，
全文 348224 UTF-16 字符 / 356938 UTF-8 字节，SHA256
`334b89ed82dc50fd73546b104ce4d760e2ca1c526ada1f6c565e4696245a253d`。
原 Calendar 测试路径及 TIMEOUT/EXTERNAL_FAILURE 失败标记实际存在；这是受限账号
GET 读取证据，未修复该历史测试，也不覆盖真实写入、Windows 或 Runtime 完整闭环。

2026-10-07 在 Windows/Node24.15、当前安装的 gh2.97.0 上通过生产 Provider/runner
复核同一失败日志：六页连续完整读回，字符数与 SHA256 同上，13 条只读命令，
账号写入与模型调用均为零。此结果不宣称最低兼容 CLI 版本或完整 Runtime 审批链，
详见 [本轮记录](../../../docs/modules/MOD-33-LOG-READ-ACCEPTANCE-20261007.md)。

pr.diff 每页读前及读后核对两端 SHA；review.comment 写前核对 commitId 及可选 expectedBaseSha（MOD-36 总是提供）；pr.create
写前核对 head branch SHA。issue.label 为追加标签，写前核对 expectedUpdatedAt，
消费者仍应对完整 issue 做指纹比较。GitHub 写接口没有这里所需的原子 SHA/时间戳
条件更新，预读与写入之间仍有竞态；消费者必须保守处理、必要时读回人工核实。
review.comment 只创建 inline comment，不提交 APPROVE/REQUEST_CHANGES。
不支持 workspace 操作、commit/push、自动 merge、关闭 issue 或向 Actions run 写评论。

provider 写入 dispatch 后断连、超时、取消、响应损坏返回 `{state:'unknown',evidenceRefs:[]}`，
registered tool 将该结果转为 `ProtocolError('RESULT_UNKNOWN')`，使 Gateway/Runtime
持久化 unknown 并进入 reconciliation，避免把正常返回的内层 unknown 当成外层 confirmed。
不重试、不伪造成功；已确认响应返回 confirmed，此处不宣称人工/外部验收 verified。
消费者 unknown 后进入 reconciliation，不能以新 run 重发。未派发的过期/取消明确
抛 TIMEOUT/CANCELLED。所有错误只返回标准错误码与固定摘要，原始 stderr 不回显。
公开 GitHubService 对每个注入 Provider 也执行同一期限/取消包装：忽略信号的
Provider 不得拖住调用或以迟到结果确认。入口已过期/取消时零 Provider 调用；
进入写 Provider 后取消/超时保守返回 unknown（服务无法证明未派发），工具入口
再转 RESULT_UNKNOWN，不自动重试。signal 中止不等于外部副作用已停止。
脱敏覆盖受限注入 token、常见 GitHub token、Authorization、密码/密钥键值；不是
DLP 保证，issue/log/diff 仍是不可信内容，不能作为权限或模型指令来源。

`GitHubConnector` 复用 ConnectorPort/manifest，通用 ConnectorPort 没有 ToolContext，
其读写/sync 方法明确 UNSUPPORTED_CAPABILITY，工具是实际执行入口。
connect 只登记宿主配置 session，不访问账号或声称 ready；health 保持 unavailable。
disconnect/dispose 释放 provider 与进程，register 初始化部分失败回滚已注册工具。

Fake 必须显式注入 operation fixture；缺项拒绝，不伪造成功。测试夹具不含真实 token。
原交付阶段只做静态检查；2026-10-05 用户已授权接续实现与必要验证，离线模块/Runtime/组合门禁已有回执，见 #277 接续说明。依赖准备完成后使用仓库固定 Node/npm 版本运行：

```sh
npm run build --workspace=@personal-agent/github
npm run typecheck --workspace=@personal-agent/github
npm run test --workspace=@personal-agent/github
npm run check
```

真实验收另行授权：白名单仓库 run/job 列表、失败日志、两端 SHA diff；写验收通过
Runtime 审批对测试 issue/PR 操作并读回，覆盖 unknown/reconciliation，不自动 merge。
