# ADR-0043：用户可调的风险分级自主档

- 状态：proposed；日期：2026-11-11。
- Profile：`huawei_ict_agentarts`；MOD-28；负责人 zemeng5208。
- 依赖：现有 `AuthorizationPolicy.grant` / `authorize` / `revoke`。不修改这些方法的语义。

## 背景与决定

产品默认自主，只有高风险或不可逆动作才先问。当前运行时只有近似两档：`automaticTools` 里的低风险只读可以直接做，其余进入 `waiting_approval` / `allow_once`。没有“做完再通知”的中间档，也没有用户可调设置。

本决定新增独立配置层 `@personal-agent/autonomy`。产品 Desktop 创建 Runtime 时默认传入自主档。库构造不传或传入 `riskAutonomy: false` 时只保留原来的 `automaticTools`。未列入分类表的工具也继续沿用该白名单。不可逆、外部写和需要在场的动作不会因此自动执行。

中风险只有在执行成功后才经现有桌面通知端口投递。用户点击通知时，宿主提交已经保存的补偿调用，并走原来的一次性审批确认。设置写入桌面加密模块记录。设置页只保留档位、两类覆盖、一个撤销按钮和最近记录。

- 低风险直接做。
- 中风险只包括有补偿动作的工具：成功后立即通知。用户点击通知后，宿主才提交已保存的补偿调用。
- 高风险，以及发消息、付款、删除、对外提交，先问。这些类别不能被覆盖成自动执行。
- 全局档位为 `conservative` / `balanced` / `autonomous`，默认 `autonomous`。类别覆盖和整档撤销立即影响后续决定。
- 每次自动执行写审计。中风险成功后另写一条桌面通知。记录不含工具参数正文。

`applyAutonomyGrant` 只在允许自动执行时调用现有 Policy `grant`。产品 Desktop 默认把自主档交给 Runtime。不传或 `riskAutonomy: false` 时仍按 `automaticTools` 放行。钩子拒绝外部写、需要在场和不可逆动作。Policy 核心没有新的授权算法。

PR #531 的 `standingAutonomy` 是尚未进入 main 的仓库级开发者常驻授权。本决定不复制那套仓库 grant、限额和 observe/suggest 级别，避免在 Policy 核心里做第二份实现。两套钩子名称不同，合并时由 Policy/Runtime 维护者决定调用顺序。

## 兼容与验证

没有新的 wire operation、数据库迁移或 Renderer 设置页。Desktop 只消费 `describeSettings()`，界面留给前端负责人。业务连接器实现不改。撤销不删除已有审计；已记录的补偿请求在撤销后仍可查询。

默认测试使用显式合成工具和内存配置。这不证明真实通知渠道、真实回滚或 AgentArts 部署已经验收。接口保持 provisional。

## 替代方案

把分类放进 `AuthorizationPolicy.grant` 会让用户批准的一次性授权和自动授权共用一个闸，并且和 PR #531 尚未合并的 `packages/policy/src/autonomy.ts` 冲突。因此分类留在独立包，Policy 只接收已经决定允许的 `grant`。
