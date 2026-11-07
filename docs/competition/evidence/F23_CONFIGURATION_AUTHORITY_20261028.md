# F23 配置权威来源与未验证边界（2026-10-28）

Profile：`huawei_ict_agentarts`；工作树：`.worktrees/image28-full-wiring`；状态：**未完成生产装配，真实配置消费者与评测证据缺失时保持 unavailable**。本记录对应 Owner 授权代实现的 goo122 原维护范围，长期维护归属不变。

## 已实现与本地证据

- [Runtime 配置端口](../../../apps/runtime/src/application/workflow-shadow-configuration.ts)使用现有 TaskRuntime SQLite 受信 host-state；配置和操作记录在同一 CAS 中提交，提交时重验同一 Runtime 的授权与版本化 acceptance。未知写入必须按原 operation 读回，不能盲重试。显式初始化需要独立的可信迁移授权。
- [授权适配器](../../../apps/runtime/src/application/workflow-shadow-authorization.ts)、[acceptance 管理口](../../../apps/runtime/src/application/workflow-shadow-acceptance.ts)和[只读验证器](../../../apps/runtime/src/application/workflow-shadow-verifiers.ts)提供受信上下文及记录校验；它们本身不生成真实评测通过事实，也不证明配置已被实际决策消费者应用。
- Node 24.15.0 定向命令：`node --test --test-concurrency=1 apps/runtime/test/workflow-shadow-authorization.test.mjs apps/runtime/test/workflow-shadow-configuration.test.mjs apps/runtime/test/workflow-shadow-acceptance.test.mjs apps/runtime/test/workflow-shadow-verifiers.test.mjs`，**15/15 通过**。这是使用本地 SQLite、受控任务与合成证据的测试，不是实际云端配置、真实模型或整图验收。

## 现有配置读取点

- [image-services.mjs](../../../apps/agentarts-runtime/src/image-services.mjs)从 operator 的启动配置读取 `shadowPolicy`，并将其传给 shadow controller；[shadow-controller.mjs](../../../apps/agentarts-runtime/src/shadow-controller.mjs)校验并克隆此策略，用于影子采样和比较。没有据此证明它读取 Runtime 的配置账本或支持运行时版本发布及应用读回。
- [owned-workflow-host-bridge.ts](../../../packages/agentarts/src/owned-workflow-host-bridge.ts)在本机影子策略计算中消费注入的 `policyConfig`。该 F22 策略消费不能证明 F23 所指决策配置或云端 Laya 参数已经生效。
- [local-laya.mjs](../../../apps/agentarts-runtime/src/local-laya.mjs)标注为本地可信宿主入口，并注明云主入口不导入或启动它；其可选使用的 [adaptive-decision.mjs](../../../apps/agentarts-runtime/src/adaptive-decision.mjs)是实验性选择器。不能由此推断当前云端选择器的实际运行路径或配置版本。

## 未交付和下一步

1. 需要确认实际决策配置的权威消费者和参数契约，并提供经授权的版本化发布、应用及消费者侧 revision/参数 digest 读回；应明确处理跨进程或跨云边界的结果未知与原操作对账。本地 CAS 成功仅证明本地记录提交。
2. 需要由真实受控运行产生与原任务、session、revision、baseline、候选参数和验收条件逐项绑定的测试 Evidence；独立验证器必须能够核对实际来源、检查与结果，缺少事实时拒绝或 unavailable。
3. Desktop/Runtime 尚未完整装配上述真实消费者、验证来源及相应许可，F23 N04/N05 的已有工厂不等于端到端注册或生产可用。本记录不声称真实 AgentArts 平台写入、云 Laya 配置生效或真实评测通过。
