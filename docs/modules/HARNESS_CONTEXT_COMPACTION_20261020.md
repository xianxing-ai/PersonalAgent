# 原生 Harness 会话上下文压缩（2026-10-20）

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

`apps/desktop/test/harness-context-host.test.mjs` 包含真实公开 ModelGateway/OpenAI Provider 和注入 Synthetic HTTP 的 Desktop 宿主链验证场景：精确目的地/材料确认、凭据等待后撤回零发送、并行独立门禁、配置撤销、原私人绑定拒绝、提交前预检和整个 Runtime 消费。当前整段实现优先，最终联合回归和新增设置页渲染 QA 待全部接线完成后统一执行。它不调用用户真实模型、不读取用户 Key，也不等于真人确认、真实云平台或实体设备验收。Desktop 默认关闭；启用需上述明确配置与逐段出机确认。真实摘要模型、AgentArts 平台整图及实际开发任务验收另行记录，接口维持 provisional。
