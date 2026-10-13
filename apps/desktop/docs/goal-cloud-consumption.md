# P8 GoalCloud 消费接线

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`；公开 Goal 工具及 Scope 仍为 provisional。沿用 Runtime Policy、现有 Goal 工具和 coordination store，无 wire/迁移变化。

`goals.list/get` 的读取结果现在包含完整的 `dependencies: [{id,revision}]`。结果出口策略由 `desktop-goal-cloud-projection-v1` 调整为 `desktop-goal-cloud-projection-v2`；后续发布/目录绑定应消费当前精确 Schema。工具名称和版本维持现有公开 Goal 工具约定。

依赖 ID 经过与目标 ID 相同的敏感文本检查；丢失/非法依赖元数据会使整个目标不可投影，不用空数组替代。返回值只包含引用，不含依赖 Fact 正文或 sourceRef。复制依赖列表，外部修改不能影响本地图谱。

主动任务仅匹配当前 namespace 的准确会话，并要求 P5 的 `readRepairBinding(taskId)` 提供当前合法 review/selection/candidate/graphRevision/targets/dependencies；同时仍需现有目标云访问许可。读回只提供相同 ID/revision 的 Goal，完整依赖必须都在可信范围内。Scope digest 与会话 generation create-only 绑定到 Runtime checkpoint，旧任务不能继承新的选项或新许可。

`goals.create/revise` 在主动任务的目录、参数接受、执行和结果出口均拒绝。不确定 RECHECK 没有合法修复 scope 时，不获得目标工具。主动写入消费同一 `cognition.commit_repair` 与 P5 精确候选；不通过宽泛 Goal 工具绕过范围约束。main 仅用晚绑定可信 getter 注入，P5 专属模块未交付时仍不可用。

局部验证：`node --test apps/desktop/test/goal-cloud-dependencies.test.mjs` 两个显式 Fake 检查通过，覆盖 list/get 与结果出口保留准确 refs、返回值隔离，以及不完整/危险 refs 整体拒绝。未调用模型、未写图谱、未执行真实 Goal 修复。

`goal-cloud-proactive-scope.test.mjs` 一个 Fake 检查覆盖准确会话、已有许可、匹配读取、无范围来源隔离、全部泛化写拒绝、选项变更与不确定候选拒绝。
