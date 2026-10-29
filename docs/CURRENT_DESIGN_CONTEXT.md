# 当前设计与实施状态（更新2026-10-18，保留历史）

<!-- current-design-alignment-20261015 -->
## 当前 Profile 边界（2026-10-18）

当前只实施 Competition Profile，由 AgentArts 负责 Competition Agent/Workflow 的构建、编排、评估和部署；本地 Runtime 经 `CloudAgentPort` 调用已部署工作流。本机 Laya 在 Competition 中保留邮件/天气提醒选择及默认编码修复的既有有界判断，并可对当前已观察窗口的有限控件提出建议，独立 Local Profile 仍是实验候选；Laya 不授予权限或接管工具执行，AgentArts 失败不静默回退到 Local Profile。

## 2026-10-15 本机 Laya 实验摘要与回执（历史）

统一入口为[当前详细设计](design/CURRENT_DESIGN_20261015.md)、[28项逐图状态](design/WORKFLOW_STATUS_20261015.md)、
[历史导航](design/README.md)、[具体新分工](competition/COLLABORATOR_WIRING_PACKAGE.md)。
当时试验包含本机Laya、镜像全部28/185串行编排、AgentArts代理DeepSeek、百炼语音和原Runtime可信执行；这些不是当前 Competition 路径说明。
主动来源跟踪有出处的责任/关注，原文/Goal/记忆/上下文参与判断；无人值守与有效归来摘要、用户可调打扰/静默feed、
最终语音询问确认复用原公开端口。高级影子并入已有判断、主任务优先、机会资源/收益选择，未知升级DeepSeek；
只有双方案择优任务等双方，其他任务可先交已验主结果。真实机会调度仍待接线，当前两runner顺序await主/影。

SWR local-laya-v3-244ca434与云arm64-local-v3-244ca434目录/关联日志已验；两案例完整表面为本机同版镜像、
本机Runtime/Policy/工具/Laya与远端AA代理。flow/外层耗时分别Wukong167.432/183.618s、Pelican第二轮81.611/89.735s。
41条Evidence，分支父succeeded但协调锚点created；首轮Pelican partial独立保留。
Laya6判断182–618ms未达150ms、各案例3裁决升级DeepSeek；无高级调用减少、训练或28业务全验收证据。
部署事实见[owned-release](competition/evidence/test-image-v3-20261015/owned-release.json)，执行事实见
[full-workflow-results](competition/evidence/test-image-v3-20261015/full-workflow-results.json)，启动见[RUN](competition/TEST_IMAGE_V3_RUN.md)。

下列原10-09/早期10-15内容是历史上下文，冲突的部署、发布、完成与旧协作门槛均不再作为当前要求。

## 2026-10-15 Owner 修订（历史）

当时采用 **本机 Laya + 自有镜像内 28 工作流 + 串行推进**，协作者经现有 Runtime/Policy/ToolGateway
接本地工具、宿主观察和条件检查。该试验方案已被上方当前 Profile 边界取代；主流程与隔离影子纳入鹈鹕动画故障的增量修复实测。
本机低 CPU 占用与 150 ms 判断为验收目标，未通过实测前不声明达标。
当时实现与接口见 [ADR-0030](adr/0030-local-laya-serial-image-workflows.md)、
[接线文档](competition/LOCAL_LAYA_WORKFLOW_WIRING.md)。当时“镜像先不发布”已被新授权与SWR实际发布取代，main/PR集成仍单独确认。
下文 10-09 和 10-14 嵌入式部署说明作为历史依据保留，不覆盖 2026-10-18 当前 Profile 边界。

产品方向：面向开发者的常驻自主助手。电脑运行时观察已授权世界变化，修复受影响计划、委派执行与监管；不引入独立云电脑。完整正文与图是目标设计，不把文档、目录或镜像构建当作能力验收。

## 历史设计入口（原10-09）

- [完整方案（22 章节）](design/resident-developer-agent-20261008/DESIGN.md)
- [离线阅读页与模块搜索](design/resident-developer-agent-20261008/index.html)
- [39 模块总图](design/resident-developer-agent-20261008/architecture-overview.svg)、[自主闭环](design/resident-developer-agent-20261008/autonomy-lifecycle.svg)、[信任/双通道](design/resident-developer-agent-20261008/trust-and-transport.svg)、[Wiki 记忆](design/resident-developer-agent-20261008/wiki-memory.svg)
- [Wiki 接入交接：goo122](design/resident-developer-agent-20261008/WIKI-MEMORY-HANDOFF.md)
- [历史设计阅读记录（当前合并规则见 CONTRIBUTING）](reviews/DESIGN_READING_GATE.md)
- [新版 WSS 镜像发布记录与来源](competition/OWNED_IMAGE_WSS_RELEASE_20261009.md)、[GitHub 预发布下载](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-97aa51a6)

## 应同步到各模块的边界

| 事项 | 当前选择 | 实施/验收状态 |
| --- | --- | --- |
| 编排 | AgentArts 自有镜像，fast/world/plan/review；ModelGateway 唯一模型入口 | owned-1.1 完整 World/Plan 内部报告与严格校验已交付；不可映射至现有候选的行为明确拒绝，真实模型/工具云验收仍缺 |
| 传输 | WSS 主通道，HTTPS 同语义备用；降级可见 | 已发布镜像提供 `/ws`、HTTP `/ping`、`/invocations` 与受保护 `/invocation-status`；WSS 客户端和仅未发送时允许的 HTTPS 备用已本地验证，公开传输契约仍为 provisional，公网 Upgrade 待验收 |
| 未知结果与恢复 | 本地持久发送标记、防重发与 `waiting_reconciliation` | 本地重启防重发已有验证；当前源码提供显式 WSS accepted-status 恢复选项，须满足原身份和状态约束，不重发原请求。云端持久回执及跨云重启恢复仍未由此证明；具体接口和证据见[当前接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)与[路线图](ROADMAP.md) |
| 任务/权限/执行 | 本地 Runtime/Policy/ToolGateway/Evidence | 保持既有边界；云结果需要校验及本地读回 |
| 记忆 | Wiki 正文 + 来源绑定 Memory 投影/FactChangeFeed | goo122 负责 MOD-08/09；自动同步/整理未交付 |
| 决策 | Competition Agent/Workflow 由 AgentArts 承担；本机 Laya 保留邮件/天气提醒选择及默认编码修复的既有有界判断，并可对当前已观察窗口的有限控件提出建议 | 独立 Local 接线与候选资格仍待验收；Laya 不授予权限或接管工具执行，AgentArts 失败不回退 Local |
| 合并 | 常规 PR 首轮须有合资格非作者有效批准，后续仅修复 CI 的提交保留批准；Owner 对具体 PR 的审核例外须记录授权、意见处置与保留分歧，不伪称独立批准 | 有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断性技术缺陷已处理后合并；四位协作者跨 PR 均衡承担审查与合并 |
| 分享 | GitHub PR + GHCR 固定版本/digest + 配置说明 | `97aa51a6` AMD64/ARM64 预览已发布并独立验证；main 合并、真实华为部署与验收分别记录 |

模块百分比保留 2026-10-08 的工程估算，不因为 Wiki 新设计或本 PR 推送而提高。不重写历史作者、旧 PR 或历史验收；其旧合并政策不能作为当前执行授权。

阅读其他文档时：PRD 定需求，架构/ADR 定边界，接口目录定实际冻结状态，模块分工定所有权，ROADMAP 定工作包状态，源码与真实读回定能力。通用导航统一指向本轮目标，不使每份历史文档自动变成当前产品说明。
