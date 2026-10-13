# 设计提案：语音优先、主动介入的本地决策 + AgentArts 协同架构

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

状态：Proposed / 仅供评审  
日期：2026-09-23  
范围：PersonalAgent 产品交互、主动介入、本地决策、AgentArts 协同与语音授权  
非目标：本提案不声明 Laya、真实 AgentArts、语音授权或对应端到端链路已经完成，也不改变当前接口冻结状态。

## 1. 背景与项目初心

PersonalAgent 的目标不是“用户发命令，助手执行一步，再频繁询问下一步”，而是长期驻留、持续理解用户目标和现实状态，在事实变化时主动判断影响、修复计划并推进工作，只把真正需要用户决定的事项集中交给用户。

用户不是系统的调度器，而是目标、授权边界和最终控制权的拥有者。

核心产品体验应满足：

- 语音是第一交互入口，但不是所有内部步骤都要求语音确认。
- 系统能主动感知邮件、日历、天气、文件、系统事件等变化，而不是等待用户来问。
- 大部分低价值事件应被忽略、合并或静默处理，避免频繁打扰。
- 已有授权范围内的低风险、可逆操作应尽量自动完成并留 Evidence。
- 只有新的权限、不可逆高风险动作、敏感数据出机或真正存在多种用户偏好的决策才请求用户确认。
- AgentArts 负责复杂理解和编排，不成为每次交互都必须等待的前台聊天后端。

## 2. 设计原则

### 2.1 Voice-first，而不是 Voice-only

语音负责：

1. 用户主动发起任务；
2. 系统主动播报真正值得注意的变化；
3. 在必要时完成简短的确认、拒绝或选择；
4. 打断播报、取消任务和纠正当前意图。

语音不负责：

- 替代 Runtime 的任务状态；
- 直接签发工具权限；
- 对每一个后台动作逐项询问；
- 让一句脱离上下文的“确认”直接触发任意工具。

### 2.2 Local-first judgment

高频、小型、结构化的判断留在本地完成，例如：

- 邮件重要性、是否需要回复、是否关联当前 Goal；
- 天气变化是否值得主动提醒；
- 日历事件是否存在冲突；
- 通知是否忽略、合并、延后；
- 新 Fact 是否值得进入长期 Memory；
- 当前变化是否需要升级给 AgentArts。

建议引入统一的 `DecisionPort`，首个 Provider 使用 Laya。业务模块不得各自直接绑定 Laya SDK。

### 2.3 AgentArts 只处理值得付出高延迟的复杂任务

AgentArts 主要负责：

- 跨来源复杂语义理解；
- 需求变化对 Goal / Plan 的影响分析；
- 最小 Plan Repair；
- 多步骤编排；
- 云端 Agent / Workflow / MCP 能力；
- 根据本地工具结果继续分析并输出最终方案。

AgentArts 不负责：

- 维护本地任务终态；
- 直接持有本地权限；
- 默认读取全部私人 Memory；
- 直接执行 Windows / 文件 / 本地账号操作；
- 决定一个本地动作已经成功。

这些职责继续由 Runtime / Policy / ToolGateway / Evidence 掌握。

## 3. 目标架构

```text
邮件 / 日历 / 天气 / 文件 / 系统事件 / 用户语音
                         ↓
                  Connector / Voice
                         ↓
                 Event / Fact Ingest
                         ↓
              ProactiveInterventionService
                         ↓
                     DecisionPort
                         ↓
                       Laya
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
       IGNORE          LOCAL          ESCALATE
       MERGE           REMIND          AgentArts
       DEFER           EXECUTE            ↓
                                        复杂分析
                                        Plan Repair
                                        Tool Proposal
                                           ↓
                                         Runtime
                                           ↓
                                 Policy / Authorization
                               ↙                     ↘
                       已有授权/低风险          必须用户决定
                              ↓                    ↓
                         ToolGateway         语音/界面确认
                              ↓                    ↓
                           本地工具  ←─────────────┘
                              ↓
                           Evidence
                              ↓
                    Memory / Goal / Plan 更新
```

## 4. 主动介入模型

建议把主动行为统一为以下结果，而不是“每个事件都生成一个通知”：

- `IGNORE`：无价值或重复事件，不打扰用户。
- `MERGE`：并入摘要、同类通知或同一 Goal 的批次。
- `DEFER`：当前不值得打扰，延后到合适时间。
- `REMIND`：需要用户知道，但不需要立即决策。
- `REQUEST_DECISION`：存在真正需要用户选择的分支。
- `EXECUTE`：在已有授权、风险和可恢复条件内自主执行。
- `ESCALATE_AGENTARTS`：问题复杂度超出本地决策层，需要 AgentArts 深度分析。

Laya 只给出判断和置信度，不拥有执行权。

## 5. 语音授权设计

当前已有 Policy / approvalId / taskId / tool / argument digest / allow_once 等底座应继续作为真实授权系统。

语音只是 Approval UI，不新增一套平行权限系统。

### 5.1 不频繁询问

建议按风险与既有授权分层：

**A. 默认自动处理**
- 纯本地只读；
- 内部分类、排序、Memory/Goal 状态维护；
- 不出机、不发送、不删除、不产生外部副作用。

**B. 已有 Standing Grant 内自动执行**
- 用户已明确授权的重复性、低风险、可恢复动作；
- 执行后记录 Evidence，可在摘要中告知，不逐次询问。

**C. 仅在越过新边界时询问**
- 对外发送邮件/消息；
- 敏感内容首次出机；
- 新对象或新范围的写操作；
- 明显不可逆或高影响动作。

同一任务的多个相关审批应尽量合并成一个明确问题，而不是连续“是否继续”。

### 5.2 Voice Approval Adapter

建议在可信 Desktop composition 增加 Voice Approval Adapter：

```text
TTS：“需要给老师发送这封邮件，是否发送？”
                  ↓
用户：“发送”
                  ↓
ASR
                  ↓
VoiceApprovalAdapter
  - 当前是否只有一个匹配的 pending approval
  - approvalId / taskId 是否仍有效
  - 语音会话是否仍在当前上下文
  - 动作摘要是否与刚才播报的一致
                  ↓
authorization.respond(allow_once)
                  ↓
Runtime / Policy
```

如果同时存在多个待审批项、上下文已经过期或语义不明确，不能把裸“确认”映射到任意动作。

## 6. Laya 与业务模块的协作

Laya 不应直接嵌入 Mail、Weather、Calendar 等 Connector。建议所有业务通过统一 `DecisionPort` 请求判断。

示例：

### 邮件

```text
Mail Connector
  ↓
规则去重 / 明确垃圾过滤
  ↓
Laya 批量判断
  - importance
  - goal relevance
  - requires_action
  - requires_reply
  - intervention
  - need_cloud
  ↓
大多数 IGNORE / MERGE / REMIND
少数 ESCALATE_AGENTARTS
```

### 天气

天气 API 提供事实；确定性阈值由代码判断。Laya 只判断“结合今天日程和长期 Goal，这次变化值不值得主动介入”。

### 日历 / 通知 / Search

同理：Connector 提供事实，规则负责确定性约束，Laya 负责模糊价值判断，AgentArts 只接复杂任务。

## 7. AgentArts 的交互职责

AgentArts 不是 UI，也不是 PersonalAgent 本体。

推荐链路：

```text
Runtime / Proactive Service
      ↓
CoordinationPort
      ↓
CloudAgentPort
      ↓
AgentArts Agent / Workflow
      ↓
复杂分析或 Tool Proposal
      ↓
Runtime
```

对于 AgentArts 高延迟：

- 简单任务不调用 AgentArts；
- 本地先给出真实状态反馈，例如“发现一项可能影响比赛计划的变化，正在分析”；
- 不伪造进度，不用 Fake 冒充云端成功；
- 未来如果 Adapter 暴露增量事件，可把真实 workflow/message 事件流送给 Desktop/TTS；
- AgentArts 不可用时，本地分类、Memory、通知和已有自动化仍应继续工作；复杂分析明确标记为暂不可用。

## 8. AgentArts 调用本地工具

继续沿用现有安全边界：

```text
AgentArts Tool Proposal
        ↓
      Runtime
        ↓
      Policy
        ↓
已有授权？ ──否且需要用户决定──→ Voice/UI Approval
        ↓
    ToolGateway
        ↓
     Local Tool
        ↓
     Evidence
        ↓
  Egress Policy / projection
        ↓
AgentArts continuation（仅发送允许出机的最小结果）
```

必须继续保持：

**本地执行授权 != 结果出机授权。**

AgentArts 不应直接获得本机 stdio、文件系统、Windows Host 或私人数据库的开放访问。

## 9. 与现有代码的关系

本提案优先复用现有边界，而不是重写项目：

保留：
- `RuntimeApplication` / `TaskRuntime`
- `CoordinationPort` / `CloudAgentPort`
- `Policy` / Approval
- `ToolGateway`
- Evidence 和任务终态由 Runtime 掌握
- Memory / Goal / Fact / Plan / Dependency / Plan Repair 方向

建议重建而不是整体合并旧堆叠：
- PR #61：VoiceSession、ASR/TTS 端口、Runtime transcript consumer 的有效增量；
- PR #78：Desktop PTT、语音采集、本地 AgentArts tool bridge 的有效增量；
- PR #51：AgentArts 多 Agent / SSE 解析中的有效修复。

新增：
- `DecisionPort`
- `LayaDecisionProvider`
- `ProactiveInterventionService`
- `VoiceApprovalAdapter`

旧 PR 基线已与 main 冲突，不应为了本提案直接整包合并。

## 10. 建议实施顺序

### Phase 1：契约与 Fake

- 定义 `DecisionPort` 和主动介入结果；
- Fake provider 覆盖 IGNORE / MERGE / REMIND / REQUEST_DECISION / EXECUTE / ESCALATE；
- 不接真实模型，不改变现有 Runtime 冻结状态。

### Phase 2：Laya Provider

- 本地加载 Laya；
- 先覆盖邮件批量分类、通知优先级和“是否需要云端”；
- 建立延迟、准确性、误提醒率和 AgentArts 降调用量的评估。

### Phase 3：语音主入口重建

- 从旧语音分支选择性重建 VoiceSession / ASR / TTS / Desktop PTT；
- transcript 仍进入现有 Runtime，不建立第二套任务系统；
- 增加 VoiceApprovalAdapter。

### Phase 4：主动 Connector 闭环

先做三条可展示链路：
1. 邮件批量分类与重要事项摘要；
2. 天气 + 日历联动的主动提醒；
3. Fact 变化 → Goal 影响 → 最小计划修复。

### Phase 5：真实 AgentArts 协同

- 真实复杂分析；
- 真实 Tool Proposal → 本地执行 → Evidence → continuation；
- 验证出机授权；
- 验证 AgentArts 不可用时的降级行为。

## 11. 最小验收场景

### 场景 A：大量邮件

输入 300 封邮件。

期望：
- 本地规则 + Laya 完成大部分分类；
- 不产生 300 次通知或确认；
- 只汇总真正重要内容；
- 只有少量复杂项目变化升级 AgentArts。

### 场景 B：主动天气提醒

天气变化与下午户外日程产生冲突。

期望：
- 用户没有主动询问也能收到一次有价值提醒；
- 不需要调用 AgentArts；
- 不要求用户确认“是否允许查看天气”。

### 场景 C：计划变化

老师邮件修改比赛/毕业设计要求。

期望：
- Laya 判断为高价值变化；
- AgentArts / Cognition 分析受影响 Goal/Plan；
- 保留未受影响工作；
- 在已有授权内可自动更新本地计划；
- 只有对外发送或越权动作才请求用户决定。

### 场景 D：语音审批

系统确实需要发送一封外部邮件。

期望：
- TTS 一次说明对象和动作；
- 用户一句明确回复完成 allow/deny；
- approvalId、taskId、动作摘要和时效严格绑定；
- 多个待审批项时不接受模糊“确认”。

### 场景 E：云端不可用

AgentArts 不可用。

期望：
- 邮件分类、天气判断、通知、Memory 和本地状态继续运行；
- 复杂分析明确失败/延后；
- 不使用 Local/Fake 结果冒充 AgentArts 成功。

## 12. 需要评审者重点回答的问题

1. `DecisionPort` 应落在独立 package，还是 Coordination/Cognition 内部更合适？
2. `ProactiveInterventionService` 应归 Runtime Application 层还是独立应用服务？
3. Standing Grant 的最小安全范围如何定义，既减少打扰又不扩大权限？
4. VoiceApprovalAdapter 放在可信 Desktop composition 是否合适？
5. AgentArts continuation 需要什么最小结构化结果，才能避免上传原始本地数据？
6. #61 / #78 / #51 哪些增量值得重建，哪些应废弃？
7. 是否同意把“减少无价值询问/提醒”作为产品级验收指标，并记录 interruption rate / unnecessary prompt rate？

## 13. 非目标

本提案当前不做：

- 让 Laya 获得工具执行权；
- 让 AgentArts 直接访问本地权限系统；
- 自动批准高风险外部写操作；
- 为了“主动”而持续打扰用户；
- 同时引入多个本地生成模型；
- 将旧冲突 PR 直接整体合入 main；
- 把 Fake、离线测试或 UI 展示当成真实 AgentArts / Voice / Evidence 验收。

---

评审目标：确认产品交互原则、模块边界和实施顺序。设计通过后再拆分具体实现 PR，不在本提案中把未完成能力登记为可用。
