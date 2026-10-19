# 自有镜像 Workflow / Controller 迁移矩阵

## 2026-10-12：全部可承载资源的可执行绑定

本轮新增固定 8 Workflow、3 Controller 的实际调用入口，编译进镜像的安全目录见
[绑定清单](OWNED-IMAGE-BINDINGS.json)，调用与前置报告见 [绑定接口](../competition/OWNED_IMAGE_BINDINGS.md)。
World/Plan 可分别返回经校验的角色报告；Review 重验同一宿主来源后返回原候选1.0。
两个持续认知 Controller 只执行一次固定图，原空 MVP 使用新的 owned 主路由并明确
标记 new-owned-binding。确定性意图可零模型选择当前宿主公布的检查/构建/测试提案。

下文 migrated subset/partial/unavailable 是原云资源的语义等价和真实依赖缺口，
不能与本轮 owned 绑定的可调用状态混为一项。原 Controller 的空绑定、未映射计划操作、
平台历史/插件、真实来源/账号和平台部署缺口仍如实保留。
绑定代码、测试、镜像 source SHA/digest 和真实云验收分别在工作包记录，合并门槛不变。
源码 `0dae0ff5` 的双架构预览已发布，四次本地/发布镜像绑定测试均9/9，
下载与验证记录见 [发布入口](../competition/OWNED_IMAGE_BINDINGS.md#已发布预览与使用入口2026-10-12)。
这只提升 owned 绑定与镜像交付证据，不提升下文原平台语义等价或真实部署状态。

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。常规 PR 须取得一名合资格非作者对当前 head 的有效批准；Owner 仅可对具体 PR 作有记录的审核例外，必需技术 CI 不豁免。有权限者（包括作者）在严格主线更新、无冲突及阻断问题解决后可正常合并。各负责人完成本工作包的实现、必要接线、验证、Evidence 和文档；历史作者、审批与验收按原日期和范围保留，旧两人本机阅读门槛不作为现行要求。

初始日期：2026-10-09；当前更新：2026-10-12。目标 profile：`huawei_ict_agentarts`。本文件记录代码迁移和真实验收缺口，
设计与既有云资源不自动成为已实现能力。合并仍遵守
[两人本机阅读与确认](../reviews/DESIGN_READING_GATE.md)。

## 依据与状态

已授权原始导出只在本机解析；原件、凭据、账号配置及私人输入不进入仓库或镜像。
资源名称、节点拓扑、依赖与片段摘要来自
[8个Workflow清单](AGENTARTS-OWNED-IMAGE-ASSETS.json)及
[3个Controller清单](AGENTARTS-OWNED-IMAGE-CONTROLLERS.json)。清单中的嵌套同ID资源、
拼音名称和模型/Provider条目不重复计为新Workflow或Controller。

`migrated subset` 表示已有受限代码与合成测试；`partial` 表示存在明确未映射职责；
`unavailable` 表示没有对应实现或真实提供者。它们均不等于云部署、真实工具闭环、
平台原生多智能体等价验收或整个MOD完成。原导出的提示词与DSL是迁移素材，不是执行授权。

## 8个顶层Workflow

| 原Workflow | 代码职责与位置 | 本轮内部职责 | 状态与缺口 |
| --- | --- | --- | --- |
| PA-MVP-快速工具与答复 | `packages/agentarts/src/index.ts` 的fast；`prompts.ts` FAST/DISPATCH | 普通文本、动态availableTools目录提案、confirmed结果总结；严格工具名/版本/Schema；只在目录真实有能力时派发 | migrated subset；历史、Studio插件、完整外部账号/业务工具依赖由宿主提供，逐项真实验收未完成 |
| PA-MVP-确定性意图 | `index.ts` commandReceipt与动态fast提案 | 已确认`node-check`/`npm-build`/`npm-test`回执确定性总结，退出码与passed一致性检查 | partial；其他意图由模型及宿主工具目录判断，不声称旧固定正则/硬编码工具分支全部等价；不由云执行命令 |
| PA-世界状态影响分析 | `index.ts` validateWorld、WORLD_PROMPT；`input.ts`宿主投影解析 | observed_facts、changed_facts、direct/transitive affected_items、missing_information、KEEP/RECHECK/REVISE；范围与版本检查 | migrated subset；旧DSL的Branch/Workflow/Code/Aggregation职责已按受限调用路径组织，未执行旧DSL；完整因果边不在投影中，影响标签须本地预览；外部真实来源未验收 |
| PA-计划最小修复 | validatePlan、PLAN_PROMPT | preserved/rechecked/revised/removed、dependency_updates、evidence_required、missing_information、local_next_actions；分类互斥与受影响范围检查 | partial；修订摘要与依赖可映射既有候选，删除/新步骤/后续工具动作没有公共候选表达，明确不支持；通用旧current_plan格式不直接作为新授权输入 |
| PA-计划最小修复_1 | 同上，初始Goal和confirmed修复入口 | 原target版本、初始summary基线/固定requestedSummary、requestedDependencies；完整报告保留复核与证据要求 | partial；初始Goal有连续来源版本时可生成候选；仅有repairContext的confirmed输入缺来源原文，新版必须RECHECK，等待宿主公开来源投影契约；不递增引用或机械复制strategy |
| PA-证据安全审查 | REVIEW_PROMPT与最终Coordination parser | 核对原输入/World/Plan，冲突与缺项拒绝；没有verification、授权、Evidence或执行成功声明 | migrated subset；安全审查输出仍不可信，不能取代本地Policy、图谱预览、CAS、真实工具读回和Evidence |
| PA-证据安全审查_1 | 同一受限review角色和候选一致性检查 | Review不能替换、遗漏或重写已审查changes；可拒绝为text | migrated subset；两个旧角色复用同一受控路径，不声称两种旧提示词/平台模型配置逐字等价或已经独立真实评估 |
| PA-MVP-受限主路由 | parseAgentInput、repairInput、invoke | 普通/结果总结走fast；合法修复依次world→plan→review；命令回执不调用模型；每角色有期限、取消与输出预算 | migrated subset；不运行旧Python/Studio图，未搬入平台History、插件私有状态或未公布能力；未实现新的本地任务库、授权器或工具宿主 |

## 3个顶层Controller

| 原Controller | 可迁移职责 | 当前判断 |
| --- | --- | --- |
| PersonalAgent-MVP协调器 | 原导出缺少可计为可调用实现的有效Workflow绑定 | unavailable；保留资源事实，不能因为存在Controller或模型配置标记已实现 |
| PersonalAgent持续认知协调器 | World→最小Plan→Review分工由OwnedAgentOrchestrator承担 | partial；镜像提供受限角色编排，不代替本地持续Fact/Goal消费、Laya决策、持久状态、监督或平台原生Controller部署 |
| PersonalAgent持续认知协调器_1 | 受限主路由、快速答复/工具提案、计划修复/审查 | partial；目录能力与source投影必须由受信宿主公开，原平台Controller身份、完整运行绑定和真实调用/评估另验收 |

## 完整内部报告1.1/1.2与公共候选

`owned-1.2` 新增显式 prepared Goal target 的完整报告兼容。Goal 目标必须是宿主投影中最新有效的精确来源；World 与 Plan 都使用 `reportVersion:1.2`，World 的 `affected_items.kind:goal` 必须与该已提交 Goal 来源匹配，缺来源的 confirmed 续接不能猜类型。旧 `1.1` 与 compact Decision/Plan 路径保留；Goal 禁止旧报告、compact 和新旧完整报告混用。Fact target、过期目标、跨 ID 前后变化、工具提案和替换候选继续拒绝。此为云端受限候选兼容，不创建另一套写入权限；本地原 Policy、审批、预览、CAS 和读回仍是执行入口。

World固定字段为`reportVersion`、`revision`、`observed_facts`、`changed_facts`、
`affected_items`、`missing_information`、`recommended_disposition`、`summary`。
每条观察包含精确`node{id,revision}`、原summary和`confidence`；变化包含原宿主节点的
`previous`/`current`连续版本引用。未知、旧于投影最新版本、替换原文、仅推断或缺项拒绝
进入REVISE。影响仅涉及宿主targets且引用版本/节点kind匹配；direct/transitive保留为
待本地图谱确认的分析。宿主projection当前不含完整旧dependencies，不能证明完整因果链。

Plan固定字段为`reportVersion`、`base_revision`、`disposition`、四类步骤、
`dependency_updates`、`evidence_required`、`missing_information`、`local_next_actions`。
四类步骤使用精确`node`引用；修订含`replacement`与`reason`。它们分类互斥，
World已确定影响的目标不能在REVISE中遗漏；未列出的无关目标保留。

| 内部语义 | 公共输出/处理 |
| --- | --- |
| preserved_steps | 不产生候选changes，原图由本地保留 |
| rechecked_steps | 存在待核实条件时RECHECK；不能与确定REVISE同时放行 |
| revised_steps | node/replacement/reason映射node/summary/reason；dependencies确定性采用target.requestedDependencies |
| removed_steps | 当前candidateVersion1.0不能表达删除；确定移除返回UNSUPPORTED_CAPABILITY，不伪装成摘要变化 |
| dependency_updates | 仅关联revised_steps，完整引用必须与requestedDependencies相同；不自主添加依赖 |
| evidence_required | 保留到Review的未满足本地核实要求，不变成evidenceRefs或可信执行证据 |
| local_next_actions | 不执行、不获得授权；确定下一步动作不在候选契约中，返回UNSUPPORTED_CAPABILITY |
| 新步骤/扩大目标 | 未获宿主target引用，拒绝；不创建云端任务或图节点 |

最终只输出原有`text`、`tool_proposal`、`repair_candidate(candidateVersion1.0)`，
不扩公共候选字段。即使模型返回“已读回/已授权/已完成”，也不能当作可信状态。
ModelGateway保持唯一模型入口，工具执行仍由Runtime/Policy/ToolGateway负责。

## 兼容、验证与后续交接

保留旧`owned-1.0`紧凑World/Plan解析以维持已知消费夹具。新版`owned-1.1`完整报告必须
显式`reportVersion:1.1`；两阶段不能混用完整与紧凑报告。旧导出无版本完整报告不直接
信任执行，先通过版本化提示词生成并严格校验。继续轮次仅含repairContext时没有来源
原文与前后版本，完整World返回RECHECK；补齐宿主公开契约之前不能通过猜测解锁。
初始Goal禁止陈旧target/allowedDependency引用、0版本和控制字符标识。

本轮包构建、类型检查与18个测试覆盖：完整报告到既有候选的映射、无关目标保留、
版本/来源/范围替换、推断/缺项、冲突分类、依赖替换、待复核停止、缺来源停止、
无法表达行为明确不支持，以及Review不能替换方案。均使用显式Fake，不调用真实付费模型。
根集成与镜像/WSS检查由主工作包记录，不用本包测试代替部署或真实平台验收。

下一步依分工完成：goo122公布Wiki/来源与持续Fact投影契约；zemeng完成AgentArts镜像
真实部署/Trace与Goal/Fact修复闭环；Potatos498逐项公布业务连接器工具目录及真实读回。
任何新删除/新节点/动作契约必须经过公开协议与本地Policy语义设计，不能私改候选DTO。
