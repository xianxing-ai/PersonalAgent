# MOD-XX：模块名称

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 需 goo122、zemeng5208、Potatos498、2511375597-lab 中任意一位非作者对当前提交有效批准；Owner 对具体 PR 的审核例外需在 PR 留记录，不伪称独立批准。有合并权限的协作者（包括作者）可在最新必需技术 CI 通过、严格同步主线、无冲突且阻断性意见已处理后合并；禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 基本信息

- 关联需求：PA-XXX
- 目标 Profile：`huawei_ict_agentarts`（当前默认）/ `local`（可选，需说明进入当前范围的理由）
- GitHub 负责人：
- 自审记录 / 可选同行评审者：
- 独占目录：
- 当前状态：todo
- 消费的冻结基线 / 精确提交：

## 职责

该模块负责什么。

## 非职责

该模块明确不负责什么。

## 输入、输出与公共入口

列出公共端口、Schema、事件和 package exports。

| 接口 | 提供方 | 状态（frozen / provisional / unavailable） | 兼容或迁移要求 |
| --- | --- | --- | --- |
|  |  |  |  |

## 依赖

- 前置模块及可用公开契约：
- 上游未就绪时的 Fake/Unavailable 与独立验证方式：
- 本工作包自行完成的必要消费/宿主接线：
- 允许依赖：
- 禁止依赖：

## 权限与数据

列出 Scope、副作用、敏感数据、凭据注入和保留边界。

## 验收

- Fake/离线测试：
- 跨模块集成：
- 真实条件验收：
- 能力发现与不可用路径：
- AgentArts deployment/API/trace 与防静默回退（Competition 模块）：

## 排除项与已知限制

明确本工作包不实现和仍未验证的事项。

Competition 模块必须区分 AgentArts、Local 和 Fake 证据；Local 模块不能被计入比赛主路径完成度。

## 本负责人实际调用方交付

写明公开输入输出/版本、本人接入的生产调用方文件、受信配置键、必要fixture与真实验收命令、源码SHA和UTC/wall/exit/logSHA、task/run/Evidence/目标读回、fixture/realHost/realAccount/physicalDevice分类、失败/unknown恢复、未验项及下一任务。不得只交端口并写“等中央接线/代验”；引用 [全MOD清单](CURRENT_MOD_WIRING_HANDOFF.md) 对应行。
