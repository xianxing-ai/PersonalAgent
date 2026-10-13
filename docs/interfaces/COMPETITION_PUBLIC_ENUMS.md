# Competition 公共枚举投影

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

状态：provisional。仅服务 huawei_ict_agentarts。

`CompetitionToolAvailability.publicEnumPaths?: readonly string[]` 是受信宿主配置，不是 Renderer / 模型输入或执行授权。默认不公开任何枚举值；显式路径（如 `/units`、`/goal/state`，数组元素用 `/*`）允许投影对应的标量枚举。描述、示例、默认值和未获声明的枚举仍不出云。

已有仅用 enum 表达类型的公共参数，可推导单一标量类型。枚举候选来自原工具 Schema，不由模型或宿主另造；本地执行仍按完整原 Schema 校验。已保存目录在实际出云和工具提案执行前重新比较，宿主缩小公开范围后不能沿用旧目录。

消费示例：Desktop 公共天气接线可只声明 `weather.forecast` 的 `/units`，让 AgentArts 获得准确的 metric / imperial 可选项。该消费接线在独立集成分支中，本工作包只交付 Runtime 接口。其他能力仍需各自宿主明确声明，不允许一次公开全部枚举来夹带账号、路径或私人标识。

必要验证：Runtime 构建通过；两项定向检查通过，分别证明默认仍隐藏私有字段，以及只公开指定公共枚举且撤回声明后旧目录被拒绝。未进行真实云模型调用，不提升原接口验收等级。没有 wire Schema、数据库迁移或新增依赖。
