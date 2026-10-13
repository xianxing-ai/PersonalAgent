# MOD-30：已发布控制器的角色与交接结构核对

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。本记录只核对现有 AgentArts 多智能体应用
`32d4d44c-eade-4f3f-8f76-209c74609e79` 的配置，不作为请求级三角色执行验收。

## 版本与可见结构

版本历史读回：`v20260925192219` 已于 2026-09-25 19:22:30 发布，版本 ID
`1790335350053`。控制器画布在该版提交后显示如下角色绑定；源工作流版本
与原有快照一致，两个审查引用都指向 `1790335103598`。控制器采用
`DeepSeek-V4-Flash` 和大模型意图识别，三个子智能体的后续处理均显示
“继续”，最大跳转次数为 9。控制器提示词要求世界分析 → 计划修复 →
证据审查，但画布连线是控制器分别引用子工作流，并未显示三个工作流
之间的有向边或字段映射。画布外观本身不说明平台的调度语义。

华为云当前[多智能体配置文档](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0106.html)
明确：起始工作流总是先执行，结束工作流总是最后执行，中间子工作流
按意图路由；默认工作流仅在未匹配意图或达到跳转上限时兜底。因此
`默认=Plan` **不保证每次运行 Plan**。“继续”表示根据结果继续其它
子工作流，或工作流完成后进入结束工作流，也不保证固定接力顺序。

| 可见执行位置 | 职责 | 来源工作流与版本 ID | 可见输入 | 可见输出及去向 | 请求级可观测标识 |
| --- | --- | --- | --- | --- | --- |
| 起始：`PA-世界状态影响分析_1` | 基于给定事实、Goal、Decision、Plan 和 revision 给出影响 JSON，包括 `recommended_disposition` | `7d06153e-6262-4679-86ae-1914b38e11f3` / `1789532410207` | 引用卡 `query:String`，应来自控制器请求；源流程内部为开始 `query` → 模型 `{{query}}` | 引用卡 `response_content:String`；源流程内部模型 `raw_output` → 结束 `result`。是否进入计划输入，画布无字段级证据 | 源 ID 和版本可在配置读回；现有 trace 未给独立角色 span |
| 默认：`PA-计划最小修复_1` | 基于既有计划及影响给出 KEEP、RECHECK 或 REVISE 的最小修复 JSON；仅在兜底条件下调用，另有同源常规子工作流供意图路由 | `ed2363d9-b770-4ce5-a988-9bf0903466f7` / `1789532322503` | 引用卡 `query:String`；未看到 `World.response_content` 到本端口的显式绑定 | 引用卡 `response_content:String`；是否进入审查输入，画布无字段级证据 | 源 ID 和版本可在配置读回；现有 trace 未给独立角色 span |
| 结束：`PA-证据安全审查` | 审查来源与权限边界，最终只返回严格的 `tool_proposal`、`repair_candidate` v1.0 或 `text` JSON | `998031d7-ec28-40ed-83e6-96667f22ff51` / `1790335103598`（发布名 `v20260925191806`） | 引用卡 `query:String`；未看到原请求、World 输出、Plan 输出合并至该端口的显式映射 | 引用卡 `response_content:String`；控制器提示词要求原样返回此最终 JSON，由本地严格解析 | 源 ID 和版本可在配置读回；现有 trace 未给独立角色 span |

另外三张分别标为“子工作流”的同源卡与上述起始、默认、结束卡并存，
仅凭卡片数量不能算作额外执行。控制器列表中还显示一个“未配置”项，
其含义未由平台执行记录确认。现有“全局配置”面板的输入参数和全局变量
表均为空；没有可见的字段级交接配置。官方文档定义全局输入只读，
全局变量可由同名同类型的子工作流输出覆盖，再传给后续子工作流。
[工作流节点文档](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0063.html)
还说明每个工作流引用固定提供 `response_content` 输出，来源为子工作流
结束节点的默认回复内容。

## 旧版运行证据与修订进度

现有非会议合成请求的同一平台 trace `668cded1dd4cb0de4a38bae90cf9736d`
有三个标识主控制器的 `UserInput` span，各自含“开始 → 大模型 → 结束”。
依次打开其链路信息，三段可见 `user` 输入都是相同的原始合成
continuation `query`；三段 `responseContent` 都是同形的
`repair_candidate` v1.0，只在 reason 措辞上不同，并没有世界分析的
影响 JSON 或计划修复的 KEEP/RECHECK/REVISE JSON。三个 span 均无
独立源资源 ID 或版本。以上只支持“可见模型输入输出无法语义映射为
World、Plan、Review”；不能排除平台在不可见上下文中使用了前序结果。
观测列表的 Root Span 输出为 `{"output":null}`。MOD-04B 的 SSE 严格解析
及合成图候选验证是本地协议证据，不补足平台角色追踪。

## 2026-09-25 22:16 已发布与实例读回

源工作流和主应用分别发布，再由主应用版本同步部署到既有实例：

1. Plan 源工作流发布 `v20260925204323`。开始节点接收原始 `query`
   和 World 原文 `response_content:String`；结束节点默认回复是 Plan
   的 `response_content`，另以 `world_result:String` 透传 World 原文。
2. Review 源工作流发布 `v20260925214120`。开始节点接收原始
   `query`、上游 `response_content:String` 和 `world_result:String`。
   提示词允许快速目标审查时后两项为空，复杂修复则要求实际 World/Plan
   内容；结束节点默认回复为严格的最终 `kind` JSON。
3. World 源工作流发布 `v20260925220514`，版本 ID
   `1790345132102`。其 Python Code 节点从受信宿主的顶层输入信封
   分类，不解析 `goal` 文本内部的任意 JSON，也不把外部输入当权限。
   图内三路明确连接：普通文本由 Code 直接给聚合节点；明确的初始
   只读工具目标或已确认结果由快速 Review 给聚合节点；合法修复候选
   经 World 模型 → Plan `v20260925204323` → Review
   `v20260925214120` 给聚合节点。聚合节点只取首个非空结果，End
   只设默认 `result`。三个源版本均只更新应用源，未独立同步部署。
4. 主多智能体发布 `v20260925221532`。画布只保留一个 World 子工作流
   引用，明确指向版本 ID `1790345132102`；可选的起始、默认、结束
   角色均未配置。子工作流后续处理选“终止”，控制器提示词要求只调用
   一次并原样返回其 `response_content`。主应用发布时选了“将该版本
   同步部署至实例”，平台显示“部署成功”。
5. 既有运行时 `agent-arts-d5ae1174bc7d4cb8ab3dbbc6fae654e4`
   （ID `1beeb366-7d05-4bb5-b054-d0b626aaef7f`）详情在
   22:16:28 读回“正常”；`Latest` 访问方式绑定 **v9**，v9 创建时间
   同为 22:16:28。入站方式仍是 API Key 认证；v8 保留在版本列表，
   是部署前的回退点。主应用旧源版本 `v20260925192219` / ID
   `1790335350053` 也保留。

主画布和源图只能证明**配置及绑定**。尚需在同一 v9 实例进行一次普通
请求与一次复杂修复候选请求，核对严格最终 JSON、本地解析/执行读回、
实际 trace 中的分支与调用次数，以及首个有用响应和最终完成耗时。
旧 trace `668cded1dd4cb0de4a38bae90cf9736d` 属于部署前配置，不能
当作 v9 请求级验收。若调用失败，保留精确错误与 trace，再决定是否
回滚到 v8；不因部署成功宣称三角色真实闭环。

源提示词与端口旧快照见 [恢复记录](MOD30-PA-WORKFLOW-RESTORE.md)，
本版控制器与审查提示词见 [提示词 V2](MOD30-PA-WORKFLOW-PROMPT-V2.md)，
发布与运行实例读回见 [部署记录](MOD30-PA-WORKFLOW-DEPLOY-20260925.md)。
