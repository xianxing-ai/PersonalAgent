# MOD-30-COMPETITION-EXPORT-01：受信合成结果出机

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-11/13/30 的 Runtime 消费端增量。
- 实现：zemeng 委派集成执行者（Git/GitHub `zemeng5208`）；评审：待 goo122 或另一位已登记非作者。
- 状态：review；不代表真实云工具循环或整个 MOD 完成。
- 基线：main `c5c4ada` + PR #99 `2630c94` 的 Workflow 输入适配。

以下保留该基线的历史行为与验收；当前源码上限、消费接线及未合并增量见末节。

## 最小行为与兼容

既有 `tool_proposal → waiting_approval → allow_once → ToolGateway → continuation`
保留。`RuntimeApplicationOptions.competitionToolExports` 是受信进程内组合配置，
不来自 Renderer、云提案或 wire 请求。缺省继续拒绝 `unverified` 工具提案。

每项配置固定 `toolName`、`toolVersion`、`exportPolicyVersion`；规则变化必须更新后者。
`accepts({taskId, proposalId, arguments})`
必须显式选择本次合成输入，注册 descriptor 必须为 `read`。配置仅许可结果出机，
不能代替 Runtime/Policy 的用户审批。审批恢复时重新检查出机选择，仍沿用原始 deadline。

执行确认后调用 `project({taskId, proposalId, result, signal})`，仅把其纯 JSON 输出放进
既有 `CoordinationContinuation`；包含 proposalId/state/result 的整个 JSON 最多 8192 UTF-8 字节。投影异常、非法 JSON、超限和取消
均阻止 continuation，错误使用固定文本，已产生的本地执行记录和 Evidence 保留。
投影不接收 grant、scope 或 Evidence 内容。合成选择及字段白名单是受信宿主责任，
不得将任意私人文件读取配上原样回传函数。

同一任务的已确认 proposal ID 保存到既有 `competition-loop` checkpoint：
相同提案重放已裁剪结果，参数/工具/版本或 verification 改变则拒绝，不重复审批或执行。
receipt 同时保存出机规则版本，重启后缺失或版本不同直接拒绝旧投影，不重新执行工具。
异步投影完成后、实际适配器调用前再次检查动态出机范围、取消信号及期限。
没有数据库迁移、新 wire DTO、Policy 改动或 capability。旧 checkpoint 缺少 receipts 时
按空列表兼容；本地 Fake 的 mock 路径保持原有行为。

`createAgentArtsRuntimeApplication` 另透传 PR #99 的 `workflowGoalInput`：
省略保持 `{query: goal}`，配置后由 adapter 发 `{inputs: {[name]: goal}}`。

消费 PR #103 `bcee4d7` 的显式 `responseMode: 'tool-proposal-json'`（缺省 `text`）：
云调用一输出无授权字段的 JSON 工具提案；Runtime 审批与投影后发起新的云调用二，
仅发送 confirmed continuation。两个调用共享本地 task，独立 Request-Id，不称同云 run 恢复。
factory 注入同步 `beforeSend`：凭据读取后、实际 fetch 前重新核对当前任务 running、
原 deadline、持久 receipt/投影、规则版本、最新 accepts 与 signal。mock receipt 不能通过真实出口。

## 验证与证据边界

- Node 24.15.0；依赖安装使用 npm 11.16.0（与仓库 npm 11.12.x 有版本偏差）。
- 定向 Runtime 测试覆盖：默认拒绝、审批、task/版本/输入绑定、只读限制、出机撤销、
  一次执行与重复 approval/proposal、冲突、期限、拒绝、取消、非协作投影取消、8KiB、
  非 JSON、敏感错误不回传、本地 Evidence 和 Workflow 输入透传。
- `npm run check` 首次完成架构/契约/生成类型、全部构建/类型检查及其余 workspace 测试，
  Runtime 为 89/90：既有 100ms deadline 测试受并行 SQLite 启动延迟影响，适配器尚未开始就过期。
  固定该测试提交时钟，保留真实 timeout timer 和原断言后补跑 Runtime 90/90、integration 11/11；
  未重复全套。未运行 Electron、真实模型、云浏览器或长期服务。
- 评审修复定向验证 36/36：包含投影期间撤权、磁盘重启后收紧规则拒绝旧投影、原工具不重做；
  已纳入 PR #99 的 `cfdb170` Workflow 终态配对修复。
- 最终 fetch 门禁与两个 HTTP invocation 的 factory 消费定向 31/31 通过，包括凭据等待时撤权
  后零第二次 fetch。HTTP 均为合成夹具，不是线上 AgentArts 成功证据。
- 所有网络响应与提案均为显式离线夹具；`unverified` 测试输入不代表真实 AgentArts 已支持工具事件。

## 尚缺的真实链路

PR #103 的多 invocation JSON 模式已有消费验证；真实平台提案/工具/后续总结仍待单独验收。
同云 run 原生暂停/恢复仍 unavailable。本片提供本地可信门禁，
不会把云文字成功解释为工具执行完成，也不会回退 Local 或把真实调用标 mock。

PR #78 的 loopback MCP 桥不在本 PR 中整体引入。历史桥只支持预创建、已批准、running 的任务。
若直接在 `CoordinationPort.execute` 的 HTTP 请求里等待 MCP 审批，
`RuntimeApplication.send(authorization.respond)` 又等待活动任务完成，会形成生命周期互等。
需要另一个明确的 Runtime 主持挂起/恢复工作包及真实云运行关联，不能由 Desktop 私建循环。

后续 HTTPS 方案交主控协调：仅绑定 loopback，单次合成运行、短期随机 token、固定只读工具、
显式字段投影、到期/取消关闭；公开入口与隧道服务确定并完成审批生命周期后才联调。
本片没有打开公网入口、读取凭据、暴露 Shell/私人文件或变更平台法律承诺。

## 2026-10-07 消费完成矩阵

main `4b5ec61` 已有下列实现；[PR #302](https://github.com/zemeng5208/PersonalAgent/pull/302)
尚未合并，本节分开登记。没有新 wire DTO、授权协议或存储迁移；本轮没有真实云验收。

| 边界 | main 已有实现 | #302 未合并增量 |
| --- | --- | --- |
| 提案与确认续接 | [coordination.ts](../../apps/runtime/src/application/coordination.ts) 主持原 Policy/审批/ToolGateway、持久 receipt、出机投影和发送前复核；已确认工具不因续接重放而重做 | adapter 冻结自己的 continuation 副本，让 guard 与已序列化发送内容一致；不冻结 caller 原对象 |
| 初始目录 | [tool-catalog.ts](../../apps/runtime/src/application/tool-catalog.ts) 从任务绑定的已注册工具及 native worker 选择精简目录，提案和发送前重新检查；目录不授予执行权限 | 单工具/provider 异常只影响该项；原 caller 取消/期限仍约束整个调用。三处 worker describe 使用有界读取并重核 name/version，保留有限 signed minimum/maximum |
| 输入 JSON | [公开 parser](../../packages/coordination/src/index.ts) 已有提案、目录和确认续接预算及严格结果类型 | 复制提案时共用预算、严格 dense own-data 数组与固定反射错误，保留合法 JSON 特殊键 |
| 默认子任务 | [subagent-host.ts](../../apps/runtime/src/application/subagent-host.ts) 使用原 Runtime 子任务、Competition worker、审批与确认回执，不建立第二调度器 | 重放时保留父取消，合法特殊 JSON ID 按 own key 读取；候选模式参与配置绑定，见 [MOD-29 兼容说明](MOD-29-AGENTARTS-RUNTIME-INTEGRATION.md) |

当前预算以公开 parser 为准：工具目录最多 **64 项 / 24,576 UTF-8 JSON 字节**；
确认 continuation 的完整 JSON 最多 **1,048,576 UTF-8 字节**；提案 arguments 为
**65,536 UTF-16 code units**。原文 8 KiB 记录是历史限制，不能当作当前上限。
main 已有目录 opt-in 路径可包含受信注册的写工具；实际执行仍须本地 Policy/审批，
结果出机仍须独立绑定与投影，不能据此扩大历史只读合成夹具的授权。

已有 CloudSkill/native worker 消费是本地受信契约接线，不证明真实 AgentArts 已执行
MCP/Skill。原生同云 run 恢复仍 unavailable；confirmed continuation 发起新的 invocation。
下一真实验收须逐项关联同一任务的提案、原审批/执行读回、最小出机投影及独立云请求，
并覆盖撤权、取消/期限和失败核实；保留原 confirmed 记录，不盲目重发或扩大外网入口。
