# 接口与能力目录

[CURRENT_INTERFACE_CATALOG](CURRENT_INTERFACE_CATALOG.md)为接口状态唯一登记；[公共协议](../DEVELOPMENT_PROTOCOL.md)说明调用语义，[主架构](../design/workflow-architecture-20261013/DESIGN.md)说明目标。类型/Schema/配置不是生产能力。

本轮保留wire 1.0.0冻结子集、独立云transport 0.1.0及原候选语义。责任、语音问题绑定、图节点和影子字段是待适配设计，不新增临时DTO。host-only端口与wire能力分开；不可用返回UNSUPPORTED_CAPABILITY，不隐式使用Fake。

- [Windows Host内部契约](WINDOWS_HOST_CONTRACT.md)
- [日历投影](P1-CALENDAR-P5-PROJECTION.md)
- [邮件分页](P1-MAIL-P5-PAGINATION.md)
- [Competition公共枚举](COMPETITION_PUBLIC_ENUMS.md)

变更按单一Schema/生成器、版本、失败夹具、消费者接线和实际验证更新目录，不由本次文档重写提升冻结范围。
