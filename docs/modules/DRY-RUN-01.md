# 影子工作流试运行预览

目标 profile：`huawei_ict_agentarts`。

桌面设置的「高级设置 → 实验性功能」提供「影子工作流试运行预览」，默认关闭。
开启后，当前任务模型可按需调用 `workflow.shadow_preview@1.0.0`，提供拟议工具及参数。

预览从本机 TaskRuntime 读取同一任务已确认的记录，做只读回放并返回动作和历史操作计数。
它不会执行拟议工具。实际操作继续经过原 Runtime、Policy 和工具结果核验。
