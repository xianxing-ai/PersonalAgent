# MOD-24：搜索与资料获取

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 基本信息

- 关联需求：PA-010（P0 联网研究——来源/发布时间/获取时间三披露，失败及过期明确）
- 当前 GitHub 负责人：`Potatos498`（2026-10-07 三人独立交付重置）
- 自审：模块负责人；可选同行评审：`goo122`，不作为交付前置
- 独占目录：`packages/connectors/research/`
- 历史工作包状态（原记录，不作为新 PR 审批门槛）：review（源码完成，待非作者评审；分支 `feat/mod-24-research`）

## 职责

检索学术/公开资料（OpenAlex）并规范化为带时间与来源的 `ConnectorItem` 材料；失败/过期区分（错误照实、缓存三态、材料过旧标 stale）；工具 `research.search` 只读。

## 非职责

研究规划与汇总（MOD-04）、通用 web 搜索（后续提供商：Bing 需 key；DDG/Wikipedia 本机连接层不通）、网页正文抓取。

## 输入、输出与公共入口

- 入口：`register`（工具 `research.search`，scope `research:read`）；ConnectorPort `search`。
- 输入：查询词＋limit；输出：材料列表（freshness/publishedAt/publishedTimeKind/ageMs 逐条披露）＋缓存三态。
- 提供商端口可插拔：Fake（夹具）与 OpenAlex（免 key，实测可达）。

## 依赖

- 前置模块：MOD-02（contracts）；MOD-04 消费本工具做规划（已在 main）。
- 允许依赖：`@personal-agent/contracts`（HTTP 经注入 fetch，无新外部依赖）。
- 禁止依赖：apps、其他内部包私有导出。

## 权限与数据

- Scope：`research:read`；无写动作（`performAction` 返回 `UNSUPPORTED_CAPABILITY`）。
- 敏感数据：无凭据（OpenAlex 免 key，mailto 可选）；材料 `sensitivity: 'public'`。

## 验收

- Fake/离线：8 项（契约、失败/过期区分、回退标注、缓存三态、规范化、能力边界、工具校验）。
- 真实条件：OpenAlex live 读回（`PA_RESEARCH_LIVE=1`，免 key）——已实测通过，证据见包 README。

## 排除项与已知限制

材料不含正文摘要；缓存实例内存级；仅学术源。详见包 README「已知限制」。
