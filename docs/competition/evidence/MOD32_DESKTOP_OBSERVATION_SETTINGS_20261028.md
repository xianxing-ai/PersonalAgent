# MOD-32 Desktop observation settings wiring（2026-10-28）

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/zemeng-production-wiring`。

## 行为

- 新增受信 `createAgentArtsObservationConfig`（safeStorage 加密文件
  `agentarts-observation-config.json`，或环境变量）。
- `resolveDesktopAgentArtsObservation` 仅在存在观测 AK/SK 时注入
  `observationAuthorization`；有 `applicationId` 时注入
  `observationApplicationId`；缺省不传参，Runtime 保持显式 unavailable。
- **不**复用 invoke Bearer；**不**静默 Fake。

## 配置方式

1. 设置页命令：`agentarts.observation.configure` /
   `agentarts.observation.revoke`（需重启生效）。
2. 或受信主机环境变量：
   - `PA_AGENTARTS_OBSERVATION_ACCESS_KEY`
   - `PA_AGENTARTS_OBSERVATION_SECRET_KEY`
   - `PA_AGENTARTS_OBSERVATION_SECURITY_TOKEN`（可选）
   - `PA_AGENTARTS_OBSERVATION_APPLICATION_ID`（可选；缺则 correlation=`not_checked`）

## 验证

- `node --test apps/desktop/test/agentarts-observation-wiring.test.mjs`
- 真实云端 ShowOpsTrace / ListOpsAgentRunLog 读回仍未在本机执行。
