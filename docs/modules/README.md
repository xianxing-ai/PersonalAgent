# 模块设计与验收入口

当前目标由[主架构](../design/workflow-architecture-20261013/DESIGN.md)、[28工作流](../design/workflow-architecture-20261013/WORKFLOWS.md)和[39模块责任](../MODULE_ASSIGNMENTS.md)定义。[接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)是能力与冻结状态依据。

本目录MOD/MVP文件是独立工作包、实现说明及历史验收，保留原作者/日期/PR和验证范围；它们不再各自定义第二套当前架构。旧Laya、旧双人阅读及未集成描述按当时基线理解，当前迁移见[IMPLEMENTATION](../design/workflow-architecture-20261013/IMPLEMENTATION.md)。

开工按[TEMPLATE](TEMPLATE.md)写明profile、负责人、代码所有权、F功能映射、公开依赖、接线、兼容与验收。模块从端口到消费者完成必要闭环，缺服务使用明确Fake/Unavailable，真实场景另记。设计/模型复评/CI均不自动把整MOD标done。
