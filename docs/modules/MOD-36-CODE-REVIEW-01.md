# MOD-36 Code Review 预审

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 当前负责人：goo122（2026-10-07 接续）；自行实现、接线、验证与自审，原 zemeng 作者及 Potatos 历史验收保留；状态：review（已有外部定向验证与只读验收报告，完整写入闭环及协议兼容评审仍待完成）。
- Profile：2026-10-03 产品负责人授权的 Local DEV-WORKFLOWS 增量，不替代 Huawei ICT AgentArts Competition Profile 或计入比赛验收；实现为公开 ModelPort / Runtime-backed AgentToolPort 的消费流程，不新增模型、GitHub授权或工具注册体系。
- 工厂：`createCodeReviewWorkflow({model,tools,maxDiffChars?,maxPages?,maxFindings?,maxTokens?})`；公开类型位于 `packages/cognition/src/dev-workflows/code-review-types.ts`，根组合负责公共导出、依赖与 Runtime 装配。

工厂捕获本实例的 ModelPort 与 Runtime-backed AgentToolPort 引用；调用方为后续实例
替换复用 options 的端口，不能使原 prepare/publish 中途切到另一提供者。新 factory
可使用新端口，原端口的 `list`、`invoke`、`complete` 方法仍实时调用，不缓存工具
可用性或权限。context/access 的授权、用户在场、取消、期限与确认回执钩子保持原
检查语义；捕获端口不代表真实能力冻结或授权。

`prepare({repo,number,rules}, AgentWorkerContext, {runId,authorizationRef})` 经 `github.pr.get` 读取精确 base/head，经带 expectedHeadSha / expectedBaseSha 的 `github.pr.diff` 完整分页，再读 PR 确认未漂移。相同 head/base 可复用 Runtime checkpoint 中的完整 diff，提交变化则重新分页；缓存不免除发表前复核。可信规则必须由宿主提供；PR 标题、正文、diff 与从完整 diff 生成的 changed-lines 提示仅置于模型 user 数据消息，不成为规则或权限。提示最多列出前 400 个变更文件；实际校验仍覆盖完整 diff，不把提示截断当作完整评审证明。

模型输出可为裸 JSON，或整个输出由一个 `json`/无语言标签的三反引号围栏包裹；仅剥离该运输层围栏，再严格 JSON/schema 校验，不从解释文字中抽取 JSON。每条 finding 包含 blocking/suggestion/question、已声明 ruleId、path、line、side、body。未知字段（包括 confidence）、未声明规则、非法类别/字段类型仍使整体准备失败；格式有效但未锚定实际变更行的意见被丢弃，精确重复条目仅保留第一条，其余有效意见按原顺序保留。空报告仅表示没有保留意见，不表示批准或无缺陷；没有合法 findingIndex 时不能发表。删改路径按 unified diff 左右侧定位，带引号的Git转义路径按下述规则解码。

报告绑定 repo/number/headSha/baseSha 和规则，保存于本任务 Runtime checkpoint 后方可消费。`publish(report,findingIndex,context,access)` 检查报告原始摘要、taskId、参数与工具公布，再读当前 head/base；只调用 `github.pr.review.comment` 发布 inline COMMENT。Provider 在外部写入前再次核对 commitId 和 workflow 传入的 expectedBaseSha，防止审批等待期间 base 改变而复用旧读取缓存。expectedBaseSha 是向后兼容的可选字段，本工作流总是传入；GitHub 预读与写入并非原子条件写，仍存在平台竞态。不自动 approve、request changes 或修改分支。用户授权由 ToolGateway 校验；流程不签发授权。

写入前持久保存 unknown，并绑定 runId/authorizationRef。已确认结果重放，pending 允许原 runId 审批恢复；unknown 不自动重试。仅 Runtime 确认原执行、校验原参数且安装 confirmed 缓存回放后，可信组合可以通过 `access.confirmedReplayReady(runId)` 对精确评论执行返回 true，调用相同 runId 消费缓存结果。该函数不得接受 PR/模型/Renderer 自报值。发布 suffix 为 `publish-head-${findingIndex}` / `comment-${findingIndex}`；prepare suffix 为 `head-before` / `diff-${page}` / `head-after`。读取或模型步骤失败不能留下可发表报告。

默认预算：200,000 diff 字符、32页、30条意见、8,000输出 tokens；超过 diff 限额返回 unsupported，不审查截断内容。所有异步调用传递 signal/deadline，循环及模型前后检查截止时间；无实际服务和模型时不会静默回退 Fake。

Git C-style带引号/转义路径已在后续增量提供有界解码与逐字节UTF8校验，中文路径可锚定
真实变更行；拒绝非法编码、畸形转义、NUL或路径越界，不猜另一个文件。
Git对含空格路径头附加一个末尾tab分隔符；中文与空格同在时也会在合法quoted头后附加。
解析仅移除单个这个分隔符，再执行原quoted/unquoted严格校验，
保留文件名的首尾/中间空格。内嵌tab、多余tab、时间戳与畸形quoted头仍拒绝，
不采用trim或以空格拆路径。重命名文件的两侧变更行都使用当前PR文件名作为评论path，
LEFT保留旧行号、RIGHT使用新行号；只有纯删除文件才回退旧路径。前一版本错误地将
rename的LEFT锚放在旧文件名、并拒绝quoted末尾合法tab；2026-10-06真实Git回归分别
复现后修正，没有把丢弃合法finding或改变旧错误断言当作成功证据。
GitHub第一方VSCode扩展的[固定源码](https://github.com/microsoft/vscode-pull-request-github/blob/e62a2ad08cc07791d0d13f471532b5032486b6f1/src/view/fileChangeModel.ts#L227)
分别保存旧文件读取路径和当前PR文件身份，并[按当前path与LEFT/base映射评论](https://github.com/microsoft/vscode-pull-request-github/blob/e62a2ad08cc07791d0d13f471532b5032486b6f1/src/view/pullRequestCommentController.ts#L145)。
这是第一方实现与真实本地Git格式依据；本轮没有实际账号COMMENT写入或声称平台422实测。
只读可定位的合法Git文件名不一定能发表：超过GitHub现有限长、包含控制字符/反斜线/
`..`/`@{`等禁止路径时publish返回unsupported且保留finding，不预留新的unknown评论写入。
先前已有confirmed/unknown发表checkpoint及原执行绑定仍优先，不改变原未知结果或盲重试。
Runtime `code_review` 的publish=true遇后续finding unsupported/pending/unknown时保留完整
prepared report、当前index/总数/已confirmed索引及累计Evidence，发表状态仍是真实状态。
审批/SQLite重启消费原确认缓存，不重模型或已发表评论；未知评论仍由原执行核实。

## 集中验收

2026-10-07 goo122 的真实 GitHub/Fake 模型/Runtime SQLite 读回发现：等待 head-after
审批后复用完整 diff 缓存，会丢失其分页 Evidence 引用。缓存现在保存并恢复各页引用；
旧缓存缺少或包含非法引用时经原公开读取端口刷新，不清库、不改既有报告或写入记录。
新回归覆盖两页 diff、审批中断、JSON checkpoint 恢复和旧缓存兼容；真实读取加拒绝
评论的证据与限制见 [恢复验收记录](MOD-36-EVIDENCE-CACHE-20261007.md)。

2026-10-06 #212 `6019894581` 增量保留公开 before：首 head 读取等待期间普通 caller
替换复用 model/tools，原 workflow 会调用新模型/工具；prepare 后换 tools 还可绕过
原端口已移除的评论能力。全部明确合成端口，不是实际账号写入或 Gateway 许可证明。
新增正式回归原码2失败/1通过，修后 Node24.15 cognition build/typecheck 通过、完整
216/216、零跳过。独立同公开 probe 原2/2失败→修后2/2通过：原实例端口保持、
新实例可换端口、原工具撤销评论能力仍 unsupported/零 Fake 写入。原失败与最终日志
均归档，源 hash `1a8e2caf0780901106b3095b1fde6a768afc67333f45b6428e0131bbba857017`。
沿 #297 交付，精确新提交 Windows 门禁另读回；不改公共 DTO/wire 或上述审批恢复。

初稿按当时用户限制仅静态交付；后续用户已授权持续实现与必要构建/受控测试。
`packages/cognition/test/code-review.test.mjs`实际覆盖可信规则隔离、head/base绑定、完整分页、严格JSON、变更行校验、报告篡改、过时head、仅COMMENT、缺工具/授权、unknown不重复写、diff不完整拒绝，以及围栏兼容/外部文字拒绝、非法条目与重复过滤、空报告不可发表。
前一受检source `2eda73d` 的固定Node24.15完整check exit0，cognition201、Runtime347、
根集成19通过；SQLite合成Gh两个finding场景验证报告不丢、后续pending不重前评论、
unknown不普通恢复。全部31workspace1990/0/50，不是实际账号COMMENT成功证明。
后续 #212 `6002238962` 的路径分隔符修复先保留真实Git旧失败及2失败/1负例通过的
回归证据，固定Node24.15/npm11.12 cognition build/typecheck与完整模块204/204通过。
真实Git临时仓库含空格路径、rename/delete与非法分隔符回归通过；注册GhCliProvider
的明确合成transport使用真实Git spacediff，准备报告及单次COMMENT payload保持精确路径。
独立只读复核无实质问题；没有真实账号COMMENT写入或扩大公共接口/授权。
后续受检源码be49b30及源码相同的docs90f02d0，两路准确90f02d0 Windows Foundation
已完整成功，各31workspace2035/0/16，其中cognition204/204、0跳过。PR首轮无runner取消
保留，仅一次基础设施重试成功；受控CI仍不替代真实账号COMMENT与原场景恢复。
精确提交/Windows门禁/真实交接见
[统一续接清单](DEV-WORKFLOWS-CONTINUATION-20261005.md)，非作者兼容与真实写入仍待完成。

Potatos498 在 `7999446a0fd4da2adda3e8ab8d25c2d3b7151719` 的提交说明报告 Code Review 10/10 和两轮真实只读 `gh` PR + GLM 模型验收，包含 8/8 意见锚定变更行。该报告不是执行端复跑结果；提交提及的 `.cache/dev-workflows/acceptance/` 原始证据未附在仓库或 PR 中，尚待回交可读的脱敏记录。旧 head 的全仓 build/59 条 DEV-WORKFLOWS 测试报告也不替代本轮 head 与新增场景的集中回归。真实评论写入、MOD-34/38 的授权工作区/提交/推送/PR/Issue 闭环、Windows 场景及 goo122 评审仍待完成；只读 GLM 验收不证明盘古或 AgentArts 实际兼容。当前接口保持 provisional。
