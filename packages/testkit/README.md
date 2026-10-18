# Fake 联调包（MOD-02）

<!-- architecture-scope-20261013 -->
## 当前架构职责

目标profile：huawei_ict_agentarts。工程责任：MOD-02（goo122）。产品流程：F01、F02、F24、F25、F28；逐节点流程见[WORKFLOWS](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md)，主架构见[DESIGN](../../docs/design/workflow-architecture-20261013/DESIGN.md)，模块接线见[MODULES](../../docs/design/workflow-architecture-20261013/MODULES.md)。

复用既有公开契约与宿主注册，将所列功能的节点输入/输出映射到实际能力，交付必要消费接线。

当前实验由本机Laya提供有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，本模块提供实际能力或候选，模型不能代签授权/宣布主任务成功。调用仍经既有公开端口、Runtime/Policy/ToolGateway或ModelGateway；同资源写入、取消、版本、结果未知与Evidence沿用既有语义。模板依赖由自有ARM64镜像串行推进；并行和机会影子尚需实际验收，架构未最终定型。

本轮仅重写架构说明。具体方法/配置/真实证据以当前源码与下面技术参考为准；这些参考的历史阶段不覆盖[当前接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)，也不证明新责任/语音/影子接线已经完成。

## 现有API、运行说明与历史验证参考
<!-- /architecture-scope-20261013 -->

负责人 goo122；评审者 zemeng。包版本 0.1.0-alpha.1。所有演示内容均为 mock，无模型、外部账号或私人数据调用。

Testkit 为接口形状和失败分支提供可重复替身，不决定生产可用性。Core Runtime Profile 1 的 Fake 已参与冻结验收；Model/Agent/Tool、设置、连接器和语音等 Fake 不会把对应能力提升为 `frozen`。精确状态见[当前接口目录](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md)。

当前新增夹具只服务 [Huawei ICT AgentArts Competition Profile](../../docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md)：后续需提供显式 `FakeCloudAgent`、deployment/trace、工具提案和防静默回退场景，但它们不能替代真实 AgentArts 项目、部署、API 和评估读回。Local 现有 Fake 保留，不形成当前新增工作。

```sh
npm ci
npm run check
npm run demo:protocol
```

以上命令在仓库根目录执行。演示包括消费者消息往返、取消受理到终态，以及 examples/connector-provider.mjs 的 register(host) / dispose 连接器提供者示例。

## 六种固定场景

new FakeRuntime({mode: 'test', scenario}) 必须显式选择测试模式。NODE_ENV=production 时拒绝构造；生产装配不得引用 testkit 作为自动降级实现。Client 的时钟应注入 runtime.clock.now。

| scenario | 测试驱动 | 预期 |
| --- | --- | --- |
| success | submit 后调用 advance 四次 | created → planning → running → verifying → succeeded |
| failure | advance 三次 | failed，固定结构化错误 |
| approval | advance 两次，再 authorization.respond | 等待授权，版本冲突拒绝；允许后推进，拒绝则取消 |
| cancel | task.cancel，再 advance | 先 cancelling，确认停止后 cancelled |
| unknown_write | advance 三次，调用 reconcile | waiting_reconciliation；确认已发生则 succeeded，未发生且请求取消则 cancelled |
| reconnect | EventCursor 保存序号，再订阅/回放 | 顺序、去重；超过 replayLimit 时 CURSOR_EXPIRED |

advance/reconcile/readEvents 是测试驱动 API，不是公开 IPC operation；没有定时器伪装业务进度。六场景内不执行真实写入；unknown_write 检查的是模拟状态分支，不能证明任意平台 exactly-once。

FakeRuntime 的幂等记录只保留在当前实例内，无期限和重启保证；Fake Runtime 是内存场景驱动，不是 MOD-03 持久任务引擎。其 settings 为测试配置，拒绝明显凭据字段，生产配置 Schema 与凭据流程由后续模块完成。voice/tool/connector 真实操作未注册时返回不支持，客户端能力列表不会宣称已接通。

FakeClock 可显式推进；FakeStorage 按命名空间隔离并返回副本；FakeToolHost 校验输入输出、范围、deadline 和取消，超时不自动重试；不合作的工具即使收到取消仍可能继续运行，因此这不构成操作系统隔离。FakeConnector 提供按账号分页、搜索、读回与连接状态，写操作返回不支持。

## 本地证据

2026-09-05：Node 24.15.0、npm 11.12.1。npm run check 通过：storage 4、contracts 4、client 5、testkit 13，共 26 项。包括 MOD-01 数据迁移回滚/跨进程读回、MOD-02 六场景、工具执行中取消/超时，以及 SQLite 持久化协议事件后再迁移和回放的跨模块测试。生成文件一致性和严格类型检查通过。

npm run demo:protocol 已执行，展示 mock 取消状态及夹具来源。项目内 .cache/clean-mod-02 独立源码副本未复制 node_modules、dist 或数据库，npm ci、npm run check（26/26）、npm run dev、npm run demo:protocol 全部通过。测试数据在项目内 .cache 下，未加载 .env。此段是 2026-09-05 的历史证据；当前冻结结论以接口目录及 PR #34 的消费验证为准。
