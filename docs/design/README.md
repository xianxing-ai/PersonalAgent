# 设计导航与历史适用范围

更新：2026-10-15。先读[当前详细设计](CURRENT_DESIGN_20261015.md)及[28项逐图状态](WORKFLOW_STATUS_20261015.md)，
再按[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)核对实际能力。架构仍未最终定型；设计不代表验收。

| 文档/图 | 原始范围 | 当前适用性 |
| --- | --- | --- |
| [当前详细设计](CURRENT_DESIGN_20261015.md) | 本轮用户设计、实现、真实回执与缺口 | 当前统一入口 |
| [28项状态索引](WORKFLOW_STATUS_20261015.md) | F01–F28 / 185节点目录及验收边界 | 当前逐图导航，不能解释为28业务通过 |
| [完整常驻目标设计](resident-developer-agent-20261008/DESIGN.md) | 2026-10-08/09，39模块与产品长期目标 | 历史目标保留；模型、发布、验收及旧协作门槛以当前入口为准 |
| [原离线阅读页](resident-developer-agent-20261008/index.html) | 原正文、模块搜索、四幅图与估算 | 历史快照；百分比仍是原估算，不提升完成度 |
| [总架构图](resident-developer-agent-20261008/architecture-overview.svg) | 39模块与部署位置 | 历史目标图，具体模型和验收状态已更新 |
| [自主闭环图](resident-developer-agent-20261008/autonomy-lifecycle.svg) | 观察、委派、验证与监管 | 目标流向继续参考，不证明完整主控已接线 |
| [信任/传输图](resident-developer-agent-20261008/trust-and-transport.svg) | 本地可信边界、WSS/HTTPS与发布 | 权限边界仍适用；当前云版本另读回 |
| [Wiki图](resident-developer-agent-20261008/wiki-memory.svg)及[交接](resident-developer-agent-20261008/WIKI-MEMORY-HANDOFF.md) | Wiki正文/来源与Memory投影分工 | 历史交接保留；后续代码/模块状态见接口目录与新分工，不沿用“尚未实现”概括现有增量 |
| [设计产物验证](resident-developer-agent-20261008/VERIFICATION.md) | 原SVG/阅读页与旧本地Fake测试 | 只证明原对象，不是当前模型/发布验收 |
| [语音优先主动提案](voice-first-proactive-agent-laya-proposal.md) | 2026-09-23提案及后续附记 | 原目标参考；当前百炼/主动责任/通知与资格边界见新设计 |
| [增量算法交接](incremental-workflow-algorithm-20261015.md) | 持续感知、细锚点、局部修复与经验建议 | 待适配设计；最小修复算法暂停/未定，不自动授权实现 |
| [28图查看页说明](workflow-architecture-20261013/README.md)及[离线页面](workflow-architecture-20261013/index.html) | 2026-10-13/14可编辑架构图 | 历史目标快照；原“最终/已定”标题不代表当前架构定型，默认模型/并行叙述已被后续决定修订 |
| [桌面草案](desktop-ui-draft.html) | 早期交互视觉方案 | 历史原型，不能当实际桌面交互或已接服务 |
| [ADR目录](../adr/README.md) | 各日期的决策与 proposed/accepted 状态 | 逐份保留原决定；部署/完成事实不跨版本沿用，ADR-0025仍为实验候选 |

原 `modules.json` / `review-manifest.json` / `modules.zip` 是带日期的历史估算/审阅产物，不重写或伪造旧审阅记录。
旧压缩包不作为当前指南分发；当前实现与来源见[发布回执](../competition/evidence/test-image-v3-20261015/owned-release.json)。
离线历史 HTML 的适用性提示由该目录既有文档生成器的 `--annotate-history` 路径维护，不重建历史图或压缩包。
