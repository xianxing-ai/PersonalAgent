# MVP-TWIN-B-KNOWLEDGE-01：知识失效与精确依赖重评

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-28，消费 MOD-27 的 `NodeRef`。
- 负责人：zemeng；状态：`review`；非作者评审由 goo122 完成后才可合并。
- 所有权：`packages/cognition/**` 和本文件。真实来源、知识库、Runtime checkpoint 与 Desktop 接线由原模块负责人维护。

现有 `decideKnowledgeFreshness` 能说明缓存是否仍可使用，但未提供可去重的依赖重评工作项。
本包在其上提供公开纯函数，按来源 ID、来源版本与内容 SHA-256 精确选取受影响的依赖，
返回稳定工作键和 checkpoint 数据。没有新建任务库、知识库、调度器或授权体系。

公开调用：

```ts
import {planKnowledgeReevaluation} from '@personal-agent/cognition';
import type {KnowledgeReevaluationCheckpoint} from '@personal-agent/cognition';

const plan = planKnowledgeReevaluation({
  namespace,                     // 可信宿主绑定的本地命名空间
  freshness,                     // 既有 FreshnessInput，来自来源核验路径
  dependencies: [{
    consumer: {id: 'plan-1', revision: 3},
    sourceId: freshness.cache.sourceId,
    sourceRevision: freshness.cache.sourceRevision,
    contentSha256: freshness.cache.contentSha256,
  }],
  checkpoint: runtime.loadCheckpoint(sourceTaskId, checkpointKey)
    as KnowledgeReevaluationCheckpoint | undefined,
});
// submit 是调用方注入的既有 Runtime 提交函数；需将选择送入 AgentArts 编排，
// 在调用方完成最新引用复核、Laya 选择及必要的出云授权后提交，不能直接写图谱。
for (const work of plan.affected) {
  if (!work.duplicate) await submit({idempotencyKey: work.workKey, work});
}
runtime.saveCheckpoint(sourceTaskId, checkpointKey, plan.checkpoint);
```

`runtime.loadCheckpoint` 返回 unknown，TypeScript 宿主应按本包导出的
`KnowledgeReevaluationCheckpoint` 接入；函数会验证 checkpoint 结构与绑定。
示例中的 `submit` 是注入点，不是新增的 Runtime 方法或已交付的生产源适配器。
同一来源的计算/提交/checkpoint 写入应由既有宿主串行处理，避免旧消费结果覆盖新结果。

输入必须来自可信宿主对既有知识来源与引用关系的读回。`sourceRevision` 是来源内容版本，
`contentSha256` 是实际缓存正文的摘要，不能用模型描述或未经绑定的 HTTP ETag 替代。
同一来源 ID 与 `sourceRevision` 对应不同摘要会拒绝；来源内容变化必须产生新的来源修订。
消费者引用使用精确 `NodeRef`；本函数不会把旧消费者版本自动替换成当前版本。
原文不进入输出，来源标识与引用也不因此获得出云许可。
调用方应先在既有来源存储中持久保留对应更新；checkpoint 只保存当前缓存身份的消费信息，
不能替代源版本历史或证明输入就是最新版本。不同来源的 checkpoint 不可混用。
输入时钟倒退会拒绝，但来源版本是不可排序字符串，其回退检测仍依赖可信源读回。

仅保存“已收到更新”不能证明重评已经落盘。调用方必须先把每个工作项用原 `workKey`
幂等提交给现有 Runtime，再保存该来源的消费 checkpoint。提交后、checkpoint 前崩溃，
重启读回上次 checkpoint 并重新计算，得到相同工作键；Runtime 按原键找回已受理任务。
不要先保存去重 checkpoint 再提交任务，否则崩溃会吞掉待重评项。
checkpoint 表示工作已交给持久任务执行，不表示计划已经修复或外部副作用成功。

来源撤回或内容已变时，历史缓存不能作为当前知识继续执行旧计划。
重新核验未变只说明对应核验结果；不能凭该结果恢复已经失效的内容或延长原有效期。
撤回比内容变化更强；同一缓存版本收到后续 changed 回执也不能把撤回状态降级。
所有修订与工具执行仍走 Laya 选择、AgentArts 编排和既有 Runtime/Policy。

生产依赖：可信来源的缓存/核验版本回执，以及来源到当前图谱消费者的精确引用映射。
该包不实现源抓取、永久订阅、Memory Fact 写入或完整真实云端验收。

验证：cognition 构建与 TypeScript 检查通过；专属测试 5/5，通过真实纯函数和合成来源回执
覆盖精确筛选、重复/重排、消费者修订、新缓存身份、来源撤回、旧回执和 JSON 重启回放。
审查发现的“同一来源修订换 hash 解开失效”问题已修复并纳入回归断言。
未运行真实 Laya/AgentArts、源抓取、全仓检查或 Desktop；没有依赖、公共 wire Schema 或迁移变化。
本机沿用 Node 26.3.0 / npm 11.16.0，与仓库要求的 24.15.x / 11.12.x 不同，未更改工具链。
