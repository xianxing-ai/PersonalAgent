# MOD-30：三 PA 工作流恢复与普通目标参数化方案

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；负责人：zemeng；状态：云提示与原实例部署已完成，非会议实调及评审待完成。
- 范围：现有三个 PA 工作流及控制器的配置恢复、输入输出约束与验收顺序。
- 依赖：MOD-29 的同一已发布 AgentArts 应用与部署读回，MOD-04B 的
  `CloudAgentPort` 适配器，MOD-05 的本地 Policy/ToolGateway；知识、MCP/Skill
  需各自真实提供者和验收。本文不创建第二套工作流运行时或公共 DTO。

## 当前证据与缺口

[`MOD-29～31 构建记录`](../modules/MOD-29-31-AGENTARTS-MULTI-AGENT-BUILD.md)
及其机器可读回执证明三个源工作流的历史身份、版本和起始／默认／结束路由。
2026-09-25 的本机合成验收记录进一步读回：世界状态影响分析、计划最小修复、
证据安全审查的源工作流及输入输出绑定仍在；证据安全审查的严格输出版本已保存，
控制器已提交新版本，原 runtime 显示正常。同日同一合成会议任务中，两个独立云
invocation 分别产生 `tool_proposal` 和 `repair_candidate`，本地批准、工具读回、
图 CAS 与同库重启均成功。该回执保存在本机忽略目录，尚未形成可移植的请求级
部署版本或跨目标评估证据。控制器画布仍可见六个引用，不能仅凭节点数量推断
已发布版本调用了重复节点；恢复时要分别读回草稿、已提交版本和实际运行 trace。

当前仓库实现有明确的场景耦合：`packages/coordination/src/agentarts.ts` 的
`candidateContinuationQuery` 固定要求从 `continuation.result` 的“会议变更”
生成候选；[`原始云配置交接`](../../tests/manual/agentarts/TOOL-INVOCATION-CLOUD-PROMPT.md)
固定了会议文件路径和提案 ID。`workflowGoalInput` 只能把一个 goal 字符串映射到
一个开始节点变量；它没有解决任意多变量 Workflow 的输入绑定。当前成功只覆盖
会议变更，不证明普通目标会选择正确工具、跳过不必要工具或生成合法修复。

## 恢复同一云应用的顺序

三段源系统提示词、输入输出绑定、控制器提示词与当前画布引用的版本 ID 已按
2026-09-25 控制台只读结果保存在
[`MOD30-PA-WORKFLOW-RESTORE.md`](MOD30-PA-WORKFLOW-RESTORE.md)，可用于逐项比对和恢复。

由同一名云配置持有者串行操作，不与 MOD-29 的部署、MOD-31 的评估并发改实例。
先只读记录当前应用、runtime、三个源工作流、控制器的草稿／已提交版本、实际
部署绑定、开始／默认／结束路由、各节点输入输出引用与最新 trace。保留已通过
合成链的版本作为回退点；不能用 `resource_version=draft` 或页面“部署成功”
替代运行实例的版本读回。若六个引用中有未路由重复节点，逐一确认其是否进入
已发布执行路径；只清除确认冗余的草稿引用，再重读路由，不直接覆盖已通过版本。

三个 PA 的职责保持分离：影响分析输出受影响引用与依据；最小修复只基于实际
图快照给出 KEEP／RECHECK／REVISE 建议；证据安全审查决定最终
`workflow_end.answer` 的严格应用协议，并拒绝云自报授权、执行和 Evidence。
先核对最终节点实际收到前两段结果的变量引用，随后在草稿中参数化提示，
读回草稿和版本差异，再提交／部署。若输出或路由不符，恢复前述可用版本，
重新读回 runtime 绑定；不得以本地 Fake 或 Local Profile 冒充恢复成功。

## 普通目标的参数化边界

1. **首次请求**：受信宿主按目标选择已授权、最小化的上下文，云端在
   `kind:'text'` 与严格 `kind:'tool_proposal'` 之间选择。提案 ID、工具名／版本
   和参数来自本次目标及已公布能力，不复制合成会议的固定 ID 或文件路径；
   云端提案不授予权限。未知能力、参数不全或无须工具时返回简短文字，不能
   猜测私人内容或虚构本地读回。
2. **工具结果续接**：只在本地 Policy 批准、ToolGateway 执行且目标系统确认后，
   受信宿主才以现有 `CoordinationContinuation` 发送明确选择的有限投影。
   `proposalId`、状态、工具版本、参数摘要、出机规则版本和任务 deadline
   仍由 Runtime 校验；两次 invocation 仍是两个云请求，不能宣称同一云 run 恢复。
3. **计划候选**：只有宿主提供本次真实图修订、允许目标 NodeRef、允许依赖
   FactRef／NodeRef 与所需目标摘要时，云端才可返回现有版本化
   `repair_candidate`。缺合法上下文返回 `kind:'text'`。云不能选择未提供的
   节点、编造 revision、改变未受影响计划或携带 verification／Evidence／授权。
   本地严格 parser、预览、独立批准与 CAS 是唯一提交路径。

云工作流提示应表达上述规则及真实可用的变量引用，不嵌入某个合成样本的值。
MOD-04B 需单独评审并移除 `candidateContinuationQuery` 中的“会议变更”假设，
在现有 8192 字节出机上限、`beforeSend` 末端门禁和严格结果 parser 下消费
参数化投影；本工作包不编辑该适配器。若普通目标需要新的可信输入字段，
先由 MOD-04B 与 Runtime owner 协调兼容性，不能在云提示里私设协议。
工具清单、知识与本地 MCP/Skill 只按真实已注册、可授权并可读回的能力开放。

## 后续验收与交付

先用现有合成会议回执作回归基线，不重复运行已通过的完整链。参数化版本发布后，
按实际改变选择最少的真实验收：一个无需工具的普通目标、一个不同于固定会议文件
的受限只读目标，以及一个有合法图上下文的不同事实类型修复目标；再检查缺上下文、
拒绝或撤权时无工具执行／无续接。每个目标分开记录已部署版本、两次请求各自
trace／usage（如发生续接）、最终严格输出、本地批准、目标读回和 Evidence。
多 Agent 的路由／交接、知识、MCP/Skill 和效果评估须各自形成证据，不能由会议
主链一次成功推导为全部 MOD-30 或 Competition MVP 完成。

本工作包无公共接口、迁移或依赖修改。2026-09-25 的实际云配置、版本发布、
原运行实例读回见
[`MOD30-PA-WORKFLOW-DEPLOY-20260925.md`](MOD30-PA-WORKFLOW-DEPLOY-20260925.md)。
仓库文档评审不能代替请求级 trace 或非作者评审。
