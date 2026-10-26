# 原生 Harness 会话上下文压缩（2026-10-20）

## 2026-10-23 自动压缩与手动命令

本轮目标：在 `huawei_ict_agentarts` 原 Runtime / Desktop 链上提供可配置自动压缩和用户命令，不更换主模型或新增工具授权。独立工作树 `.worktrees/context-auto-compact`，基线为 128,000 字符扩容提交 `d87637b4`。

- 设置入口仍为「模型 → 开发者 Harness → 会话上下文自动压缩」。首次显示推荐预算：96,000 字符触发、64,000 字符目标、128,000 字符硬上限，保留最近 8 条消息（边界上的同一任务问答一并保留），最多读取 2,000 条合资格来源，每段 32,000 字符，摘要每段最多 4,000 字符，输出预算 2,048 tokens。须用户选择已保存模型、勾选并保存；旧配置与旧自定义预算不被自动覆盖。
- 启用后每轮在最终发送之前按真实序列化字符数判断，存在受信 tokenizer 时同时检查 token 预算。达到阈值则压缩旧历史；当前目标、近期原文与实际工具 continuation 保持原值。目标和尾部已超预算时在模型调用前拒绝，不偷偷删历史。
- 主对话单独发送 `/压缩` 或 `/compact`，沿原 `task.submit` 生成 Runtime 管理任务并立即执行同一压缩算法，即使尚未达到触发阈值。不派发执行子任务、不调用工具、不把命令发给主模型。只有当前用户提交的完整命令生效；历史或模型中出现命令字符串不会触发。任务进行中须先等待或停止，不以压缩命令截断在途操作。
- 结果展示压缩前后字符数；没有可压缩的旧消息则明确返回无需压缩。取消、超时、来源/配置变化或预算失败保留原始历史，失败不谎报压缩成功。摘要可能丢失细节，原历史仍为事实来源，不能保证语义无损。
- 成功后复用进程内摘要前缀，加上后续新增原文；新输入低于触发阈值时不重复请求摘要模型。再次接近阈值时从原历史重新生成，避免反复压缩摘要导致误差累积。缓存绑定原会话、源配置、模型版本、完整策略及前缀内容/身份/状态摘要，使用和最终发送前重验原来源。不同会话、撤回、更正和模型/策略变化不能沿用旧摘要。缓存限 20 个会话，关闭和副本清除会释放；不持久化摘要正文，重启后重新生成。
- 主对话委派的执行子任务通过 Runtime 原 `readDelegatedUserTaskParent` 验证来源主会话身份后复用其摘要；发送与出机许可仍绑定实际执行任务。独立子智能体追加会话继续使用自己的原生历史与自动阈值，不借用其他会话缓存。手动命令入口为主对话；独立子对话仍沿原消息语义。
- 模型凭据、精确出机确认、取消及截止时间沿原宿主。自动触发不代表取消出机确认；新材料仍走既有授权卡。没有辅助模型时明确提示配置，不能把 AgentArts 主模型或本地模型自动当成摘要模型。

兼容性：无 Core wire、Schema 或数据库迁移；仅增加 host-only 压缩选项和过程内缓存。保留原 TaskRuntime 检查点摘要、来源重验和重启漂移拒绝语义。自动预算和命令测试、真实服务边界见本轮验收记录；本实现不等于已配置用户摘要模型或完成真实云验收。

### 本轮验收记录

- 独立工作树完整 `npm run build` 通过；最终定向 Runtime / Desktop 六文件回归 132/132 通过（`.cache/context-tests-complete.log`）。初轮发现的 DOM 测试节点范围及不成立的 Token 单调假设已修正。
- 定向命令：`node --test --test-concurrency=1 apps/runtime/test/context-compaction.test.mjs apps/runtime/test/context-compaction-model.test.mjs apps/desktop/test/harness-context-host.test.mjs apps/desktop/test/harness-context-integrity-compat.test.mjs apps/desktop/test/model-api-controls.test.mjs apps/desktop/test/harness-main-composition.test.mjs`。合成来源、模型响应和注入 HTTP；未调用真实账号或摘要模型。
- 覆盖字符阈值边界、手动命令、原主会话到实际委派子任务的缓存复用、跨会话/配置/来源隔离、命令取消、普通引用文本不会误触发及在途任务不会被压缩命令打断。
- 首次整仓检查发现测试 PATH 缺 PowerShell 7 / OpenSSL，另有目录探测超时断言失败。补齐测试进程路径后，`npm run check` 的架构、契约夹具、生成类型、构建/类型检查通过；Runtime 1173/1173 通过，Desktop 1796 通过、1 项邮件等待超时、10 项跳过，其他 workspace 无失败。整仓命令返回 1，不能宣称全绿（`.cache/full-check-r2.log`）。真实服务与专用宿主缺失的跳过项不计为真实验收。
- 用户要求不处理邮件；未修改邮件实现。该指示到达前已启动的单文件复跑返回 0，之后不继续排查。根 `npm run test:integration` 单独补跑 57/57 通过（`.cache/integration-check.log`）；该结果不改写整仓命令的失败记录。最终 `git diff --check` 通过。
- 本次未修改本机正式用户配置、未启动新生产版本、未上传镜像或发布云端；未提交、推送或创建新的 PR。正式使用须运行本分支并配置明确的辅助模型与出机许可。
- 推荐每段 32,000 字符按完整消息划分，单条历史消息超过此限制时明确失败，须按摘要模型实际能力调整预算；超过 2,000 条来源同样不会静默截断。字符预算与模型 Token 容量分别校验，缺计量器时仍标记 `unmeasured`。

目标 Profile 为 `huawei_ict_agentarts`。本包增强原 Coordination 与持久子智能体会话的历史输入，不新增任务库、模型调度器、执行循环或授权入口。主对话保留交互、澄清与汇总，实际执行继续由原产品子智能体负责。

## 实际消费路径

`RuntimeApplication.executeCoordination` 在原历史合资格过滤之后、最终 `compileCoordinationGoal` 之前消费受信 `coordinationInput.contextCompaction`。未配置时保留原行为。配置显式指定策略版本、触发/目标/最终字符预算、原尾部保留数量、来源范围、分段与摘要上限，以及原模型配置引用；不新增默认 token、步骤、金额或耗时预算。Token 检查复用原受信计量器，缺失时仍标记 `unmeasured`。

持久子会话直接同步重读原 `readSubagentConversationContext`；启用时使用显式范围，避免此前提前截成二十条。普通合并 overlay 必须由宿主另提供同步 `readSnapshot`；只有异步读取 hook 时压缩不可用。摘要只覆盖历史问答；原当前目标、prepared goal、system 和 `request.continuation` 保留。不能从消息正文猜测原生工具调用配对，实际工具结果仍由原 `competition-loop.receipts` 与 continuation 路径承载。

摘要投影保留在进程内，以 `derived_conversation_summary` / `untrusted_data` 的会话消息参与最终序列化。原 TaskRuntime 检查点只保存完整来源范围、逐来源任务引用的哈希、原尾部/摘要哈希、策略、配置与预算回执；最终编译绑定包含该回执的摘要。没有另存原私人正文或摘要正文。原删除/失效过滤继续作用于来源；提交检查点前和实际云发送前均同步重读来源，撤回、变更、取消、到期或摘要无进展/仍超预算均拒绝。

重启不从哈希恢复摘要正文。重新摘要必须仍匹配完整原来源与原回执；生成内容漂移时原编译绑定拒绝替换，须新建任务，而不能把旧回执冒充新摘要。

## 模型宿主适配

`createContextModelSummarizer` 只接公开 `ModelPort` 身份，固定摘要 system，材料作为不可信 user 数据，`tools: []`，拒绝工具提案、配置/部署漂移和输出溢出。精确材料出机须经过 `authorizeModelRequest`；原 deadline / signal 贯穿等待，取消时即使底层慢响应也不继续提交。不自动重试，不自选模型，不回退 Provider。

通用 `ModelPort.complete` 没有凭据等待后的最终来源门禁契约，因此独立使用该 port 时明确 `UNSUPPORTED_CAPABILITY`。宿主必须显式提供 `guardedComplete(request, beforeSend)`，在所有凭据等待结束之后、实际 Provider 发送之前同步调用该次 `beforeSend`。可复用现有 Provider 的受信 `fetch` 注入口：每次摘要独立创建 Gateway/Provider，让该次 fetch 闭包调用 guard 后转发真实 fetch；不能在多个并行请求间共用可变 guard。此组合不要求修改公共 Models 协议。

## Desktop 宿主配置与消费

`apps/desktop/electron/harness-context-host.js` 已由 `main.js` 的原 `coordinationInput` 消费。原 Desktop 历史读取同步重读 Conversations、Live、Runtime 和当前公开事实投影；启用时使用显式范围。原 Skill 提交前预检仅为可压缩历史保留后续摘要机会，当前 goal 与不可压缩原尾部仍须符合最终字符预算，实际摘要与整段预算由 Runtime 在确认出机后检查。

用户从现有「模型 → 开发者 Harness」设置区选择与保存。配置存入原 `model-api-config.json` 的 safeStorage 加密 envelope 的可选 `harness` 字段，不增加第二配置注册体系或环境变量产品入口。旧配置缺少该字段时默认关闭。该区同时管理原生开发任务规划的执行总步骤预算和历史摘要设置；工作区仍使用「电脑操控」中已选择并授权的编程工作区。每次保存检查原 revision 并生成新版本，旧任务/旧摘要端口随版本变化失效，下一任务通过动态受信 resolver/getter 使用新配置，无需重启桌面。启用字段如下：

| 字段 | 含义 |
| --- | --- |
| `version`、`revision` | 兼容原 envelope 的可选配置版本 `1`；保存时生成 CAS 版本 |
| `enabled`、`maxExecutorSteps` | 明确启用原生开发任务规划及其执行子智能体总步骤预算 |
| `context.enabled` | 明确启用历史摘要；下列模型/预算字段属于 `context` |
| `modelId`、`configurationRef` | 模型设置中已明确配置的辅助模型及精确版本；不读取隐式默认模型 |
| `maxOutputTokens` | 该摘要模型的显式输出预算 |
| `policy.version` | 主进程随保存版本生成的受信压缩策略版本 |
| `policy.triggerCharacters`、`targetCharacters`、`maxCharacters` | 触发、目标、最终字符预算；最终预算不超过 128000 字符边界（2026-10-22 按 ADR-0037 扩容）；旧显式较小预算仍有效 |
| `policy.retainMessages`、`maxSourceMessages` | 完整尾部保留数量及最大来源消息范围 |
| `policy.segmentCharacters`、`maxSummaryCharacters` | 每段完整原消息材料与每段摘要的显式字符预算 |
| `events.enabled`、`events.quiet` | 原持续责任事件接入与静默偏好；不授予来源、工具或模型权限 |

Harness 配置不重复存 API Key。Key 继续由原加密模型设置托管。每段原文通过既有本机精确出机确认显示用途、实际 Provider/Endpoint/model/配置版本及完整请求；取消即不发送，原 AgentArts 或私人记忆许可不会自动转授给摘要模型。私人任务绑定直接拒绝，摘要只处理合资格的先前历史。`model-api-config.js` 的 `getGuardedModelGateway` 每次创建独立模型端口和 fetch 闭包，真实 fetch 前复核原模型配置和该次来源，不在并发请求间共享 guard。没有独立 guarded factory 时保持不可用，不把普通 `ModelPort.complete` 当作已受最终门禁保护。

## 验证与剩余限制

`apps/runtime/test/context-compaction.test.mjs` 与 `context-compaction-model.test.mjs` 包含纯端口与实际 Runtime/Coordination 消费的 Synthetic 验证：完整尾部、来源变更/撤回、取消/到期、凭据等待后的最终发送拦截、预算与无进展、重启哈希/摘要漂移、超过二十条的原持久子会话，以及当前真实工具 continuation 原值保留。测试不调用真实模型/云，不构成真实平台验收。

`apps/desktop/test/harness-context-host.test.mjs` 包含真实公开 ModelGateway/OpenAI Provider 和注入 Synthetic HTTP 的 Desktop 宿主链验证场景：精确目的地/材料确认、凭据等待后撤回零发送、并行独立门禁、配置撤销、原私人绑定拒绝、提交前预检和整个 Runtime 消费。2026-10-23 已纳入上述六文件联合回归；设置控件使用测试 DOM 验证，尚未完成实体桌面渲染验收。它不调用用户真实模型、不读取用户 Key，也不等于真人确认、真实云平台或实体设备验收。Desktop 默认关闭；启用需上述明确配置与逐段出机确认。真实摘要模型、AgentArts 平台整图及实际开发任务验收另行记录，接口维持 provisional。
