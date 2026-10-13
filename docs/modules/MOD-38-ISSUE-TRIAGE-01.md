# MOD-38：Issue 分类与受控修复 PR

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

当前负责人 Potatos498（2026-10-07 接续；历史作者 zemeng 保留）；目标为已授权的 `local` DEV-WORKFLOWS 增量；状态 `review`（由负责人完成自审、必要检查及真实标签/修复 PR/Issue 回链验收，不等待集中验收）。不计入 `huawei_ict_agentarts` 比赛验收。
初始基线 `3d4d917`、工作树 `.worktrees/dev-issue`、分支 `codex/dev-issue`；历史交付沿
PR #290集成；当前沿既有 PR #297 续接，精确提交与验收入口见下方统一记录。

## 行为与依赖

`createIssueTriageWorkflow` 接收公开 `@personal-agent/models` 的 `ModelPort`、
`@personal-agent/agents` 的 `AgentToolPort` / `AgentWorkerContext`，不反向依赖 apps。
factory 捕获本实例 Model/Tool/IssueRepair 端口引用和已验证的 maxSteps/maxTokens，
等待期间为后续实例更新复用 options 不改变当前分类、标签或修复链。新 factory
可以使用新配置；原端口的 list/invoke/complete/repairIssue 方法仍实时，
authorizationRefFor/confirmedReplayReady/confirmedRepairReplayReady 继续读取原
options 的实时属性。配置与端口绑定不冻结权限、不把缺能力替换为另一提供者。
`listIssues` 经 MOD-33 `github.issue.list` 保留 page/nextPage/hasMore，
`triageIssue` 经 `github.issue.get` 读取完整快照，仅接受 bug/feature/docs/question，
confidence 必须为有限 0..1，证据为能在原始标题/正文中找到的精确摘录。
缺省低于 0.8 转人工；置信度标记 calibrated=false，不冒充校准概率。
中文/混合标签四类夹具通过仅证明该契约，不是未给评估集/阈值的真实分类准确率。

输入中的安全/漏洞/凭据线索和常见令牌先在本地筛查，直接人工，不向模型发送这些内容。
这是一道保守筛查而非完整 DLP；模型外发仍需宿主授权，宿主必须保证注入的模型与隐私策略一致。
Issue 是不可信数据，不能签发权限、切换 profile、构造工具提案或提供修复授权。

写标签默认关闭；启用时仍要求宿主 scope 与 Runtime Policy 审批。
模型分类后先重读比较完整 SHA-256 fingerprint（含正文/标题/标签/状态/时间/URL），
再通过 `github.issue.label` 追加标签，并传 `expectedUpdatedAt` 给提供者再次检查。
提供者前置读回不等于 GitHub 原子条件写；最后一次外部读取与写入间的竞态仍需真实验收。
不把 Model 摘录当执行证据，`evidenceRefs` 只消费工具/修复链可信返回值。

bug 修复使用宿主注入 `IssueRepairPort.repairIssue`，组合适配 MOD-34 既有修复链，
不创建另一个 Agent 执行循环、调度器或任务库。宿主须保证受限工作区、MOD-34 预算、
源码快照/补丁/测试/提交/PR 与审批的事实状态，并将请求的 pullRequestBody 合入真实 PR 正文。
正文采用 `Related issue: <url>` 回链，不使用关闭关键词；不自动 close / merge。
缺少 repair 端口或可信 repairGoal 明确转人工，不以 Fake 替代生产服务。

2026-10-06 默认 Runtime 桥补齐这项委派：先捕获请求的 repository/Issue/指纹/goal/正文，
再调用可信失败 run 选择器，将 goal 与正文传入 MOD34。`CiFixOptions` 的可选
`repairGoal` / `pullRequestBody` 分别有界至 8000 / 16000 字符，入口捕获独立字符串，
goal 进入模型 JSON 上下文并计入原 token 预算；正文追加到原诊断、source/Issue 回链与
fingerprint 后，完整正文在 commit/push 之前核对 65536 字符上限。目标不授予新工具或
权限，不改变源码白名单、审批、验证、CAS、draft PR 或禁自动关闭/合并的原语义。

这两个字段有值时参与原 CI checkpoint 身份，变化不得复用旧工具运行或确认结果。
无字段的 legacy CI 身份字节保持；已有旧 Issue 未知 checkpoint 不能在加入新上下文
后自动迁移、清除或换 run 继续写入，身份不匹配时拒绝并保留原 journal，由原可信宿主
按旧上下文核实和恢复。升级代码不证明外部旧写入已完成，也不自动重发。

固定 Node 24.15.0 的旧公开入口回归 CI 三组全失败、默认 Runtime 桥一组失败；修后
coding-tools 208/0/15 平台跳过及 build/typecheck、Runtime 定向 46/46 和最终入口捕获
后的默认桥 1/1 通过。真实 TaskRuntime/SQLite 审批与重启、明确 Fake 模型/工具验证
goal 传递、PR 完整回链、commit/PR/Issue backlink 各只一次；不冒充真实 GitHub 或云写入。
超长合成 URL 边界夹具首轮先耗尽模型预算的失败已保留，给夹具足够预算后才验证正文
越界在 commit/push/PR 前拒绝，生产预算没有放宽。该接线沿 #296 交付并由 goo122 合入 main
`111bb90`；准确 `0babfcc` 两路首次 Windows Foundation 完整日志各 2076/0/16，原真实验收不变。

## 恢复、预算与端口

请求使用 `{repo,number,writeLabel?,repairBug?,repairGoal?}`；list 使用
`{repo,page?,perPage?,state?,labels?}`。options 包含 model/tools/repair?、
authorizationRefFor、maxSteps、maxTokens、minConfidence?、labels?。
返回分类、fingerprint、标签及工具证据；分类与执行状态分离。接口为 provisional。
公共index/依赖与Runtime装配沿既有单一集成槽维护，模块不私设wire或新的授权接口。
当前Runtime `issue_list`提供独立已审批发现页；宿主明确选项后提交独立issue_triage任务，
通过持久请求及原Gateway runId保留页/审批/确认缓存/幂等身份；list自身没有独立步骤预算
journal，不调用模型，不自动轮询、为整页建子任务或复用另一Issue修复checkpoint。

所有调用携 deadline / AbortSignal；使用已有 `withCognitionDeadline`，迟到结果不能触发下一写入。
步骤和输入估算/输出 token 预算在模型调用与副作用前检查，真实 usage 超预算转人工。
输入估算是字符估计，不能保证所有 tokenizer 的实际输入 token；真实硬限额仍由 ModelGateway 执行。

写入前把 intent 存在 Runtime checkpoint。结果 unknown、超时、取消或断连保留
waiting_reconciliation，重入不重发未知写入。pending 审批返回 waiting_approval，
仅通过相同参数与 runId 的 Gateway 调用恢复审批或读回缓存；Gateway 必须实施幂等。
读工具的pending/unknown同样保持Runtime暂停状态。标签confirmed后的repair及原repair
waiting_approval恢复，先以本模块持久generation按原累计steps读取当前Issue；pending读取
沿同runId继续。确认原正文/标题/state/URL未变且通过敏感筛查后，保留原repairSource/
fingerprint/PRbody输入委派原MOD34，消费其已有checkpoint，不复制执行循环或换原修复身份。
仅实际进入委派才推进下一次fresh read generation，普通审批重启不反复换读取ID。
确认写入不会因后续修复失败而抹去。Runtime 是任务状态与 checkpoint 的唯一事实来源。

未知标签保留原始参数及 runId；只有宿主 `confirmedReplayReady(runId,context)`
核验原运行已存在 durable confirmed receipt 和 Gateway 缓存时才允许同调用读回缓存。
未知修复保留原 Issue 绑定，只有 `confirmedRepairReplayReady(context,issue)`
确认 MOD-34 原 checkpoint 的未知 run 都已分别核验/缓存才重新进入其恢复入口。
这两个 callback 必须由可信 Runtime 组合提供；新的审批、通用任务状态或调用者布尔值
均不能替代精确原始 receipt。缺 callback 始终保留暂停，不发起新任务或新写入。

2026-10-06 后续标签审批恢复修复（#212 `6018825022`）：原 pending 标签恢复只依赖原
`expectedUpdatedAt`，同一时间戳内的正文变化可能沿旧分类继续写。现在恢复写前以新的
持久读取 generation 重读完整 fingerprint 与敏感条件；先保存累计步骤和读取身份，
取消、未知或读取消费后的再次恢复不能复用旧 GET 缓存；已知读取审批 pending 仍沿原
runId 与已计预算恢复，避免换身份反复索要审批。预算耗尽不继续读取或写入。原标签写 runId
和参数不变，不重新调用分类模型。

未知写入仍须可信原 confirmed receipt 才能恢复；先消费并保存该回执，再读当前 Issue。
核对标题、正文、状态、URL 与排除本次标签后的其他标签，允许自身追加标签导致的
标签及 updatedAt 变化；其他变化或敏感内容转人工、不进入 repair。读取取消后保留
已消费回执，下一次不再消费原写入；即使随后转人工，结果仍保留已确认的历史标签及
工具证据，不宣称远端当前仍持有该标签。该比较不能把 GitHub 外部读写变成原子事务。
Node 24.15.0 的 cognition build/typecheck、完整测试 213/213 通过；受控工具与模型证据
不计真实账号标签验收，准确后续提交的 CI 和非作者审核另在交付 PR 记录。

## 验证与限制

初稿按当时用户限制仅静态交付；后续已授权并执行必要构建/受控验证。
Fake行为测试位于 `packages/cognition/test/issue-triage.test.mjs`：
四类、置信度/字段/证据校验、凭据拦截、指纹变化、审批与未知结果、幂等恢复、
bug修复回链、预算、取消/deadline和分页；后续补齐原修复委派绑定与重读缓存代际恢复。
历史source `2eda73d` 固定Node24.15完整check exit0，cognition201、Runtime347、
根集成19通过，全部31workspace1990/0/50跳过。原内容/已confirmed标签与原修复预算
在后续暂停/重启时保留，未将同一Issue改写为新的模型任务。
这些为明确Fake/SQLite受控证据，非真实标签或修复PR验收；当前精确head门禁及交接见
[统一续接清单](DEV-WORKFLOWS-CONTINUATION-20261005.md)，状态仍review/provisional。

2026-10-06 #212 `6019995540` 新 factory 绑定增量：公开 before1/1失败，普通 caller
在首 Issue get 等待期间为新实例更新 model/tools，旧实例后续改用新模型/工具并
生成另一分类/标签。明确 Fake 端口，不是实际账号/Gateway 跨权限写入证据。
修后同公开脚本1/1通过，Node24.15 cognition build/typecheck及完整219/219、零跳过。
独立最终公开6/6通过，覆盖GET/分类await端口与预算更新、旧实例原绑定/新实例新
配置、原repairIssue与授权方法实时、能力撤销及两个确认回执钩子的属性替换。
标签审批重读和原run恢复规则不变；原失败日志与准确hash归档。独立准备期一个命名
before的日志实际已是新dist的3通过，仅作为准备记录，不虚计为旧失败。
本增量只动本人实现/测试与模块/续接说明，沿#297发布；新提交完整Windows门禁另
读取，源就绪不等于真实验收或非作者评审完成。

Potatos498 在集成公共导出/依赖与 MOD-33/34/Runtime 装配后集中执行：

```sh
npm run build --workspace=@personal-agent/cognition
node --test packages/cognition/test/issue-triage.test.mjs
npm run check
```

真实验收需单独授权：真实 issue.list/get → 受权模型分类 → 审批 label 追加/读回 →
真实 MOD-34 修复 PR 正文回链，验证原 issue 未关闭、PR 未自动合并；
审批拒绝/撤销、写入未知恢复、并发改 Issue、取消和预算分别留存可信 Evidence。
离线 Fake 与编译均不能证明 GitHub、AgentArts 或模型外发生产能力已可用/已冻结。
