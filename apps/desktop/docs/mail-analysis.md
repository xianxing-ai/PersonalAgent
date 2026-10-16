# 邮件分类与主对话接线

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../../../docs/design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../../../docs/design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../../../docs/design/workflow-architecture-20261013/index.html) · [接口状态](../../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。复用现有 QQ MailReadSession、Laya 分类、Runtime 任务与 AgentArts 协调入口。

## 用户路径

1. 设置中配置 QQ IMAP，允许本会话本地信头分类，启动 Laya 后开始整批分类。
2. 需要主智能体解释和安排建议时，单独勾选发送待分析信头到 AgentArts，点击“开启主智能体分析”。本地读取许可不自动包含云端发送。
3. Laya 的 `main_agent`／`review` 项依次提交到同一个 Runtime，回答留在主对话；`deferred` 项保留本地。工具提案仍执行正式 Policy 流程。
4. 关闭云端分析会取消在途任务并阻止后续云调用，本地分类仍可继续。关闭邮箱会同时撤销两项许可；重启不会恢复许可。

## 持久与版本边界

- 待交接记录保存在已有加密分类 Storage；任务事实保存在 Runtime，桌面不建立第二套任务库。
- 确定工作键复用 Runtime 幂等提交。已受理而确认回执丢失时，读回原任务，不再次创建。
- 每次 AgentArts 发送前同步检查当前读取会话、云许可、来源版本、分类回执、投影摘要及任务绑定。旧来源、撤销许可和重启遗留任务不能恢复旧出云许可。
- 仅发送信头投影，不发送 IMAP 授权码、邮箱配置、正文或本机路径。邮件属于不可信输入，不赋予执行权限。
- 单个分析失败保留记录与原因，停止自动重试；允许用户重新开启后核实原任务。

## 当前证据

桌面定向检查覆盖独立许可、撤销／重启不恢复、实际 Runtime 幂等任务交接、版本变化阻断和主对话任务回执。使用合成邮箱信头与显式 Fake 协调器；不构成真实 QQ、Laya 或 AgentArts 验收。设备与云端验收合并到对应实际链路，未重复调用真实账号。
