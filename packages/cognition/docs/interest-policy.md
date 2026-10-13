# 兴趣推断与知识时效纯策略

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Competition Profile 的宿主建议层；不创建数据库、定时器、网络连接或授权，不启动 Laya。
`decideInterest()` 与 `decideKnowledgeFreshness()` 接受可信宿主整理的输入，返回可解释结果。

## 兴趣判决

输出 `candidate / watch_public / abstain / decay / revoked`，包含 topic、证据 ID / source ID /
source revision、来源版本、scope revision、原因及有限期限。所有时间窗口由宿主明确传入。
`watch_public` 仅为建议，宿主执行前仍须重新检查持续跟踪 scope 和来源。

- 单次偶然问题为短期 candidate；没有有效证据 abstain，原 watch 无新证据时 decay。
- 关键词命中及别的 topic 不作为证据。语义 topic 关系必须由宿主核实，不能给任意文本贴 semantic 标签。
- 相同 topic 的明确追问链、问题与收藏、问题与当前目标等组合可形成公开低风险 watch。
- 仅重复问题须有绑定全部证据版本的 Laya sustained 分类线索及不同 interaction；次数本身不充分。
- Laya uncertain、abstain 或证据不匹配时保守 abstain；始终 `classificationCalibrated:false`，不把模型置信度冒充校准准确率。
- 来源须公开、低风险且有未过期传输验证，持续跟踪 scope 必须存在、未撤销、未过期。
- 用户撤销 tombstone 优先于行为推断；仅撤销后新的、同 topic 显式用户开启动作可恢复，模型不能生成该动作。
  宿主应永久保留撤销记录及新开启事件，不能把两次调用之间的 tombstone 丢弃。

`source.transportVerified` 是可信宿主断言，不是 URL 安全实现。宿主必须在实际抓取每一跳重新验证
批准的 URL、协议、域名、端口、DNS/实际连接目标与公开地址；输入验证不能代替 SSRF 防护。
收藏、聊天或目标等私人原文不因本地兴趣分类而获得云端发送许可。

## 缓存时效判决

`use_cache` 只在版本匹配、来源可用、内容 SHA 合法、最近成功复验与事实有效期均未过期时返回；
它表示当前来源范围内可复用，不能概括为全网知识最新。版本不匹配或内容已变返回 `refresh_required`，
明确撤回返回 `unavailable`，来源不可达、复验失败、过期或 receipt 未绑定返回 `last_verified_only`。
回答应展示最后核实时间，不把旧结果当实时结果。

成功 `unchanged` receipt 必须由可信读取路径产生，绑定 source ID、source revision、已有正文 SHA，
且时间不早于缓存成功复验。它可更新最后成功检查时间，但不能延长事实 `validUntil`。
ETag/Last-Modified 不进入内容 SHA 字段；304 是 HTTP 条件验证，不是独立正文哈希。
`changed` 后必须由已有入库路径读取新内容、计算 SHA、记录版本，纯策略不改写缓存或 Fact。

## 验证边界

行为检查位于 `test/interest-policy.test.mjs`，直接读取纯 TypeScript 源码以避免并行构建写入 dist。
这里只验证判决、证据绑定、撤销和缓存失效语义；没有真实 Laya、后台跟踪或次日最新答案验收。
后续由宿主复用已有 tick、Runtime 调度、存储与知识入库接口，并展示理由、期限、撤销和衰减。
