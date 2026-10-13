# Desktop 目标变化与 Laya / AgentArts 接线

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。负责人 zemeng；Desktop 组合消费 MOD-27/28 与 Runtime 的公开端口。

## 已实现

- 设置 → 电脑操控 → 主动变化提醒中，独立开启目标分析和目标方案出云。CPU / 内存监控许可不授权目标出云。
- 使用现有公共 Fact host、目标工具真实回执和图谱存储，不增加另一个任务库或执行循环。
- Laya 从合法候选中选择；选择持久化后，由既有 Runtime Client 提交 AgentArts 编排任务。选择本身不修改计划、不签发工具权限。
- 目标修订仅接受 `succeeded / applied` 回执；旧目标版本不重复触发。Fact 影响消费复用原游标和完成回执。
- 交接使用持久 `commandId` 幂等键。已交接任务读回原任务；临时错误延后核实，过期 envelope 不续期；新的目标/事实版本另行分析。
- AgentArts 真实 HTTP 发出前再同步检查会话许可、图谱版本、原投影和期限。撤销及重启使旧出云许可失效。
- 投影只包含受影响节点、变更引用对应的最小摘要；不包含来源路径，排除 restricted 节点和非公开 Fact。私人 Goal / Decision / Plan 描述只有在明确的目标出云开关开启后才进入投影。

## 运行入口与限制

先在本地模型设置启动项目内 Laya，再开启目标分析。Laya 未就绪时显示等待，不使用伪造结果，也不偷偷把本地分类改成云调用。实际工具仍由 AgentArts 选择公开能力并经 Runtime / Policy 执行。

目前公共 Fact host 尚需要各来源的生产接线；此改动不声称天气、邮件等所有变更都已经自动写入图谱。已有目标没有关联 Decision / Plan 时，影响分析可以正确返回 KEEP。没有可用的计划编辑工具时，AgentArts 只能给出规划，不能宣称计划已修改。

## 验证与交付

2026-09-27：Runtime TypeScript 构建、受影响 JavaScript 语法检查通过。定向测试使用真实 SQLite Runtime、公开认知 host、Fake Laya 推理和 Fake AgentArts HTTP：

1. 目标变化后本地选方案；独立许可开启后仅交接一次；私有来源 Fact 不出云；选择不直接改图谱；重启不能复用旧许可。
2. 读取云凭据期间撤销许可，最终 HTTP 请求数为零。
3. 读取云凭据期间出现新的图谱版本，旧方案不再发送。

命令：`node --test apps/desktop/test/goal-cognition-host.test.mjs`，3/3 通过。设置页通过合成状态的浏览器实际渲染检查。Sol 只读审查指出的临时异常恢复阻断已修复，保留同键核实路径。未启动真实 Laya、未使用真实 AgentArts 请求，此记录不是整条链路真实验收。当前本机内存限制仍需真实联调时处理。

公共接口仅增加受信组合选项 `beforeCompetitionSend(request): void`；不改变 Renderer 协议或数据库迁移。仍需非作者评审和真实模型链路验收。
