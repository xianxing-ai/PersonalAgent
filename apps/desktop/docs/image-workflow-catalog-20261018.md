# 28 图只读对话目录

`createImageWorkflowCatalogHost({getApplication})` 返回 `.tools/.competitionToolAvailability/.competitionToolExports/close()`。主组合将三数组接入原 Competition 目录，可显式 automatic 唯一只读工具 `workflow.image.catalog@1.0.0`；`workflowId` 可省略，或取 F01..F28，`publicEnumPaths` 已声明。Live 通过同一 Runtime 的静态目录发现 Schema，实际读取仍交给原 request_work/user-work/Gateway。

设计来源严格复用 `@personal-agent/agentarts` 公开 `getOwnedWorkflowTemplates()`、`getOwnedWorkflowDesignCoverage()`、`getOwnedWorkflowAdapterRequirements()`。28 图/185 节点是设计覆盖；152 项是111 host+41 guard 的 adapter 要求，不是节点数或完成数。

输出逐图给出公开名称/摘要、节点计数、入口状态、adapter 注册状态、required tool 缺项及精确缺失名字；选择单图时另给该图全部节点的公开 id/label/kind。只比较原 Registry 中公开要求的名字与版本，不调用 availability 或工具，不投影任意工具 Schema、路径、私有配置、凭据、checkpoint 或 proof。结果至多64KiB；导出重新核对同一原任务与当前注册快照，变化则拒绝旧投影。

唯一识别的图入口为 F15 的 `coding.repair.workflow@1.0.0`。入口存在只标 `entry_registered_requires_task_authorization`，仍不证明 readiness、授权或执行成功；缺 adapter/tool 时逐项 unavailable。其他图没有 generic 对话入口，F20 即使无 host/guard 需求仍 unavailable。独立 developer、知识、待办和 Windows 工具不计算成整图已接通。`remoteImageVerification:'unverified'` 明确本地静态目录不是远端镜像命中或真实执行证据。

Local/Synthetic 专测覆盖公开计数、F15 精确注册与版本、F20 无入口、拒绝模型传入 task/advance/proof、无私有元数据出口，以及原 user-work 子任务的发现→原 Gateway 执行→模型结果续答。未调用云、镜像 advance、Laya 或真实 Windows。
