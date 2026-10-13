# MVP-TWIN-B-TRIAGE-01：邮件批量分类的消费出口

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-28；负责人 zemeng；状态：`review`。
- 所有权：认知包和本文件；邮件连接器仍由 Potatos498 负责，根宿主接线由主任务负责。
- 复用 #187 的 `LayaTriageService`，不创建第二个分类器、连接器、任务库或授权入口。

分类结果本身不应直接变成邮件写入或用户审批。本包验证原输入与分类回执的精确绑定，
输出普通分类分组、需要 AgentArts 进一步推理的项目，以及暂时无法分类的项目。
`review` 表示机器需要更多推理；是否需要用户批准由执行时的 Runtime/Policy 决定。

公开调用：

```ts
import {prepareTriageDispatch} from '@personal-agent/cognition';

const results = await triage.classify({messages, labels, deadline, signal});
const dispatch = prepareTriageDispatch({namespace, messages, labels, results});
// 普通分类：dispatch.groups [{label, refs}]
// 交 AgentArts 推理：dispatch.mainAgent 和 dispatch.review
// 尚未分类成功：dispatch.deferred [{...ref, reason, requiredRoute}]
// ref 只有 source/messageId/sourceRevision/receipt/workKey，不含正文。
```

`mainAgent` 包含高影响项；`review` 包含未作出确定分类的项。
两者都是自动化调用方可消费的机器推理出口，不创建人工审批。
`deferred.requiredRoute` 保留已知的高影响标记，重试时不能将它降级成普通分组。
取消或过期请求不因保留该标记而自动继续执行；宿主恢复时使用新的有效请求上下文。

输入必须保留同一次分类的 `messages`、`labels` 与 `results`。来源 ID、邮件 ID、来源版本、
正文摘要、分类定义摘要和回执 ID 必须匹配。真实宿主已标为高影响的消息不能被模型降级为普通分组。
结果只含来源引用与回执元数据，不携带邮件正文，也不因此获得云端发送或邮件写入权限。
回执摘要用于关联和输入一致性检查，不是签名或独立来源证明；宿主只接纳可信分类路径的输出。
置信度阈值属于 `LayaTriageService` 的可配置参数，本出口不重新定义阈值，也不声称能证明
任意伪造分类结果来自模型。`messages` 不可混入同一来源/邮件 ID 的多个修订；宿主先确定当前版本。

工作键供既有 Runtime 的 `idempotencyKey` 使用。调用方必须在任务持久受理后才标记对应
分类结果已消费。中断恢复再次使用同一工作键，读回原任务；不能随机生成新的任务 ID 重放写入。
模型不可用、取消或超时的项目保持延期，不能作为已分类成功项目保存。
若来源游标需要向前推进，必须先通过既有持久待办或任务记录保留这些未解决的来源引用；
游标与待办原子性仍由来源宿主维护，本函数不接管该协议。

生产接入需要已授权的邮件输入投影与最新 sourceRevision 读回，以及必要的 AgentArts
最小出云投影。该包不启动模型、不读取真实邮箱、不发送邮件、不创建订阅。

验证：cognition 类型检查与构建通过；专属 3 个行为用例使用实际 LayaTriageService
加显式 Fake 推理，覆盖分组/高影响/不确定、回执篡改与错版本、降级与重复身份、
取消/过期/不可用、输出无正文和重排稳定键。独立子代理只读复核无阻断；仍待 goo122 非作者 PR 评审。
没有依赖、wire Schema 或迁移变化；未启动真实模型/邮箱/AgentArts，也未运行全仓检查。
本机 Node 26.3.0 / npm 11.16.0 与仓库要求 24.15.x / 11.12.x 不同，未更改工具链。
