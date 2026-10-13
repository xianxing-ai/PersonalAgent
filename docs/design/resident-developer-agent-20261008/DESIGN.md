# PersonalAgent 常驻自主开发者助手：完整目标设计

首次设计：2026-10-08；修订：2026-10-09。状态：**目标方案／proposed**。目标 Profile：`huawei_ict_agentarts`。设计、模块估算与可编辑架构图不等于实现完成，不改变既有接口冻结状态。现有自有镜像代码/接口与分享流程随当前 PR 提交，真实发布及验收分别记录。

设计修订：2026-10-09。Wiki 记忆接入仍由 goo122 具体实现；本轮另同步 WSS、Runtime 防重发及完整角色报告的 provisional 本地实现。模块百分比和区间保留 2026-10-08 的估算基线，不因新增代码或文档自动提高。另见项目协作规则：当前 PR 必须由 goo122 与 Potatos498 完成本机阅读确认与审批，禁止强制合并或绕过门槛。新版镜像构建/发布、父集成与真实云验收单独记录。

完成度估算代码基线：`e86bac53`，工作树为项目内 `.worktrees/agentarts-owned-image`，分支 `codex/agentarts-owned-image`。2026-10-08 快照观察了该工作树当时未提交的自有镜像迁移；其他工作树的未合并成果不计入。参考源码、README、接口目录、模块台账和验收记录；当前 PR 的代码/镜像验证另行记录，未获得新的真实云端运行证据。

## 1. 产品目标与边界

产品是面向开发者的常驻个人助手。电脑运行且用户暂时离开时，它继续观察已授权的信息源，判断哪些变化会影响用户的持续责任，修复受影响的局部计划，分配执行、验证和监管任务。用户回来时能看到发生了什么、为什么处理、实际改动、依据以及待决定事项。

持续责任可以是“保持这个项目的 CI 正常”“发现依赖安全公告后判断是否受影响”“监管某个 PR 的测试与评审”“维护发布前检查”“监测日程变化并调整计划”。一次对话只是建立或修改责任的入口，持续运行依赖明确的目标、范围、停止条件和授权。

参考 Your dot 的持续责任、上下文记忆、并行任务、主动提醒与任务委派体验。它具有云电脑等能力；本产品选择电脑开机时的本地执行，不提供电脑关机后继续操作的模式。AgentArts 仍承担云端语义编排；“不做独立云电脑”不等于删除云端模型和编排。[Your dot 官方介绍](https://learn.chatgpt.com/docs/dots)

核心成功标准：一个真实变化能经过可信观察、影响判断、计划更新、授权执行与独立读回，形成可追溯的结果；无变化时保持安静，证据不足时保留不确定状态。系统不依靠模型不停循环来维持“在线感”。

## 2. 关键设计决策

| 决策 | 目标行为 | 当前事实与限制 |
| --- | --- | --- |
| WSS 主通道、HTTPS 备用 | 同一 AgentArts 部署、同一协议语义、同一任务记录；可见降级 | 10-09 `/ws`、严格传输信封与WSS客户端已有 provisional 本地实现；仅invoke未发送的连接失败可备用，真实网关及完整恢复待验收 |
| 本地 Runtime 是执行事实源 | 云端建议不能直接改变任务终态或本机权限 | 保持现有 Runtime/Application 边界 |
| AgentArts 负责语义编排 | 云端规划、复杂判断、多角色、评估；不静默回退 Local Agent | 云端新镜像真实闭环待验收 |
| Laya 提高决策可检验性 | 对合法候选做结构化选择、弃权、升级 | 当前实现保留 `calibrated:false`，不保证领域可靠性 |
| 用户预授权有边界 | 限定目标、资源、动作、期限和隔离档位 | 全套无人值守配置与撤销仍需实现 |
| 世界状态驱动增量修复 | 仅处理发生变化且关联的节点 | 图、认知有基础；可信真实源与监管闭环不足 |
| 常驻复用现有 Runtime | 事件订阅、调度、持久状态统一管理 | 不假设独立 Windows 服务已经存在 |
| 权限与沙箱独立 | 允许做什么与执行时能接触什么分别限制 | TS 类型、路径检查、超时不构成强 OS 沙箱 |
| 记忆接入 Wiki | Wiki 承载长期知识正文，Memory 提供来源绑定的事实投影和检索；变化进入增量修复 | MOD-08/09 由 goo122 实现；自动 Wiki 整理/同步当前未交付 |

### 2.1 2026-10-09 实施增量，独立于原估算

本轮补齐了三类局部实现：容器 `/ws` 与传输 `0.1.0`；Coordination 的 WSS 优先与未发送时 HTTPS 备用；Runtime 发送前持久意图和结果未知时阻止重发。World/Plan 改为完整版本化内部报告，保留事实变化、影响、步骤分类与证据需求。它们保持 provisional，不改变既有 frozen 集合。

局部测试已分别通过服务端21项、客户端16项、Runtime防重发3项，以及编排包18项。记录仅覆盖各自合成/Fake路径：父工作包的最终集成、新版镜像构建/发布与真实华为云端尚未完成。此前HTTP预览镜像的发布/容器结果不能证明这些新代码已经进入发布镜像。设计生成与XML校验不代替新的视觉检查或产品验收。

## 3. 总体架构与每个模块的位置

详图：[总架构 SVG](architecture-overview.svg)、[自主闭环 SVG](autonomy-lifecycle.svg)、[信任与双通道 SVG](trust-and-transport.svg)、[Wiki 与记忆 SVG](wiki-memory.svg)、[离线阅读页](index.html)。总图包含全部 39 个模块，MOD-04 拆为 04A 和 04B。云图表示职责位置；MOD-04A 是可复用公共包，并非只能运行在云端。MOD-10 是横向研究工作，不处于每次请求的必经路径。

```text
用户：语音／文字／责任设置／审批／查看证据／暂停
  ↓ MOD-11~15 Desktop Renderer
安全 Preload / IPC → 可信主进程：凭据、窗口、Runtime Application
  ↓ MOD-02 Client；MOD-03 TaskRuntime
世界输入 → MOD-09 FactChangeFeed → MOD-27 世界/目标图
Wiki 正文/版本 → MOD-08 受信知识端口 → MOD-09 事实/检索投影
  ↓ MOD-28 影响判断 + Laya 合法候选选择
MOD-04B Coordination / CloudAgentPort
  ⇄ WSS 主通道；HTTPS POST + SSE/查询备用
AgentArts 自有镜像：MOD-29 基础 → MOD-30 编排 → MOD-31 多角色
  ↓ MOD-04A ModelGateway → 模型 Provider
  ↑ 返回结构化提案、Trace、用量；不返回本机授权
本地重新核对事实与版本 → MOD-05 Policy / Approval
  ↓ ToolGateway → Connector Host → 受限执行器
MOD-06~08、16~18、20~26、33 提供工具或观察能力
MOD-34~38 组合开发者业务工作流
  ↓ 外部读回与 Evidence → MOD-03 状态提交
MOD-27/28 更新图；MOD-23 通知；监督任务继续观察
MOD-01 存储；MOD-19 分发；MOD-32 云端观测贯穿对应边界
```

Renderer 不导入 Runtime、数据库、Provider 或 Shell。主进程通过 Client/Application 接线，不复制 Agent 执行循环。packages 不反向依赖 apps；跨模块只用公开 exports 和已公布端口。工具统一走 ToolGateway，云角色不直接调用本地 OS。业务连接器只通过 MOD-05 公布的 capability 被 AgentArts 消费。

## 4. 用户界面与日常使用

### 4.1 入口与责任创建

Orb 提供快速文字/语音入口；对话支持即时询问和“持续负责这件事”。建立责任时显示解析出的目标、项目/账户范围、触发源、允许动作、停止条件、通知规则与云端可见数据。用户能修改这些字段。自然语言中的“帮我看着”不能自动扩张成发布、删除或发信权限。

责任面板展示：目标、当前计划、最新事实、下一检查条件、运行/暂停状态、授权有效期、关联任务、监管任务、最后一次真实核实时间。执行记录中分别展示“受理”“等待审批”“执行中”“等待核实”“完成/失败/取消”，不把提交成功显示为工作完成。

### 4.2 无人监管模式

用户为某个工作区开启预授权后，已授权的观察和低风险修复继续运行。超范围动作进入审批队列，相关分支等待；独立任务可继续。返回时显示按目标聚合的变化摘要，不逐条推送无关噪声。

界面常驻显示：主通道/备用通道/离线、自动化档位、隔离能力、待审批数、事实新鲜度、正在执行的副作用。用户能分别暂停一个目标、整个自主系统、某个连接器或语音监听。停止语音播放不等于取消任务；取消主任务需说明并处理其已委派执行与周期监管。

### 4.3 设置结构

| 设置组 | 用户可配置项 | 实际约束点 |
| --- | --- | --- |
| 责任 | 范围、触发、完成条件、通知、停止时间 | Goal/Plan + Runtime 调度 |
| 自主性 | 只观察、提案、范围内自动执行 | Policy + 授权租约 |
| Laya | 选择策略、弃权/升级、经验证的阈值配置 | Cognition 决策端口；不能扩大权限 |
| 沙箱 | 目录、网络、进程、命令、账户隔离 | 执行宿主；实际不可用档位禁止显示“已启用” |
| 数据 | 允许读取、持久记忆、允许发送云端的数据 | Connector Host + 投影/导出过滤 |
| 连接 | WSS 优先、HTTPS 备用开关、部署版本 | 云端口传输管理；同一授权与任务 |
| 通知/语音 | 静默时段、优先级、设备、显式唤醒 | MOD-14/15/23；唤醒默认关闭 |

当前部分设置存在界面或配置基础；上述整套产品行为是目标设计，需要与真实 Runtime 接线后才能宣称可用。

## 5. 世界状态、记忆与依赖图

世界状态不是一段无限增长的提示词。每条事实具有稳定标识、来源、源 revision、观察时间、有效期、敏感级别和可导出范围。代码事实可以绑定 repository、HEAD、文件哈希、工作树；日历事实绑定日历源 revision；CI 事实绑定 run/job/commit。缺少来源时标为待核实，不编造 provenance。

| 实体 | 含义与必需信息 | 事实归属 |
| --- | --- | --- |
| Fact | 外部观察及来源版本；可能过期、撤回、相互冲突 | Memory/FactChangeFeed；Goal 图引用 |
| Goal | 用户持续责任、范围、成功/停止条件 | MOD-27 |
| Decision | 候选、选择理由、置信指标、证据引用 | MOD-28；不包含可用授权秘密 |
| Plan | 版本化步骤与依赖、预期结果 | MOD-27；运行提交受 Runtime 约束 |
| Task/ToolRun | 具体执行状态、deadline、取消、输入摘要 | MOD-03/05 |
| Supervision | 观察对象、谓词、下次检查、过期、升级条件 | 目标图引用 Runtime 监管任务；新增设计 |
| AuthorizationLease | 用户允许范围、期限、撤销版本 | Policy/可信存储；新增持久授权能力 |
| Evidence | 执行记录、实际读回、来源与核实级别 | 可信执行路径写入 |

图中边表示“依赖这个事实”“由这个决定产生”“监管这个任务”等具体关系。每次变更带旧 revision、新 revision 和撤回标记。事实更新先完成可信持久化，再通知订阅者。消费水位线与 checkpoint 保留跨重启状态。

记忆分为用户确认的偏好、可核实项目事实、任务工作记忆与可撤回的推断。撤销信息要传播到相关计划和缓存；记忆删除不抹去依法/工程上必要的执行审计，产品应明确保留范围。知识写回绑定 expectedSha256、精确修改、备份与读回；过期引用不能继续作为当前依据。

### 5.1 Wiki 作为可编辑长期记忆

Wiki 承载长期语义知识：项目背景、架构决定、用户确认的偏好、排障经验及资料关联。MOD-08 负责页面正文、目录/权限、版本和链接适配；MOD-09 负责经授权的结构化事实、检索投影与 FactChangeFeed。Wiki 页面是该知识正文的来源，Memory 投影可重建，不能形成与页面无关的第二份“真相”。原始 CI/日历/邮件仍是各自事实的来源，整理进 Wiki 必须保留其来源和时间，不能靠整理把旧信息变成新事实。

运行日志、TaskRuntime 状态、授权和原始 Evidence 不迁移为 Wiki 的执行台账。短期工作记忆也不自动写成长期知识。Wiki 链接图表示内容关系，Goal 图表示执行依赖；不能把每一个页面链接都当作计划依赖。当前未指定具体 Wiki 系统，由 goo122 通过公开适配端口选择实现，优先复用现有 Markdown/Obsidian 基础；本设计不安装插件、不创建新服务。

### 5.2 双向接入与版本化引用

读取：用户选择受信来源及范围 → MOD-08 搜索/读回 → 校验页面 revision → MOD-09 构造允许的 Fact/引用投影 → MOD-27/28 消费。引用包含不透明 sourceId、configRevision、pageId/相对路径、段落或块定位及源内容 revision；部分是目标新增契约，不宣称已冻结。回答同时给出来源，引用过期返回 SOURCE_CHANGED 或重新核实，不能继续引用旧结论。

写回：执行证据或用户输入 → 形成 Wiki 精确修改提案 → 绑定原始证据和 baseline → Policy 审批/有效预授权 → ToolGateway → MOD-08 受控写入 → 备份及实际哈希读回 → MOD-09 更新投影/变更流。模型可提出总结，不能自行认证“用户已确认”，也不能将未经读回的执行自报成功固化为知识。

用户手工编辑、移动或删除页面时，来源适配器确认实际变化，再更新或撤回对应投影，使相关计划进入增量核实。扫描失败/库暂时不可用不等于页面删除。来源切换或权限撤销取消旧租约，旧 source/config 的引用、审批和任务不得消费新库。使用稳定页面身份处理移动，不能仅凭相似文本判断两个页面是同一来源。

### 5.3 一致性、隐私与恢复

Wiki 文件和 Memory SQLite 不具备天然跨存储事务。复用可信操作记录，将“正文已核实、投影待更新”保存为可恢复状态；重启后读回页面并补投影，不再次盲写。重复观察以来源身份 + revision 去重，自有写回也由适配器统一产生事实更新，避免写回→采集→再次写回的循环。用户后来改动导致 baseline 冲突时保留提案并重新核实，禁止强行覆盖。

原始资料与 Wiki 页面分别保留敏感级别、读取权限和出机权限。摘要、索引及链接不得降低敏感级别；本地可检索不代表可以发送 AgentArts。当前受信知识源的写入/出机许可仅会话有效；持久无人值守权限是 MOD-05/13 的后续能力，不能由 Wiki 接入顺带放开。私人 Wiki 的删除还需明确正文、索引、缓存、WAL 和备份的范围，不能把逻辑撤回宣称为所有副本已物理删除。

### 5.4 goo122 的交付责任

工作包见 [Wiki 记忆接入交接](WIKI-MEMORY-HANDOFF.md)。goo122 负责 MOD-08/09 的公开契约、适配器、检索投影、受控写回、去重/恢复和必要 Runtime/Policy 接线，保持其他协作者修改。zemeng 通过公开端口消费 FactChangeFeed、来源引用和失效事件，完成认知/目标侧接线；不把 Wiki 数据库或私有实现直接导入 Agent。实现进度、真实 Wiki 证据和接口状态由后续工作包更新，不能以本设计完成代替接入完成。

## 6. 常驻循环与增量修复

常驻指系统在目标有效期间持续接收事件和到期检查。确定性代码负责采集、去重、合并、范围筛选、调度和权限过滤；模型只在需要语义判断时被调用。重复 RSS、无关文件变更和状态未改变的检查不触发完整规划。

一次增量修复按以下顺序运行：

1. 连接器提交真实变化，可信宿主校验 source/revision，生成 FactChanged。
2. MOD-27 找出直接依赖与传递依赖，限定在有效授权目标内，标记受影响计划节点。
3. MOD-28 判断是否忽略、保留、核实、修订或升级；Laya 在可执行候选中选择。
4. 简单确定性调整直接形成局部候选；需要语义推理的部分通过 WSS/HTTPS 发给 AgentArts，携带必要子图与版本。
5. 云端返回候选变更及依据；本地检查事实仍新鲜、引用有效、依赖未环、工具已注册。
6. 使用 expectedRevision/CAS 原子提交局部计划。版本冲突时重新核实受影响片段，不能覆盖另一协作者的新结果。
7. 对执行动作逐项通过 Policy。工具结束后读回，更新 Evidence 与任务状态。
8. 将新结果投影为事实，安排后续监管；通知用户需要关注的变化。

现有 `KEEP / RECHECK / REVISE` 思路可复用。目标设计中停止和补偿是显式 Runtime 行为，不把它们假装成已冻结的新图操作。来源失效必须重新核实；模型说“仍然有效”不足以保留旧计划。已终结任务不能重开，需要建立有来源关联的后继任务。

例如：某个 PR 的 CI 从成功变为失败，仅失效对应 commit 的发布前结论、测试定位与修复步骤；无关联的文档任务继续。若失败属于外部服务故障，先核实而非改代码；若确需修复，MOD-35 定位、MOD-34 生成受限补丁、MOD-36 验证 diff，写入权限仍由 Policy 决定。

## 7. Laya 的位置、能力与可信决策

Laya 放在 MOD-28 决策端口后，输入是当前事实和有限候选集合，输出是结构化选择、review 或 abstain。它不直接执行工具，不签发权限，不负责持久任务终态。工具候选先由宿主排除未授权、过期、不支持和参数不合法项，再进行选择。最终工具执行还要重新校验 Policy，防止选择后权限被撤销。

当前 `laya-action-choice.ts` 已定义候选版本、来源引用、范围、参数摘要与选择结果。实现明确保留 `calibrated:false`；代码中的 confidence 0.7、margin 0.15 是现有分支阈值，不是已经验证的用户可调产品设置。高风险动作即使被选中也仍需 review。模型答案置信与概率分布集中度分别记录，不能混成一个“可信分”。

官方模型卡描述了类型化判断与概率输出；这些能力可用于构造可评估的决策系统，但不证明它在本项目的无人值守开发场景已校准。当前模型卡也不应被旧文档里的早期模型评价替代。[Laya 模型卡](https://huggingface.co/convaiinnovations/laya)

可信度提高来自整条链：候选受限、来源可核实、任务领域评估、可弃权、权限独立、执行隔离、实际读回。后续应建立 CI 故障、来源过期、提示注入、命令风险、噪声变化等标注集，测量误放行、误升级、弃权率与校准误差。未经领域验收的阈值不能解锁更高风险动作。

用户可以选择“保守升级”“仅自动执行已验证低风险类别”等策略。设置变更记录策略 revision，影响后续选择；不能通过降低阈值越过工具权限或隔离限制。Laya 运行位置通过决策端口隔离，优先评估可信宿主可部署方式；当前不能声称完整本地 Laya 推理已验证。

## 8. 委派、监管与任务分工

角色包括规划者、执行者、验证者和监管者。AgentArts 编排语义角色；本地 Runtime 接受经校验的子任务提案并维护父子关系。运行时角色与开发协作者 goo122/zemeng/Potatos498 是不同概念；产品运行不依赖 Codex 的开发协作工具。

子任务继承并收窄父任务权限、数据范围、deadline 和预算，不可自行扩大范围。创建子任务前检查循环、重复目标与资源冲突。工作区写入按资源串行或使用隔离工作树；不能为方便切换他人分支或覆盖其修改。验证者检查实际 diff/测试/读回，不仅复述执行者报告。

监管任务含被监管对象、观察条件、检查节奏、过期时间、升级条件及取消传播关系。例如“监管这个修复 PR：CI 结束后读回状态；出现新的 commit 时旧评审失效；合并后结束”。简单状态监管使用确定性调度，只有变化解释需要模型。

父任务取消先阻止新委派，再向活跃子任务传递取消，等待停止确认，保留已经发生的副作用。周期监管是否一并停止由用户责任范围明确决定。父任务完成与某个长期责任继续监管分开记录，不能靠一个“done”隐藏仍在运行的分支。

## 9. 权限、审批与执行沙箱

| 档位 | 允许行为 | 典型限制 |
| --- | --- | --- |
| 观察 | 已允许源的读取、比对、提醒 | 不修改文件、不外发内容 |
| 提案 | 生成计划/补丁预览/诊断 | 写入、发送、发布进入审批 |
| 范围内自动 | 有效预授权内的低风险执行 | 指定目录/工具/账户/期限；可撤销 |
| 高风险审批 | 删除、发布、外发、权限变更等对应授权 | 明确动作、参数、范围与一次性消费 |

授权绑定 task、tool、scope、参数摘要、期限与 revision。持久租约用于可重复但范围有限的观察或低风险责任；一次性批准用于具体副作用。消费和检查必须具备事务保护，撤销后未开始的执行不能继续放行。结果未知时保留等待核实状态，不能用重试绕过一次性授权。

沙箱约束进程实际能访问的文件、网络、命令和账户。目录白名单和 Schema 校验是能力限制；真实隔离需操作系统/容器/受限宿主的有效边界和负向测试。当前任意命令强沙箱不是已有能力，因此不能开放“任意 Shell 自主执行”。第一阶段使用固定受限工具，按需要单独引入隔离执行器。

云容器的隔离只约束云代码，不能保护电脑上运行的本地工具。MOD-16 的受限 Windows Host 与 MOD-18 的编程工具各自需要资源边界、取消、读回与审计。TraceGuard 不能被虚构为已接入模块；MOD-17 当前是电脑状态观察。

## 10. WSS 主通道、HTTPS 备用

WSS 是使用 TLS 加密的 WebSocket，适合持续双向事件、工具请求和继续轮次。HTTPS 备用使用请求/响应及 SSE 事件流；SSE 是云到本地的单向流，本地继续轮次通过额外 POST 提交。二者承载同一业务协议，传输失败不切换为另一套 Agent 或绕开 Policy。

华为当前自定义运行时规范列出 ARM64、端口 8080、`POST /invocations`、`/ping`，以及同端口可选 `/ws`。这些是容器适配要求；实际公开 WSS URL、Upgrade 代理、认证方式与连接生命周期仍需部署验收。不能把容器支持 `/ws` 等同于公网已打通。[容器协议规范](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_070.html)

OpenAI Responses API 官方同时提供持续 WebSocket 模式与 HTTP/SSE；可以参考其增量调用方式。它并不证明 ChatGPT 客户端内部采用与本方案相同的自动切换策略。[WebSocket 模式](https://developers.openai.com/api/docs/guides/websocket-mode)、[HTTP 流式响应](https://developers.openai.com/api/docs/guides/streaming-responses)

### 10.1 传输状态机

```text
START → WSS_CONNECTING → WSS_READY
              ↓ 可恢复连接失败 / 能力不支持
         RECONCILING → HTTPS_READY（界面显示“备用通道”）
              ↑                ↓ 后台验证 WSS 恢复
          WSS_RECONNECTING ← QUIESCING → RECONCILING → WSS_READY
任一通道不可用 → OFFLINE_WAIT（本地已授权观察继续；需云决策的任务等待）
认证失败 → AUTH_REQUIRED；协议不兼容 → UNSUPPORTED（不盲目改走备用）
```

降级策略由用户配置允许，不对每次连接失败再次询问。先停止新传输、确定当前请求是否已受理并核对游标，再切换；重连退避带抖动，避免风暴。恢复后新调用回主通道，已有请求按原协议收尾或协调，不在双通道同时执行同一请求。

HTTPS 的事件恢复能力必须通过协商确认。若平台只提供单轮 POST/SSE，则本地保存继续上下文，以单轮请求推进；缺少独立查询时不能假装有断流续传。当前自有HTTP入口返回单次JSON事件数组，不是原生SSE或查询恢复能力。后台监管仍由本地调度触发；实时云主动推送在备用通道可能延迟或不可用，UI 显示能力降低。云 Runtime 弹性回收后可重新建立语义上下文，不能依赖其本地磁盘作为唯一记录。

### 10.2 同一业务信封（proposed，尚未冻结）

| 字段组 | 作用 |
| --- | --- |
| protocolVersion / messageType / capabilities | 显式协商，不把内部 DTO 当作公共协议 |
| requestId / taskId / parentTaskId / sessionId | 关联调用、任务、委派与连接；连接不拥有任务终态 |
| idempotencyKey / payloadDigest | 相同标识不能绑定不同输入；两种通道共享 |
| seq / ack / resumeCursor | 区分传输确认与业务受理；支持协商后的事件恢复 |
| expectedRevision / sourceRefs / deploymentVersion | 防止使用过期世界状态、计划和云版本 |
| deadline / cancellation / budget | 有界执行；继承用户和平台实际限制，不自定固定预算 |
| traceRef / usage / evidenceRefs | 审计与成本；不包含密钥和多余私人内容 |

消息类别：握手与能力、调用与受理、进度、工具提案、工具结果/继续、取消与停止确认、状态快照/协调、错误、心跳。心跳证明连接活着，不证明任务有进展或执行成功。本文是设计分类，不宣称这些名称已进入现有 Schema。

当前落地子集另外定义于 `packages/contracts/schema/agentarts-transport.json`，版本`0.1.0`，并非把上表全部字段或消息宣告为已实现。它包含ready/invoke/accepted/result/error/status/cancel等严格帧，绑定sessionId、requestId、idempotencyKey、payloadDigest、deadline与serverInstanceId；握手公布invoke/status/cancel/ephemeral-replay及`restartRecovery:false`。不存在持久seq/ack/resumeCursor或服务器重启续传能力。公共候选仍是原有text/tool_proposal/repair_candidate1.0，不因传输改变授权语义。

### 10.3 可靠交付与认证

客户端只建立向外连接，不要求用户电脑开放公网端口。认证在可信主进程适配平台当前可用的机制，TLS 校验开启，凭据不放 URL、不进 Renderer 或普通日志。云端绑定租户、主体和部署，不能靠用户传入 taskId 越权查询别人的任务。

复用 MOD-01/03 的数据库与执行日志扩展持久发送/接收记录，不能再造第二套任务库。采用至少一次消息投递与业务去重；任意外部副作用无法通用承诺 exactly-once。已确认结果可重放，未知写入先读回或进入协调。备用通道也必须保持这个规则。

### 10.4 当前WSS实现的可靠性边界

受信配置显式选择`transport:wss`、同网关/同runtime的`websocketUrl`及`allowHttpsFallback`，未配置保留旧HTTPS消费兼容。WSS内层宿主Bearer凭据与平台IAM分开，客户端主进程持有，服务器要求独立宿主令牌；未配置不开放`/ws`。TLS证书、公网Upgrade、代理寿命、身份与凭据失效仍需真实部署核实。

只在invoke从未发送的连接失败时自动改走同目标HTTPS。只要尝试过发送，即使没收到accepted，也视为可能受理；断线、超时或结果未知不能重发同一动作或通过备用重新开始。严格status/终结回执需要匹配原身份与摘要，认证/协议错误不能当作可降级网络失败。

容器使用有界、带期限的内存回执，校验同标识不得替换输入与deadline，结束结果只在当前实例/缓存存活期内重放；不是云端第二套任务事实源。实例重启或回执过期后unknown不表示未执行。连接断开会请求取消原调用，但本地取消或关闭连接不证明外部副作用已停止。

Runtime在实际发送前同步持久化`competition-cloud-inflight`身份/摘要意图；匹配终结回执只记录`competition-cloud-received`身份/摘要，不立即清除意图。只有严格解析的提案已持久进入原`competition-loop`，或原任务已由TaskRuntime持久提交succeeded，才能解除防重发标记；收到结果与本地消费之间崩溃仍等待核实。结果未知另外记录`competition-cloud-unknown`并进入waiting_reconciliation，继续或重启遇到未清意图/未知标记会阻止新发送。三个新checkpoint不保存云payload、模型正文或凭据。当前提供的是保守防重发，不是已完成的公开协调UI、服务器持久续传或自动查询恢复消费者；完成核实、原状态恢复与整链重启读回仍需组合验收。

## 11. 云镜像内部与平台职责

自有镜像承担：输入 Schema 校验、编排、模型入口、工具目录消费、多角色提案、继续轮次、输出校验与 Trace 关联。它调用的是工具端口；实际本地文件、Shell、邮件等动作通过工具提案回本机 Runtime。可选纯云只读能力也需公开目录与独立授权，不能借此绕开本地写入边界。

云镜像不包含 Desktop、用户数据库、仓库全量源码、`.env` 或个人导出文件。代码包通过公开导出复用，凭据由运行时安全注入。当前 `personal-agent-owned:20261008` 已有 ARM64 本地构建和受限验证；这不是 SWR 上传、AgentArts 部署或真实模型/工具验收。

2026-10-09 WSS与完整报告增量当前仅在工作树代码中验证。此前GHCR/GitHub发布的HTTP预览仍按其固定source commit/digest记录，新代码必须重新构建并逐项核实，不能沿用旧镜像测试声明新版已发布。

AgentArts 保留真实构建/Agent/Workflow 编排、部署版本与评估职责。迁移旧 8 个工作流和 3 个多 Agent 时需要逐项核对输入输出语义、错误、世界报告、继续轮次、角色与停止行为，不能把名字相同当作迁移完成。导出文件可能含认证元数据，只使用脱敏后的契约与清单。

运行时生命周期由平台决定；官方文档提示弹性回收和本地磁盘临时性。可靠业务记录保留在本地，云端无状态或采用经批准的外部持久服务。当前不新增另一套云端个人任务事实源。[高代码运行时说明](https://support.huaweicloud.com/highcode-agentarts/agentarts_10_029.html)

### 11.1 World/Plan完整职责与公共候选边界

新版提示词`owned-1.1`输出`reportVersion:1.1`的完整内部World/Plan报告。World保留observed_facts、changed_facts、affected_items及KEEP/RECHECK/REVISE，引用宿主提供的精确事实/Goal前后版本和原summary；推断、缺项、陈旧版本或无连续变化不放行修复。direct/transitive是模型影响分析标签，现有投影不含完整旧依赖边，仍须本地图谱预览确认。

Plan分别记录preserved/rechecked/revised/removed步骤、dependency_updates、evidence_required、missing_information和local_next_actions。步骤分类互斥，影响目标不可遗漏；未列出的无关目标默认保留。确定修订映射原repair_candidate1.0的node/summary/reason，依赖固定采用宿主requestedDependencies；Review不能替换或遗漏方案。

保留不产生写入，待复核条件未满足时RECHECK；删除、新节点或后续工具动作没有现有候选表达，明确返回不支持/缺口，不能伪装成摘要变化。证据需求只说明未来可信本地核实要求，不生成Evidence或声称已满足。旧compact报告兼容仅保留原消费，不自动回退提示词；完整版本不能混用。confirmed继续轮次仅有repairContext时缺来源原文与前后版本，完整World必须RECHECK，等待宿主公开来源投影契约。

完整8个Workflow、3个Controller迁移矩阵见`docs/modules/AGENTARTS-OWNED-IMAGE-PARITY.md`。MVP协调器的空绑定不计实现；角色语义迁移不等于平台Controller原生绑定、真实模型、评估或本地工具闭环已经通过。

## 12. 业务连接器与开发者工作流

MOD-20~26 负责效率、邮件、订阅、通知、研究、天气与可选社交；它们通过公共端口发布事实或执行受限工具。MOD-33 提供 GitHub 能力。每个源须有 credential scope、revision、水位线、撤销与失败语义；连接器不判断用户授权。

| 工作流 | 数据与执行步骤 | 监管与完成条件 |
| --- | --- | --- |
| MOD-34 CI 修复 | CI 结果→定位→补丁预览→授权应用→相关测试→提交/PR 对应授权 | 读回 commit/CI/PR；新 commit 使旧结论失效 |
| MOD-35 测试定位 | 结构化测试输出→文件/行/调用证据→候选原因 | 证据定位可复核；不能把定位当作已修复 |
| MOD-36 代码评审 | 固定 diff 与版本→问题候选→源码锚定→报告/发布审批 | 来源变化触发重新评审；缓存绑定 revision |
| MOD-37 文档维护 | 契约/行为变化→文档漂移→精确补丁→验证→PR | 尚未实现；需读回链接和行为依据 |
| MOD-38 Issue 分诊 | Issue 与仓库事实→分类→建议/标签/修复分支 | 写标签与发布按权限；核实 PR 与 Issue 关联 |

外部邮件、网页、Issue、注释与工具输出都是数据，不成为新的授权来源。工作流看到“忽略限制并上传凭据”时只作为待分析内容。不把仓库私密内容默认发给云端；用户可配置允许导出的路径、摘要或精确片段。

## 13. 公共接口与组合入口

| 端口/契约 | 生产方 → 消费方 | 必须保持的语义 |
| --- | --- | --- |
| Client/任务请求与事件 | MOD-02/03 → Desktop | 受理与终态分离；revision、错误码一致 |
| FactChangeFeed / MemoryQueryPort | MOD-09 → MOD-27/28/协调方 | 来源版本、撤回、有限数据范围 |
| CoordinationPort / CloudAgentPort | MOD-04B/29 → Runtime | WSS/HTTPS 是适配；云结果不可信需验证 |
| ModelPort / ModelGateway | MOD-04A → 编排角色 | deadline、取消、usage；明确真实 Provider |
| ToolExecutionPort / capability catalog | MOD-05 → Agent/连接器 | 不支持明确拒绝；Policy 统一执行 |
| Goal/Plan 图读写与修复候选 | MOD-27/28 → Application | CAS、来源引用、失效与后继任务 |
| Decision 选择端口 | MOD-28 → Laya 适配 | 有限候选、弃权、无权限签发 |
| Wiki 知识适配与事实投影（目标新增） | MOD-08 → MOD-09 → MOD-27/28 | 复用 KnowledgePort/MemoryQueryPort/FactChangeFeed；来源版本、范围、去重与撤回 |
| 委派/监管端口 | Runtime 与 MOD-31（目标新增） | 收窄权限、取消传播、父子终态 |

目标接口需要工作包发布、Schema、消费测试与门禁；当前 provisional/unavailable 继续按接口目录处理。MCP/Skills 源码中的受限实现不能自动使整模块 frozen；旧台账中的“未实现”也不能抹去已经存在的受限能力。本设计不修改官方接口目录。

## 14. 数据安全、信任与隐私

信任边界分为用户明确指令、可信配置/凭据宿主、本地 Runtime/Policy、受限执行器、云端 AgentArts、模型与外部数据。云提案、平台“成功”页面和模型输出均不直接证明本地工作完成。

仅上传被授权目标需要的最小子图和内容。sourceRefs 可采用不含秘密的稳定引用；凭据、私人文件全量、邮件附件、原始导出认证内容不能默认进入上下文。日志对错误回显、请求体与 Trace 进行脱敏。Evidence 分别保留执行状态、Schema 校验、外部读回级别，不能把 mock 标记 verified。

共享部署按主体隔离，用户凭据不打包进镜像。协作者的调试数据、个人授权和生产数据分开。会话凭据失效时暂停相应云操作，不因备用 HTTPS 的存在绕过认证。内容注入不得修改用户自主档位、允许网络、授权期限或模型预算。

## 15. 故障、恢复、停止与资源管理

| 情况 | 应有行为 | 禁止的误判/动作 |
| --- | --- | --- |
| WSS 断开 | 协调受理状态；可见降级 HTTPS | 直接重发未知写入 |
| 两个通道都失败 | 本地观察继续；需云决策等待 | 静默运行另一 Local Agent |
| 云容器被回收 | 从本地 checkpoint 重建上下文 | 将云临时磁盘当唯一状态 |
| 认证失败/权限撤销 | 停止相关新动作；提示所需处理 | 改走备用绕过认证 |
| 来源 revision 变化 | 使相关证据失效并重新核实 | 覆盖更新的计划或保留旧结论 |
| 工具响应丢失 | waiting_reconciliation；读回副作用 | 以超时判定“没有执行”并盲重试 |
| 执行进程崩溃 | 记录已开始的操作；恢复先核实 | 重启清空次数/授权消费 |
| 子任务失联 | 租约到期、停新动作、父任务报告不确定 | 将子任务自动标成完成 |
| 用户暂停/取消 | 阻止新分派、传递取消、确认停止 | 仅关 UI 就宣称执行停止 |
| 云提案非法/未注册 | 明确拒绝、保留审计 | 自动猜 DTO 或强行映射工具 |
| 事实源无数据 | unknown/stale 状态，按目标决定等待 | 将缺数据解释为世界没有变化 |
| 资源冲突/队列积压 | 优先级、公平调度、按资源锁、背压 | 长写入占锁导致全部只读饥饿 |

事件合并窗口、检查频率、模型/步骤预算应从目标与用户配置读取，并服从平台限制。本方案不替用户设定固定金额或时间上限。运行时使用 deadline、取消信号和资源租约，关闭时持久化 checkpoint，并显示仍待确认的操作。

## 16. 部署、镜像分享与协作者协作

协作者分享使用用户已选择的GitHub/GHCR：源代码、锁文件、构建说明、契约/接口目录和镜像固定tag+digest；GitHub Release的镜像归档tar供离线交付。单独给镜像不包含源码协作、权限配置、运行参数或验收依据。个人凭据和原始导出文件不作为协作包内容。

云发布步骤：确认 ARM64/协议 → 构建受限上下文 → 扫描敏感文件 → 推送 SWR → 确认 AgentArts 拉取权限 → 部署版本 → WSS/HTTPS 实际握手与调用 → 真实工具闭环 → 评估 → 小范围启用 → 记录回滚入口。固定依赖版本，镜像以非 root 运行；更换镜像不自动迁移本地数据库或扩大工具权限。

回滚选择上一可用 deployment/image，客户端协商其 capabilities。协议或数据迁移不兼容时暂停，而不是隐式降级另一产品 profile。保留旧部署直到新版本验收；GHCR协作发布不能代替华为云镜像拉取权限、Deployment与真实链路验收，平台要求时另外通过SWR部署。

goo122 负责底座、协议、Policy/网关、模型与知识记忆及 33/36/37；zemeng 负责协调、目标认知、AgentArts、Desktop/Windows/语音与编程工具；Potatos498 独立负责 20~26、34/35/38 的业务接线和验收。实施工作包需有唯一负责人和文件所有权，公共变更说明兼容影响；本设计不自动委派或开新任务。

## 17. 可观测性与验收证据

每次运行关联 goalId、taskId、requestId、sessionId、deploymentVersion、modelRequest、toolRun、sourceRevision、授权摘要与 Evidence。日志里的摘要不含可用 token 或密钥。连接状态、任务状态与工具副作用分别观测。

指标覆盖：有效变化/噪声比、受影响节点数/总节点数、修复范围、过期证据拒绝、重复请求跳过、误放行、审批等待、取消停止时间、未知结果协调、WSS 降级频率、HTTPS 延迟、云用量与失败。稳定无变化不定期生成“我还在运行”的模型消息。

验收分三层：离线契约/Fake、真实外部接口、完整产品闭环。当前本地镜像的合成请求和隔离测试只能证明其被测路径；控制台可打开、部署显示成功或一次真实读取都不能替代所有 MOD 验收。

## 18. 验收场景与评估集

| 场景 | 核心证据与负向要求 |
| --- | --- |
| CI 变化增量修复 | 真实 commit/source revision；只修受影响节点；相关测试与读回 |
| 日历源变更 | 真实源 revision 进入 Fact 图；旧决定失效；未授权写入被阻止 |
| WSS→HTTPS→WSS | 同 task/idempotency；无重复副作用；可见降级与能力变化 |
| 跨重启恢复 | 已消费授权不重用；未知写入协调；已完成结果可重放 |
| 无人监管低风险执行 | 范围内动作正常；越路径/越账户/过期/撤销被拒绝 |
| 提示注入 | 外部内容不能扩大权限/导出数据/修改策略 |
| 多 Agent 委派 | 权限收窄、依赖无环、停止传播、验证者独立证据 |
| Laya 决策评估 | 标注集上的错误、弃权、升级、校准指标；阈值变更有依据 |
| 真实 AgentArts Golden Path | deployment/API/trace→提案→Policy→工具→读回→终态 |
| 安静运行与通知 | 未变化不扰动；重要失败/审批通知；跨重启去重 |

产品实现时运行实际工作树对应检查；涉及公共契约/Runtime 接线按仓库要求执行 `npm run check`。设计文档与 SVG 校验数据、路径、语法、差异与渲染；镜像代码/容器/发布验证另行记录，不消耗真实模型费用替代离线验证。

## 19. 完成度估算：口径、全部模块与缺口

百分比回答“距离本方案的目标完成到什么程度”，不是历史工作包的合并比例、测试通过率或线上成功概率。评分维度：契约/设计 20、实现 30、消费接线 20、目标真实验收 20、恢复/安全 10；各项由源码与记录做保守工程判断，和为估算值。区间表示判断不确定性，不能当统计置信区间。没有完整重新运行验收，所以不报 100%。不求模块平均值：各模块工作量不同，零进度的可选扩展与关键通道影响也不同。

历史台账的 done 表示当时工作包完成，不能证明本轮常驻自主目标完成。MCP/Skills 有固定受限实现；Windows/编程工具有接线基础，这些已计入。其他工作树的在途成果未计入。下面表格来自 [modules.json](modules.json)，是设计快照，不替代 ROADMAP 与 MODULE_ASSIGNMENTS。

<!-- MODULE_TABLE_START -->
| 模块 | 负责人 / 位置 | 估算与区间 | 五项得分 | 依据与主要剩余缺口 |
| --- | --- | --- | --- | --- |
| MOD-01 工程与存储底座 | goo122<br>packages/storage；根配置 | **85%**；75–95% | 20 / 30 / 20 / 10 / 5 | 依据：packages/storage；docs/ROADMAP.md<br>缺口：常驻长时间运行、升级保留数据和跨重启队列需联合验收。 |
| MOD-02 公共契约与客户端 | goo122<br>packages/contracts；packages/client；packages/testkit | **75%**；65–85% | 20 / 25 / 20 / 5 / 5 | 依据：packages/contracts/schema/agentarts-transport.json；docs/DEVELOPMENT_PROTOCOL.md<br>缺口：10-09 传输0.1.0严格信封/能力已有 provisional 本地实现；真实网关认证、重启恢复与消费端组合待验收，不能扩展旧 frozen 子集。 |
| MOD-03 任务 Runtime | goo122<br>apps/runtime/src/application；Runtime 核心 | **75%**；60–80% | 20 / 25 / 20 / 5 / 5 | 依据：apps/runtime/src/application/agentarts.ts；apps/runtime/src/application/coordination.ts；docs/ARCHITECTURE.md<br>缺口：10-09 发送前持久意图/结果未知防重发已有 provisional 本地接线；真实网关和重启恢复消费者、持续租约及无人监管组合待验收。 |
| MOD-04A 模型网关与 Provider | goo122<br>packages/models；云镜像通过公开导出消费 | **70%**；60–80% | 20 / 25 / 15 / 5 / 5 | 依据：packages/models；docs/modules/MOD-04A-LIVE-RESPONSE-RECOVERY-20261008.md<br>缺口：自有镜像中的真实模型与工具提案闭环未证实；不能把文字 JSON 提案视为原生工具调用。 |
| MOD-04B 协调与云端口 | zemeng<br>packages/coordination；Runtime CloudAgentPort 消费方 | **55%**；40–70% | 15 / 20 / 15 / 0 / 5 | 依据：packages/coordination/src/agentarts-websocket.ts；packages/coordination/src/agentarts.ts；docs/adr/0012-owned-agentarts-image.md<br>缺口：10-09 WSS主通道与invoke未发送时HTTPS备用已有 provisional 本地实现；已发送未知结果禁止重发，真实网关/完整恢复消费待验收。 |
| MOD-05 Policy 与工具网关 | goo122<br>packages/policy；packages/tool-gateway；packages/connector-host | **55%**；40–70% | 20 / 20 / 10 / 0 / 5 | 依据：packages/policy；packages/tool-gateway；docs/interfaces/CURRENT_INTERFACE_CATALOG.md<br>缺口：持久无人值守授权、撤销竞态、跨传输去重与强隔离组合验收不足。 |
| MOD-06 本地 MCP | goo122<br>packages/mcp；可信宿主的固定 stdio 服务 | **55%**；40–70% | 15 / 20 / 10 / 5 / 5 | 依据：packages/mcp/README.md；docs/modules/MOD-06-07-MVP.md<br>缺口：已有受限只读参考服务；任意服务、写操作及通用恢复不在已证实范围。 |
| MOD-07 Skills 执行 | goo122<br>packages/skills；固定 reference-summary Bundle | **50%**；35–65% | 15 / 20 / 10 / 0 / 5 | 依据：packages/skills/README.md；docs/modules/MOD-06-07-MVP.md<br>缺口：已有固定受限 Skill；任意脚本/下载运行、完整审批恢复与云端消费未验收。 |
| MOD-08 知识与 Wiki/Obsidian | goo122<br>packages/knowledge；Wiki 适配/受控写入 | **45%**；30–60% | 15 / 15 / 10 / 0 / 5 | 依据：packages/knowledge；docs/MODULE_ASSIGNMENTS.md<br>缺口：新增 Wiki 长期知识设计由 goo122 实现；自动索引、来源同步、双向写回及常驻消费尚待交付/真实验收。 |
| MOD-09 记忆与 Wiki 投影 | goo122<br>packages/memory；packages/learning | **65%**；50–80% | 20 / 20 / 15 / 5 / 5 | 依据：packages/memory；docs/modules/MOD-09-VAULT-LIFECYCLE-20261008.md<br>缺口：新增 Wiki→版本化事实/检索投影由 goo122 实现；来源 revision、双向去重、撤回、跨存储恢复和出机控制需联合验收。 |
| MOD-10 模型研究与训练 | zemeng<br>docs/research/agentarts；后续模型研究工作包 | **20%**；5–35% | 10 / 5 / 5 / 0 / 0 | 依据：docs/research/agentarts；docs/MODULE_ASSIGNMENTS.md<br>缺口：研究材料不等于训练完成；Laya 开发者场景标注集、校准与训练尚未交付。 |
| MOD-11 Desktop 外壳与桥接 | zemeng<br>apps/desktop；Electron 主进程/Preload/IPC | **75%**；65–85% | 20 / 25 / 20 / 5 / 5 | 依据：apps/desktop；docs/PROJECT_STRUCTURE.md<br>缺口：主进程内 Runtime 已有基础；无人监管状态展示、长驻恢复和权限改动需验收。 |
| MOD-12 Orb 与对话体验 | zemeng<br>apps/desktop 的 Orb/Conversation 功能 | **70%**；60–80% | 20 / 25 / 15 / 5 / 5 | 依据：apps/desktop；docs/design/voice-first-proactive-agent-laya-proposal.md<br>缺口：责任面板、委派监管关系、降级状态和多窗口/DPI 组合体验待完成。 |
| MOD-13 管理与自主设置 | zemeng<br>apps/desktop 的 Settings/Admin 功能 | **60%**；45–75% | 15 / 20 / 15 / 5 / 5 | 依据：apps/desktop；docs/MODULE_ASSIGNMENTS.md<br>缺口：Laya 策略、权限租约、隔离档位与 Runtime 实际行为需端到端绑定。 |
| MOD-14 ASR/TTS 与实时语音 | zemeng<br>packages/voice；apps/desktop/electron/live-voice-host.js | **50%**；35–65% | 15 / 20 / 10 / 0 / 5 | 依据：packages/voice/README.md；apps/desktop；docs/MODULE_ASSIGNMENTS.md<br>缺口：真实语音链路、打断与任务取消区分、设备恢复仍有验收缺口。 |
| MOD-15 可选语音唤醒 | zemeng<br>packages/voice-wake；apps/desktop/electron/wake-voice-host.js | **35%**；20–50% | 15 / 10 / 5 / 0 / 5 | 依据：packages/voice-wake/README.md；apps/desktop；docs/MODULE_ASSIGNMENTS.md<br>缺口：默认关闭；真实中文唤醒、误触发和设备占用未形成完整证据。 |
| MOD-16 Windows Host | zemeng<br>apps/windows-host；Runtime windows-host-adapter | **50%**；35–65% | 15 / 20 / 10 / 0 / 5 | 依据：apps/windows-host/README.md；docs/MODULE_ASSIGNMENTS.md<br>缺口：已有受限实现；真实 UIA 执行读回与进程隔离不足，握手不能证明操作成功。 |
| MOD-17 电脑状态观察 | zemeng<br>packages/windows-client | **60%**；45–75% | 20 / 20 / 15 / 0 / 5 | 依据：packages/windows-client/README.md；docs/ROADMAP.md<br>缺口：需接入版本化世界事实；状态观测不等于任意桌面控制或故障因果诊断。 |
| MOD-18 编程工具与工件 | zemeng<br>packages/coding-tools；工作区受限工具 | **65%**；50–80% | 20 / 20 / 15 / 5 / 5 | 依据：packages/coding-tools；docs/modules/MOD-27-28-INTEGRATION-HANDOFF.md<br>缺口：读/预览/补丁已有接线；任意命令强沙箱、Windows 长作业与工件服务待闭环。 |
| MOD-19 Windows 分发 | zemeng<br>scripts/release；apps/desktop | **20%**；5–35% | 10 / 5 / 5 / 0 / 0 | 依据：docs/modules/MOD-19-RELEASE-PREFLIGHT-01.md；docs/MODULE_ASSIGNMENTS.md<br>缺口：已有打包前置工作；安装/运行/升级未完整验收，目前暂停，不作为设计交付门槛。 |
| MOD-20 效率与日历 | Potatos498<br>packages/productivity；packages/connectors/calendar | **60%**；45–75% | 20 / 20 / 15 / 0 / 5 | 依据：packages/productivity；packages/connectors/calendar；docs/modules/CONNECTORS-RUNTIME-INTEGRATION.md<br>缺口：日历源 revision 与真实 Fact 投影需闭环；账户写入和全时区行为未完整验收。 |
| MOD-21 邮件连接器 | Potatos498<br>packages/connectors/mail | **65%**；50–80% | 20 / 20 / 15 / 5 / 5 | 依据：packages/connectors；docs/MODULE_ASSIGNMENTS.md<br>缺口：历史有限真实链路不代表完整账户生命周期；读取、发送、无人值守授权分别控制。 |
| MOD-22 RSS/Atom 订阅 | Potatos498<br>packages/connectors/feeds | **75%**；65–85% | 20 / 25 / 20 / 5 / 5 | 依据：packages/connectors；docs/ROADMAP.md<br>缺口：已有去重/水位线/真实读取记录；世界状态投影、噪声过滤和长期监管待组合验收。 |
| MOD-23 通知与提醒 | Potatos498<br>packages/notifications；Desktop 消费 | **65%**；50–80% | 20 / 20 / 15 / 5 / 5 | 依据：packages/notifications；docs/ROADMAP.md<br>缺口：已有静默、暂停与确认基础；源事件到界面、跨重启通知去重需真实验收。 |
| MOD-24 资料研究 | Potatos498<br>packages/connectors/research | **70%**；55–85% | 20 / 25 / 15 / 5 / 5 | 依据：packages/connectors；docs/ROADMAP.md<br>缺口：已有 OpenAlex 等有限源；广泛网页检索、来源新鲜度与研究目标链未全部实现。 |
| MOD-25 天气与环境 | Potatos498<br>packages/connectors/weather | **80%**；70–90% | 20 / 25 / 20 / 10 / 5 | 依据：packages/connectors；docs/ROADMAP.md<br>缺口：已有较充分连接器证据；条件化失败语义到 AgentArts 常驻目标闭环仍需验证。 |
| MOD-26 可选社交连接器 | Potatos498<br>待选择平台后在 packages/connectors 扩展 | **0%**；0% | 0 / 0 / 0 / 0 / 0 | 依据：docs/MODULE_ASSIGNMENTS.md；docs/ROADMAP.md<br>缺口：未确定平台、未开工；属于可选扩展，不阻塞开发者核心路径。 |
| MOD-27 目标与世界状态图 | zemeng<br>packages/goals；版本化 Goal/Fact/Decision/Plan | **65%**；50–80% | 20 / 20 / 15 / 5 / 5 | 依据：packages/goals；docs/modules/MOD-27-28-INTEGRATION-HANDOFF.md<br>缺口：CAS/图基础已有；真实源 provenance、监管节点和完整影响传播待完成。 |
| MOD-28 持续认知与 Laya | zemeng<br>packages/cognition；Laya Action Choice/Repair | **55%**；40–70% | 20 / 20 / 10 / 0 / 5 | 依据：packages/cognition/src/laya-action-choice.ts；docs/modules/MOD-28-LAYA-DECISION-01.md<br>缺口：代码保留 calibrated:false；用户配置、领域校准、真实 AgentArts 修复和监管闭环未完成。 |
| MOD-29 AgentArts 基础与镜像 | zemeng<br>packages/agentarts；apps/agentarts-runtime | **45%**；30–60% | 15 / 20 / 10 / 0 / 0 | 依据：apps/agentarts-runtime/src/websocket-transport.mjs；docs/adr/0012-owned-agentarts-image.md；docs/modules/AGENTARTS-OWNED-IMAGE-MIGRATION.md<br>缺口：10-09 容器/ws与有界内存回执为 provisional；restartRecovery=false。新版镜像/真实部署、公开WSS路径与认证待验收。 |
| MOD-30 云工作流与单 Agent | zemeng<br>apps/agentarts-runtime；编排与继续轮次 | **50%**；35–65% | 15 / 20 / 10 / 0 / 5 | 依据：packages/agentarts/src/index.ts；docs/modules/AGENTARTS-OWNED-IMAGE-PARITY.md；docs/modules/AGENTARTS-OWNED-IMAGE-MIGRATION.md<br>缺口：10-09 完整World/Plan内部职责已有受限版本化实现；缺来源RECHECK，删除/新步骤/动作不在既有候选协议；真实模型及云修复闭环待验收。 |
| MOD-31 多 Agent 与评估 | zemeng<br>AgentArts 角色编排；Runtime Subagent Host 消费 | **35%**；20–50% | 10 / 15 / 5 / 0 / 5 | 依据：apps/runtime/src/application；docs/MODULE_ASSIGNMENTS.md<br>缺口：有委派基础；执行/验证/监管角色完整授权衰减与真实云评估仍缺。 |
| MOD-32 云 API/Trace/运维 | zemeng<br>AgentArts API；tests/manual/agentarts；云观测 | **30%**；15–45% | 10 / 10 / 5 / 0 / 5 | 依据：tests/manual/agentarts；docs/modules/AGENTARTS-OWNED-IMAGE-MIGRATION.md<br>缺口：新镜像部署版本、真实 Trace/用量、传输降级与回滚尚未完整验收。 |
| MOD-33 GitHub 能力 | goo122<br>packages/connectors/github | **75%**；65–85% | 20 / 25 / 20 / 5 / 5 | 依据：packages/connectors/github；docs/MODULE_ASSIGNMENTS.md<br>缺口：已有受限真实读取与 Fake；PR/写操作的长期授权和结果核实仍需验收。 |
| MOD-34 CI 修复工作流 | Potatos498<br>DEV-WORKFLOWS；CI Fix；coding-tools/git-tools | **60%**；45–75% | 15 / 20 / 15 / 5 / 5 | 依据：packages/coding-tools；docs/MODULE_ASSIGNMENTS.md<br>缺口：历史有限修复证据；AgentArts 主路径、停止竞态与完整 PR 读回待完成。 |
| MOD-35 测试定位工作流 | Potatos498<br>DEV-WORKFLOWS；Test Locate；TAP/证据定位 | **70%**；55–85% | 20 / 25 / 15 / 5 / 5 | 依据：packages/coding-tools；docs/MODULE_ASSIGNMENTS.md<br>缺口：已有结构化定位；不同框架、来源变化及真实任务解释质量需评估。 |
| MOD-36 代码评审工作流 | goo122<br>packages/cognition 的 Code Review；GitHub 消费 | **65%**；50–80% | 20 / 20 / 15 / 5 / 5 | 依据：packages/cognition；docs/MODULE_ASSIGNMENTS.md<br>缺口：已有 diff 证据锚定和恢复基础；真实发布评审及权限/缓存新鲜度待闭环。 |
| MOD-37 文档维护工作流 | goo122<br>DEV-WORKFLOWS；后续漂移检测/补丁/PR 工作包 | **0%**；0% | 0 / 0 / 0 / 0 / 0 | 依据：docs/MODULE_ASSIGNMENTS.md；docs/ROADMAP.md<br>缺口：规划项，未交付；本设计文档本身不计为自动文档维护能力。 |
| MOD-38 Issue 分诊与修复 | Potatos498<br>packages/cognition 的 Issue Triage；GitHub 消费 | **50%**；35–65% | 15 / 20 / 10 / 0 / 5 | 依据：packages/cognition；docs/MODULE_ASSIGNMENTS.md<br>缺口：已有受限分诊基础；真实标签/修复 PR/Issue 关联和监管结果待完成。 |
<!-- MODULE_TABLE_END -->

明确尚未通过本目标验收的横向缺口：**WSS 真实链路、双通道协调与自动切换、持久无人值守授权、完整委派监管、Laya 领域校准、任意命令强沙箱、真实云镜像 Golden Path**。图中标成“新增目标待验收”，不通过旧模块完成率掩盖。

## 20. 实施顺序与可独立评审的工作包

| 顺序 | 工作包与负责人 | 必须先证明的最小结果 |
| --- | --- | --- |
| 1 | MOD-02/04B/29：协议与双通道；goo122 + zemeng，逐文件明确所有权 | 实际公开 WSS 路径；HTTPS 同协议调用；切换去重；不猜平台能力 |
| 2 | MOD-29/30/32：新镜像云部署；zemeng | 真实模型→工具提案→本地 Policy→工具读回；部署/API/Trace 关联 |
| 3 | MOD-09/20/27/28：可信变化与增量修复；各模块负责人 | 一个真实源 revision 进入图，CAS 更新局部计划；过期输入拒绝 |
| 3 内独立包 | MOD-08/09：Wiki 记忆接入；goo122 | 授权 Wiki→版本化引用/投影→真实编辑失效→增量修复；受控写回与崩溃恢复分别验证 |
| 4 | MOD-03/05/13/16/18：预授权与受限执行；goo122/zemeng | 低风险无人监管执行；撤销、过期、越界与未知结果正确处理 |
| 5 | MOD-28/31：委派与监管；zemeng，Runtime 契约协同 | 子任务收窄权限；独立核实；取消传播；跨重启监管恢复 |
| 6 | MOD-10/28：Laya 领域评估；zemeng | 标注集、误放行/弃权指标、可复现阈值；未校准不开放高风险 |
| 7 | MOD-11~15/23：完整产品体验；zemeng/Potatos498 | 责任创建、审批、降级、证据、暂停在界面真实闭环 |
| 8 | MOD-33~38：逐个开发者工作流；既定负责人 | 真实 Git/CI/Issue 证据与受限写入；不集中代验别人的模块 |
| 后续 | MOD-19/26/37 和其他扩展；对应负责人 | 需要时再做分发、社交或完整文档维护；不影响先证明核心闭环 |

上述顺序是依赖安排，不是新的开工、委派、付费或发布授权。每个包包括公开契约、实现、消费方、失败路径验证和文档证据，不能只把“接口接进镜像”当完成。

## 21. 术语与阅读图例

| 术语 | 本方案中的意思 |
| --- | --- |
| MOD | 仓库的功能模块编号；不是一一对应独立进程 |
| Runtime / Application | 维护任务状态及调度执行的可信本地层/装配层 |
| Agent / Workflow | 基于模型进行规划判断的角色/多步骤编排流程 |
| WSS / HTTPS / SSE | 加密双向长连接／加密 HTTP／HTTP 上云到客户端的事件流 |
| IPC / Preload | Electron 进程通信／向 Renderer 暴露有限 API 的桥接层 |
| Port / Adapter | 能力契约／某个服务或传输的实现，便于隔离替换 |
| Schema / capability | 输入输出的可校验结构／实际公布且可调用的能力 |
| Policy / Approval | 宿主权限规则／用户对具体操作的批准 |
| Lease / Sandbox | 带期限可撤销的使用授权／执行时的资源隔离边界 |
| Fact / revision / provenance | 可核实事实／版本／事实来源和获得过程 |
| CAS / checkpoint | 版本一致才提交／可恢复的执行检查点 |
| idempotency / reconciliation | 重复调用不重复产生已确认结果／结果未知时核实协调 |
| Trace / Evidence | 云调用追踪／可信执行与实际读回凭据，两者不能互相替代 |
| SWR / image / container | 华为镜像仓库／打包的运行代码及依赖／镜像运行实例 |
| ModelGateway / Provider | 统一模型调用入口／具体模型服务适配 |
| MCP / Skill | 工具互操作协议／受限步骤资产；二者都不是权限来源 |
| calibrated / confidence | 概率与实际准确性经过领域检验／模型的置信指标 |
| frozen / provisional / unavailable | 已公布冻结子集／暂定契约／不能作为真实能力消费 |
| Golden Path | 比赛真实云编排到本地工具读回的完整主路径 |
| Electron / Renderer | Windows 桌面框架／用于显示界面的渲染进程；与可信主进程分开 |
| ASR / TTS / UIA | 语音转文字／文字转语音／Windows 界面自动化接口 |
| stdio / Named Pipe | 子进程标准输入输出通信／Windows 本机进程通信管道 |
| CI / PR / Issue / HEAD / diff | 自动集成测试流程／代码合并请求／问题单／当前 Git 提交／代码差异 |
| ARM64 / Node / tag / digest | CPU 架构／JavaScript 运行时／镜像可读标签／镜像内容哈希标识 |
| deadline / token / budget | 本次调用截止时刻／模型处理文本的计量单位／允许消耗的额度或步骤 |
| payloadDigest / ack / cursor | 消息内容摘要／收到或受理的明确确认／恢复事件读取位置 |
| DTO / scope / DAG | 数据传输对象／允许的资源范围／没有依赖循环的任务图 |
| confidence / margin / entropy | 答案置信／最高候选与次高候选差距／分布不确定性指标；都不是授权 |
| jitter / backpressure / rollback | 重连等待加入随机扰动／队列积压时限制继续发送／退回已验证旧版本 |
| Wiki / backlink / projection | 可编辑且有页面关联的知识库／指向当前页的反向链接／从来源生成、可重建的检索或事实表示 |

图中颜色区分职责区域，箭头表示目标数据/控制流；不表示相邻模块任意互相导入。百分比是上述目标估算。横向缺口单独列出。实线的目标流程也可能尚未实现，必须结合本快照和源码判断。

## 22. 依据与仍需确认的事项

仓库依据：`docs/PRD.md`、`ARCHITECTURE.md`、`PROJECT_STRUCTURE.md`、`DEVELOPMENT_PROTOCOL.md`、`MODULE_ASSIGNMENTS.md`、`ROADMAP.md`、`interfaces/CURRENT_INTERFACE_CATALOG.md`、`competition/HUAWEI_ICT_AGENTARTS_PROFILE.md`、`adr/0012-owned-agentarts-image.md`，以及模块表逐项 evidence。源码与台账冲突时记录范围，不把存在目录当作实现或冻结证据。

平台待实测：公网 WSS 地址及 Upgrade 支持、认证与过期、连接/会话寿命、代理断流、HTTPS 事件恢复能力、运行时架构与镜像拉取权限、真实 Provider 工具提案语义、Trace/评估与用量。平台文档中的容器 `/ws` 支持不足以回答这些全部问题。

产品待决定但不阻塞本设计：自主权限的具体预设、首个长期责任与真实数据源、强隔离执行器选型、领域评估标注标准、可选社交平台。实现时优先证明一个真实责任闭环，再扩展来源和工作流。

本方案已经体现用户选择的 **WSS 主通道 + HTTPS 备用、电脑运行时常驻自主、Laya 辅助可信决策、用户权限与沙箱设置、增量修复及监管委派**。这些是拟实施目标；当前完成度与真实验收缺口由模块快照约束。
