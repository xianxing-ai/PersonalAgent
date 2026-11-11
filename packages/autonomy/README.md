# 用户风险档（MOD-28）

<!-- current-design-20261009 -->
> 当前设计与协作入口（2026-10-17）：[当前详细设计](../../docs/design/CURRENT_DESIGN_20261015.md) · [逐图状态](../../docs/design/WORKFLOW_STATUS_20261015.md) · [历史设计导航](../../docs/design/README.md)。当前协作者为 zemeng5208、goo122、Potatos498、2511375597-lab；审查及合并规则以 [CONTRIBUTING](../../CONTRIBUTING.md) 和 [AGENTS](../../AGENTS.md) 为准，模块/文件所有权以 [MODULE_ASSIGNMENTS](../../docs/MODULE_ASSIGNMENTS.md) 为准。

目标 profile：`huawei_ict_agentarts`。负责人：zemeng5208。这是独立的用户风险配置层，不是 Policy 授权核心，也不替代 PR #531 尚未进入 main 的仓库级常驻开发授权。

## 行为

默认档位是 `autonomous`。Runtime 在未传入 `riskAutonomy: false` 时使用这一档。分类表中的低风险直接做，有补偿的中风险在执行成功后走桌面通知端口；点击该通知才提交补偿调用。未列入分类表的工具仍按原来的 `automaticTools` 放行。发消息、付款、删除、对外提交不能被覆盖成自动执行。

设置保存在桌面既有加密模块记录 `risk-autonomy.json`。设置页只放档位、收起的两类覆盖、一个撤销/恢复按钮，以及最近自动执行文字列表。没有统计、保存或刷新按钮。不可逆类别没有单独控件。

| 档位 | 低风险只读 | 有补偿的中风险 | 高风险 / 不可逆 |
| --- | --- | --- | --- |
| `conservative` | 先问 | 先问 | 先问 |
| `balanced` | 直接做 | 先问 | 先问 |
| `autonomous` | 直接做 | 做完立即通知，并可请求补偿 | 先问 |

中风险只发给声明了补偿动作的工具。发消息、付款、删除、对外提交永远至少先问，类别覆盖不能把它们改成自动执行。撤销立即停止后续自动执行；已经记下的补偿请求仍然可以查询。每次自动执行都写审计，并写一条通知记录。`execute_and_notify` 的通知是立即可见的。

分类表在 `RISK_CLASSIFICATION_TABLE`。未列入的工具按名称、`action` 和工具描述符归类。描述符的 `external_write` 和 `requiresPresence` 只会把结果收紧，不能把不可逆动作降成自动。

## 和现有 Policy 的关系

`applyAutonomyGrant` 只在决定为 `execute` 或 `execute_and_notify` 时调用现有 `AuthorizationPolicy.grant`。`ask` 不签发授权。Policy 的 `authorize` / `revoke` 语义没有改。

Runtime 增加了可选 `riskAutonomy` 钩子。未传入时，原来的 `automaticTools` 行为不变。传入后，由本包的 `createRiskAutonomyGate` 决定是否走原有的一次性例行授权；外部写、需要在场、不可逆，以及没有补偿的写，仍进入原来的 `waiting_approval`。这段接线请 goo122 复核。

PR #531（`codex/image28-full-wiring`）里的 `standingAutonomy` 是按仓库登记的开发者常驻授权，级别为 observe / suggest / act_reversible / act_all_but_irreversible，并且还没有进入 main。本包不复制那套 grant、限额和仓库范围，避免两套实现叠在 Policy 核心里。

设置界面只提供 `describeSettings()`。Desktop Renderer 与业务连接器不在本包。

## 验证

```sh
npm run build --workspace=@personal-agent/autonomy
npm run test --workspace=@personal-agent/autonomy
node --test apps/runtime/test/risk-autonomy-gate.test.mjs
```

接口状态为 provisional。Fake 通过不代表真实渠道通知或真实回滚已经验收。
