# MOD-34-CI-FIX-01：有界失败修复消费链

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

状态：review；目标 profile：`local`（本轮明确授权的开发工作流增量）。当前负责人 Potatos498（2026-10-07 接续）；负责实现、受控 Git、Runtime/桌面必要接线、验证、自审及交付，历史 zemeng 作者归属保留。本增量不声明真实 GitHub、模型、Windows 或 AgentArts 验收已完成，也不替代 Competition Golden Path。

## 入口与依赖

`createCiFixWorkflow(CiFixOptions): CiFixWorkflowPort` 返回 `run(AgentWorkerContext)`；也可调用 `runCiFix(context, options)`。消费公开 `@personal-agent/agents` 的 `AgentToolPort` / `AgentWorkerContext`、`@personal-agent/models` 的 `ModelPort` 与既已声明依赖的 `@personal-agent/github` 修复关联类型/名字校验，不导入 apps，不创建任务库、调度器、模型入口或授权服务。`ToolExecutionPort` 是既有 AgentToolPort 的本模块别名，并非新冻结契约。

宿主绑定 repository、失败 runId、sourcePaths、验证 recipe、source/base branch、Git 工具名、steps/tokens 上限和 authorizationRefFor。缺端口或注册工具返回 unsupported。issue-only 模式省略 runId，要求 expectedHeadSha 与 issue 元信息；不伪造失败 CI。

生产工具依赖：

| 能力 | 名称 / 参数 |
| --- | --- |
| Failed run | `github.actions.run.list {repo,page,perPage:30,status:'failure'}`，最多4页 |
| Failed jobs | `github.actions.job.list {repo,runId,page,perPage:30}`，最多4页 |
| Job log | `github.actions.log.read {repo,runId,jobId,offset,maxChars}`，初始offset=0，按nextOffset最多8段 |
| Source | `workspace.read_text {path,maxBytes:65536}` |
| Patch | `workspace.apply_text_patch {path,expectedSha256,edits}` |
| Verify | `workspace.run_allowed_command {recipeId}` |
| Git | Host registered head / commit / push，见 Git 工具交付文档 |
| Approved PR | `github.pr.create {repo,head,base,expectedHeadSha,title,body,draft:true}` |
| Backlink | `github.pr.comment {repo,number,body}`，含原 run URL |
| Issue-only | `github.issue.get {repo,number}` 与 `github.issue.comment {repo,number,body}` |

所有上述读写均通过 Runtime ToolGateway，模型没有 GitHub provider 或 shell 访问权。GitHub run 本身没有评论 API；默认未配置sourceRunBacklink时，回链是 draft PR 正文及 PR comment 引用原 run URL，issue 模式另对原 issue 评论 PR URL，不自动 close 或 merge。
日志单段maxChars不超过65536，完整日志受共享maxLogBytes的UTF8字节预算限制；页尾半个
UTF16码点或达到上限时停止并保留truncated，不把不完整内容称为完整失败日志。

公开 `createCiRunDiscoveryWorkflow` 提供独立单页失败运行发现；Runtime `ci_list` 的
原审批/页号/一步预算跨SQLite重启保持。宿主明确选定后提交独立 `ci_fix`，不自动轮询
或为整页建子任务。完整公开输入输出与组合规则见
[Runtime消费说明](DEV-WORKFLOWS-INTEGRATION-01.md)。
发现工厂捕获原 ToolPort 引用，descriptor 与后续 bounded 调用使用同一端口；
普通 caller 启动读取后为新实例替换复用 options.tools，不改变旧实例。原端口的
list/invoke 方法及原授权/confirmedReplayReady 属性仍实时，原 now 函数捕获、
请求参数/identity/checkpoint/一步预算保持不变，新 factory 可用新端口。

可信宿主可显式设置 `sourceRunBacklink={toolName,runAttempt}`，原PR/评论后追加原预算内
稳定source-backlink步骤。未配置时旧checkpoint identity不变，仍只表示PR引用原来源。
配置时缺registered external_write在修复前返回unsupported，issue-only无run拒绝配置。
confirmed `sourceRunLink`复用公开GitHubRepairReceipt，核对完整原identity、官方固定名字、
same-repo Check/PR URL与neutral回执。新中性源SHA关联不等于原run页面评论或修复CI绿。
未知执行保持等待；Runtime可显示原候选ID的unverified提示，另经新审批只读核验，
提示或readback成功都不自动确认原未知写入、不重POST。

## 行为与可信结果

有界修复循环：读取失败 run 与至多八个 failed-job 日志 → 确认初始完整 workspaceClean 与失败 SHA → 每轮读取宿主批准源文件的当前内容 → ModelPort 返回严格 JSON 诊断/精确文本 patch → 校验只有已读路径及 SHA → 经现有 patch 工具审批应用 → 执行宿主 allowlist verification recipe。`maxAttempts` 默认 2、合法范围 1～4；验证失败时将上一轮诊断与有界验证输出作为不可信数据交给下一轮，补丁在已有改动上叠加。达到上限或预算不足时不提交。

只有 confirmed exitCode=0 后才重新读取同 HEAD SHA，并经可信 Git 工具核实实际验证 receipt 与当前文件指纹后 commit → 独立审批 push → 审批 draft PR → 写回链。commit 路径从所有轮次的 confirmed patch receipts 去重汇总；审批恢复与重启不能丢失前轮已应用文件，也不重新执行已确认补丁。暂停结果中的 verificationRunId 指向最近实际确认的验证步骤，不指向尚未执行的新轮次。

Git receipt 必须从 Runtime 获得；commit 参数中的 verificationRunId 仅是查找键，不能当成功证据。实际 receipt 同 workspace/HEAD/文件快照绑定由 Git 工具及 composition 执行。本链不绕过验证。工具返回 pending / unknown 或外部 write state unknown 均不作为成功。

issue fingerprint 与 MOD-38 一致：SHA256(JSON.stringify([number,title,body,state,sortedLabels,url,updatedAt]))；修复前重新读取并校验，变化返回 stale。PR 保留 issue URL/fingerprint，不使用自动关闭关键字。

MOD38 默认 Runtime 桥还传递可信 `repairGoal` 与 `pullRequestBody`：前者最多 8000、
后者最多 16000 字符，非空且在入口捕获为独立字符串。goal 作为有界模型 JSON 上下文
计入原输入预算，不赋予权限；正文追加到原诊断、source/Issue 回链和 fingerprint 后。
完整正文超过 65536 字符时在 commit/push 前拒绝，保留原审批与验证链。

## 恢复与预算

单次 `runCiFix` 调用在首个 await 前捕获执行配置：仓库/run/源 SHA、分支、验证
recipe、步骤/token/日志/尝试上限及已批准上下文，复制 sourcePaths 数组与
Issue/Git 工具名/sourceRunBacklink 子对象。普通调用方在等待期间修改复用 options，
不能让同一 task/identity 的后续参数偏离原配置。factory 不在创建时永久冻结执行
配置，不同任务的新调用可以使用新配置；旧 journal 的 identity 校验和序列化保持
不变。factory 创建时固定 ModelPort/工具对象，旧 pending/unknown 恢复不会因宿主
复用 options 创建另一实例而切换 Runtime adapter。新 factory 可绑定新端口；直接
`runCiFix(context, options)` 每次调用选取端口。原端口的方法和能力仍实时，Runtime `authorizationRefFor`、
`confirmedReplayReady` 与 `now` 继续读取实时钩子，撤销、回执可消费性和期限不会被
配置快照冻结。快照不替代工具权限检查或现场执行回执。

Runtime checkpoint `ci-fix-v1` 保存参数 identity、调用计数、token 保守预留、confirmed receipts、evidence 与 in-flight 标识。工具 runId 稳定绑定 task/identity/step。每次 dispatch 前持久化；异常、取消、超时保留 in-flight，默认恢复不重试。pending 审批恢复复用相同 runId 与参数。unknown 仅当宿主 `confirmedReplayReady(runId)` 明确表示 Runtime 已完成真实读回且可消费缓存确认结果时，才允许调用既有 Runtime adapter 重放；不得用该函数授权重新执行未知写入。模型未知响应不自动重做。

上述 goal/正文有值时参与同一 identity；变化不得消费旧运行。未配置两字段的 legacy CI
身份字节不变。旧 Issue 未知 checkpoint 加入新上下文会拒绝，原 journal 不变、零新
派发；不自动迁移、清除或换 run，由原可信宿主以旧上下文核实恢复。代码升级不证明
旧外部副作用已经确认。

`maxSteps` 含读取、模型、工具；tokens 在请求前保守预留全部剩余预算，确认响应后按合法 `usage.totalTokens` 结算，多轮共享预算。usage 缺失或非法时保留耗尽状态，恢复不能重置预算。每轮 source/model/patch/verify 标识绑定轮次，防止误用上一轮结果。取消信号与 deadline 贯穿全部调用。没有 shell 字段，模型不能选择 command recipe 或 Git/PR 参数。

## 验收交接

### 全仓工作区与 patch helper 组合

Potatos498 在 PR #277 评论 `5968380670` 报告真实失败 run `37116843775` 的 MOD-34
验收受阻：仓库根同时包含默认包内 `locked-apply.ps1`，原保护正确拒绝从可写工作区执行
helper，但源码部署没有外部 helper 配置入口。本轮保留 root/helper/recovery 隔离，增加
`WorkspacePatchApplyHostOptions.helperScriptPath?`，经公开 apply factory 及 Runtime 的
`workspace.patch.helperScriptPath` 转交。不删除 in-root 保护、不缩小全仓验证 root、不自动部署。

受信宿主须先把本版本已审查 helper 的字节一致副本安装到工作区及 recovery 之外的独立限权
目录，再显式注入绝对路径；factory 校验常规文件/单硬链接/位置/摘要，执行前复核。
缺外部安装时仍明确拒绝，不能把 workspace 内的脚本豁免为受信程序。该选项是进程内可选
配置，不改变 wire/tool schema 或授权范围；宿主 ACL 和非作者兼容评审仍待 goo122 核实。
已补仓库根注册、外部 helper 实际应用、相对/越界/未知脚本/硬链接拒绝、注册后突变拒绝的
Windows 测试。后续59c366b PR Foundation完整Windows日志实际通过对应临时工作区/
PowerShell受控用例，包括外部helper实际apply、位置/硬链接拒绝、变更失效和Desktop接线。
这些不恢复Potatos498原未知task或证明其设备完整MOD34闭环，原场景仍须精确head集中复验。

`packages/coding-tools/test/ci-fix.test.mjs` Fake行为场景覆盖完整消费链、执行顺序、确认verify失败拒绝commit、缺能力、模型shell拒绝、unknown不重发、pending同run恢复、HEAD/identity变化、取消、预算、issue-only与指纹漂移。初稿仅静态交付，后续授权已执行构建/受控回归；不能把Fake验证称为真实Git提交或账号闭环。

Potatos498在 `656bd874` 的旧59/59报告保留为历史证据，不替代后续分轮修复和当前source。
历史source `2eda73d` 固定Node24.15完整check实际exit0，coding-tools183/15平台跳过，
Runtime347、根integration19通过；CI83+发现30的受控定向验证已通过，包含上述恢复回归。
完整31workspace1990/0/50及最新Windows head见
[统一续接清单](DEV-WORKFLOWS-CONTINUATION-20261005.md)，模块仍review/provisional。

上述 `2eda73d` 为历史组合证据。2026-10-06 新增单次输入快照（#212 `6019776595`）
公开 before 1/1 失败：首个读取等待期间普通 caller 改 repository，后续参数改用新
仓库而 identity 保持原值；明确 Fake 工具成功不代表真实 Gateway 放行跨仓库写入。
修后同复现 1/1 通过，正式 Node24.15 构建/类型通过、coding-tools 227/0/15 Linux
平台跳过。独立公开探针 10/10：读取/模型/验证等待期间标量和嵌套配置更新仍用原绑定，
实时 hook 属性替换生效、旧 journal 拒绝新配置、新任务接受新配置、非法关联零派发
拒绝及 legacy identity 一致。原失败与最终日志均保留；沿 #297 交付，精确发布头的
Windows 门禁另读回，不把之前已通过的提交当作本增量验证。

CI discovery 后续 #212 `6020191190` 有效公开 before1/1失败：同步 descriptor 来自
原端口，调用方启动后复用 options 更换同名/version 的端口，bounded 微任务却调新
端口。修后同脚本1/1通过，Node24.15 coding-tools build/typecheck、模块230/0/15
Linux平台跳过；独立公开4/4通过，覆盖原端口/新factory、原方法和能力撤销、pending
及 unknown 的原run/参数/steps1和实时授权/确认钩子。所有工具明确 Fake READ，
无真实账号写入；误命名before的准备日志实际新dist3通过，不计旧失败。
最小源码仅3行引用绑定变化，不改上述恢复与时钟语义；沿现有#297继续交付。

factory 跨恢复的端口绑定另按 #212 `6022269030` 修复。旧公开复现1/1失败：原
读取 pending 后，宿主复用 options 创建新 factory，旧 factory 恢复原 run 却使用新
tools/model。独立纯 Fake READ 的 pending/unknown 两例旧2失败→同探针新2通过，
保持原 run/参数、确认未就绪时暂停、就绪后仅经原 adapter 消费。私有执行入口固定
factory 端口，公开两参数 `runCiFix` 保持每次调用选端口；不冻结原权限与时钟钩子。
同公开复现after1/1通过；正式新增回归旧1失败/1通过，固定Node24.15的build/typecheck
及coding-tools232/0/15 Linux平台跳过通过。独立追加边界4/4涵盖直接调用新端口、
原方法更新、授权撤销/恢复、时钟更新和能力撤销。追加探针首轮把既有unsupported
返回误断为异常，纠正断言后通过；保留原日志，不计作产品或旧实现失败。
仅本人CI修复源码/测试和配套说明，沿#297交付；未知写核实、Runtime授权、配置
identity/序列化和步骤预算未改变，真实自动修复链仍按原owner验收。

真实验收由Potatos498在原受信场景接续，精确脚本以当前package.json为准；需要获授权的GitHub仓库/分支/账号、MOD33 adapter、真实受权ModelPort、Windows patch host、受限验证recipe及Runtime verification snapshot。Local链不强制依赖AgentArts；AgentArts兼容与比赛云验收另按对应profile执行。Fake通过不替代上述真实验收。
