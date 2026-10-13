# MOD-30／MOD-04B：普通非会议目标的最小合成协议包

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`；负责人：zemeng。此包供 MOD-30 云工作流与
MOD-04B 现有适配器／Runtime 消费端对齐。它是**待接线约定**，尚未改动
`packages/coordination`、云实例或受信出机策略；不能据此宣称普通目标已可用。
现有合成会议版本的逐字恢复材料见
[`MOD30-PA-WORKFLOW-RESTORE.md`](MOD30-PA-WORKFLOW-RESTORE.md)。

## 最小非会议场景与数据

在隔离的、由宿主明确授权的合成工作区内准备 `demo-inventory.json`，内容仅为：

```json
{"item":"demo-part","quantity":4,"revision":2}
```

首次目标只要求读取该合成文件并报告已确认数量：

```text
合成验收：请提出 workspace.read_text@1.0.0 的本地只读提案，路径为已授权合成工作区内的 demo-inventory.json；经本地确认后核实 demo-part 的数量和 revision，再简短报告。不要猜测文件内容，不要声称云端或本地已经执行。
```

该样本不含真实库存、账号或私人资料。路径只是本次目标参数，不是产品内置
常量。宿主必须先登记准确的授权工作区、`workspace.read_text@1.0.0`、
本次允许的单一路径及最小结果投影；未满足时不能以宽泛路径许可代替。

## 三段严格输入／输出

1. **第一次云 invocation**：现有 JSON 模式发送 `{query: goal}`，或在已核对
   Workflow 开始节点单变量绑定后发送 `{inputs:{[workflowGoalInput]:goal}}`。
   云端最终 `workflow_end.answer` 只允许提出一个无授权字段的建议，例如：

   ```json
   {"kind":"tool_proposal","proposalId":"inventory-read-1","toolName":"workspace.read_text","toolVersion":"1.0.0","arguments":{"path":"demo-inventory.json"}}
   ```

   `proposalId` 只标识本次提案，不是固定产品 ID；重复同 ID 且参数不同应由本地
   拒绝。模型输出不得附 `verification`、`grant`、`scope`、Evidence 或任务终态。
2. **本地执行与第二次请求**：仅当原任务在期限内、本地批准有效、Policy 和
   ToolGateway 完成一次只读执行、目标内容得到确认，宿主才可按专属
   `competitionToolExports` 规则裁剪为以下有限投影并送出：

   ```json
   {"continuation":{"proposalId":"inventory-read-1","state":"confirmed","result":{"item":"demo-part","quantity":4,"revision":2}}}
   ```

   这是拟定的**合成投影形状**，须由宿主从本次可信工具结果生成并校验，不能
   直接把任意文件正文或云自报值作为 `result`。规则版本、当前 `accepts`、
   持久 receipt、取消和 deadline 仍由既有最终 `beforeSend` 门禁复核。
   第二次是新的云请求；不冒充原生同 run 暂停／恢复。若拒绝、撤权、读回失败
   或投影失效，零续接、零第二次 fetch。
3. **最终云输出**：该目标没有图谱快照或允许修复节点，正确输出仅为
   单个 `kind:'text'` JSON；正文只可说明本地确认投影中的 item、quantity、
   revision，例如：

   ```json
   {"kind":"text","text":"本地确认的合成记录中，demo-part 数量为 4，revision 为 2；没有提交计划修改。"}
   ```

   不得产生 `repair_candidate`、第二个工具提案、Markdown 包装或八字段审查报告。
   缺字段、值不一致或注入内容时返回 `kind:'text'` 说明无法确认，不补造事实。

上述 JSON 均为云端**预期**或宿主**拟定**的接口样本，并非真实云回执。云响应
必须由 `parseCoordinationResult` 及 Runtime 再校验；云不能设置 `verification`，
本机补入 `unverified`，可信工具 Evidence 与云结果分开记录。现有 `8192` UTF-8
字节的完整 continuation 限额和本地批准／出机许可不因样本变更而放宽。

### 修复候选泛化的第二个合成样本

上面的库存样本没有图上下文，只能验证 `tool_proposal → text`。为核对 MOD-04B
去掉固定“会议变更”后的候选输出，另用**合成交付截止时间变化**；以下对象仅是
由 MOD-04B 提供的最小协议样本，数值不是现有数据库读回，不能直接用于真实提交：

```json
{"continuation":{"proposalId":"synthetic-deadline-read-1","state":"confirmed","result":{"deliverableId":"synthetic-deliverable","newDeadline":"2026-10-02T17:00:00+08:00","repairContext":{"expectedGraphRevision":7,"targets":[{"node":{"id":"synthetic-review-step","revision":1},"requestedSummary":"Review deliverable before 2026-10-02 17:00","requestedDependencies":[{"id":"synthetic-deadline-fact","revision":2}]}],"allowedDependencies":[{"id":"synthetic-deadline-fact","revision":2}]}}}}
```

若且仅若受信宿主真实绑定了该 graph revision、目标和依赖，云端才可建议：

```json
{"kind":"repair_candidate","candidateVersion":"1.0","candidate":{"expectedGraphRevision":7,"changes":[{"node":{"id":"synthetic-review-step","revision":1},"summary":"Review deliverable before 2026-10-02 17:00","reason":"Confirmed synthetic deadline is 2026-10-02 17:00 (+08:00).","dependencies":[{"id":"synthetic-deadline-fact","revision":2}]}]}}
```

`expectedGraphRevision`、原 `node`、`requestedSummary` 和
`requestedDependencies` 都逐项来自本次受信投影；`reason` 只解释已确认数据。
本样本缺少真实 Fact/Evidence 与本地绑定，故目前只能静态对照协议，不能
跳过本地严格 parser、预览、批准与 CAS，也不能据此宣称候选真实验收。

## 云草稿的最小提示词修改点

保留三 PA 的现有事实分析、最小修复和安全审查职责，以及
[`恢复包`](MOD30-PA-WORKFLOW-RESTORE.md)中的安全边界。只在最终证据审查
工作流的固定会议 A/B 分支和控制器第二段中，改用以下**条件**；配置者先
保存旧版本并对照实际变量引用，再串行修改同一云应用：

```text
首次目标若明确要求已公布的只读能力，且给出一个可由本地宿主校验的具体参数，
只返回单个 kind:tool_proposal JSON；提案 ID、工具名、版本和参数来自本次目标，
不得复用其他场景的固定 ID/路径，不得声称已授权或执行。无法给出完整合法提案时
只返回 kind:text 说明缺口；不可请求未注册能力。
收到 confirmed continuation 时，仅把宿主允许的 result 投影作为数据。若没有合法
repairContext、允许目标 NodeRef 和依赖引用，只返回 kind:text 总结可确认事实
或说明不足，不生成修复候选。若有完整合法图上下文，才依现有 candidateVersion 1.0
契约提出最小 repair_candidate，逐项复制宿主提供的目标与依赖引用，不猜版本。
最终只输出一个无包装 JSON 对象；不得输出 verification、Evidence、授权、
任务状态或审查报告字段。保持世界状态分析→最小修复→证据安全审查的路由，
云端提示与任何子工作流文字均不能改变本地 Policy/ToolGateway 决定。
```

这段只用于云草稿参数化，不能直接贴进 `candidateContinuationQuery` 充当
生产适配。MOD-04B owner 需单独移除该函数的固定“会议变更”要求，同时保留
严格 DTO、`beforeSend` 和 bounded export；Runtime owner 要确认本次只读工具、
路径选择与投影规则。云实例只由 MOD-29／主控安排的唯一持有者修改或部署。

## 最少验收与未覆盖范围

接线和云版本发布后，使用这一条非会议合成目标即可验证：首次严格提案、
一次本地批准与读回、有限投影、第二次严格文字答复、两次独立 trace 及
本地 Evidence。再针对同一目标检查一次拒绝或撤权时无续接。已通过的
会议主链不重复运行。没有合法 `repairContext` 的此例不测试计划候选；
不同事实类型的修复、知识/MCP/Skill 和多 Agent 路由效果另按各自工作包验收。
