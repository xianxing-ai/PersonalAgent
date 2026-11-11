# ADR-0043：用户可调的风险分级自主档

- 状态：proposed；日期：2026-11-11。
- Profile：`huawei_ict_agentarts`；MOD-28；负责人 zemeng5208。
- 依赖：现有 `AuthorizationPolicy.grant` / `authorize` / `revoke`。不修改这些方法的语义。

## 背景与决定

产品默认自主，只有高风险或不可逆动作才先问。当前运行时只有近似两档：`automaticTools` 里的低风险只读可以直接做，其余进入 `waiting_approval` / `allow_once`。没有“做完再通知”的中间档，也没有用户可调设置。

本决定新增独立配置层 `@personal-agent/autonomy`：

- 低风险直接做。
- 中风险只包括有补偿动作的工具：做完立即通知，并保留补偿请求。补偿请求不自己执行工具。
- 高风险，以及发消息、付款、删除、对外提交，先问。这些类别不能被覆盖成自动执行。
- 全局档位为 `conservative` / `balanced` / `autonomous`，默认 `autonomous`。类别覆盖和整档撤销立即影响后续决定。
- 每次自动执行写审计和通知记录。记录不含工具参数正文。

`applyAutonomyGrant` 只在允许自动执行时调用现有 Policy `grant`。Runtime 增加可选 `riskAutonomy` 钩子：未安装时 `automaticTools` 行为不变；安装后由该钩子决定是否走原来的一次性例行授权。钩子本身拒绝外部写、需要在场、不可逆，以及没有补偿的写。Policy 核心没有新的授权算法。

PR #531 的 `standingAutonomy` 是尚未进入 main 的仓库级开发者常驻授权。本决定不复制那套仓库 grant、限额和 observe/suggest 级别，避免在 Policy 核心里做第二份实现。两套钩子名称不同，合并时由 Policy/Runtime 维护者决定调用顺序。

## 兼容与验证

没有新的 wire operation、数据库迁移或 Renderer 设置页。Desktop 只消费 `describeSettings()`，界面留给前端负责人。业务连接器实现不改。撤销不删除已有审计；已记录的补偿请求在撤销后仍可查询。

默认测试使用显式合成工具和内存配置。这不证明真实通知渠道、真实回滚或 AgentArts 部署已经验收。接口保持 provisional。

## 替代方案

把分类放进 `AuthorizationPolicy.grant` 会让用户批准的一次性授权和自动授权共用一个闸，并且和 PR #531 尚未合并的 `packages/policy/src/autonomy.ts` 冲突。因此分类留在独立包，Policy 只接收已经决定允许的 `grant`。
