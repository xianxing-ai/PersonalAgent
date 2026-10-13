# 当前设计与实施状态（2026-10-09）

产品方向：面向开发者的常驻自主助手。电脑运行时观察已授权世界变化，修复受影响计划、委派执行与监管；不引入独立云电脑。完整正文与图是目标设计，不把文档、目录或镜像构建当作能力验收。

## 当前唯一设计入口

- [完整方案（22 章节）](design/resident-developer-agent-20261008/DESIGN.md)
- [离线阅读页与模块搜索](design/resident-developer-agent-20261008/index.html)
- [39 模块总图](design/resident-developer-agent-20261008/architecture-overview.svg)、[自主闭环](design/resident-developer-agent-20261008/autonomy-lifecycle.svg)、[信任/双通道](design/resident-developer-agent-20261008/trust-and-transport.svg)、[Wiki 记忆](design/resident-developer-agent-20261008/wiki-memory.svg)
- [Wiki 接入交接：goo122](design/resident-developer-agent-20261008/WIKI-MEMORY-HANDOFF.md)
- [两人阅读确认与合并门槛](reviews/DESIGN_READING_GATE.md)
- [新版 WSS 镜像发布记录与来源](competition/OWNED_IMAGE_WSS_RELEASE_20261009.md)、[GitHub 预发布下载](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-97aa51a6)

## 应同步到各模块的边界

| 事项 | 当前选择 | 实施/验收状态 |
| --- | --- | --- |
| 编排 | AgentArts 自有镜像，fast/world/plan/review；ModelGateway 唯一模型入口 | owned-1.1 完整 World/Plan 内部报告与严格校验已交付；不可映射至现有候选的行为明确拒绝，真实模型/工具云验收仍缺 |
| 传输 | WSS 主通道，HTTPS 同语义备用；降级可见 | 已发布镜像提供 `/ws`、HTTP `/ping`、`/invocations` 与受保护 `/invocation-status`；WSS 客户端和仅未发送时允许的 HTTPS 备用已本地验证，公开传输契约仍为 provisional，公网 Upgrade 待验收 |
| 未知结果与恢复 | 本地持久发送标记、防重发与 `waiting_reconciliation` | 本地重启防重发已验证；云端仅有界内存回执，`restartRecovery:false`。自动 status 协调与持久云端恢复未交付 |
| 任务/权限/执行 | 本地 Runtime/Policy/ToolGateway/Evidence | 保持既有边界；云结果需要校验及本地读回 |
| 记忆 | Wiki 正文 + 来源绑定 Memory 投影/FactChangeFeed | goo122 负责 MOD-08/09；自动同步/整理未交付 |
| 决策 | MOD-28 Laya 有限合法候选、弃权/升级 | 不签发权限；领域校准与完整用户设置待验收 |
| 合并 | goo122 与 Potatos498 当前版本本机阅读确认及审批 | 原自审可合并规则失效；禁止强制合并/管理员绕过 |
| 分享 | GitHub PR + GHCR 固定版本/digest + 配置说明 | `97aa51a6` AMD64/ARM64 预览已发布并独立验证；main 合并、真实华为部署与验收分别记录 |

模块百分比保留 2026-10-08 的工程估算，不因为 Wiki 新设计或本 PR 推送而提高。不重写历史作者、旧 PR 或历史验收；其旧合并政策不能作为当前执行授权。

阅读其他文档时：PRD 定需求，架构/ADR 定边界，接口目录定实际冻结状态，模块分工定所有权，ROADMAP 定工作包状态，源码与真实读回定能力。通用导航统一指向本轮目标，不使每份历史文档自动变成当前产品说明。
