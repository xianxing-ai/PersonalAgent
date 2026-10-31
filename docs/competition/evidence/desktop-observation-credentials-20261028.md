# Desktop AgentArts observation credentials (2026-10-28)

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/zemeng-production-wiring`。

## 行为

- 受信宿主 `createAgentArtsObservationConfig` 经 Electron `safeStorage` 加密保存观测 AK/SK（可选 securityToken）与平台 `applicationId`（resource_id）。
- `resolveDesktopAgentArtsObservation` 仅在设置存在时向 `createAgentArtsRuntimeApplication` 注入 `observationAuthorization` / `observationApplicationId`。
- 缺省保持显式 unavailable：不静默 Fake、不复用 invoke Bearer。
- 签名范围固定为 cn-southwest-2 的 ShowOpsTrace / ListOpsAgentRunLog GET。

## 配置方式

1. 设置 IPC：`agentarts.observation.configure` / `agentarts.observation.revoke`（需重启 Runtime 装配生效）。
2. 或受信环境变量：
   - `PA_AGENTARTS_OBSERVATION_ACCESS_KEY`
   - `PA_AGENTARTS_OBSERVATION_SECRET_KEY`
   - `PA_AGENTARTS_OBSERVATION_APPLICATION_ID`
   - 可选 `PA_AGENTARTS_OBSERVATION_SECURITY_TOKEN`

## 验证

```text
node --test --test-concurrency=1 apps/desktop/test/agentarts-observation-config.test.mjs
```

Fake signer 覆盖：缺省省略选项、加密保存不回显密钥、注入 authorize 不含 Bearer、生产签名器拒绝非观测 URL、撤销后恢复 unavailable。真实平台读回未在本笔记执行。
