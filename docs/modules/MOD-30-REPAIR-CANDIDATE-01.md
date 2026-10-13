# MOD-30-REPAIR-CANDIDATE-01：显式候选与本地批准提交

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：huawei_ict_agentarts；状态：in_progress / provisional。
- 实现：zemeng 委派 Runtime 消费执行者；公共新增候选解析唯一 owner 为本工作包。
- 非作者评审：需 goo122；未冻结、未合并，不以模型意见代替真实协作者批准。
- 基线：Runtime 出机 PR #101（c8274ca），AgentArts 候选适配 PR #105（8c2d1fb）。

## 显式兼容与边界

新增的是 `@personal-agent/coordination` 的 in-process result 联合与严格解析器，
不是新 wire operation。`CoordinationRepairCandidateResult` / `parseCoordinationRepairCandidate`
唯一实现位于 `repair-candidate.ts`，其 candidate 结构与既有 `StoredRepairRequest` 对齐。
不增加跨包私有导入、依赖或第二个 Schema/任务库。

云端可返回以下 JSON 建议，A 的 adapter 必须先拒绝云自带的 verification 再添加
`verification: 'unverified'` 交由公共 parser 校验。D 消费 Runtime 的 typed checkpoint，
不得从带展示元数据的 resultSummary 提取协议。

```json
{"kind":"repair_candidate","candidateVersion":"1.0","candidate":{"expectedGraphRevision":6,"changes":[{"node":{"id":"prepare","revision":1},"summary":"Prepare at 16:00","reason":"Meeting moved to 17:00","dependencies":[{"id":"meeting","revision":2}]}]}}
```

这只是合法形状示例，id/revision 必须在真正提交时逐一属于 host 实际投影的允许集合。
云不能自报 task、FactRef、Evidence、scope、批准或提交权限；这些均来自可信本地读回。
版本不等于 `1.0`、未知字段、空 changes、重复 target/dependency、自依赖、非法 revision、
非 JSON/getter 或超限内容全部拒绝。比如新增 `evidenceRefs` 或 `verification: 'verified'`
并不会取得权限，而会使整个候选失败。

整个 host result JSON 最多 8192 UTF-8 字节；changes 为 1..16；summary/reason 各 1..1024
字符且无控制字符；node/dependency id 为 1..128；revision 为正 safe integer；
expectedGraphRevision 为非负 safe integer；每项 dependencies 为 0..16。对象均精确字段。

Runtime 和 adapter 都须显式 `repairCandidateVersion: '1.0'` opt-in；adapter 还必须处于
`responseMode: 'tool-proposal-json'`。缺省 text/旧调用方不获得候选或写图能力；
未启用遇到候选明确拒绝。候选产出仅完成云建议任务，不表示计划已提交。

## 本地提交计划与职责

- B：公共候选 parser/联合、Runtime typed checkpoint/read、显式本地提交。
- A：仅 adapter mode/版本选择与云输出映射，复用 B parser，不复制候选规则。
- D：真实工具结果到 Memory Fact/Projection link 的可信组合、只读 preview、显式确认 UI。

本地提交将创建独立 local action task，不重开原云 task。完整 intent（source task/Evidence、
candidate/version、当前 Fact/NodeRef、允许目标、图基线及参数摘要）先持久绑定幂等键，
再通过已有 RegisteredTool `local_write`、Policy/allow_once 与 ToolGateway 执行一次 CAS。
云文本不是权限；未选节点业务字段必须保持不变；新 Fact、旧投影、目标越界或图冲突拒绝。

graph 已写、confirmed receipt 未写的崩溃窗口按 `waiting_reconciliation` 保留；
同一 intent 重复提交返回原任务，不能重做写入。真实系统须人工核对图和执行记录。

Runtime 已提供 host-only `readRepairCandidate(taskId)` 与 `submitLocalRepair(request)`，
以及 `LocalRepairHostOptions`：受信宿主提供原始 Fact/NodeRef 选择、当前 Memory 查询和
真实工具结果与 Fact 对应关系，并用 `withSourceLock` 与 Fact 摄入/投影共享写锁。
提交前绑定已确认 source task、真实 read Evidence、
工具参数摘要和实际执行记录的完整 inputDigest（含授权引用）、候选、允许节点、
graph namespace/binding version 与 deadline；
新任务等待 `cognition.commit_repair@1.0.0` 的 `cognition:repair` 单次批准。
执行时重读当前 Fact、原始授权和图版本，经 `previewStoredRepair` 后同步 CAS，
再按持久图修订号读回。失效、拒绝、取消和冲突均不得修改图。
候选的每个修复目标必须保留原图中全部依赖身份，只允许已选同一节点的新 revision；
空依赖或替换为无关节点会在审批前与提交前拒绝。
同一幂等键先只读找到原任务并核对完整 intent；CAS 后图版本已变化仍返回原任务，
不会以新候选重新提交。
TaskRuntime 在一个事务中写入 task/idempotency 与 `local-repair-intent`；两次写入间中断
会整体回滚。旧版留下的 `created` 且缺 intent 任务仅在 attachment 完整摘要与本次
intent 一致时补写恢复；已启动任务、改参数或摘要不符均拒绝，不自动重做工具执行。
修复任务操作的图 namespace 从持久 intent 读取，并核对图读回值；宿主配置在
异步 Fact 查询期间临时切换，不会把已批准的 CAS 重定向到另一个图。

本地合成测试覆盖批准后 CAS、拒绝、当前 FactRef 变化、图变化、越界选择、
幂等 intent 冲突、两个真实批准读取互借 Evidence 的失败路径、断链拒绝、
共享锁排序、临时切图、原子 checkpoint 写入失败回滚、旧版 created 缺口安全恢复，
以及 CAS 后结果未知并重开数据库。
当前性保证依赖同一进程所有 Memory 摄入/投影写入都使用宿主提供的同一把锁；
若另一个进程绕过该锁先写 Memory 而未更新图，仍可能存在两存储间窗口，
不能宣称跨进程原子提交。尚未验证实际 AgentArts 云端
生成符合形状的候选，或 Desktop 最终组合与人工确认流程；不得宣称比赛真实闭环。
