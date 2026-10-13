# AgentArts 文字 MVP 继续入口

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

目标 profile：`huawei_ict_agentarts`。工作包：MOD-04B/29/30/32 文字适配；负责人
zemeng，非作者评审待 goo122 或另一位已登记协作者完成。接口仍为 provisional。

## 当前修复与证据边界

从 main `c5c4ada` 选择性重建 #51/#78 的 coordination 文字增量，不合并旧堆叠：

- 有 workflow_start/workflow_end 的响应只选择最后一个已完成工作流的 answer；必须
  随后看到 task_end、end，错误事件仍覆盖候选答案。新工作流开始会清除旧候选。
- 当前仅支持串行工作流。交错 start、没有 start 的 end，以及两端都提供的
  workflow_id/workflow_name 不一致时拒绝；不按最后到达顺序推断并发工作流成功。
  部分身份字段省略时只按唯一活动的串行工作流配对，不推断供应商并发语义。
- 显式 workflow_start 划分 message index 的作用范围；同一范围内 index 对应不同
  正文仍拒绝。累计 message 文字预算、单个 answer 预算和响应字节上限均保留。
- 受信宿主可选 `workflowGoalInput`，把 goal 映射到一个 Workflow 开始节点变量；
  省略时保留 `{query: goal}`，配置时只发送 `{inputs: {[name]: goal}}`。
- 纯文字适配器拒绝 continuation，不能忽略已执行工具的结果后重新发送原问题。

历史 #51 的 `2026-09-17-runtime-index-conflict.json` 证明 HTTP 200、完整 SSE、
ordered task_end/end 和全局 index 冲突，但未证明冲突发生在工作流内还是工作流间，
也未确定生产解析器首个拒绝分支。`2026-09-17-runtime-text-success.json` 的名字
不表示 Desktop 成功：云端调用成功，但两次 Desktop 调用均 EXTERNAL_FAILURE，
同库重启只读回失败终态。不能把旧离线夹具通过视为本次真实故障已修复。

## Runtime/Desktop 接线（由对应负责人实施）

Runtime 的 `createAgentArtsRuntimeApplication` options、解构和 AgentArts config
需透传可选 workflowGoalInput。Desktop 从受信启动配置提供该值，不能让 Renderer
或云输出决定配置。Competition task.submit 应传入 180000ms deadline；历史真实
调用约 70–90 秒。保留 main 的工具装配、取消和数据路径行为，不能整段覆盖旧文件。
多 Agent query 入口与单 Workflow inputs 入口须按实际部署选择，不能自动猜测或重试。

## 验证顺序

1. 构建 contracts、coordination，运行 coordination 单测、类型检查与架构门禁。
2. 在主控安排的资源时段，以单个 Node 进程和受信凭据发起合成文字调用；不记录
   Authorization、原始响应、正文、工作流名称或私人数据。不做自动重试。
3. 若仍失败，记录状态码、固定事件类别/字段类型/顺序、字节与文字长度、index 冲突
   的工作流作用范围及确切拒绝分支，再决定解析器修改。未知结构不能直接放宽校验。
4. 由集成执行者验证 Desktop → Runtime → 真实 AgentArts 的文字展示、持久化；
   关闭后从同一数据库重启，不提交任务、不读凭据、不发网络请求，读回相同结果。

云端文字一律 `unverified`；不产生 trusted Evidence，不扩大 Policy，不回退 Local。
真实工具循环、云端 trace/usage、Desktop 成功和同库重启分别记录，未验收不标 done。

## 2026-09-24 本工作树离线验证

- contracts、coordination build 与 coordination typecheck 通过。
- coordination 单测 73/73、架构门禁 3/3、git diff --check 通过。
- 原 npm 测试在沙箱中因 spawn EPERM 未执行用例；最小权限重跑同一脚本后通过。
- Node 26.3.0 / npm 11.16.0；未按仓库指定 Node 24.15.x / npm 11.12.x 验证。
  仅安装两个 workspace 的必要依赖并忽略安装脚本，未修改锁文件。
- 随后定位到既有 Node 24.15.0；用该版本运行相同 coordination 测试（单进程
  `--test-isolation=none`）73/73 通过；npm 11.12 仍未验证。
- 本记录不包含本日真实 API、Desktop 或同库成功结果重启验收。

## 不含内容的单次诊断

`support/run-text-probe.mjs` 是显式手工入口，使用与 Desktop 一致的受信进程环境
PA_AGENTARTS_AUTHORIZATION / PA_AGENTARTS_GATEWAY_URL / PA_AGENTARTS_RUNTIME_NAME，
可选 PA_AGENTARTS_WORKFLOW_GOAL_INPUT。缺配置只报告 not_configured 且零网络请求。
凭据由本机受信宿主配置，不贴入聊天、命令参数或提交文件。它只提交内置合成场景，
最多一个 HTTP 请求，180 秒 deadline，无自动重试、无工具、无 Electron。

`support/text-response-diagnostic.mjs` 的 fetch 包装器将原字节交给生产适配器；在
内存中额外保留至多 1 MiB。完整接收后，以同工作树编译后的解析器代码片段进行
诊断重放，记录该编译文件 SHA256、固定拒绝类别、类型/计数/长度/终结顺序及
global/workflow index 冲突数。此重放不做网络请求、不改变生产接受条件，也不代表
Runtime 或 Desktop 验收。片段来自受信本地构建文件，云响应始终只作为数据。
若构建布局变化会显式 diagnostic_internal；未知错误不会输出原始消息。

重放的 `strictCompletion` 默认 false，与 [文字探针](support/run-text-probe.mjs) 的
默认 text 模式一致；[提案](support/run-proposal-probe.mjs)与[候选](support/run-candidate-probe.mjs)
探针显式传 true，沿其 JSON 模式检查 SSE 完成顺序。`workflow_order` 也涵盖
task_end 后正文、[DONE] 后事件的既有拒绝原因，不将它们记成诊断内部故障。

文字诊断的结构计数支持 JSON 响应及完整 JSON data 行中的事件对象或数组；标准
多行 SSE 标 not_fully_inspected，但仍由实际解析器重放。另一个
[结构观察器](support/structural-fetch.mjs)不检查 SSE 事件数组的成员，其
`indexedMessages.coverage` 标 partial，不能据零冲突计数声称全流无冲突。
这些覆盖标志不允许把部分统计推断成完整事件证据。输出只含白名单
类别和数字，不保存响应正文、工作流名称、Authorization 或请求 ID。报告保存在
忽略的 `.cache/agentarts-text/`；人工复核后才选择性加入真实验收记录。

Node 24.15 上诊断测试 5/5 通过，覆盖作用范围、标准多行 SSE、内容不泄漏、
错误原因白名单及包装后生产结果一致；测试命令：
`node --test --test-isolation=none tests/manual/agentarts/support/text-response-diagnostic.test.mjs`。

Chat 静态审查提出 start(A) → start(B) → end(A) 可能提前成功；已用行为回归
复现（修复前 Missing expected rejection），加入串行配对拒绝。Node24.15 重新构建
coordination 后，受影响 adapter 与诊断测试 51/51 通过；身份字段按可用交集比较的
最后调整又通过3项定向回归。该模型审查不替代已登记协作者批准。此修复没有真实云响应证据，
不能扩大为通用并发工作流支持。
