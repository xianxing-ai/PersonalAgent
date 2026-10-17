# V2 本地镜像与工程验证记录

目标为 `huawei_ict_agentarts` 的可接线测试镜像。历史运行、配置与协作者入口见 [TEST_IMAGE_V2](../../TEST_IMAGE_V2.md)。V2 当时预留的 `test-kit.json` 未生成；实际当前制品见 [V3交付](../../DELIVERY_20261015.md)，不能据此补造V2归档证据。

- [checks.json](checks.json)：最终全仓门禁通过；同时保留首轮 Windows EPERM 失败、单项复测及各自日志/时间范围。测试数为 runner 汇总，不能换算成独立业务任务数。
- [container-smoke.json](container-smoke.json)：实际 Linux ARM64 镜像、生产入口、非 root 用户与隔离网络测试。使用合成签名决策/历史记录，真实模型调用为零，平台连接未验。
- 工作流目录含 28 个功能与 185 个节点。Engine/HostBridge 的全部模板控制测试使用明确 Fake 外部端口；容器中实际调用 F20 控制及影子/回放服务。缺外部端口保持 unavailable。
- 同次 DeepSeek/Laya 参与、主任务优先、历史配对与隔离证明有协议及检查；本轮容器测试没有执行真实双模型推理，也未证明高级隔离影子业务端到端效果。
- F23 的比较、CAS、晋升回读与回滚已提供公开服务/adapter，配置宿主和原 Runtime 授权仍需协作者接线。原生平台评测/观测真实回读分别验收。
- 新 replay 服务复用冻结历史读取，未知反事实保持 unknown，历史写仅显示时间线。Engine 原 trace_replay 停点需通过 F22 adapter 显式消费公开服务。

本机 Laya 权重及运行方式保持原状。先前真实鹈鹕主/影子测试及其模型耗时见 [V1 实测记录](../test-image-v1-20261015/live-test-results.json)，该记录独立于 V2 的离线/容器测试。

下一轮算法输入见 [增量工作流设计交接](../../../design/incremental-workflow-algorithm-20261015.md)，模型只读研究见 [候选报告](../../research/DECISION_MODEL_OPTIONS_20261015.md)。本轮保留暂停中的最小修复算法工作，未更换模型、训练权重、确定最终架构或发布镜像。
