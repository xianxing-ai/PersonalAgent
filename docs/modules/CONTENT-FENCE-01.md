# 外部内容围栏

目标 profile：`huawei_ict_agentarts`。在现有审批和「不可信数据」提示之外，给邮件、网页、文件和工具结果加上来源围栏。

- 策略：`packages/policy/src/content-fence.ts`。围栏文本声明自己是数据，伪造的结束标记不能提前闭合。
- 产品接线：Competition 启动在原工具列表上调用 `createContentFenceProduct().wrapTools`。快照字段 `contentFence` 经现有 `desktop:action` 与 preload 的 `invoke` 到达工作区状态行。
- 发送、删除、付款仍走原 Policy。本任务已经读入外部内容时，除非用户目标自己写明该操作，且没有把决定交给邮件、网页、文件或工具结果，否则直接拒绝。
- 标识字段和放不下围栏的限长字段保持原样，来源仍记在快照里。没有外部读回，也不把围栏当成新的授权。
